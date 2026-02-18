/**
 * context.ts — board state serialization for AI commands.
 * Filters objects to the requester's viewport plus selected objects,
 * groups them by frames, and produces a compact JSON structure
 * that Claude uses to understand the board layout.
 */

import type { BoardObject } from '@/lib/types';

interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AIObjectSummary {
  id: string;
  type: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  isAIGenerated?: boolean;
  aiCommandId?: string;
  parentFrame?: string;
  connectedTo?: string[];
}

interface AIFrameSummary {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: AIObjectSummary[];
}

export interface AIBoardContext {
  totalObjects: number;
  visibleObjects: AIObjectSummary[];
  frames: AIFrameSummary[];
  orphanObjects: AIObjectSummary[];
  connectors: AIObjectSummary[];
  colorLegend: { color: string; meaning: string }[];
  selectedObjectIds: string[];
}

/**
 * Determines whether an object's center is within the viewport bounds.
 * Objects with parentFrame are not directly positioned — they follow the frame.
 */
function isInViewport(obj: BoardObject, bounds: ViewportBounds): boolean {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  return (
    cx >= bounds.x - 200 &&
    cx <= bounds.x + bounds.width + 200 &&
    cy >= bounds.y - 200 &&
    cy <= bounds.y + bounds.height + 200
  );
}

function toSummary(obj: BoardObject): AIObjectSummary {
  return {
    id: obj.id,
    type: obj.type,
    ...(obj.text !== undefined ? { text: obj.text } : {}),
    x: Math.round(obj.x),
    y: Math.round(obj.y),
    width: Math.round(obj.width),
    height: Math.round(obj.height),
    color: obj.color,
    ...(obj.isAIGenerated ? { isAIGenerated: true } : {}),
    ...(obj.aiCommandId ? { aiCommandId: obj.aiCommandId } : {}),
    ...(obj.parentFrame ? { parentFrame: obj.parentFrame } : {}),
    ...(obj.connectedTo?.length ? { connectedTo: obj.connectedTo } : {}),
  };
}

/**
 * Serializes board objects into a compact AI context structure.
 * Includes viewport objects + selected objects (even if off-screen).
 * Groups objects by frame for better spatial understanding.
 */
export function serializeBoardState(
  objects: Record<string, BoardObject>,
  viewportBounds: ViewportBounds,
  selectedObjectIds: string[]
): AIBoardContext {
  const allObjects = Object.values(objects);
  const totalObjects = allObjects.length;

  // Include viewport objects + selected objects + frame children of visible frames
  const visibleIds = new Set<string>();

  for (const obj of allObjects) {
    if (obj.type === 'connector') continue;
    if (selectedObjectIds.includes(obj.id)) {
      visibleIds.add(obj.id);
      continue;
    }
    if (isInViewport(obj, viewportBounds)) {
      visibleIds.add(obj.id);
    }
  }

  // Also include children of visible frames
  for (const obj of allObjects) {
    if (obj.parentFrame && visibleIds.has(obj.parentFrame)) {
      visibleIds.add(obj.id);
    }
  }

  const visibleObjects = allObjects.filter(
    (o) => visibleIds.has(o.id) && o.type !== 'connector' && o.type !== 'colorLegend'
  );

  // Extract color legend entries
  const legendObj = allObjects.find((o) => o.type === 'colorLegend');
  const colorLegend = legendObj?.legendEntries ?? [];

  // Group frames and their children
  const frames: AIFrameSummary[] = visibleObjects
    .filter((o) => o.type === 'frame')
    .map((frame) => ({
      id: frame.id,
      title: frame.text ?? 'Untitled Frame',
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      width: Math.round(frame.width),
      height: Math.round(frame.height),
      children: visibleObjects
        .filter((o) => o.parentFrame === frame.id && o.type !== 'frame')
        .map(toSummary),
    }));

  // Objects not in any frame
  const framedIds = new Set(visibleObjects.filter((o) => o.parentFrame).map((o) => o.id));
  const frameIds = new Set(visibleObjects.filter((o) => o.type === 'frame').map((o) => o.id));
  const orphanObjects = visibleObjects.filter(
    (o) => !framedIds.has(o.id) && !frameIds.has(o.id) && o.type !== 'connector'
  ).map(toSummary);

  // Connectors between visible objects
  const connectors = allObjects
    .filter(
      (o) =>
        o.type === 'connector' &&
        o.connectedTo?.some((id) => visibleIds.has(id))
    )
    .map(toSummary);

  return {
    totalObjects,
    visibleObjects: visibleObjects.map(toSummary),
    frames,
    orphanObjects,
    connectors,
    colorLegend,
    selectedObjectIds,
  };
}
