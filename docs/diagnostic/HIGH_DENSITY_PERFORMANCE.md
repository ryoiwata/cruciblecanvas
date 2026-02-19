# High-Density Performance Implementation

**Goal**: 60 FPS at 7,000+ objects during pan, zoom, and drag.
**Branch**: `user_and_more_item_performance`
**Plan reference**: `docs/plans/PLAN_HIGH_DENSITY_PERFORMANCE.md`
**Files changed**: `ShapeObject.tsx`, `StickyNote.tsx`, `FrameObject.tsx`, `ConnectorObject.tsx`, `BoardObjects.tsx`, `objectStore.ts`, `types.ts`, `useKeyboardShortcuts.ts`, `Canvas.tsx`, `board/[boardId]/page.tsx` + new `scripts/seed-perf-board.ts`, `tests/performance/fps-benchmark.spec.ts`, `src/types/rbush.d.ts`

---

## Leaks Identified and Fixed

### LEAK-01 — Drag flooding (Phase 1)

**Files**: `ShapeObject.tsx:59–62`, `StickyNote.tsx:71–74`, `FrameObject.tsx:77–88`

Each component had an `onDragMove` handler that called `updateObjectLocal` on every Konva `dragmove` event (~120 Hz). Each call spread the entire objects map (`{ ...state.objects, [id]: obj }`). At 7,000 objects, dragging one shape for one second wrote 7,000-object-reference copies 120 times — 840,000 object references allocated per second during drag.

Konva positions the node visually during drag without React involvement. The store only needs the final position (committed on `dragend`). The intermediate writes were purely wasteful.

**Fix**: Removed `handleDragMove` and the `onDragMove` prop from all three components. `handleDragEnd` (which already existed and wrote the final position) is unchanged.

```typescript
// REMOVED from ShapeObject.tsx, StickyNote.tsx, FrameObject.tsx:
const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
  const node = e.target;
  updateObjectLocal(object.id, { x: node.x(), y: node.y() });
};
// onDragMove={handleDragMove} prop removed from <Group>
```

**Trade-off**: Connectors whose endpoint is being dragged no longer track in real time — they snap to the final position on `dragend`. Acceptable for MVP; real-time connector tracking would require imperative Konva ref manipulation (Phase 3 of the plan, deferred).

For `FrameObject`, children also no longer move visually with the frame during drag (they snap on `dragend`). The `handleDragEnd` delta calculation using `preDragPos.current` and `childSnapshots.current` is intact.

---

### LEAK-02 — ConnectorObject subscribes to the full objects map (Phase 1)

**File**: `ConnectorObject.tsx:30`

```typescript
// BEFORE — re-renders every ConnectorObject on every object change anywhere:
const objects = useObjectStore((s) => s.objects);
const startObj = objects[endpointIds[0]];
const endObj = objects[endpointIds[1]];
```

With 500 rendered connectors, dragging any shape caused 500 ConnectorObject re-renders per frame.

**Fix**: Replaced the full-map subscription with two narrow per-endpoint selectors. Zustand's equality check only schedules a re-render when the specific endpoint object changes identity.

```typescript
// AFTER — each connector re-renders only when one of its two endpoints changes:
const endpointId0 = object.connectedTo?.[0] ?? '';
const endpointId1 = object.connectedTo?.[1] ?? '';
const startObj = useObjectStore((s) => (endpointId0 ? s.objects[endpointId0] : null) ?? null);
const endObj   = useObjectStore((s) => (endpointId1 ? s.objects[endpointId1] : null) ?? null);
```

Hooks are called unconditionally (before the existing early returns) — valid React.

---

### LEAK-03 — O(N) spatial scan for viewport culling (Phase 4)

**File**: `BoardObjects.tsx:79–116`

`Object.values(objects)` at 7,000 objects iterated every object on every viewport change. At 60 Hz pan this was ~0.5 ms/call × 60 = 30 ms/sec of CPU just for culling. At 7,000 objects it becomes the dominant cost.

**Fix**: Added an R-tree spatial index (`rbush`) maintained outside Zustand state. The index is updated imperatively on every object mutation; `BoardObjects` queries it with `spatialIndex.search(vpBounds)` for O(log N + k) culling.

**objectStore.ts** — new module-level state (not in Zustand, so mutations don't trigger re-renders):

```typescript
export const spatialIndex = new RBush<SpatialItem>();
const spatialItemMap = new Map<string, SpatialItem>(); // id → item for O(1) removal

// upsertSpatialItem / removeSpatialItem maintain the index incrementally.
// rebuildSpatialIndex is called on setObjects (initial load) — O(N log N) bulk load.
```

Every mutation path updates the index:
- `setObjects` → `rebuildSpatialIndex` (bulk load)
- `upsertObject`, `updateObjectLocal` → `upsertSpatialItem`
- `removeObject`, `batchRemove` → `removeSpatialItem`
- `batchUpsert` → `upsertSpatialItem` per item

Connectors are excluded from the index (they have no meaningful bounding box — `x=0,y=0,w=0,h=0`). Their culling is handled separately by endpoint visibility.

**BoardObjects.tsx** — replaces the linear scan:

```typescript
// BEFORE — O(N):
for (const obj of Object.values(objects)) {
  if (obj.x + obj.width < vpLeft) continue;
  // ...
}

// AFTER — O(log N + k):
const candidates = spatialIndex.search({ minX: vpLeft, minY: vpTop, maxX: vpRight, maxY: vpBottom });
const visibleIds = new Set(candidates.map((item: { id: string }) => item.id));
const layered = candidates
  .map((item: { id: string }) => objects[item.id])
  .filter((obj): obj is BoardObject => obj !== undefined);
```

**rbush type declarations**: `rbush` v4 ships no TypeScript types. Created `src/types/rbush.d.ts` with a minimal `declare module 'rbush'` covering the surface used.

---

### LEAK-04 — Viewport RAF throttling (Phase 2) — already implemented

`Canvas.tsx` already had `pendingViewportRef` + `viewportRafRef` + `flushViewport()` coalescing both `handleWheel` and pan `mousemove` to one `setViewport` per animation frame. No change needed.

---

### LEAK-05 — Canvas.tsx broad objects subscription (Phase 3) — already implemented

`Canvas.tsx` already used a narrow `connectorStartObj` selector for the only reactively-needed object. All other object access was already done via `useObjectStore.getState()` inside event callbacks. No change needed.

---

### LEAK-06 — Keyboard shortcut handler re-registers excessively (Phase 6)

**File**: `useKeyboardShortcuts.ts`

The `useEffect` dependency array included `selectedObjectIds`, `objects`, `performDelete`, `handleCopy`, `handlePaste`, `handleDuplicate`, `handleSelectAll`. Since `performDelete` et al. closed over `selectedObjectIds` and `objects`, any selection change or object change caused `window.removeEventListener` + `window.addEventListener` — observable in React Profiler as redundant effect runs.

**Fix**: Moved all reactive reads inside the event handler body using `getState()`. Each callback (`performDelete`, paste, duplicate, select-all, layering) now reads the store imperatively at call time rather than capturing it as a closure dependency.

```typescript
// BEFORE — handler re-registers on every selection/object change:
useEffect(() => { ... }, [mode, selectedObjectIds, editingObjectId, performDelete, handleCopy, ...]);

// AFTER — handler re-registers only when mode or editingObjectId change:
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const { selectedObjectIds: ids } = useCanvasStore.getState();
    const { objects } = useObjectStore.getState();
    // ...all operations use getState() reads
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [mode, editingObjectId, performDelete, boardId]);
// performDelete only depends on boardId (stable) — equivalent to [mode, editingObjectId]
```

`selectedObjectIds` is kept as a reactive subscription solely to expose `deleteCount` to the parent `DeleteDialog`.

---

### LEAK-07 — No level of detail at extreme zoom-out (Phase 5)

**Files**: `ShapeObject.tsx`, `StickyNote.tsx`, `FrameObject.tsx`, `BoardObjects.tsx`, `types.ts`

At `stageScale < 0.15`, individual objects are rendered as 2–5px squares. Rendering full React components (text, shadow, border, notepad lines) for objects smaller than a pixel wastes GPU budget.

**Fix**: Added LOD thresholds to `types.ts`:

```typescript
export const LOD_SIMPLE_THRESHOLD = 0.15;  // below → simplified shapes
export const LOD_INVISIBLE_THRESHOLD = 0.05; // below → skip entirely (future)
```

`BoardObjects.tsx` computes `isSimpleLod = stageScale < LOD_SIMPLE_THRESHOLD` and passes it to each leaf component. When `isSimpleLod` is true, each component returns a single colored `Rect` or `Circle` with `listening={false}` — no text, no shadow, no border, no notepad lines:

```typescript
// ShapeObject.tsx — early return after all hooks, before function definitions:
if (isSimpleLod) {
  return object.type === 'rectangle'
    ? <Rect x={object.x} y={object.y} width={object.width} height={object.height}
            fill={object.color} listening={false} />
    : <Circle x={object.x + object.width / 2} y={object.y + object.height / 2}
              radius={object.width / 2} fill={object.color} listening={false} />;
}
```

The `React.memo` comparator in each component was updated to include `isSimpleLod` to prevent stale renders when the LOD level changes.

**Pattern**: The LOD guard is placed after all hooks (valid React — hooks called unconditionally) but before the full-render function definitions. Returning before defining `handleDragStart` etc. is safe because those are plain function expressions, not hooks.

---

## Phase 2 & 3 Already Implemented

Both were already in place on the branch:

- **Phase 2**: `Canvas.tsx` already coalesces `handleWheel` and pan `mousemove` through a `viewportRafRef` / `pendingViewport` ref pattern identical to the plan's specification.
- **Phase 3**: `Canvas.tsx` had no broad `objects` subscription — only a narrow `connectorStartObj` selector for JSX, with all other object reads done imperatively inside event handlers via `getState()`.

---

## Test Infrastructure (Phase 7)

### Performance bypass

`board/[boardId]/page.tsx` — added `IS_PERF_BYPASS` flag that skips auth guard, auth loading state, and object-loading gate when `NEXT_PUBLIC_PERF_BYPASS=true`. Enables Playwright to load the canvas without OAuth.

### Canvas-ready sentinel

`Canvas.tsx` wrapper `<div>` now has `data-testid="canvas-ready"` so Playwright can reliably gate test start on full DOM render:

```typescript
<div data-testid="canvas-ready" style={{ width: "100vw", height: "100vh", ... }}>
```

### Seed script

`scripts/seed-perf-board.ts` — uses `firebase-admin` to batch-write 7,000 mixed-type objects across a 50,000 × 50,000 logical canvas. Distribution: 55% stickyNote, 20% rectangle, 10% circle, 10% frame, 5% connector. Connectors reference randomly paired non-connector objects. Writes in groups of 500 (Firestore batch limit).

```bash
FIREBASE_ADMIN_SERVICE_ACCOUNT='...' npm run seed-perf
# PERF_BYPASS_BOARD_ID=perf-test-board-001 (default)
```

### Playwright FPS benchmark

`tests/performance/fps-benchmark.spec.ts` — injects a `requestAnimationFrame` loop into the page to measure inter-frame durations while Playwright drives pan and zoom gestures. Asserts avg frame < 16.7 ms (60 FPS) and p95 < 33.3 ms (30 FPS floor).

```bash
npm run test:perf  # requires dev server + NEXT_PUBLIC_PERF_BYPASS=true
```

---

## Verification Protocol

### After Phase 1 (drag / connector fix)
1. Open board with 200 objects, open Chrome DevTools → Performance
2. Record while dragging 3 objects for 5 seconds
3. Confirm: no `updateObjectLocal` calls in timeline during drag (only on mouseup)
4. Confirm: `ConnectorObject` renders only when its endpoint object moves (React Profiler)

### After Phase 4 (R-tree)
1. Seed board: `npm run seed-perf`
2. Performance → Record 5s pan across canvas
3. Confirm: `BoardObjects` useMemo fires ≤60/sec; avg frame < 16.7 ms
4. Confirm: React tree contains ≤300 rendered objects at any zoom level

### After Phase 5 (LOD)
1. Zoom to `stageScale = 0.05` (all 7,000 objects visible)
2. Record 3s pan — confirm 60 FPS with simplified color squares visible

### After Phase 6 (shortcut stabilization)
1. React Profiler: trigger copy (Ctrl+C), paste, select-all
2. Confirm: `useKeyboardShortcuts` useEffect does **not** re-run (no listener re-registration)

### Full regression
```bash
npm run test:perf   # Playwright FPS suite
npm run build       # confirm zero type errors / lint warnings
```

---

## Packages Added

| Package | Version | Reason |
|---------|---------|--------|
| `rbush` | `^4.0.1` | R-tree spatial index for O(log N + k) viewport culling |
| `@playwright/test` | `^1.58.2` (devDep) | FPS benchmark test runner |

`src/types/rbush.d.ts` — minimal declaration file created because rbush v4 ships no TypeScript types and `@types/rbush` does not cover v4.
