/**
 * spatialPlanning.ts — client-side spatial analysis for AI command context.
 * Computes open positions in the current viewport where new objects can be
 * placed without overlapping existing content.
 *
 * Algorithm (two-pass):
 *   Pass 1 — Viewport grid cluster: finds the first clear anchor in the
 *     viewport, then generates a tight grid of positions (sqrt(N) cols) from
 *     that anchor. Frames are treated as opaque solid blocks — any candidate
 *     position whose clearance rect overlaps a frame's bounding box is skipped.
 *   Pass 2 — Reflow fallback: if Pass 1 yields fewer than maxCount positions,
 *     remaining items are placed in a new grid row below the lowest existing
 *     object, starting from the viewport's left edge.
 *
 * Results are sent in the POST body as suggestedPositions and injected into
 * the Mason system prompt as numbered placement hints.
 */

import type { BoardObject } from '@/lib/types';

export interface SuggestedPosition {
  x: number;
  y: number;
  /** Human-readable label describing why this position was chosen. */
  label: string;
  /** Whether this position is inside the current viewport or below it. */
  source: 'viewport' | 'reflow';
}

// Clearance area required for each candidate position (canvas units).
// Matches the default sticky note footprint so hints suit the most common case.
const CLEARANCE_W = 200;
const CLEARANCE_H = 160;
// Step size for the anchor scan
const SCAN_STEP = 40;
// Gap between items in a grid cluster
const GRID_GAP = 20;
// Grid snap — must match the board's GRID_SIZE constant
const GRID_SNAP = 20;

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
 * AABB intersection: does a candidate clearance rect at (cx, cy) overlap rect?
 */
function overlapsRect(cx: number, cy: number, rect: OccupiedRect): boolean {
  return (
    cx < rect.x + rect.w &&
    cx + CLEARANCE_W > rect.x &&
    cy < rect.y + rect.h &&
    cy + CLEARANCE_H > rect.y
  );
}

/**
 * Scans the current viewport to find open positions where new objects can be
 * placed without overlapping existing content or frame boundaries.
 *
 * Frames are treated as opaque exclusive zones — new items are never placed
 * inside a frame's bounding box unless the user explicitly requests it.
 *
 * @param objects   - All board objects keyed by id
 * @param viewport  - Visible canvas area in canvas coordinates
 * @param maxCount  - Maximum number of positions to return (default 5)
 */
export function computeSuggestedPositions(
  objects: Record<string, BoardObject>,
  viewport: { x: number; y: number; width: number; height: number },
  maxCount: number = 5
): SuggestedPosition[] {
  // ── Build exclusion sets ────────────────────────────────────────────────────
  // Frames are opaque blocks — their full AABB is an exclusive zone.
  const frameRects: OccupiedRect[] = Object.values(objects)
    .filter((o) => o.type === 'frame')
    .map((o) => ({ x: o.x, y: o.y, w: o.width, h: o.height }));

  // Non-frame content (excluding connectors/lines which have no meaningful size)
  const contentRects: OccupiedRect[] = Object.values(objects)
    .filter((o) => o.type !== 'frame' && o.type !== 'connector' && o.type !== 'line')
    .map((o) => ({ x: o.x, y: o.y, w: o.width, h: o.height }));

  // Combined: all rects that block a candidate position
  const allRects = [...frameRects, ...contentRects];

  function isClear(cx: number, cy: number): boolean {
    return !allRects.some((r) => overlapsRect(cx, cy, r));
  }

  // ── Pass 1: Find anchor and generate a tight grid cluster in viewport ───────
  // Grid geometry — sqrt(maxCount) columns to form a square-ish block
  const cols = Math.max(1, Math.round(Math.sqrt(maxCount)));
  const cellW = CLEARANCE_W + GRID_GAP;
  const cellH = CLEARANCE_H + GRID_GAP;

  // Raster-scan for the first clear anchor point inside the viewport
  let anchor: { x: number; y: number } | null = null;
  scanAnchor: for (
    let cy = viewport.y;
    cy < viewport.y + viewport.height - CLEARANCE_H;
    cy += SCAN_STEP
  ) {
    for (
      let cx = viewport.x;
      cx < viewport.x + viewport.width - CLEARANCE_W;
      cx += SCAN_STEP
    ) {
      if (isClear(cx, cy)) {
        anchor = { x: snapToGrid(cx), y: snapToGrid(cy) };
        break scanAnchor;
      }
    }
  }

  const results: SuggestedPosition[] = [];

  if (anchor) {
    for (let i = 0; i < maxCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = snapToGrid(anchor.x + col * cellW);
      const y = snapToGrid(anchor.y + row * cellH);

      // Skip any grid cell whose clearance rect overlaps a frame (opaque block rule)
      const hitsFrame = frameRects.some((r) => overlapsRect(x, y, r));
      if (!hitsFrame) {
        results.push({ x, y, label: 'open area in viewport', source: 'viewport' });
      }
    }
  }

  // ── Pass 2: Reflow fallback — below the lowest object, at viewport left edge ─
  // Used when the viewport is too full to fit all requested positions.
  if (results.length < maxCount) {
    const allBottoms = allRects.map((r) => r.y + r.h);
    const lowestY = allBottoms.length > 0 ? Math.max(...allBottoms) : viewport.y;
    // Two-gap vertical clearance so reflow items don't crowd the existing content
    const reflowY = snapToGrid(lowestY + GRID_GAP * 2);
    const reflowAnchorX = snapToGrid(viewport.x);
    const needed = maxCount - results.length;

    for (let i = 0; i < needed; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      results.push({
        x: snapToGrid(reflowAnchorX + col * cellW),
        y: snapToGrid(reflowY + row * cellH),
        label: 'below existing content',
        source: 'reflow',
      });
    }
  }

  return results;
}
