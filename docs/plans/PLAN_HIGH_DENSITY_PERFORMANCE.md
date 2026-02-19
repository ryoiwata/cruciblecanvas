# High-Density Performance Plan
## CrucibleCanvas — 7,000+ Objects at 60 FPS

---

## 1. Context & Targets

| Metric                    | Current (est.) | Target         |
|---------------------------|----------------|----------------|
| Frame rate (pan/zoom)     | ~40–50 FPS     | 60 FPS         |
| Frame rate (drag)         | ~20–30 FPS     | 60 FPS         |
| Object sync latency       | <200ms         | <100ms         |
| Cursor sync latency       | ~30ms          | <50ms          |
| Max objects before drop   | ~500           | 7,000+         |
| Concurrent users          | 5              | 5+ no degradation |

The current codebase is well-structured with several optimizations already in place
(viewport culling, RAF-gated resize, granular lock listeners, batch Firestore sync).
However, scaling to 7,000+ objects requires a fundamentally different approach:
O(N) culling must be replaced with spatial indexing, drag event flooding must be
eliminated, and Konva's React reconciliation overhead must be bypassed for the
majority of objects at high density.

---

## 2. What Is Already Working (Preserve These)

These patterns are correct and must not be regressed:

- **Viewport culling** — `BoardObjects.tsx:72–117`, memoized with 200px padding
- **RAF-gated border resize** — `Canvas.tsx:650–691`, bypasses React reconciliation
- **Batch Firestore sync** — `useFirestoreSync.ts`, `batchUpsert` + `batchRemove`
- **Granular lock child listeners** — `useLockSync.ts` + `rtdb.ts:onLockChildEvents`
- **Granular cursor child listeners** — `CursorLayer.tsx:105–109`
- **`useShallow` in BoardObjects** — `BoardObjects.tsx:58–68`, 6 subscriptions → 1
- **Cursor throttle: time + distance** — `Canvas.tsx:41–42`, 16ms + 3px threshold
- **`locallyEditingIds` echo prevention** — `useFirestoreSync.ts:58`
- **`React.memo` on leaf objects** — `ShapeObject`, `StickyNote`, `ConnectorObject`
- **Connector culling by endpoint visibility** — `BoardObjects.tsx:101–110`

---

## 3. Performance Leaks Identified

Analysis of the live codebase found the following issues in priority order:

### LEAK-01 — Drag flooding (CRITICAL)
**File:** `src/components/canvas/ShapeObject.tsx:59–62`, `src/components/canvas/StickyNote.tsx`
**Impact:** 100–300 Zustand store mutations/second during drag. Each mutation spreads
the entire objects map (`{ ...state.objects, [id]: obj }`). At 7,000 objects, one
drag stroke = 7,000 object references copied 200 times/second.

```typescript
// Current (fires every Konva dragmove event, ~120 Hz):
const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
  const node = e.target;
  updateObjectLocal(object.id, { x: node.x(), y: node.y() });
};
```

Konva positions the node itself during drag — the store does not need to track
intermediate positions. Only `dragend` needs a store write + Firestore write.

### LEAK-02 — ConnectorObject subscribes to the entire objects map (CRITICAL)
**File:** `src/components/canvas/ConnectorObject.tsx:30`
**Impact:** Every single object change (any drag, any text edit) re-renders ALL
rendered connectors. With 500 connectors on screen, one drag event = 500 re-renders/frame.

```typescript
// Current: subscribes to full map
const objects = useObjectStore((s) => s.objects);
const startObj = objects[endpointIds[0]];
const endObj = objects[endpointIds[1]];
```

### LEAK-03 — O(N) spatial scan at 7,000 objects (CRITICAL for target scale)
**File:** `src/components/canvas/BoardObjects.tsx:79–116`
**Impact:** `Object.values(objects)` at 7,000 objects + culling loop = ~0.5ms per
call. With viewport updates at 60 Hz, this costs 30ms/sec of CPU just for culling.
At 500 objects this is fine; at 7,000 it becomes the dominant cost.

### LEAK-04 — Viewport RAF throttling not implemented (HIGH)
**File:** `src/components/canvas/Canvas.tsx` (pan/zoom handlers)
**Impact:** `setViewport()` called synchronously on every `wheel` event (10–15×
per scroll gesture) and every `mousemove` during pan. Each call triggers
`BoardObjects.useMemo` recomputation. Without RAF gating, culling runs at full
input event rate rather than display refresh rate.

### LEAK-05 — Canvas.tsx subscribes to full objects map reactively (MEDIUM)
**File:** `src/components/canvas/Canvas.tsx`
**Impact:** Canvas.tsx uses `const objects = useObjectStore((s) => s.objects)` for
operations that don't require reactive updates (clipboard, keyboard shortcuts, frame
nesting). This re-renders the entire Canvas component tree on every object change.

### LEAK-06 — Keyboard shortcut handler re-registers excessively (LOW)
**File:** `src/hooks/useKeyboardShortcuts.ts:302–316`
**Impact:** Large `useEffect` dependency array (`mode`, `performDelete`, `handleCopy`,
`handlePaste`, etc.) causes `window.removeEventListener` + `window.addEventListener`
on most user interactions. Observable as extra work in React Profiler.

### LEAK-07 — No level of detail (LOD) at extreme zoom-out (MEDIUM at 7k objects)
**File:** `src/components/canvas/BoardObjects.tsx`
**Impact:** At zoom < 0.1, rendering 7,000 StickyNote/ShapeObject React components
(even off-screen ones that escape culling due to large bounding boxes) still creates
thousands of Konva nodes. Each Konva node = a canvas draw call.

---

## 4. Architecture Overview

### Current Layer Structure (correct — preserve)

```
Layer 1 (Grid)         listening=false  — DotGrid (static dots)
Layer 2 (Objects)      listening=true   — BoardObjects (all interactive objects)
Layer 3 (Selection)    listening=true   — SelectionLayer + Transformer
Layer 4 (Cursors)      listening=false  — CursorLayer (remote cursor overlays)
```

This is architecturally sound. The planned refactors add optimizations _within_ each
layer, not additional layers.

### Proposed Additions for 7k+ Scale

```
Layer 2a (LOD Offscreen) listening=false — Konva.FastLayer, canvas-direct draw for
                                           objects outside viewport (density map)
Layer 2b (Objects)       listening=true  — Full React components for viewport objects
```

At 7,000 objects with viewport culling leaving ~200 on screen, Layer 2b handles ≤200
objects as today. Layer 2a renders a low-fidelity density overview for the minimap
(future) and does not participate in hit detection.

---

## 5. Implementation Plan

### Phase 1 — Eliminate Drag Flooding (LEAK-01, LEAK-02)
**Effort:** 1–2 days | **FPS gain:** +20–30 FPS during drag

#### 1.1 Remove `updateObjectLocal` from `handleDragMove`

**Files:** `src/components/canvas/ShapeObject.tsx`, `src/components/canvas/StickyNote.tsx`,
`src/components/canvas/FrameObject.tsx`

Konva handles the visual position of the node during drag natively. The store does
not need to track intermediate drag positions because `BoardObjects.useMemo` re-runs
`Object.values(objects)` only when `objects` changes — eliminating those intermediate
writes means the culling useMemo never fires during drag at all.

The position is written to store once on `dragend`, and Konva's own rendering keeps
the object visually at the correct position throughout the drag.

```typescript
// BEFORE — ShapeObject.tsx:59–62 (fires 100–300×/sec):
const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
  const node = e.target;
  updateObjectLocal(object.id, { x: node.x(), y: node.y() });
};

// AFTER — remove handleDragMove entirely, remove onDragMove prop:
// No handleDragMove function.
// Konva positions the node; store is only written on dragend.
```

**Connector position during drag**: ConnectorObject recomputes line geometry from
the objects store. Without intermediate store updates, the connector will snap to
the final position on dragend rather than tracking in real time. This is acceptable
for MVP. If live connector tracking is required, see Phase 3 (direct Konva connector
redraw via imperative refs).

#### 1.2 Narrow ConnectorObject store subscription

**File:** `src/components/canvas/ConnectorObject.tsx:30`

Replace the full objects map subscription with two narrow per-object subscriptions.
Zustand's selector equality check will only re-render the connector when one of its
two endpoint objects changes.

```typescript
// BEFORE:
const objects = useObjectStore((s) => s.objects);
const startObj = objects[endpointIds[0]];
const endObj = objects[endpointIds[1]];

// AFTER:
const startObj = useObjectStore((s) => s.objects[endpointIds[0]]);
const endObj = useObjectStore((s) => s.objects[endpointIds[1]]);
```

This is safe because `ConnectorObject` is wrapped in `React.memo` and receives
`object` (connector data) as a stable prop. Zustand will only schedule a re-render
when one of the specific endpoint objects changes identity.

---

### Phase 2 — Viewport RAF Throttling (LEAK-04)
**Effort:** 0.5 days | **FPS gain:** +5–10 FPS during pan/zoom

**File:** `src/components/canvas/Canvas.tsx`

Add a `pendingViewportRef` and `viewportRafRef` similar to the existing
`borderResizeRafRef` pattern. Coalesce all `setViewport` calls within a single
animation frame to one commit.

```typescript
// Add at component level alongside other refs:
const pendingViewportRef = useRef<{ x: number; y: number; scale: number } | null>(null);
const viewportRafRef = useRef<number | null>(null);

function flushViewport() {
  viewportRafRef.current = null;
  if (!pendingViewportRef.current) return;
  const { x, y, scale } = pendingViewportRef.current;
  pendingViewportRef.current = null;
  setViewport(x, y, scale);
}

// In handleWheel and the pan mousemove path:
// Replace direct setViewport(...) call with:
pendingViewportRef.current = { x: newX, y: newY, scale: newScale };
if (!viewportRafRef.current) {
  viewportRafRef.current = requestAnimationFrame(flushViewport);
}
```

**Cleanup:** Cancel the RAF on component unmount to avoid calling `setViewport` on
an unmounted component.

---

### Phase 3 — Narrow Canvas.tsx Reactive Subscriptions (LEAK-05)
**Effort:** 0.5 days | **FPS gain:** eliminates Canvas re-render on every object change

**File:** `src/components/canvas/Canvas.tsx`

Audit every `useObjectStore` subscription. Replace any usage inside event callbacks
(not JSX) with imperative `useObjectStore.getState()` reads. Reactive subscriptions
should only remain for values used in the JSX render output.

```typescript
// BEFORE (causes Canvas re-render on every object change):
const objects = useObjectStore((s) => s.objects);
// ... used only inside handleCopy, handleDelete, etc.

// AFTER (no subscription, reads state imperatively when needed):
// Remove the reactive subscription entirely.
// Inside callbacks:
const objects = useObjectStore.getState().objects;
```

Verify each usage: clipboard operations, keyboard shortcut handlers, frame nesting
helpers — all are event-driven and do not require reactivity.

---

### Phase 4 — Spatial Index for 7,000+ Object Culling (LEAK-03)
**Effort:** 3–4 days | **Required for 7k+ target**

At 7,000 objects, O(N) culling in `BoardObjects.tsx:79` creates unacceptable CPU
overhead. Replace the linear scan with an R-tree (or simple flat grid) that answers
"which objects intersect viewport?" in O(log N + k) time where k = result count.

#### 4.1 Choose spatial index implementation

Use `rbush` — a battle-tested, minimal R-tree library (~5KB) already used in
geospatial tools:

```bash
npm install rbush @types/rbush
```

#### 4.2 Maintain the R-tree in objectStore.ts

Add a spatial index as a non-reactive field (not in Zustand state) that updates
imperatively when objects are added, removed, or moved.

```typescript
// src/lib/store/objectStore.ts — add alongside the store:
import RBush from 'rbush';

interface SpatialItem {
  minX: number; minY: number; maxX: number; maxY: number;
  id: string;
}

export const spatialIndex = new RBush<SpatialItem>();

// Call after batchUpsert, upsertObject:
function rebuildSpatialIndex(objects: Record<string, BoardObject>) {
  spatialIndex.clear();
  const items: SpatialItem[] = Object.values(objects).map((obj) => ({
    minX: obj.x,
    minY: obj.y,
    maxX: obj.x + obj.width,
    maxY: obj.y + obj.height,
    id: obj.id,
  }));
  spatialIndex.load(items); // bulk load is O(N log N), faster than N inserts
}
```

For incremental updates (single object moved), use `spatialIndex.remove` +
`spatialIndex.insert` rather than full rebuild. Full rebuild only on `setObjects`
and `batchUpsert`.

#### 4.3 Update BoardObjects.tsx to use spatial query

```typescript
// BEFORE — O(N) linear scan:
for (const obj of allObjects) {
  if (obj.x + obj.width < vpLeft) continue;
  // ...
  layered.push(obj);
}

// AFTER — O(log N + k) spatial query:
import { spatialIndex } from '@/lib/store/objectStore';
const candidates = spatialIndex.search({
  minX: vpLeft, minY: vpTop,
  maxX: vpRight, maxY: vpBottom,
});
const layered = candidates
  .map((item) => objects[item.id])
  .filter(Boolean)
  .filter((obj) => obj.type !== 'connector');
```

#### 4.4 Keep connector culling endpoint-based

Connectors store no meaningful bounding box. Keep the existing endpoint-visibility
approach but use a `Set` built from the spatial query result instead of a separate
linear scan:

```typescript
const visibleIds = new Set(candidates.map((item) => item.id));
```

---

### Phase 5 — Level of Detail (LOD) Rendering (LEAK-07)
**Effort:** 2–3 days | **Required for 7k+ at extreme zoom-out**

When `stageScale < 0.15` (more than 6.7× zoomed out), individual object details
(text, borders, shadows) become invisible. Rendering full React components for
objects that are 3px squares wastes GPU budget.

#### 5.1 Add LOD threshold constant

```typescript
// src/lib/types.ts
export const LOD_SIMPLE_THRESHOLD = 0.15; // below this, render simplified shapes
export const LOD_INVISIBLE_THRESHOLD = 0.05; // below this, skip render entirely
```

#### 5.2 Modify leaf components to render simplified form

In `StickyNote.tsx`, `ShapeObject.tsx`, `FrameObject.tsx`: accept a `isSimpleLod`
prop. When true, render only a colored `Rect` or `Circle` (no text, no border, no
shadow). The hit area remains accurate.

```typescript
// ShapeObject.tsx — simplified rendering when zoom is extreme:
if (isSimpleLod) {
  return <Rect x={object.x} y={object.y} width={object.width}
               height={object.height} fill={object.color} listening={false} />;
}
// ... full rendering below
```

#### 5.3 Pass LOD flag from BoardObjects.tsx

```typescript
const isSimpleLod = stageScale < LOD_SIMPLE_THRESHOLD;
// Pass to each renderObject(..., isSimpleLod)
```

---

### Phase 6 — Keyboard Shortcut Stabilization (LEAK-06)
**Effort:** 1 hour

**File:** `src/hooks/useKeyboardShortcuts.ts`

Move all store reads inside the event handler body using `getState()` instead of
capturing them as hook dependencies. This makes the `useEffect` dependency array
stable (only changes when mode/editingObjectId change, not on every action).

```typescript
// BEFORE — dependency array causes re-registration on every action:
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    // uses: performDelete, handleCopy, handlePaste, ...
  }
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [mode, performDelete, handleCopy, handlePaste, handleDuplicate, handleSelectAll]);

// AFTER — stable handler, reads state imperatively:
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    const { selectedObjectIds, editingObjectId } = useCanvasStore.getState();
    const { objects } = useObjectStore.getState();
    // perform all operations using getState() — no closure over reactive values
  }
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [mode]); // only re-register when mode changes
```

---

### Phase 7 — Playwright Performance Test Infrastructure
**Effort:** 2 days

Create a testing mode that bypasses Firebase Auth and populates the board with
programmatically generated objects, enabling automated FPS regression testing.

#### 7.1 Performance bypass environment variable

Add to `.env.local` (development only):

```bash
NEXT_PUBLIC_PERF_BYPASS=true
PERF_BYPASS_BOARD_ID=perf-test-board-001
```

When `NEXT_PUBLIC_PERF_BYPASS=true`, the board page skips the Auth guard and
redirects directly to the test board. This enables Playwright to load the canvas
without OAuth.

#### 7.2 Seed script for 7,000 objects

**File:** `scripts/seed-perf-board.ts` (new)

```typescript
/**
 * seed-perf-board.ts
 * Populates a Firebase board with N test objects distributed across a large canvas.
 * Run: FIREBASE_ADMIN_SERVICE_ACCOUNT='...' npx ts-node scripts/seed-perf-board.ts
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BOARD_ID = process.env.PERF_BYPASS_BOARD_ID ?? 'perf-test-board-001';
const OBJECT_COUNT = 7000;
const CANVAS_SPREAD = 50_000; // 50k x 50k canvas units

// Distribution: 55% stickyNote, 20% rectangle, 10% circle, 10% frame, 5% connector
// Batch writes in groups of 500 (Firestore limit)
// Connectors reference randomly selected pairs of non-connector object IDs

// Each object: { id, type, x, y, width, height, color, zIndex, createdAt, ... }
```

#### 7.3 Playwright FPS measurement test

**File:** `tests/performance/fps-benchmark.spec.ts` (new)

```typescript
import { test, expect } from '@playwright/test';

test('maintains 60 FPS during pan with 7000 objects', async ({ page }) => {
  await page.goto(`/board/${process.env.PERF_BYPASS_BOARD_ID}`);
  await page.waitForSelector('[data-testid="canvas-ready"]');

  // Collect frame timestamps via Chrome DevTools Protocol
  const client = await page.context().newCDPSession(page);
  await client.send('Overlay.setShowFPSCounter', { show: true });

  // Simulate pan gesture
  await page.mouse.move(400, 400);
  await page.mouse.down();
  const frames: number[] = [];
  let lastT = performance.now();
  for (let i = 0; i < 200; i++) {
    await page.mouse.move(400 + i * 2, 400 + i);
    const t = performance.now();
    frames.push(t - lastT);
    lastT = t;
  }
  await page.mouse.up();

  const avgFrameMs = frames.reduce((a, b) => a + b, 0) / frames.length;
  const pct95FrameMs = frames.sort((a, b) => a - b)[Math.floor(frames.length * 0.95)];

  expect(avgFrameMs).toBeLessThan(16.7); // avg >= 60 FPS
  expect(pct95FrameMs).toBeLessThan(33.3); // p95 >= 30 FPS (no major hitches)
});
```

#### 7.4 canvas-ready sentinel

**File:** `src/app/board/[boardId]/page.tsx`

Add `data-testid="canvas-ready"` attribute to the stage wrapper once
`isLoaded === true`, enabling Playwright `waitForSelector` to gate test start on
full object load.

---

## 6. Implementation Checklist

### Phase 1 — Drag Flooding (LEAK-01 + LEAK-02)
- [ ] `ShapeObject.tsx`: Remove `handleDragMove` / `onDragMove` prop
- [ ] `StickyNote.tsx`: Remove `handleDragMove` / `onDragMove` prop
- [ ] `FrameObject.tsx`: Remove `handleDragMove` / `onDragMove` prop
- [ ] `ConnectorObject.tsx`: Replace `useObjectStore((s) => s.objects)` with two narrow
      per-endpoint selectors
- [ ] Manual test: drag a shape; connector endpoint should snap to final position on
      dragend; FPS counter should show steady 60 FPS during drag

### Phase 2 — Viewport RAF Throttle (LEAK-04)
- [ ] `Canvas.tsx`: Add `pendingViewportRef` + `viewportRafRef` + `flushViewport()`
- [ ] `Canvas.tsx` `handleWheel`: Replace synchronous `setViewport(...)` with
      `pendingViewportRef.current = ...`
- [ ] `Canvas.tsx` pan `mousemove` handler: Same replacement
- [ ] `Canvas.tsx` `useEffect` cleanup: Cancel `viewportRafRef.current` on unmount
- [ ] Manual test: scroll on large board; React Profiler shows `BoardObjects` renders
      ≤60 times/sec regardless of wheel event rate

### Phase 3 — Canvas.tsx Narrow Subscriptions (LEAK-05)
- [ ] `Canvas.tsx`: Audit all `useObjectStore` calls — list which are reactive vs.
      event-driven
- [ ] Move all event-driven reads to `useObjectStore.getState().objects` inside
      callbacks
- [ ] Manual test: React Profiler confirms `Canvas` does not re-render when a remote
      user moves an object (no reactive objects subscription in Canvas JSX)

### Phase 4 — R-tree Spatial Index (LEAK-03)
- [ ] `npm install rbush @types/rbush`
- [ ] `src/lib/store/objectStore.ts`: Export `spatialIndex` RBush instance
- [ ] `objectStore.ts` `setObjects`: Call `rebuildSpatialIndex(objects)` after set
- [ ] `objectStore.ts` `batchUpsert`: Incremental update — remove old items, insert
      new items (or full rebuild if count > threshold)
- [ ] `objectStore.ts` `batchRemove`: Remove items from spatial index
- [ ] `objectStore.ts` `updateObjectLocal`: Update spatial index for moved object
- [ ] `BoardObjects.tsx`: Replace O(N) loop with `spatialIndex.search(vpBounds)`
- [ ] Manual test with 7,000 seeded objects: pan across canvas at 60 FPS; check
      CPU usage in DevTools Performance tab

### Phase 5 — LOD Rendering (LEAK-07)
- [ ] `src/lib/types.ts`: Add `LOD_SIMPLE_THRESHOLD = 0.15` constant
- [ ] `BoardObjects.tsx`: Compute `isSimpleLod = stageScale < LOD_SIMPLE_THRESHOLD`
      and pass to `renderObject`
- [ ] `ShapeObject.tsx`: Render simplified `<Rect>` / `<Circle>` when `isSimpleLod`
- [ ] `StickyNote.tsx`: Render simplified `<Rect>` when `isSimpleLod`
- [ ] `FrameObject.tsx`: Render simplified `<Rect>` border when `isSimpleLod`
- [ ] Manual test: zoom out to see 1,000+ objects; FPS stays ≥60

### Phase 6 — Keyboard Shortcut Stabilization (LEAK-06)
- [ ] `useKeyboardShortcuts.ts`: Replace captured closure values with `getState()`
      reads inside handler
- [ ] Reduce `useEffect` dependency array to `[mode, editingObjectId]`
- [ ] Manual test: React Profiler; shortcut handler should not re-register on
      clipboard operations

### Phase 7 — Test Infrastructure
- [ ] Add `NEXT_PUBLIC_PERF_BYPASS` env var + bypass logic in `board/[boardId]/page.tsx`
- [ ] Create `scripts/seed-perf-board.ts` with 7,000 mixed-type objects
- [ ] Add `data-testid="canvas-ready"` sentinel to canvas wrapper
- [ ] Create `tests/performance/fps-benchmark.spec.ts` with pan + zoom tests
- [ ] CI: Add `npm run test:perf` script that runs Playwright perf suite in headful
      Chromium (FPS measurement requires GPU access)

---

## 7. Phased Rollout Schedule

| Phase | Bottleneck Addressed        | Est. Effort | Expected FPS Gain |
|-------|-----------------------------|-------------|-------------------|
| 1     | Drag flooding + connectors  | 1–2 days    | +20–30 FPS drag   |
| 2     | Viewport RAF throttle       | 0.5 days    | +5–10 FPS pan     |
| 3     | Canvas subscriptions        | 0.5 days    | eliminate cascades|
| 4     | R-tree spatial index        | 3–4 days    | enables 7k scale  |
| 5     | LOD rendering               | 2–3 days    | +10–15 FPS zoom   |
| 6     | Shortcut stabilization      | 1–2 hours   | cosmetic           |
| 7     | Test infrastructure         | 2 days      | measurement        |

Phases 1–3 can be executed immediately on the current codebase. Phase 4 has a
dependency on Phase 3 completing (ensures `updateObjectLocal` correctly updates the
spatial index only on meaningful position changes). Phase 5 depends on Phase 4 (LOD
only matters once the index enables 7k+ on screen).

---

## 8. Verification Protocol

### After Phase 1 (drag / connector fix)
1. Open board with 200 objects
2. Chrome DevTools → Performance → Record → drag 3 objects simultaneously for 5s
3. Verify: no frame >16.7ms (green in timeline); no `updateObjectLocal` calls during
   drag in React Profiler
4. Verify: `ConnectorObject` only re-renders when its endpoint objects move

### After Phase 2 (viewport RAF)
1. Chrome DevTools Performance → Record → 3s rapid scroll wheel
2. Verify: `BoardObjects` renders ≤60 times in the recording window
3. Verify: wheel event count in recording >> `setViewport` call count

### After Phase 4 (R-tree)
1. Seed board with 7,000 objects (`npm run seed-perf`)
2. Chrome DevTools Performance → Record → 5s pan across full canvas
3. Verify: culling useMemo fires ≤60/sec; avg frame <16.7ms
4. Verify: at any zoom level, React component tree contains ≤300 rendered objects

### After Phase 5 (LOD)
1. Zoom out to `stageScale = 0.05` (showing all 7,000 objects)
2. Record 3s pan — verify 60 FPS with simplified render forms visible

### After All Phases — Full Regression
1. Run Playwright test suite: `npm run test:perf`
2. Confirm `fps-benchmark.spec.ts` passes (avg frame <16.7ms, p95 <33ms)
3. Manual 5-user test: 5 browsers on same board, all drag simultaneously
4. Confirm no `Firestore onSnapshot error` messages under concurrent load
5. Confirm RTDB cursor writes rate ≤60/sec per user (Network → WS frames)

---

## 9. Out of Scope

- **Server-side rendering of board state** — SSR with 7,000 objects requires
  streaming; defer to after MVP
- **WebGL rendering** — Konva Canvas 2D is sufficient with LOD + spatial index at
  7k objects; WebGL adds complexity without proportional gain at this scale
- **Cloud Functions for spatial queries** — client-side R-tree is sufficient; server
  spatial query only needed for collaborative selection or server-authoritative
  physics
- **Object pagination / lazy load from Firestore** — single `onSnapshot` listener
  handles 7k objects; Firestore is not the bottleneck (rendering is)
- **Mobile support** — canvas is desktop-only by design (CLAUDE.md)

---

## 10. Critical Files Reference

| File | Change |
|------|--------|
| `src/components/canvas/ShapeObject.tsx` | Remove `onDragMove` / drag store flood |
| `src/components/canvas/StickyNote.tsx` | Remove `onDragMove` / drag store flood |
| `src/components/canvas/FrameObject.tsx` | Remove `onDragMove` / drag store flood |
| `src/components/canvas/ConnectorObject.tsx` | Narrow per-endpoint subscriptions |
| `src/components/canvas/Canvas.tsx` | RAF viewport, narrow objects subscription |
| `src/components/canvas/BoardObjects.tsx` | R-tree spatial query, LOD flag |
| `src/lib/store/objectStore.ts` | Export `spatialIndex`, maintain on mutations |
| `src/hooks/useKeyboardShortcuts.ts` | Stable dependency array via `getState()` |
| `src/lib/types.ts` | Add LOD threshold constants |
| `scripts/seed-perf-board.ts` | New: 7,000-object seeder |
| `tests/performance/fps-benchmark.spec.ts` | New: Playwright FPS test |
| `src/app/board/[boardId]/page.tsx` | Add canvas-ready sentinel + perf bypass |
