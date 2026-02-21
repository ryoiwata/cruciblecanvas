/**
 * spatialPlanning.ts — client-side spatial analysis for AI command context.
 * Computes open positions in the current viewport where new objects can be
 * placed without overlapping existing content. Used by useAICommand to give
 * The Mason persona concrete anchor points before it begins tool calls.
 */

import type { BoardObject } from '@/lib/types';

export interface SuggestedPosition {
  x: number;
  y: number;
  /** Human-readable label for why this position was chosen. */
  label: string;
}

// Clearance area required around each candidate position (canvas units)
const CLEARANCE_W = 200;
const CLEARANCE_H = 160;
// Step size for grid scan
const SCAN_STEP = 40;
// Grid snap size — must match the board's GRID_SIZE constant
const GRID_SNAP = 20;

/** Snap a value to the nearest GRID_SNAP multiple. */
function snapToGrid(value: number): number {
  return Math.round(value / GRID_SNAP) * GRID_SNAP;
}

interface OccupiedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * AABB intersection test for a candidate clearance rectangle vs an occupied rect.
 * Returns true if they overlap.
 */
function overlapsOccupied(cx: number, cy: number, rect: OccupiedRect): boolean {
  return (
    cx < rect.x + rect.w &&
    cx + CLEARANCE_W > rect.x &&
    cy < rect.y + rect.h &&
    cy + CLEARANCE_H > rect.y
  );
}

/**
 * Scans the current viewport in SCAN_STEP increments to find open positions
 * where a CLEARANCE_W × CLEARANCE_H area doesn't overlap any existing object.
 * Appends a below-content fallback if fewer than maxCount positions are found.
 *
 * @param objects - All board objects keyed by id
 * @param viewport - Visible canvas area in canvas coordinates
 * @param maxCount - Maximum number of positions to return (default 5)
 */
export function computeSuggestedPositions(
  objects: Record<string, BoardObject>,
  viewport: { x: number; y: number; width: number; height: number },
  maxCount: number = 5
): SuggestedPosition[] {
  // Build list of occupied rects from all non-connector objects
  const occupied: OccupiedRect[] = Object.values(objects)
    .filter((o) => o.type !== 'connector' && o.type !== 'line')
    .map((o) => ({ x: o.x, y: o.y, w: o.width, h: o.height }));

  const results: SuggestedPosition[] = [];

  // Scan viewport in row-major order
  outerLoop: for (let cy = viewport.y; cy < viewport.y + viewport.height; cy += SCAN_STEP) {
    for (let cx = viewport.x; cx < viewport.x + viewport.width; cx += SCAN_STEP) {
      const hasOverlap = occupied.some((rect) => overlapsOccupied(cx, cy, rect));
      if (!hasOverlap) {
        results.push({
          x: snapToGrid(cx),
          y: snapToGrid(cy),
          label: 'open area in viewport',
        });
        if (results.length >= maxCount) break outerLoop;
        // Skip forward to avoid clustered candidates
        cx += CLEARANCE_W;
      }
    }
  }

  // Fallback: place below the lowest occupied object
  if (results.length < maxCount) {
    const maxBottom = occupied.length > 0
      ? Math.max(...occupied.map((r) => r.y + r.h))
      : viewport.y;

    results.push({
      x: snapToGrid(viewport.x),
      y: snapToGrid(maxBottom + 40),
      label: 'below existing content',
    });
  }

  return results;
}
