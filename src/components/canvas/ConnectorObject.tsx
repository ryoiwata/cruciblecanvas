"use client";

import { memo } from "react";
import { Line, Text, Group } from "react-konva";
import type Konva from "konva";
import { useObjectStore } from "@/lib/store/objectStore";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { nearestEdgePoint } from "@/lib/utils";
import type { BoardObject, ConnectorStyle } from "@/lib/types";
import { CONNECTOR_DEFAULTS } from "@/lib/types";

interface ConnectorObjectProps {
  object: BoardObject;
  boardId: string;
}

function getDash(style: ConnectorStyle): number[] {
  switch (style) {
    case "dashed":
      return [10, 5];
    case "dotted":
      return [2, 4];
    default:
      return [];
  }
}

export default memo(function ConnectorObject({
  object,
}: ConnectorObjectProps) {
  // Narrow per-endpoint subscriptions — avoids re-rendering all connectors when
  // any unrelated object changes (previously subscribed to the full objects map).
  const endpointId0 = object.connectedTo?.[0] ?? '';
  const endpointId1 = object.connectedTo?.[1] ?? '';
  const startObj = useObjectStore((s) => (endpointId0 ? s.objects[endpointId0] : null) ?? null);
  const endObj = useObjectStore((s) => (endpointId1 ? s.objects[endpointId1] : null) ?? null);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const mode = useCanvasStore((s) => s.mode);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);

  if (!object.connectedTo || object.connectedTo.length < 2) return null;
  if (!startObj || !endObj) return null;

  // Calculate center of each endpoint object
  const startCx = startObj.x + startObj.width / 2;
  const startCy = startObj.y + startObj.height / 2;
  const endCx = endObj.x + endObj.width / 2;
  const endCy = endObj.y + endObj.height / 2;

  // Get edge points
  const startPt = nearestEdgePoint(startObj, endCx, endCy);
  const endPt = nearestEdgePoint(endObj, startCx, startCy);

  const midX = (startPt.x + endPt.x) / 2;
  const midY = (startPt.y + endPt.y) / 2;

  const connectorStyle =
    (object.metadata as Record<string, unknown>)?.connectorStyle as
      | ConnectorStyle
      | undefined;
  const dash = getDash(connectorStyle || "solid");
  const isSelected = selectedObjectIds.includes(object.id);

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== "pointer") return;
    e.cancelBubble = true;
    if (e.evt.ctrlKey || e.evt.metaKey) {
      toggleSelection(object.id);
    } else {
      selectObject(object.id);
    }
  };

  const handleContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    showContextMenu({
      visible: true,
      x: e.evt.clientX,
      y: e.evt.clientY,
      targetObjectId: object.id,
      nearbyFrames: [],
    });
  };

  return (
    <Group id={object.id}>
      {/* Hit area (wider invisible line for easier clicking) */}
      <Line
        points={[startPt.x, startPt.y, endPt.x, endPt.y]}
        stroke="transparent"
        strokeWidth={12}
        onClick={handleClick}
        onTap={handleClick}
        onContextMenu={handleContextMenu}
      />

      {/* Visible line */}
      <Line
        points={[startPt.x, startPt.y, endPt.x, endPt.y]}
        stroke={isSelected ? "#2196F3" : object.color}
        strokeWidth={isSelected ? (object.thickness ?? CONNECTOR_DEFAULTS.strokeWidth) + 1 : (object.thickness ?? CONNECTOR_DEFAULTS.strokeWidth)}
        dash={dash}
        listening={false}
      />

      {/* Optional label */}
      {object.text && (
        <Text
          x={midX - 40}
          y={midY - 8}
          width={80}
          text={object.text}
          fontSize={12}
          fontFamily="sans-serif"
          fill="#374151"
          align="center"
        />
      )}
    </Group>
  );
});
