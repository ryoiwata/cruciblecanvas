/**
 * validation.ts — server-side validation utilities for AI tool calls.
 * Handles size clamping per object type, grid snapping, and layout calculations.
 * All AI-generated coordinates and dimensions pass through these functions before
 * being written to Firestore.
 */

import { GRID_SIZE } from '@/lib/types';
import type { ObjectType } from '@/lib/types';

// ---------------------------------------------------------------------------
// Size limits per object type (AI-specific, stricter than canvas limits)
// ---------------------------------------------------------------------------

const AI_SIZE_LIMITS: Record<string, { min: [number, number]; max: [number, number] }> = {
  stickyNote: { min: [80, 60], max: [600, 600] },
  rectangle: { min: [20, 20], max: [800, 800] },
  circle: { min: [20, 20], max: [800, 800] },
  frame: { min: [150, 100], max: [4000, 4000] },
};

/**
 * Snaps a coordinate value to the nearest grid point (default 20px).
 */
export function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Clamps width and height to type-specific min/max bounds.
 * Falls back to identity if the type has no defined limits.
 */
export function clampSize(
  type: ObjectType,
  width: number,
  height: number
): { width: number; height: number } {
  const limits = AI_SIZE_LIMITS[type];
  if (!limits) return { width, height };
  return {
    width: Math.max(limits.min[0], Math.min(limits.max[0], width)),
    height: Math.max(limits.min[1], Math.min(limits.max[1], height)),
  };
}

/**
 * Validates and sanitizes board coordinates.
 * Ensures they are within a reasonable range for a virtual canvas.
 */
export function validateCoordinates(x: number, y: number): { x: number; y: number } {
  const MAX_COORD = 100000;
  return {
    x: Math.max(-MAX_COORD, Math.min(MAX_COORD, Math.round(x))),
    y: Math.max(-MAX_COORD, Math.min(MAX_COORD, Math.round(y))),
  };
}

interface LayoutObject {
  id: string;
  width: number;
  height: number;
}

interface LayoutOptions {
  columns?: number;
  spacing?: number;
  originX?: number;
  originY?: number;
}

/**
 * Calculates uniform-cell grid layout positions for a set of objects.
 * Uses the largest object dimensions as the cell size to ensure consistent alignment.
 * All positions are snapped to the 20px grid.
 */
export function calculateUniformGrid(
  objects: LayoutObject[],
  options: LayoutOptions = {}
): { id: string; x: number; y: number }[] {
  if (objects.length === 0) return [];

  const { columns = Math.ceil(Math.sqrt(objects.length)), spacing = 20, originX = 0, originY = 0 } = options;

  const maxW = Math.max(...objects.map((o) => o.width));
  const maxH = Math.max(...objects.map((o) => o.height));
  const cellW = snapToGrid(maxW + spacing);
  const cellH = snapToGrid(maxH + spacing);

  return objects.map((obj, i) => ({
    id: obj.id,
    x: snapToGrid(originX + (i % columns) * cellW + (cellW - obj.width) / 2),
    y: snapToGrid(originY + Math.floor(i / columns) * cellH + (cellH - obj.height) / 2),
  }));
}

/**
 * Calculates horizontal layout positions (objects in a single row).
 */
export function calculateHorizontalLayout(
  objects: LayoutObject[],
  options: LayoutOptions = {}
): { id: string; x: number; y: number }[] {
  const { spacing = 20, originX = 0, originY = 0 } = options;

  let currentX = originX;
  return objects.map((obj) => {
    const x = snapToGrid(currentX);
    const y = snapToGrid(originY);
    currentX += obj.width + spacing;
    return { id: obj.id, x, y };
  });
}

/**
 * Calculates vertical layout positions (objects in a single column).
 */
export function calculateVerticalLayout(
  objects: LayoutObject[],
  options: LayoutOptions = {}
): { id: string; x: number; y: number }[] {
  const { spacing = 20, originX = 0, originY = 0 } = options;

  let currentY = originY;
  return objects.map((obj) => {
    const x = snapToGrid(originX);
    const y = snapToGrid(currentY);
    currentY += obj.height + spacing;
    return { id: obj.id, x, y };
  });
}
