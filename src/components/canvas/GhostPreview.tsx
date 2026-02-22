"use client";

import { Rect, Circle, Line } from "react-konva";
import type { ObjectType } from "@/lib/types";
import {
  STICKY_NOTE_DEFAULT,
  SHAPE_DEFAULTS,
  FRAME_DEFAULTS,
  COLOR_LEGEND_DEFAULTS,
  TEXT_DEFAULTS,
} from "@/lib/types";

interface GhostPreviewProps {
  tool: ObjectType;
  x: number;
  y: number;
  color: string;
  /** Current canvas zoom level — ghost dimensions are scaled to match creation defaults. */
  stageScale: number;
}

/**
 * Returns the canvas-space dimensions for the ghost preview, scaled to match
 * what getDefaultsForTool() will produce when the user clicks to create.
 * Uses the same [0.25, 4.0] clamp as the creation path.
 */
function getGhostSize(tool: ObjectType, stageScale: number) {
  const s = Math.max(0.25, Math.min(4.0, stageScale));
  switch (tool) {
    case "stickyNote":
      return { width: Math.round(STICKY_NOTE_DEFAULT.width / s), height: Math.round(STICKY_NOTE_DEFAULT.height / s) };
    case "rectangle":
      return { width: Math.round(SHAPE_DEFAULTS.rectangle.width / s), height: Math.round(SHAPE_DEFAULTS.rectangle.height / s) };
    case "circle":
      return { width: Math.round(SHAPE_DEFAULTS.circle.width / s), height: Math.round(SHAPE_DEFAULTS.circle.height / s) };
    case "frame":
      return { width: Math.round(FRAME_DEFAULTS.width / s), height: Math.round(FRAME_DEFAULTS.height / s) };
    case "colorLegend":
      return { width: Math.round(COLOR_LEGEND_DEFAULTS.width / s), height: Math.round(COLOR_LEGEND_DEFAULTS.height / s) };
    case "text":
      return { width: Math.round(TEXT_DEFAULTS.width / s), height: Math.round(TEXT_DEFAULTS.height / s) };
    default:
      return { width: Math.round(100 / s), height: Math.round(100 / s) };
  }
}

export default function GhostPreview({ tool, x, y, color, stageScale }: GhostPreviewProps) {
  const { width, height } = getGhostSize(tool, stageScale);
  const s = Math.max(0.25, Math.min(4.0, stageScale));

  if (tool === "line") {
    return (
      <Line
        x={x}
        y={y}
        points={[0, 0, Math.round(120 / s), 0]}
        stroke={color}
        strokeWidth={2}
        opacity={0.4}
        dash={[4, 4]}
        lineCap="round"
        listening={false}
      />
    );
  }

  if (tool === "circle") {
    const radius = width / 2;
    return (
      <Circle
        x={x + radius}
        y={y + radius}
        radius={radius}
        fill={color}
        opacity={0.3}
        stroke="#9CA3AF"
        strokeWidth={1}
        dash={[4, 4]}
        listening={false}
      />
    );
  }

  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={color}
      opacity={0.3}
      stroke="#9CA3AF"
      strokeWidth={1}
      dash={[4, 4]}
      cornerRadius={tool === "stickyNote" ? 4 : 0}
      listening={false}
    />
  );
}
