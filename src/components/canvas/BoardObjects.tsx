"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
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

  // useShallow combines 6 individual subscriptions into one, preventing redundant
  // re-renders when unrelated store slices change between these values.
  const { stageX, stageY, stageScale, mode, creationTool, connectorHoverTarget } =
    useCanvasStore(
      useShallow((s) => ({
        stageX: s.stageX,
        stageY: s.stageY,
        stageScale: s.stageScale,
        mode: s.mode,
        creationTool: s.creationTool,
        connectorHoverTarget: s.connectorHoverTarget,
      }))
    );

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
    const pendingConnectors: BoardObject[] = [];
    // Track visible non-connector IDs so connectors can be culled by endpoint visibility
    const visibleIds = new Set<string>();

    for (const obj of allObjects) {
      if (obj.type === "connector") {
        pendingConnectors.push(obj);
        continue;
      }

      // Viewport culling for non-connector objects
      if (obj.x + obj.width < vpLeft) continue;
      if (obj.x > vpRight) continue;
      if (obj.y + obj.height < vpTop) continue;
      if (obj.y > vpBottom) continue;

      layered.push(obj);
      visibleIds.add(obj.id);
    }

    // Cull connectors based on endpoint visibility — connectors store x=0,y=0,w=0,h=0
    // so bounding-box culling is meaningless; use endpoint presence instead.
    const conns: BoardObject[] = [];
    for (const conn of pendingConnectors) {
      const endpoints = conn.connectedTo;
      if (!endpoints || endpoints.length < 2) continue;
      if (visibleIds.has(endpoints[0]) || visibleIds.has(endpoints[1])) {
        conns.push(conn);
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
