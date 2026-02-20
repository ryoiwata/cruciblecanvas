"use client";

import { Circle } from "react-konva";
import type { BoardObject } from "@/lib/types";

interface AnchorPointsProps {
  object: BoardObject;
  /** Current stage scale — used to keep anchor circles a constant screen size. */
  stageScale: number;
  onAnchorClick: (objectId: string) => void;
  onAnchorDragStart?: (objectId: string) => void;
}

/** Screen-space radius in px — anchors stay this size regardless of zoom level. */
const ANCHOR_SCREEN_RADIUS = 6;

/**
 * Renders 4 small circles at edge midpoints for connector creation.
 * Only shown when in connector create mode and hovering an object.
 *
 * Supports both click (tap/accessibility) and mouseDown (drag-based) creation.
 * Radius is scaled by 1/stageScale so circles remain constant on screen.
 */
export default function AnchorPoints({
  object,
  stageScale,
  onAnchorClick,
  onAnchorDragStart,
}: AnchorPointsProps) {
  const anchors = [
    { x: object.width / 2, y: 0 }, // Top
    { x: object.width / 2, y: object.height }, // Bottom
    { x: 0, y: object.height / 2 }, // Left
    { x: object.width, y: object.height / 2 }, // Right
  ];

  // Keep the circle radius constant in screen pixels
  const radius = ANCHOR_SCREEN_RADIUS / stageScale;

  return (
    <>
      {anchors.map((anchor, i) => (
        <Circle
          key={i}
          x={object.x + anchor.x}
          y={object.y + anchor.y}
          radius={radius}
          fill="#6366f1"
          stroke="#ffffff"
          strokeWidth={2 / stageScale}
          onClick={(e) => {
            e.cancelBubble = true;
            onAnchorClick(object.id);
          }}
          onTap={(e) => {
            e.cancelBubble = true;
            onAnchorClick(object.id);
          }}
          onMouseDown={(e) => {
            if (onAnchorDragStart) {
              e.cancelBubble = true;
              onAnchorDragStart(object.id);
            }
          }}
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "crosshair";
          }}
          onMouseLeave={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "";
          }}
        />
      ))}
    </>
  );
}
