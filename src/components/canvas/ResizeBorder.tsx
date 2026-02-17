"use client";

import { Rect, Circle as KonvaCircle } from "react-konva";
import type Konva from "konva";
import type { ResizeEdge } from "@/lib/types";
import { CORNER_ZONE } from "@/lib/types";
import { isTransforming } from "@/lib/resizeState";

interface ResizeBorderProps {
  objectId: string;
  width: number;
  height: number;
  isCircle?: boolean;
  enabled: boolean;
  onHoverChange: (hovering: boolean) => void;
}

function detectEdge(
  lx: number,
  ly: number,
  w: number,
  h: number
): ResizeEdge | null {
  const nearLeft = lx < CORNER_ZONE;
  const nearRight = lx > w - CORNER_ZONE;
  const nearTop = ly < CORNER_ZONE;
  const nearBottom = ly > h - CORNER_ZONE;

  if (nearTop && nearLeft) return "nw";
  if (nearTop && nearRight) return "ne";
  if (nearBottom && nearLeft) return "sw";
  if (nearBottom && nearRight) return "se";
  if (nearTop) return "n";
  if (nearBottom) return "s";
  if (nearLeft) return "w";
  if (nearRight) return "e";

  return null;
}

function edgeToCursor(edge: ResizeEdge): string {
  switch (edge) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
  }
}

function dispatchCursor(cursor: string | null) {
  window.dispatchEvent(
    new CustomEvent("border-cursor", { detail: { cursor } })
  );
}

export default function ResizeBorder({
  objectId,
  width,
  height,
  isCircle,
  enabled,
  onHoverChange,
}: ResizeBorderProps) {
  if (!enabled) return null;

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const node = e.target;
    const pos = node.getRelativePointerPosition();
    if (!pos) return;

    const edge = detectEdge(pos.x, pos.y, width, height);
    if (edge) {
      dispatchCursor(edgeToCursor(edge));
    }
  };

  const handleMouseEnter = () => {
    if (isTransforming) return;
    onHoverChange(true);
  };

  const handleMouseLeave = () => {
    onHoverChange(false);
    dispatchCursor(null);
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isTransforming) return;
    const node = e.target;
    const pos = node.getRelativePointerPosition();
    if (!pos) return;

    const edge = detectEdge(pos.x, pos.y, width, height);
    if (!edge) return;

    // Prevent Group click/drag handlers from firing
    e.cancelBubble = true;

    window.dispatchEvent(
      new CustomEvent("border-resize-start", {
        detail: { objectId, edge },
      })
    );
  };

  if (isCircle) {
    return (
      <KonvaCircle
        x={width / 2}
        y={height / 2}
        radius={width / 2}
        fillEnabled={false}
        stroke="#000000"
        strokeWidth={16}
        opacity={0.005}
        listening={true}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
      />
    );
  }

  return (
    <Rect
      width={width}
      height={height}
      fillEnabled={false}
      stroke="#000000"
      strokeWidth={16}
      opacity={0.005}
      listening={true}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
    />
  );
}
