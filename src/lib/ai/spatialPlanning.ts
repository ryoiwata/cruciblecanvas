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

// ---------------------------------------------------------------------------
// Server-side spatial analysis (used by AI route for Tier 1 & Tier 2)
// ---------------------------------------------------------------------------

export interface OccupiedZone {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Human-readable label for debugging. */
  label: string;
}

const ZONE_PADDING = 20;
const CLUSTER_PROXIMITY = 100; // px — objects closer than this are merged into one zone
// Must match the board's GRID_SIZE constant (also declared below for computeSuggestedPositions)
const SERVER_GRID_SNAP = 20;

/**
 * Converts board objects into compact occupied zone rectangles.
 *
 * Frames → exact AABB + 20px padding (treated as opaque exclusive zones).
 * Non-frame/non-connector objects → proximity-clustered bounding boxes + 20px padding.
 * Connectors are skipped (no meaningful footprint).
 */
export function computeOccupiedZones(objects: Record<string, BoardObject>): OccupiedZone[] {
  const zones: OccupiedZone[] = [];

  // ── Frames ────────────────────────────────────────────────────────────────
  for (const obj of Object.values(objects)) {
    if (obj.type === 'frame') {
      zones.push({
        x: obj.x - ZONE_PADDING,
        y: obj.y - ZONE_PADDING,
        width: obj.width + ZONE_PADDING * 2,
        height: obj.height + ZONE_PADDING * 2,
        label: `frame:${obj.text ?? obj.id}`,
      });
    }
  }

  // ── Non-frame, non-connector objects → cluster by proximity ───────────────
  const contentObjects = Object.values(objects).filter(
    (o) => o.type !== 'frame' && o.type !== 'connector' && o.type !== 'line'
  );

  // Simple greedy clustering: expand clusters as objects are processed
  const clusters: { minX: number; minY: number; maxX: number; maxY: number; label: string }[] = [];

  for (const obj of contentObjects) {
    const objRight = obj.x + obj.width;
    const objBottom = obj.y + obj.height;

    // Check if this object is within CLUSTER_PROXIMITY of any existing cluster
    let merged = false;
    for (const cluster of clusters) {
      const nearX =
        obj.x <= cluster.maxX + CLUSTER_PROXIMITY &&
        objRight >= cluster.minX - CLUSTER_PROXIMITY;
      const nearY =
        obj.y <= cluster.maxY + CLUSTER_PROXIMITY &&
        objBottom >= cluster.minY - CLUSTER_PROXIMITY;

      if (nearX && nearY) {
        cluster.minX = Math.min(cluster.minX, obj.x);
        cluster.minY = Math.min(cluster.minY, obj.y);
        cluster.maxX = Math.max(cluster.maxX, objRight);
        cluster.maxY = Math.max(cluster.maxY, objBottom);
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push({
        minX: obj.x,
        minY: obj.y,
        maxX: objRight,
        maxY: objBottom,
        label: `cluster:${obj.text ?? obj.type}`,
      });
    }
  }

  for (const c of clusters) {
    zones.push({
      x: c.minX - ZONE_PADDING,
      y: c.minY - ZONE_PADDING,
      width: c.maxX - c.minX + ZONE_PADDING * 2,
      height: c.maxY - c.minY + ZONE_PADDING * 2,
      label: c.label,
    });
  }

  return zones;
}

/**
 * Returns the id of the first frame whose bounds contain the center of the given object.
 * Used to automatically set `parentFrame` on AI-created objects placed inside frames.
 */
export function findContainingFrame(
  boardObjects: Record<string, BoardObject>,
  x: number,
  y: number,
  width: number,
  height: number
): string | undefined {
  const cx = x + width / 2;
  const cy = y + height / 2;
  for (const obj of Object.values(boardObjects)) {
    if (obj.type !== 'frame') continue;
    if (cx >= obj.x && cx <= obj.x + obj.width && cy >= obj.y && cy <= obj.y + obj.height) {
      return obj.id;
    }
  }
  return undefined;
}

const MAX_SCAN_RADIUS = 100_000; // effectively unlimited per requirements

/**
 * Finds the first clear rectangle of the given size by scanning from searchOrigin.
 * Scans indefinitely downward — always finds clear space even far off-screen.
 *
 * Step sizes are adaptive: `max(40, dimension / 4)` per axis for fine-grained
 * detection without O(N²) cost on small objects.
 *
 * Result is snapped to the 20px board grid.
 */
export function findClearRect(
  occupied: OccupiedZone[],
  neededW: number,
  neededH: number,
  searchOrigin: { x: number; y: number }
): { x: number; y: number } {
  const stepX = Math.max(40, Math.round(neededW / 4));
  const stepY = Math.max(40, Math.round(neededH / 4));

  function overlapsAny(cx: number, cy: number): boolean {
    for (const zone of occupied) {
      if (
        cx < zone.x + zone.width &&
        cx + neededW > zone.x &&
        cy < zone.y + zone.height &&
        cy + neededH > zone.y
      ) {
        return true;
      }
    }
    return false;
  }

  // Row-major scan starting from searchOrigin, expanding downward
  for (let dy = 0; dy < MAX_SCAN_RADIUS; dy += stepY) {
    const cy = searchOrigin.y + dy;
    for (let dx = 0; dx < MAX_SCAN_RADIUS; dx += stepX) {
      const cx = searchOrigin.x + dx;
      if (!overlapsAny(cx, cy)) {
        return {
          x: Math.round(cx / SERVER_GRID_SNAP) * SERVER_GRID_SNAP,
          y: Math.round(cy / SERVER_GRID_SNAP) * SERVER_GRID_SNAP,
        };
      }
    }
  }

  // Absolute fallback: place far below (should never reach here in practice)
  return {
    x: Math.round(searchOrigin.x / SERVER_GRID_SNAP) * SERVER_GRID_SNAP,
    y: Math.round((searchOrigin.y + MAX_SCAN_RADIUS) / SERVER_GRID_SNAP) * SERVER_GRID_SNAP,
  };
}

/**
 * Clamps object coordinates so the object fits within a frame's inner bounds.
 * Applies a 20px inner margin to prevent objects from touching the frame border.
 * When the frame is too small for the object, returns the frame origin with margin.
 * Result is snapped to the 20px board grid.
 */
export function clampToFrame(
  frame: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  const INNER_MARGIN = SERVER_GRID_SNAP; // 20px from all frame edges
  const minX = frame.x + INNER_MARGIN;
  const minY = frame.y + INNER_MARGIN;
  const maxX = frame.x + frame.width - width - INNER_MARGIN;
  const maxY = frame.y + frame.height - height - INNER_MARGIN;
  // Ensure max >= min so object always has a valid placement even in small frames
  const clampedX = Math.max(minX, Math.min(x, Math.max(minX, maxX)));
  const clampedY = Math.max(minY, Math.min(y, Math.max(minY, maxY)));
  return {
    x: Math.round(clampedX / SERVER_GRID_SNAP) * SERVER_GRID_SNAP,
    y: Math.round(clampedY / SERVER_GRID_SNAP) * SERVER_GRID_SNAP,
  };
}

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
