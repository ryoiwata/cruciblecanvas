import { GRID_SIZE } from "./types";

/**
 * Snaps a coordinate value to the nearest grid intersection.
 * Handles negative coordinates correctly: snapToGrid(-15) → -20.
 */
export function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize;
}

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
