# Plan: Border-Wide Resizing for Shapes & Sticky Notes

## Goal

Allow users to initiate resize by clicking anywhere along a shape's perimeter (~8px border zone), not just on the 8 small Transformer anchors. Show appropriate resize cursors on hover. Apply to rectangles, circles, and sticky notes. Maintain 20px grid snapping and RTDB soft locking.

---

## Architecture

### Why per-shape, not canvas-level?

Konva events bubble **up** from specific shapes → Group → Layer → Stage. The Stage's `onMouseDown` fires *after* shape handlers. Intercepting edge clicks at the Canvas level is impossible without capture-phase hacks. Instead, each shape component adds an invisible border-zone child that captures events *before* the Group's drag system activates.

### Event flow

```
1. Mouse hovers border zone → ResizeBorder.onMouseMove
   → detect edge (n/s/e/w/nw/ne/sw/se) from local coordinates
   → dispatch 'border-cursor' custom event → Canvas sets cursor override

2. Mouse leaves border zone → ResizeBorder.onMouseLeave
   → dispatch 'border-cursor' with null → Canvas clears cursor

3. Mousedown on border zone → ResizeBorder.onMouseDown
   → e.cancelBubble = true (prevent Group click handler)
   → dispatch 'border-resize-start' with {objectId, edge, bounds}
   → Canvas stores in borderResizeRef, acquires RTDB lock

4. Mousemove (Stage) → Canvas.handleMouseMove
   → if borderResizeRef active: compute new x/y/w/h from edge + mouse position
   → snap to 20px grid (unless Cmd/Ctrl held)
   → clamp to min/max limits
   → updateObjectLocal() for instant UI

5. Mouseup (Stage) → Canvas.handleMouseUp
   → persist to Firestore via updateObject()
   → release RTDB lock
   → clear borderResizeRef
```

### Preventing drag during border resize

The border zone is a child of the draggable Group. Konva's DD system would normally start dragging the Group when a child receives mousedown. Solution: toggle `draggable={isDraggable && !isHoveringBorder}` on the Group based on whether the mouse is over the border zone.

---

## Konva Hit Detection for Border Zone

Each shape gets ONE extra Konva node: a `Rect` (or `Circle`) with:

```
fillEnabled={false}    → center area passes through to shape below
stroke="#000"          → needed for hit canvas registration
strokeWidth={16}       → 8px inside + 8px outside the shape edge
opacity={0.005}        → invisible to eye, but opacity > 0 → Konva draws on hit canvas
listening={true}       → only when mode === "select"
```

This creates a 16px-wide hit band centered on the shape's perimeter. The center of the shape is NOT hittable by this node (no fill), so clicks there fall through to the shape's fill rect below for normal select/drag behavior.

---

## Edge Detection Math

Given local coordinates `(lx, ly)` within the border zone node (origin at shape's top-left), and shape dimensions `(W, H)`:

```
CORNER_ZONE = 16px   // corner region size

nearLeft   = lx < CORNER_ZONE
nearRight  = lx > W - CORNER_ZONE
nearTop    = ly < CORNER_ZONE
nearBottom = ly > H - CORNER_ZONE

if nearTop  && nearLeft  → 'nw'    cursor: 'nwse-resize'
if nearTop  && nearRight → 'ne'    cursor: 'nesw-resize'
if nearBottom && nearLeft  → 'sw'  cursor: 'nesw-resize'
if nearBottom && nearRight → 'se'  cursor: 'nwse-resize'
if nearTop    → 'n'                cursor: 'ns-resize'
if nearBottom → 's'                cursor: 'ns-resize'
if nearLeft   → 'w'               cursor: 'ew-resize'
if nearRight  → 'e'               cursor: 'ew-resize'
```

---

## Resize Computation

During mousemove, given:
- `anchor`: the fixed edge/corner (opposite of the dragged edge)
- `mouseX, mouseY`: current canvas-space mouse position
- `startBounds`: {x, y, width, height} at resize start

### Edge resize (rectangle/sticky note):

| Edge | newX | newY | newW | newH |
|------|------|------|------|------|
| e | startX | startY | mouseX - startX | startH |
| w | mouseX | startY | startRight - mouseX | startH |
| s | startX | startY | startW | mouseY - startY |
| n | startX | mouseY | startW | startBottom - mouseY |

### Corner resize (rectangle/sticky note):

Combine both axes from the table above. E.g., `se` = e + s.

### Circle constraint:

After computing w and h, enforce `w === h` by taking `max(w, h)`. Adjust position to keep the anchor corner fixed.

### Grid snapping:

```
if NOT (ctrlKey OR metaKey):
    newW = snapToGrid(newW)
    newH = snapToGrid(newH)
    newX = snapToGrid(newX)
    newY = snapToGrid(newY)
```

### Clamping:

```
newW = clamp(newW, limits.minW, limits.maxW)
newH = clamp(newH, limits.minH, limits.maxH)
// Recalculate position from anchor after clamping
```

---

## Zustand State Changes

**None.** All transient resize state lives in Canvas refs. Cursor override uses `useState` in Canvas, communicated via custom DOM events (matching existing `object-drag-end` pattern).

---

## Files Modified

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `BORDER_ZONE`, `CORNER_ZONE` constants; `ResizeEdge` type |
| `src/components/canvas/ResizeBorder.tsx` | **New** — invisible border zone with edge detection + cursor + mousedown dispatch |
| `src/components/canvas/ShapeObject.tsx` | Add `<ResizeBorder>` child, `isHoveringBorder` state to disable drag |
| `src/components/canvas/StickyNote.tsx` | Same as ShapeObject |
| `src/components/canvas/Canvas.tsx` | Listen for `border-resize-start` / `border-cursor` events; resize logic in mousemove/mouseup; cursor override state |
| `src/components/canvas/SelectionLayer.tsx` | Update sticky note anchors from 2 → all 8 |

---

## RTDB Soft Locking

On resize start:
```
acquireLock(boardId, objectId, userId, displayName)
```

On resize end (mouseup):
```
releaseLock(boardId, objectId)
```

This matches the existing drag-to-move locking pattern in ShapeObject and StickyNote.

---

## Edge Cases

1. **Click (no drag) on border**: If mouse doesn't move past threshold (5px), treat as a click — select the object instead of resizing.
2. **Circle edge drag**: Both dimensions forced equal; anchor corner stays fixed.
3. **Cmd/Ctrl bypass**: Skip snapToGrid for free-form pixel-precise resize.
4. **Object already selected**: Transformer handles still work independently. Border zone sits below Transformer anchors (Layer 2 vs Layer 3).
5. **Multiplayer conflict**: RTDB lock prevents concurrent edits; locked objects have `isLocked=true` which disables the border zone.
6. **Sticky note text**: Text reflows as dimensions change (existing behavior from width/height update).
7. **Mode changes during resize**: Cleanup effect clears borderResizeRef and releases lock.

---

## Verification Checklist

1. Hover shape edge → resize cursor appears
2. Hover shape center → default cursor (normal select behavior)
3. Drag from right edge → width changes, left edge fixed, snaps to grid
4. Drag from top-left corner → both dimensions change, bottom-right fixed
5. Circle edge drag → stays circular
6. Cmd/Ctrl + drag edge → free-form (no snap)
7. Click on edge (no drag) → selects the object
8. Sticky note edge resize → works from all 4 edges and 4 corners
9. Object locked by another user → border zone inactive
10. During resize → RTDB lock acquired; released on mouseup
11. `npx tsc --noEmit` passes
