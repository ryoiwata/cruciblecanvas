"use client";

import { useMemo } from "react";
import { useObjectStore } from "@/lib/store/objectStore";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useAuthStore } from "@/lib/store/authStore";
import StickyNote from "./StickyNote";
import ShapeObject from "./ShapeObject";
import FrameObject from "./FrameObject";
import ConnectorObject from "./ConnectorObject";
import ColorLegendObject from "./ColorLegendObject";
import AnchorPoints from "./AnchorPoints";
import type { BoardObject } from "@/lib/types";
import type { Timestamp } from "firebase/firestore";

interface BoardObjectsProps {
  boardId: string;
  width: number;
  height: number;
  hoveredObjectId: string | null;
  onAnchorClick: (objectId: string) => void;
  onAnchorDragStart?: (objectId: string) => void;
}

/** Convert createdAt to milliseconds for z-index sorting. */
function getCreatedAtMs(obj: BoardObject): number {
  const ts = obj.createdAt;
  if (typeof ts === "number") return ts;
  if (ts && typeof (ts as Timestamp).toMillis === "function") {
    return (ts as Timestamp).toMillis();
  }
  return 0;
}

/** Sort comparator: explicit zIndex first, then createdAt as tiebreaker. */
function zSort(a: BoardObject, b: BoardObject): number {
  const za = a.zIndex ?? 0;
  const zb = b.zIndex ?? 0;
  if (za !== zb) return za - zb;
  return getCreatedAtMs(a) - getCreatedAtMs(b);
}

export default function BoardObjects({
  boardId,
  width,
  height,
  hoveredObjectId,
  onAnchorClick,
  onAnchorDragStart,
}: BoardObjectsProps) {
  const objects = useObjectStore((s) => s.objects);
  const locks = useObjectStore((s) => s.locks);
  const userId = useAuthStore((s) => s.user?.uid);

  const stageX = useCanvasStore((s) => s.stageX);
  const stageY = useCanvasStore((s) => s.stageY);
  const stageScale = useCanvasStore((s) => s.stageScale);
  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const connectorHoverTarget = useCanvasStore((s) => s.connectorHoverTarget);

  // Memoized viewport culling + sort — only recomputes when objects or viewport change.
  // For 500+ objects this avoids O(N) scan + sort on every unrelated re-render.
  const { layeredObjects, connectors } = useMemo(() => {
    const padding = 200;
    const vpLeft = -stageX / stageScale - padding;
    const vpTop = -stageY / stageScale - padding;
    const vpRight = vpLeft + width / stageScale + padding * 2;
    const vpBottom = vpTop + height / stageScale + padding * 2;

    const allObjects = Object.values(objects);
    const layered: BoardObject[] = [];
    const conns: BoardObject[] = [];

    for (const obj of allObjects) {
      // Viewport culling (connectors skip culling — they're derived from endpoints)
      if (obj.type !== "connector") {
        if (obj.x + obj.width < vpLeft) continue;
        if (obj.x > vpRight) continue;
        if (obj.y + obj.height < vpTop) continue;
        if (obj.y > vpBottom) continue;
      }

      if (obj.type === "connector") {
        conns.push(obj);
      } else {
        layered.push(obj);
      }
    }

    // Sort by zIndex first, then createdAt as tiebreaker
    layered.sort(zSort);
    conns.sort(zSort);

    return { layeredObjects: layered, connectors: conns };
  }, [objects, stageX, stageY, stageScale, width, height]);

  const isConnectorMode = mode === "create" && creationTool === "connector";

  const renderObject = (obj: BoardObject) => {
    const lock = locks[obj.id];
    const isLockedByOther = !!lock && lock.userId !== userId;
    const lockedByName = isLockedByOther ? lock.userName : null;
    const isTarget = connectorHoverTarget === obj.id;

    switch (obj.type) {
      case "stickyNote":
        return (
          <StickyNote
            key={obj.id}
            object={obj}
            boardId={boardId}
            isLocked={isLockedByOther}
            lockedByName={lockedByName}
            isConnectorTarget={isTarget}
          />
        );
      case "rectangle":
      case "circle":
        return (
          <ShapeObject
            key={obj.id}
            object={obj}
            boardId={boardId}
            isLocked={isLockedByOther}
            lockedByName={lockedByName}
            isConnectorTarget={isTarget}
          />
        );
      case "frame":
        return (
          <FrameObject
            key={obj.id}
            object={obj}
            boardId={boardId}
            isLocked={isLockedByOther}
            lockedByName={lockedByName}
            isConnectorTarget={isTarget}
          />
        );
      case "connector":
        return (
          <ConnectorObject
            key={obj.id}
            object={obj}
            boardId={boardId}
          />
        );
      case "colorLegend":
        return (
          <ColorLegendObject
            key={obj.id}
            object={obj}
            boardId={boardId}
            isLocked={isLockedByOther}
            lockedByName={lockedByName}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/* All layered objects (frames, shapes, sticky notes, etc.) sorted by zIndex */}
      {layeredObjects.map(renderObject)}

      {/* Connectors (always on top of all objects) */}
      {connectors.map(renderObject)}

      {/* Anchor points for connector creation mode */}
      {isConnectorMode &&
        layeredObjects.map((obj) => {
          if (obj.type === "connector" || obj.type === "colorLegend")
            return null;
          // Show anchors on hover or always in connector mode
          if (hoveredObjectId === obj.id || isConnectorMode) {
            return (
              <AnchorPoints
                key={`anchor-${obj.id}`}
                object={obj}
                onAnchorClick={onAnchorClick}
                onAnchorDragStart={onAnchorDragStart}
              />
            );
          }
          return null;
        })}
    </>
  );
}
