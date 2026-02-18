# Resize System Diagnostic Summary

> **Purpose**: Technical briefing for an external LLM to diagnose and fix three resize bugs
> in CrucibleCanvas, a collaborative whiteboard built with React + Konva.js + Zustand + Firebase.
>
> **Bugs**: (1) Performance lag/stutter during resize, (2) Erratic scaling / collapse to min-size,
> (3) Floating anchors (opposite corner not staying fixed).

---

## 1. System Architecture Overview

### Layer Structure (Konva Stage)

```
<Stage>  (captures onMouseDown, onMouseMove, onMouseUp at top level)
  <Layer 1>  DotGrid             (listening={false}, static background)
  <Layer 2>  BoardObjects         (all shapes, sticky notes, frames, connectors)
             Each object is a <Group id={objectId}> containing:
               - Primary visual (Rect, Circle)
               - Optional text nodes
               - ResizeBorder (invisible hit zone, only on shapes/stickyNotes)
  <Layer 3>  SelectionLayer       (Konva <Transformer> with 8 anchor handles)
             SelectionRect        (rubber-band selection)
  <Layer 4>  CursorLayer          (remote user cursors, listening={false})
</Stage>
```

### Two Independent Resize Systems

There are **two completely separate resize code paths** that can both act on the same object.
This is a core architectural fact that drives many of the bugs.

| System | Trigger | Handler Location | Visual Feedback | State Commit |
|--------|---------|------------------|-----------------|--------------|
| **Border Resize** | MouseDown on `ResizeBorder` (Layer 2) | `Canvas.tsx` handleMouseMove | Direct Konva node manipulation via `applyResizeToKonvaNode()` | `updateObjectLocal()` on mouseUp only |
| **Transformer Resize** | Drag Transformer anchor (Layer 3) | `SelectionLayer.tsx` onTransform/onTransformEnd | Konva Transformer internal scale | `updateObjectLocal()` + Firestore on transformEnd |

---

## 2. Event Pipeline (Bug Source: Lag + Conflicts)

### Border Resize Event Flow

```
Step 1: INITIATION
  User mousedown on ResizeBorder (child of Group in Layer 2)
  └─> ResizeBorder.handleMouseDown()
      ├─> e.cancelBubble = true   (prevents Group drag)
      └─> window.dispatchEvent('border-resize-start', {objectId, edge})

Step 2: Canvas CAPTURES the custom event (via useEffect listener)
  └─> borderResizeRef.current = {
        objectId, edge,
        startX: obj.x, startY: obj.y,    // Snapshot at drag start
        startW: obj.width, startH: obj.height,
        objectType: obj.type
      }
  └─> startLocalEdit(objectId)   // Guard against Firestore echoes
  └─> acquireLock(boardId, objectId, userId)  // RTDB soft lock

Step 3: DRAG (every mousemove on Stage)
  Canvas.handleMouseMove() fires (Stage-level handler)
  └─> if (borderResizeRef.current):
      ├─> Compute new {x, y, w, h} from edge + cursor position
      ├─> Clamp: Math.max(1, Math.min(100000, value))
      ├─> Round dimensions, then recompute position from anchor
      ├─> Store in borderResizeLatestRef (for commit on mouseUp)
      └─> applyResizeToKonvaNode(stage, objectId, ...)
          ├─> stage.findOne(`#${objectId}`)  // Find Group node
          ├─> group.x(x); group.y(y);       // Move Group
          ├─> For each child: update Rect w/h or Circle x/y/radius
          └─> group.getLayer()?.batchDraw()  // Redraw Layer 2 only

Step 4: COMMIT (mouseUp on Stage)
  Canvas.handleMouseUp()
  └─> Read final values from borderResizeLatestRef
  └─> updateObjectLocal(objectId, latest)   // Single Zustand commit
  └─> updateObject(boardId, objectId, latest) // Firestore persist
  └─> releaseLock(), endLocalEdit()
  └─> Clear refs
```

### Transformer Resize Event Flow

```
Step 1: INITIATION
  User drags a Transformer anchor handle (Layer 3)
  └─> Konva Transformer internally starts scaling the attached node(s)
  └─> onTransformStart fires
      └─> startLocalEdit() for each selected node

Step 2: DRAG (internal to Konva)
  Konva Transformer applies scaleX/scaleY to the Group node.
  └─> boundBoxFunc fires every frame:
      ├─> Normalize: Math.abs(width), Math.abs(height)
      ├─> Clamp to min/max if dimension violates limits
      └─> Return clamped box (NOT oldBox -- "clamp-not-reject" strategy)
  NOTE: No React state update occurs during drag.
  NOTE: No Zustand update occurs during drag.
  The node visually scales via Konva's internal transform matrix.

Step 3: COMMIT (onTransformEnd)
  └─> For each selected node:
      ├─> Compute actual size: baseRect.width * |scaleX|
      ├─> RESET SCALE: node.scaleX(1); node.scaleY(1)  // CRUCIAL
      ├─> Clamp to limits
      ├─> Circle constraint: width === height
      ├─> node.width(newWidth); node.height(newHeight)
      ├─> updateObjectLocal(id, updates)   // Zustand
      └─> updateObject(boardId, id, updates) // Firestore
  └─> endLocalEdit() for each node
```

### Critical Conflict: Both Systems Can Be Active

When an object is **selected** (Transformer visible on Layer 3), the ResizeBorder on Layer 2
is also active. Both have hit zones that overlap spatially:

- Transformer anchors: 8px squares at corners/midpoints (Layer 3)
- ResizeBorder: 16px stroke band around perimeter (Layer 2)

**Conflict scenario**: If the user grabs near a corner, the Transformer anchor (Layer 3)
typically wins because Layer 3 renders above Layer 2. But the ResizeBorder's `onMouseEnter`
may still fire, setting `isHoveringBorder = true`, which **disables dragging** on the Group
(`draggable={mode === "select" && !isLocked && !isHoveringBorder}`).

This can create a state where:
1. The Transformer starts a resize (setting its internal scale)
2. The border hover state prevents the Group from being draggable
3. On transform end, the scale is applied but the node position may be wrong because
   Konva's drag system was disabled mid-transform

---

## 3. Anchor Geometry (Bug Source: Floating Anchors)

### The Math

At resize start, we snapshot the object's bounds:

```
startX, startY, startW, startH
startRight  = startX + startW
startBottom = startY + startH
```

On each mousemove, we compute new dimensions from the cursor position:

```
         startX          startRight
           |                  |
startY --- ┌──────────────────┐ --- startY
           │                  │
           │     OBJECT       │
           │                  │
startBottom├──────────────────┤ --- startBottom


Dragging EAST edge:   newW = cursorX - startX     (left edge is anchor)
Dragging WEST edge:   newW = startRight - cursorX  (right edge is anchor)
Dragging SOUTH edge:  newH = cursorY - startY      (top edge is anchor)
Dragging NORTH edge:  newH = startBottom - cursorY  (bottom edge is anchor)

Corner drags combine both axes (e.g., SE = E + S).
```

### Position Recalculation (The Anchor Fix)

After computing newW and newH, the position must be recalculated
to keep the OPPOSITE edge/corner fixed:

```
// Current code (Canvas.tsx lines 550-564):

// 1. Round dimensions FIRST
newW = Math.round(newW);
newH = Math.round(newH);

// 2. THEN recalculate position from the fixed anchor
if (edge includes west): newX = startRight  - newW;
if (edge includes north): newY = startBottom - newH;

// 3. Round position
newX = Math.round(newX);
newY = Math.round(newY);
```

### Why The Opposite Corner STILL Drifts (Remaining Bugs)

**Problem A: The `applyResizeToKonvaNode` function blindly updates ALL Rect children.**

```typescript
// Canvas.tsx lines 119-130
for (const child of group.getChildren()) {
    const cls = child.getClassName();
    if (objectType === "circle" && cls === "Circle") {
        // Circle: update x, y, radius
    } else if (cls === "Rect") {
        r.width(w);   // <-- Updates EVERY Rect child
        r.height(h);
    }
}
```

For a **Frame** object, the children are:
- `Rect` (background, full size) -- should be updated
- `Rect` (title bar, width=full but height=40px fixed) -- **SHOULD NOT have height changed**
- `Rect` (selection border, conditional) -- should be updated
- `Text` nodes -- not updated

Setting the title bar Rect to height=h makes the title bar fill the entire frame.
This causes visual glitching on frame resize.

**Problem B: React state and Konva nodes are out of sync during drag.**

During border resize, `applyResizeToKonvaNode` modifies Konva nodes directly, but
Zustand state still holds the OLD values. If anything triggers a React re-render during
the drag (e.g., another user's cursor update, a Firestore echo that bypasses the local
edit guard, or the `selRect` state changing), React will reconcile and **overwrite** the
Konva node values back to the stale Zustand values. This causes a visible snap-back/jump.

**Problem C: Transformer `boundBoxFunc` uses `singleType` from render scope.**

```typescript
// SelectionLayer.tsx line 269
boundBoxFunc={(oldBox, newBox) => {
    const limits = getLimitsForType(singleType || "");
    // ...
}}
```

`singleType` is derived from React state (selectedObjects). If the selection changes
mid-transform (e.g., multi-select to single-select), the closure captures a stale value.
With `singleType = null`, `getLimitsForType("")` returns the default `{minW: 1, ...}`,
which may differ from the object's actual type limits.

**Problem D: Transformer scale reset happens ONLY in `onTransformEnd`.**

During the drag, Konva accumulates scaleX/scaleY on the Group node. The child shapes
(Rect, Circle) inside the Group are NOT individually scaled -- the Group's transform
matrix scales them. But the ResizeBorder's hit zone dimensions are in local coordinates
(they read `width` and `height` from React props, which are stale during Transformer drag).
This means the ResizeBorder's edge detection is wrong during Transformer resize.

---

## 4. State Update Loop (Bug Source: Performance Lag)

### Border Resize Path (Current Implementation)

```
BEFORE the recent refactor:
  mousemove → updateObjectLocal() → Zustand set() → new objects{} immutable record
  → BoardObjects re-renders (subscribed to objects) → viewport culling + sorting
  → Individual <ShapeObject> re-renders (new object reference) → Konva reconciles
  → Konva redraws

  This happened on EVERY mousemove event (120+ Hz on modern hardware).

AFTER the recent refactor (current code):
  mousemove → applyResizeToKonvaNode() → direct Konva node mutation + batchDraw()
  mouseup → single updateObjectLocal() → Zustand + Firestore

  React is NOT involved during the drag. This is the correct approach.
```

### Remaining Performance Issues

**Issue 1: `handleMouseMove` callback has a massive dependency array.**

```typescript
// Canvas.tsx lines 659-673
useCallback((e) => { ... }, [
    boardId, user, displayName, mode, creationTool, connectorStart,
    selRect.active, stageX, stageY, stageScale, lastUsedColors,
    upsertObject, updateObjectLocal,
])
```

Every time ANY of these 13 dependencies changes, the entire `handleMouseMove` function is
recreated. This causes the Stage's `onMouseMove` prop to change, which makes react-konva
unbind the old listener and bind a new one. During rapid operations (panning, zooming,
color changes), this can cause dropped frames.

**Issue 2: `getCanvasPoint` is called multiple times per mousemove.**

In a single `handleMouseMove` call, `getCanvasPoint` may be called up to 4 times:
1. For drag-to-create (line 431)
2. For border resize (line 507)
3. For connector endpoint (line 604)
4. For cursor sync (line 636)

Each call does the same math: `(pointerX - stageX) / stageScale`. This is cheap but
wasteful. More importantly, calls 1 and 2 use `stage.x()` / `stage.scaleX()` while
call 4 uses the Zustand stageX/stageScale. If Zustand is one frame behind, the cursor
sync position will be slightly different from the resize position.

**Issue 3: Cursor sync fires during resize.**

The cursor sync code at the bottom of `handleMouseMove` (lines 631-657) calls
`setCursor(boardId, userId, ...)` which writes to Firebase RTDB. This network I/O
happens on the same mousemove handler as the resize computation. Although it's throttled
to 30Hz, it still adds latency to the event handler.

### Zustand Store Internals

```typescript
// objectStore.ts lines 49-58
updateObjectLocal: (id, updates) => {
    const existing = get().objects[id];
    if (!existing) return;
    set((state) => ({
        objects: {
            ...state.objects,              // Shallow copy ALL objects
            [id]: { ...existing, ...updates },  // New object for this ID
        },
    }));
},
```

Every call creates a new `objects` record via spread. For a board with 500 objects,
this means allocating a new object with 500 entries per call. During border resize
(before the refactor), this happened 120+ times per second.

After the refactor, this only happens once on mouseUp. **But it still happens on every
mousemove for drag-to-create** (Canvas.tsx line 488), and for **object dragging**
(ShapeObject.tsx line 57, StickyNote.tsx line 58, FrameObject.tsx line 73).

---

## 5. Constraint Logic (Bug Source: Erratic Scaling)

### Size Limits (Current Values in `types.ts`)

All limits have been relaxed to:
```
min: { width: 1, height: 1 }
max: { width: 100000, height: 100000 }
```

This means the only real constraint is preventing dimensions <= 0.

### Border Resize Constraints (Canvas.tsx)

```
1. Compute raw newW, newH from cursor position
2. Clamp: newW = max(1, min(100000, newW))
3. Circle: newW = newH = max(newW, newH)
4. Round dimensions
5. Recompute position from anchor
6. Round position
```

**Potential issue**: Step 2 clamps to min=1 BEFORE the circle constraint in step 3.
If the user drags a circle's east edge to the left (making newW = 1) while newH is
still large (say 200), step 3 forces newW = newH = 200. This is unexpected -- the
user was trying to shrink, but the circle constraint enlarged it.

### Transformer Constraints: The "Clamp-Not-Reject" Strategy

**Historical context** (from `PLAN_FIX_RESIZE_STABILITY.md`):

The original `boundBoxFunc` used a REJECT strategy:
```typescript
// OLD (buggy):
if (newBox.width < minW) return oldBox;  // Snap entire box back
```

This caused flicker because on the boundary frame, the box alternated between
`newBox` (slightly below min, gets rejected → shows oldBox at full size) and
`newBox` (slightly above min, gets accepted → shows at min size).

The fix was CLAMP strategy:
```typescript
// CURRENT:
if (clamped.width < limits.minW) {
    if (Math.abs(clamped.x - oldBox.x) > 0.5) {
        clamped.x = oldBox.x + oldBox.width - limits.minW;
    }
    clamped.width = limits.minW;
}
```

This smoothly clamps to the minimum while keeping the opposite edge fixed.

**Remaining issue with the clamp**: The anchor detection heuristic
(`if (Math.abs(clamped.x - oldBox.x) > 0.5)`) assumes that if `x` changed,
the user is dragging a left-side handle. But Konva Transformer can produce
sub-pixel x shifts even when dragging a right-side handle (due to floating-point
math in the scale transform). This can cause the clamp to adjust `x` when it
shouldn't, producing the "floating anchor" effect.

### Grid Snapping

`snapToGrid` exists in `utils.ts` but is **NOT currently called** during resize.
It was designed for Transformer resize (per `PLAN_RESIZE_AND_SNAP_REFACTOR.md`)
but the `handleTransformEnd` code in `SelectionLayer.tsx` does not call it.
The border resize code in `Canvas.tsx` also does not call it.

Grid snapping is effectively disabled for resize operations.

---

## 6. Object Component Structure (Needed for Direct DOM Manipulation)

Understanding the Konva Group children is critical for `applyResizeToKonvaNode`.

### ShapeObject (rectangle)
```
<Group id={objectId} x y width height draggable>
  <Rect width height fill cornerRadius />        ← index 0: primary shape
  <Text />                                        ← index 1: lock indicator (conditional)
  <Rect width height stroke strokeWidth=16 />     ← last: ResizeBorder (if enabled)
</Group>
```

### ShapeObject (circle)
```
<Group id={objectId} x y width height draggable>
  <Circle x={w/2} y={h/2} radius={w/2} fill />   ← index 0: primary shape
  <Text />                                          ← index 1: lock indicator (conditional)
  <KonvaCircle x={w/2} y={h/2} radius={w/2} />    ← last: ResizeBorder (if enabled)
</Group>
```

### StickyNote
```
<Group id={objectId} x y width height draggable>
  <Rect width height fill cornerRadius shadow />   ← index 0: background
  <Text width={w-20} x=10 y=10 />                  ← index 1: content text (conditional)
  <Text x={w-22} y=4 text="sparkle" />              ← index 2: AI badge (conditional)
  <Text />                                           ← index 3: lock indicator (conditional)
  <Rect width height stroke strokeWidth=16 />        ← last: ResizeBorder
</Group>
```

### FrameObject (NO ResizeBorder -- only Transformer resize)
```
<Group id={objectId} x y width height draggable>
  <Rect width height fill opacity stroke />          ← index 0: background
  <Rect width height=40 fill opacity />              ← index 1: title bar (FIXED height!)
  <Rect width height stroke />                        ← index 2: selection border (conditional)
  <Text width={w-20} />                               ← index 3: title text
  <Text />                                             ← index 4: lock indicator (conditional)
</Group>
```

### ColorLegendObject (NO ResizeBorder -- only Transformer bottom-right anchor)
```
<Group id={objectId} x y draggable>
  <Rect width height={max(dynamic,h)} fill />        ← background
  <Text "Color Legend" />                              ← header
  <Group> per-entry color swatch + text </Group>       ← entries
  <Text />                                             ← lock indicator (conditional)
</Group>
```

---

## 7. Key File Locations

| File | Responsibility |
|------|----------------|
| `src/components/canvas/Canvas.tsx` | Stage event handlers, border resize state machine, `applyResizeToKonvaNode` |
| `src/components/canvas/SelectionLayer.tsx` | Konva `<Transformer>`, `boundBoxFunc`, `handleTransformEnd` |
| `src/components/canvas/ResizeBorder.tsx` | Invisible hit zone, edge detection, custom event dispatch |
| `src/components/canvas/ShapeObject.tsx` | Rectangle/Circle rendering, drag handlers, ResizeBorder integration |
| `src/components/canvas/StickyNote.tsx` | Sticky note rendering, drag handlers, ResizeBorder integration |
| `src/components/canvas/FrameObject.tsx` | Frame rendering, child delta movement, NO ResizeBorder |
| `src/lib/types.ts` | `BoardObject`, `BorderResizeState`, `ResizeEdge`, size limit constants |
| `src/lib/store/objectStore.ts` | Zustand store: `updateObjectLocal`, `startLocalEdit`/`endLocalEdit` |
| `src/lib/utils.ts` | `getCanvasPoint`, `snapToGrid`, `boundsOverlap` |

---

## 8. Specific Bug Analysis

### Bug 1: Performance Lag

**Status**: Partially fixed. Border resize now uses direct Konva manipulation (`applyResizeToKonvaNode`)
instead of `updateObjectLocal` on every mousemove.

**Remaining causes**:
- Transformer resize has no equivalent optimization. `boundBoxFunc` fires every frame but
  doesn't touch React state, so this is OK. However, if `boundBoxFunc` is expensive
  (it's not currently), it could slow down.
- The `handleMouseMove` callback is recreated whenever any of its 13 dependencies change.
- Cursor sync I/O (`setCursor` to RTDB) runs on the same handler.
- Drag-to-create still uses `updateObjectLocal` on every mousemove (line 488).

### Bug 2: Erratic Scaling / Collapse to Min-Size

**Root causes**:
1. `applyResizeToKonvaNode` updates ALL `Rect` children to the same width/height.
   For frames, this includes the title bar (height should be 40, not the frame height).
2. If a React re-render happens during border resize (stale Zustand state overwrites
   the Konva node's direct-manipulated values), the object visually snaps back to its
   pre-resize dimensions for one frame, then jumps forward again.
3. The Transformer's `handleTransformEnd` uses `getClientRect({skipTransform: true})`
   to compute base dimensions. For Group nodes, `getClientRect` returns the bounding
   box of ALL children. If any child has stale/wrong dimensions (from a prior
   `applyResizeToKonvaNode` that set the ResizeBorder Rect to the wrong size), the
   computed dimensions will be wrong.

### Bug 3: Floating Anchors

**Root causes**:
1. **Border resize**: The anchor math is now correct (round dimensions before recomputing
   position). But `applyResizeToKonvaNode` doesn't update the Group's `.width()` and
   `.height()` attributes -- it only updates child shapes. If anything reads
   `group.width()` (like the Transformer's `getClientRect`), it gets the stale value.
2. **Transformer resize**: The `boundBoxFunc` anchor detection heuristic
   (`Math.abs(clamped.x - oldBox.x) > 0.5`) can misfire due to floating-point precision.
   When it misfires, it adjusts `x` when it shouldn't, making the anchor appear to float.
3. **Cross-system**: If the user starts a border resize while the Transformer is attached
   (object is selected), the Transformer may still have a stale `nodes()` reference.
   On the next React render (mouseUp commit), the Transformer re-syncs and may adjust
   the node's position to match its internal state, which conflicts with the border
   resize's final position.

---

## 9. Recommended Investigation Path

For the external LLM fixing these bugs, the priority order should be:

1. **Audit `applyResizeToKonvaNode`**: It must be type-aware. For frames, don't update
   the title bar Rect's height. For all types, also update `group.width()` and
   `group.height()` so `getClientRect` returns correct values.

2. **Prevent cross-system conflicts**: When border resize is active, either detach the
   Transformer or ensure it doesn't interfere. Consider adding a `isBorderResizing` flag
   that the Transformer checks.

3. **Protect against React re-render during drag**: The `startLocalEdit` guard only
   prevents Firestore echoes. It doesn't prevent React from re-rendering the component
   with stale Zustand values if some other state trigger fires. Consider keeping Zustand
   in sync during drag (but batched via rAF) OR preventing the component from reading
   stale values during active resize.

4. **Fix `boundBoxFunc` anchor heuristic**: Use a more robust method than comparing
   `x` delta to 0.5. Store the active anchor at transform start and use it consistently.

5. **Unify the coordinate space**: Ensure `getCanvasPoint` is called once per mousemove
   and the result is reused across all code paths.
