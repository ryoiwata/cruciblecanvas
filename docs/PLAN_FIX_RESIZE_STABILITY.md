
# PLAN_FIX_RESIZE_STABILITY.md

## Problem: Erratic Micro-Resizing Bug

When resizing objects via the Konva Transformer, objects can flicker between their current size and a previous size, or collapse to near-zero dimensions before snapping. This produces an erratic "micro-resizing" visual glitch.

## Root Cause

### 1. `boundBoxFunc` rejects instead of clamping (Primary cause)

The current `boundBoxFunc` in `SelectionLayer.tsx` returns `oldBox` entirely when `newBox` violates any size limit:

```ts
// BEFORE (buggy)
boundBoxFunc={(oldBox, newBox) => {
  if (newBox.width < minW || newBox.height < minH || ...) {
    return oldBox; // Snap-back: causes flickering
  }
  return newBox;
}}
```

When the user drags an anchor near the minimum size, the box alternates between `newBox` (slightly below min) and `oldBox` (the last valid size, which could be much larger). This produces visible flicker every frame.

**Fix**: Clamp `newBox` dimensions to min/max instead of rejecting the entire box. This produces smooth visual behavior at the boundary.

```ts
// AFTER (clamped)
boundBoxFunc={(oldBox, newBox) => {
  const limits = getSizeLimits();
  const clamped = { ...newBox };
  clamped.width = Math.max(limits.minW, Math.min(limits.maxW, clamped.width));
  clamped.height = Math.max(limits.minH, Math.min(limits.maxH, clamped.height));
  return clamped;
}}
```

### 2. No flip prevention

Konva Transformer allows negative scaling by default (dragging an anchor past the opposite edge). This produces negative dimensions momentarily, which the clamp catches only at `onTransformEnd` — by then the visual has already glitched.

**Fix**: Add `flipEnabled={false}` to the Transformer to prevent negative scale transforms entirely.

### 3. Scale values not normalized with Math.abs

In `handleTransformEnd`, `node.scaleX()` and `node.scaleY()` could theoretically be negative if a flip occurred before the fix. Using `Math.abs` ensures the computed dimensions are always positive.

### 4. Snap-then-clamp ordering

The current order (clamp → snap → re-check) is correct but the `boundBoxFunc` rejection undermines it. With the clamping fix, the ordering works as intended:
1. Compute actual size from `width * |scaleX|`
2. Clamp to min/max
3. Snap to 20px grid (unless Cmd/Ctrl held)
4. Re-check: if snap pushed below min, bump back up to min

## Files Modified

| File | Change |
|------|--------|
| `SelectionLayer.tsx` | Clamp-based `boundBoxFunc`, `flipEnabled={false}`, `centeredScaling={false}`, `Math.abs` on scale in `handleTransformEnd` |
| `Canvas.tsx` | Prevent negative dimensions in border resize path with early `Math.max(0, ...)` guard |

## Size Limits Enforced

| Object Type | Min Width | Min Height | Max Width | Max Height |
|-------------|-----------|------------|-----------|------------|
| Sticky Note | 80px      | 60px       | 600px     | 600px      |
| Rectangle   | 20px      | 20px       | 800px     | 800px      |
| Circle      | 20px      | 20px       | 800px     | 800px      |
| Frame       | 150px     | 100px      | 4000px    | 4000px     |

These values are defined in `src/lib/types.ts` as `STICKY_NOTE_SIZE_LIMITS`, `SHAPE_SIZE_LIMITS`, and `FRAME_SIZE_LIMITS`.

## Snapping Behavior

- Grid: 20px (global `GRID_SIZE`)
- Snapping applies to both dimensions and position
- `snapToGrid(value) = Math.round(value / 20) * 20`
- Bypass: Hold Cmd (macOS) or Ctrl (Windows/Linux) for free-form sizing
- Isolated: No smart guides or shape-to-shape snapping; only the global dot grid
