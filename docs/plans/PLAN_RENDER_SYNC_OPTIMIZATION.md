# CrucibleCanvas Render & Sync Optimization Plan

## Audit Summary

After reading all key files, the previous performance plan (`performance_plan.MD`) has been
**fully implemented**. The following are already working correctly:

| Area | Status |
|------|--------|
| Batch Firestore docChanges → batchUpsert/batchRemove | ✅ done |
| Lock granular child listeners (onLockChildEvents, upsertLock, removeLock) | ✅ done |
| RAF viewport throttle (viewportRafRef + pendingViewport) | ✅ done |
| R-tree spatial index with incremental upsert/remove | ✅ done |
| Viewport culling + 200px buffer + connector endpoint culling | ✅ done |
| LOD rendering at zoom < 0.15 | ✅ done |
| Object component memoization with custom comparators | ✅ done |
| Single Firestore write per drag session (on dragEnd only) | ✅ done |
| Cursor granular child listeners + 16ms throttle (60 Hz) | ✅ done |
| CursorLayer React.memo + granular child listeners | ✅ done |
| Presence heartbeat lightweight (updatePresenceTimestamp) | ✅ done |
| locallyEditingIds echo prevention (border resize) | ✅ done |
| batchDraw for selection rect + border resize | ✅ done |
| 4-layer architecture, static layer listening={false} | ✅ done |
| useShallow in BoardObjects for 6-value viewport subscription | ✅ done |

---

## Newly Identified Issues

### Issue 1 — HIGH: All 7 object components subscribe to full `selectedObjectIds` array

**Files:** ShapeObject.tsx:41, ConnectorObject.tsx:39, StickyNote.tsx, FrameObject.tsx,
TextObject.tsx, LineObject.tsx, ColorLegendObject.tsx

**Problem:** Each object component contains:
```ts
const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
const isSelected = selectedObjectIds.includes(object.id);
```

`React.memo` only blocks re-renders triggered by parent prop changes. It cannot block
re-renders triggered by Zustand hook subscriptions inside the component. When the user
clicks any object, `selectedObjectIds` changes → all 500+ visible object components
re-render, even if their own selected state didn't change.

**Fix:** Narrow to a per-object boolean selector:
```ts
const isSelected = useCanvasStore((s) => s.selectedObjectIds.includes(object.id));
```

`Object.is` comparison on the returned boolean means only objects whose own selection
state changed will re-render.

**Expected impact:** ~500× reduction in re-renders per click/selection change.

---

### Issue 2 — MEDIUM: SelectionLayer subscribes to full `objects` map

**File:** SelectionLayer.tsx:75

**Problem:**
```ts
const objects = useObjectStore((s) => s.objects);
```
Used only to map `selectedObjectIds → selectedObjects` for Transformer config.
This causes SelectionLayer to re-render on every object change anywhere on the board.

**Fix:** Narrow to a selector that only extracts the currently selected objects:
```ts
const selectedObjects = useObjectStore((s) =>
  selectedObjectIds.map((id) => s.objects[id]).filter(Boolean)
);
```

Since `selectedObjectIds` is a separate subscription, this composed selector only
changes when a selected object's data changes — not on any object change.

---

### Issue 3 — MEDIUM: Multi-object transform writes N individual Firestore calls

**File:** SelectionLayer.tsx:191–282 (`handleTransformEnd`)

**Problem:** When resizing/rotating a group of N selected objects, `handleTransformEnd`
loops over `transformer.nodes()` and calls `updateObject(...)` for each node independently.
Resizing 50 objects = 50 simultaneous Firestore writes.

**Fix:** Collect all updates inside the loop, then execute a single `writeBatch()` call
after the loop. Firebase Firestore supports up to 500 writes per batch.

**Expected impact:** N Firestore round-trips → 1 per transform operation.

---

### Issue 4 — MEDIUM: handleDragMove frame detection is O(N) full scan

**Files:** ShapeObject.tsx:57–81, StickyNote.tsx (same pattern)

**Problem:** The RAF-throttled `handleDragMove` calls `Object.values(allObjects)` and
iterates every object looking for frame candidates. At 500 objects, this is 500 iterations
per RAF frame (~60×/sec = 30,000 iterations/sec) while dragging.

**Fix:** Replace with a spatial index query — search a box around the dragged object's
current position and filter results to `type === 'frame'`:
```ts
const candidates = spatialIndex.search({
  minX: curX - 20, minY: curY - 20,
  maxX: curX + object.width + 20, maxY: curY + object.height + 20,
});
// candidates already limited to nearby objects; filter to frames
```

Note: connectors are excluded from the spatial index, so no extra filtering needed for them.

**Expected impact:** O(N) → O(log N + k) frame detection per drag frame.

---

### Issue 5 — LOW: Cursor lerp not implemented

**File:** CursorLayer.tsx

**Problem:** Remote cursors jump to new positions rather than lerping. At typical cursor
update frequency (60 Hz sender), each received cursor update moves the cursor visually
~16ms of movement in one frame. This is fine. But with 2–3 users, intermittent network
jitter can cause noticeable cursor jumps.

**Fix:** Add a simple linear interpolation in `RemoteCursor` using a `useEffect` + RAF
loop that moves each cursor 30% of the remaining distance per frame (exponential ease-out),
targeting convergence within ~100ms.

**Expected impact:** Perceptibly smoother remote cursors; no measurable performance cost.

---

### Issue 6 — LOW: No cap on rendered remote cursors

**File:** CursorLayer.tsx

**Problem:** With many concurrent users, all remote cursors render with no limit.

**Fix:** Slice to the first 10 non-stale cursors. Beyond 10, remote users are visually
indistinguishable anyway.

---

## Implementation Plan

### Phase 1 — Fix selectedObjectIds Subscription (CRITICAL)

**Estimated scope:** 7 files, ~14 line changes total.

All 7 object components — ShapeObject, StickyNote, FrameObject, ConnectorObject,
TextObject, LineObject, ColorLegendObject — change:

```ts
// BEFORE (full array subscription — re-renders on any selection change):
const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
const isSelected = selectedObjectIds.includes(object.id);

// AFTER (narrow boolean selector — re-renders only when this object's state changes):
const isSelected = useCanvasStore((s) => s.selectedObjectIds.includes(object.id));
```

Also audit the memo comparators to ensure they still work correctly without `isSelected`
being derived from props (they already don't include `isSelected` in comparators).

After this change, the `selectedObjectIds` variable is no longer needed in most components.
Remove the variable declaration so the store selector is the only reference.

---

### Phase 2 — Narrow SelectionLayer `objects` Subscription (HIGH)

**Estimated scope:** SelectionLayer.tsx, ~5 line changes.

Replace:
```ts
const objects = useObjectStore((s) => s.objects);
const selectedObjects = selectedObjectIds.map((id) => objects[id]).filter(Boolean);
```

With a single narrow selector:
```ts
const selectedObjects = useObjectStore((s) =>
  selectedObjectIds.map((id) => s.objects[id]).filter((o): o is BoardObject => !!o)
);
```

This avoids the full `objects` subscription while maintaining correct reactivity on
selected object data changes (e.g. type/color changes that affect Transformer config).

---

### Phase 3 — Batch Transform Writes with writeBatch (MEDIUM)

**Estimated scope:** SelectionLayer.tsx `handleTransformEnd`, ~15 line changes.
Also affects `handleTransformEnd`-adjacent: import `writeBatch` from Firestore helpers.

Pattern:
```ts
import { getBatch, commitBatch } from '@/lib/firebase/firestore';

// Inside handleTransformEnd loop:
const batch = getBatch();
for (const node of transformer.nodes()) {
  // ... compute updates ...
  updateObjectLocal(id, updates);
  batch.update(objectDocRef(boardId, id), updates);
}
await batch.commit();
```

Note: `getBatch`/`commitBatch` helpers may need to be added to `src/lib/firebase/firestore.ts`.
Check if `writeBatch` from `firebase/firestore` is already imported there.

---

### Phase 4 — Spatial Index for handleDragMove Frame Detection (MEDIUM)

**Estimated scope:** ShapeObject.tsx and StickyNote.tsx, ~10 line changes each.

```ts
// BEFORE:
const allObjects = useObjectStore.getState().objects;
let bestId: string | null = null;
let bestOverlap = 0;
for (const candidate of Object.values(allObjects)) {
  if (candidate.type !== "frame" || candidate.id === object.id) continue;
  ...
}

// AFTER:
import { spatialIndex } from '@/lib/store/objectStore';
const allObjects = useObjectStore.getState().objects;
const curX = node.x();
const curY = node.y();
const nearby = spatialIndex.search({
  minX: curX, minY: curY,
  maxX: curX + object.width, maxY: curY + object.height,
});
let bestId: string | null = null;
let bestOverlap = 0;
for (const item of nearby) {
  const candidate = allObjects[item.id];
  if (!candidate || candidate.type !== "frame" || candidate.id === object.id) continue;
  ...
}
```

---

### Phase 5 — Cursor Lerp + Cap (LOW)

**Estimated scope:** CursorLayer.tsx, ~40 line changes.

**5A: Cap remote cursors at 10.**

In CursorLayer render, slice entries:
```ts
const visibleCursors = Object.entries(cursors)
  .filter(([id, cursor]) => id !== userId && isFinite(cursor.x) && ...)
  .slice(0, 10);
```

**5B: Cursor interpolation.**

In `RemoteCursor`, maintain a lerp position via `useRef` + RAF:
- On each new `data` prop, set `targetRef.current = { x: data.x, y: data.y }`
- RAF loop moves `currentPos` 30% toward target each frame (exponential ease)
- Use `x={currentPos.x} y={currentPos.y}` on the Group

Implementation uses `useEffect` + `requestAnimationFrame` loop, cleaned up on unmount.
Lerp factor 0.3 converges to within 1px in ~5 frames (~83ms), masking typical jitter.

---

### Phase 6 — Verification

1. Run `npm run test:perf` — compare frame timing against current baseline.
2. Manually verify selection behavior:
   - Click an object: only that object + previously selected object re-render (use React DevTools Profiler)
   - Drag 50 objects: Firestore Network tab shows 1 batch write (transform) or N individual writes (drag-end)
3. Stress test: seed-perf board (7,000 objects), pan + select + drag.
4. Multi-tab test: 5 tabs, all moving objects, check FPS and cursor smoothness.

---

## Files Affected

| File | Phase | Change |
|------|-------|--------|
| src/components/canvas/ShapeObject.tsx | 1, 4 | Narrow isSelected selector; spatial index in handleDragMove |
| src/components/canvas/StickyNote.tsx | 1, 4 | Same |
| src/components/canvas/FrameObject.tsx | 1 | Narrow isSelected selector |
| src/components/canvas/ConnectorObject.tsx | 1 | Narrow isSelected selector |
| src/components/canvas/TextObject.tsx | 1 | Narrow isSelected selector |
| src/components/canvas/LineObject.tsx | 1 | Narrow isSelected selector |
| src/components/canvas/ColorLegendObject.tsx | 1 | Narrow isSelected selector |
| src/components/canvas/SelectionLayer.tsx | 2, 3 | Narrow objects subscription; batch transform writes |
| src/components/canvas/CursorLayer.tsx | 5 | Cursor cap + lerp interpolation |
| src/lib/firebase/firestore.ts | 3 | Add writeBatch helper if not present |

---

## Out of Scope

- WebGL/WebGPU rendering (Konva Canvas 2D is sufficient for 500 objects at 60 FPS)
- Server-side Cloud Functions (onDisconnect handles crash recovery)
- Regional Firebase configuration (network latency is infrastructure)
- Multi-object drag batching (each object fires dragEnd independently via Konva; complex to batch without a dedicated drag-end aggregation layer)
