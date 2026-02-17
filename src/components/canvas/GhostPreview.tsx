"use client";

import { Rect, Circle } from "react-konva";
import type { ObjectType } from "@/lib/types";
import {
  STICKY_NOTE_DEFAULT,
  SHAPE_DEFAULTS,
  FRAME_DEFAULTS,
  COLOR_LEGEND_DEFAULTS,
} from "@/lib/types";

interface GhostPreviewProps {
  tool: ObjectType;
  x: number;
  y: number;
  color: string;
}

function getDefaultSize(tool: ObjectType) {
  switch (tool) {
    case "stickyNote":
      return { width: STICKY_NOTE_DEFAULT.width, height: STICKY_NOTE_DEFAULT.height };
    case "rectangle":
      return { width: SHAPE_DEFAULTS.rectangle.width, height: SHAPE_DEFAULTS.rectangle.height };
    case "circle":
      return { width: SHAPE_DEFAULTS.circle.width, height: SHAPE_DEFAULTS.circle.height };
    case "frame":
      return { width: FRAME_DEFAULTS.width, height: FRAME_DEFAULTS.height };
    case "colorLegend":
      return { width: COLOR_LEGEND_DEFAULTS.width, height: COLOR_LEGEND_DEFAULTS.height };
    default:
      return { width: 100, height: 100 };
  }
}

export default function GhostPreview({ tool, x, y, color }: GhostPreviewProps) {
  const { width, height } = getDefaultSize(tool);

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
