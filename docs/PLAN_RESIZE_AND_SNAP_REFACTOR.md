# Plan: Resize & Snap Refactor

## Goal

Enable 8-handle resizing for all shapes, ensure isolated 20px grid snapping (no smart guides), enforce proportional constraint for circles, and add Cmd/Ctrl bypass for free-form resizing.

---

## Current State Analysis

| Aspect | Rectangle | Circle |
|--------|-----------|--------|
| Anchors | All 8 (4 corners + 4 edges) | 4 corners only |
| keepRatio | `false` (free stretch) | `true` (locked aspect ratio) |
| Grid snap | On transformEnd only | On transformEnd only |
| Smart guides | None exist | None exist |
| Min size | 20x20 enforced in `boundBoxFunc` + post-snap re-clamp | 20x20 enforced |
| Cmd/Ctrl bypass | Not implemented for resize | Not implemented for resize |

**Key finding:** There are no smart guides or alignment snapping anywhere in the codebase. The only snapping is `snapToGrid()` in `src/lib/utils.ts`, which rounds to the nearest 20px. The "isolated grid snapping" requirement is already satisfied; no code needs to be removed.

---

## Zustand State Changes

**None required.**

The Cmd/Ctrl modifier key state is transient and only relevant during an active resize interaction. It does not need to be shared across components or persisted. A local approach inside `SelectionLayer` is appropriate:

- **Option considered:** Add `isModifierHeld: boolean` to `canvasStore` — rejected because it would cause unnecessary re-renders across the app on every keydown/keyup.
- **Chosen approach:** Access the native event's `ctrlKey` / `metaKey` property directly from the `onTransformEnd` callback's Konva event object (`e.evt`). This is zero-state, zero-overhead.

---

## Konva Transformer Prop Updates

### File: `src/components/canvas/SelectionLayer.tsx`

#### Circle `enabledAnchors`

```
BEFORE: ["top-left", "top-right", "bottom-left", "bottom-right"]
AFTER:  ["top-left", "top-center", "top-right",
         "middle-left", "middle-right",
         "bottom-left", "bottom-center", "bottom-right"]
```

This gives circles all 8 resize handles (4 corners + 4 edge midpoints), matching rectangles.

#### Circle `keepRatio`

Remains `true`. With `keepRatio = true` and edge handles:
- Dragging a corner: scales proportionally (standard behavior)
- Dragging an edge midpoint: Konva scales both axes proportionally based on the single-axis drag, keeping the circle perfectly circular

This is the correct UX — circles must never become ellipses.

#### Rectangle (no prop changes)

Already has all 8 anchors and `keepRatio = false`, allowing free non-proportional stretching from any handle.

#### `onTransformEnd` signature

```
BEFORE: const handleTransformEnd = useCallback(() => { ... })
AFTER:  const handleTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => { ... })
```

The event parameter provides access to `e.evt.ctrlKey` and `e.evt.metaKey` for the bypass check.

---

## Grid-Snapping Math

### `snapToGrid` (unchanged, in `src/lib/utils.ts`)

```
snapToGrid(value, gridSize = 20) = Math.round(value / gridSize) * gridSize
```

Examples:
| Input | Output | Reasoning |
|-------|--------|-----------|
| 25 | 20 | round(1.25) = 1 -> 1 * 20 |
| 35 | 40 | round(1.75) = 2 -> 2 * 20 |
| 50 | 60 | round(2.5) = 3 -> 3 * 20 (JS rounds 0.5 up) |
| -15 | -20 | round(-0.75) = -1 -> -1 * 20 |

### Resize Pipeline in `handleTransformEnd`

```
Step 1: Compute actual size
    newWidth  = Math.round(node.width()  * node.scaleX())
    newHeight = Math.round(node.height() * node.scaleY())

Step 2: Clamp to type-specific limits
    newWidth  = clamp(newWidth,  limits.minW, limits.maxW)
    newHeight = clamp(newHeight, limits.minH, limits.maxH)

Step 3: Grid snap (CONDITIONAL)
    IF NOT (ctrlKey OR metaKey):
        newWidth  = snapToGrid(newWidth)
        newHeight = snapToGrid(newHeight)
        // Re-clamp in case snap pushed below minimum
        newWidth  = max(newWidth,  limits.minW)
        newHeight = max(newHeight, limits.minH)

Step 4: Reset node scale & apply
    node.scaleX(1)
    node.scaleY(1)
    node.width(newWidth)
    node.height(newHeight)

Step 5: Snap position (CONDITIONAL)
    IF NOT (ctrlKey OR metaKey):
        node.x = snapToGrid(node.x())
        node.y = snapToGrid(node.y())

Step 6: Persist
    updateObjectLocal(...)   // Zustand (instant UI)
    updateObject(...)        // Firestore (async cloud sync)
```

### `boundBoxFunc` (real-time constraint)

Unchanged — continues to reject boxes outside min/max limits during drag. Grid snapping is intentionally **not** applied here to keep the resize interaction smooth (no visual jitter). The snap happens on release.

```
IF newBox.width  < minW OR newBox.height < minH
OR newBox.width  > maxW OR newBox.height > maxH:
    RETURN oldBox    // reject
ELSE:
    RETURN newBox    // allow
```

---

## Files Modified

| File | Change |
|------|--------|
| `src/components/canvas/SelectionLayer.tsx` | Circle anchors (4 -> 8), Cmd/Ctrl bypass in `handleTransformEnd`, position snap bypass |

No other files need changes. No new files. No Zustand store changes.

---

## Edge Cases

1. **Circle edge drag**: keepRatio=true ensures proportional scaling even from edge midpoints. The circle never becomes an ellipse.
2. **Snap to minimum**: If resize brings width to 25px, snap rounds to 20px (the minimum). The re-clamp ensures it stays at 20px, never goes to 0.
3. **Cmd/Ctrl held**: Both dimension and position snapping are bypassed, allowing pixel-perfect placement.
4. **Multi-select**: handleTransformEnd iterates all transformer nodes. Type-specific limits apply per-object.
5. **Mixed selection types**: When multiple types are selected, `singleType` is null, defaulting to generic limits (20-4000px). Anchor config defaults to empty (no resize handles shown for mixed types).

---

## Verification Checklist

1. Rectangle: drag any of 8 handles -> resizes freely (non-proportional from edges, proportional only if keepRatio were true — it's false)
2. Circle: drag any of 8 handles -> always stays circular
3. Grid snap: release after resize -> dimensions snap to nearest 20px multiple
4. Grid snap bypass: hold Cmd/Ctrl + release -> dimensions stay at exact pixel values
5. Min size: try to shrink below 20x20 -> rejected by boundBoxFunc
6. Position snap: after resize, position snaps to grid (or doesn't if Cmd/Ctrl held)
7. No smart guides: resize near another object -> no alignment lines, no snapping to other objects
8. TypeScript: `npx tsc --noEmit` passes
