"use client";

import { Rect } from "react-konva";

interface SelectionRectProps {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

/**
 * Semi-transparent rubber-band rectangle rendered during drag-select.
 */
export default function SelectionRect({
  x,
  y,
  width,
  height,
  visible,
}: SelectionRectProps) {
  if (!visible) return null;

  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="rgba(33, 150, 243, 0.1)"
      stroke="#2196F3"
      strokeWidth={1}
      listening={false}
    />
  );
}
