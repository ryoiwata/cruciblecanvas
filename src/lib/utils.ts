/**
 * Generates a deterministic hex color from a userId string.
 * Same userId always produces the same color across sessions and users.
 * Uses HSL with fixed saturation (70%) and lightness (55%) for readable colors.
 */
export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32-bit integer
  }
  const hue = ((hash % 360) + 360) % 360; // Ensure positive hue
  return hslToHex(hue, 70, 55);
}

/**
 * Converts HSL values to a hex color string.
 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;

  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };

  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Converts screen-space pointer coordinates to canvas-space coordinates,
 * accounting for pan (stage position) and zoom (stage scale).
 */
export function getCanvasPoint(
  stageX: number,
  stageY: number,
  stageScale: number,
  pointerX: number,
  pointerY: number
): { x: number; y: number } {
  return {
    x: (pointerX - stageX) / stageScale,
    y: (pointerY - stageY) / stageScale,
  };
}

// ---------------------------------------------------------------------------
// Grid snapping
// ---------------------------------------------------------------------------

/**
 * Snaps a value to the nearest grid line.
 * Returns the original value if gridSize is <= 0.
 */
export function snapToGrid(value: number, gridSize: number = 20): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

// ---------------------------------------------------------------------------
// Bounds / overlap helpers (Phase 3)
// ---------------------------------------------------------------------------

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Returns true if two axis-aligned bounding boxes overlap.
 */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width < b.x ||
    a.x > b.x + b.width ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}

/**
 * Returns the fraction of area of `inner` that overlaps with `outer`.
 * Used for frame auto-nesting (>50% threshold).
 */
export function overlapFraction(inner: Bounds, outer: Bounds): number {
  const overlapX = Math.max(
    0,
    Math.min(inner.x + inner.width, outer.x + outer.width) -
      Math.max(inner.x, outer.x)
  );
  const overlapY = Math.max(
    0,
    Math.min(inner.y + inner.height, outer.y + outer.height) -
      Math.max(inner.y, outer.y)
  );
  const overlapArea = overlapX * overlapY;
  const innerArea = inner.width * inner.height;
  return innerArea > 0 ? overlapArea / innerArea : 0;
}

/**
 * Calculates the nearest edge point on a rectangle to a target point.
 * Returns the point on the border of the rect closest to (tx, ty).
 */
export function nearestEdgePoint(
  rect: { x: number; y: number; width: number; height: number },
  tx: number,
  ty: number
): { x: number; y: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  const dx = tx - cx;
  const dy = ty - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: rect.y };

  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  const scaleX = halfW / Math.abs(dx || 1);
  const scaleY = halfH / Math.abs(dy || 1);
  const scale = Math.min(scaleX, scaleY);

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  };
}

/**
 * Returns a Konva-compatible dash array for the given stroke style.
 * Returns undefined for solid lines (no dash array = solid in Konva).
 */
export function getStrokeDash(
  style: "solid" | "dashed" | "dotted" | undefined
): number[] | undefined {
  if (style === "dashed") return [8, 4];
  if (style === "dotted") return [2, 4];
  return undefined;
}

/**
 * Returns the bounding box that encloses all provided bounds.
 */
export function getBoundingBox(items: Bounds[]): Bounds | null {
  if (items.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const b of items) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
