"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useObjectStore, spatialIndex } from "@/lib/store/objectStore";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useAuthStore } from "@/lib/store/authStore";
import StickyNote from "./StickyNote";
import ShapeObject from "./ShapeObject";
import FrameObject from "./FrameObject";
import ConnectorObject from "./ConnectorObject";
import ColorLegendObject from "./ColorLegendObject";
import AnchorPoints from "./AnchorPoints";
import type { BoardObject } from "@/lib/types";
import { LOD_SIMPLE_THRESHOLD } from "@/lib/types";
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

  // useShallow combines subscriptions into one, preventing redundant re-renders.
  const { stageX, stageY, stageScale, mode, creationTool, connectorHoverTarget, frameDragHighlightId } =
    useCanvasStore(
      useShallow((s) => ({
        stageX: s.stageX,
        stageY: s.stageY,
        stageScale: s.stageScale,
        mode: s.mode,
        creationTool: s.creationTool,
        connectorHoverTarget: s.connectorHoverTarget,
        frameDragHighlightId: s.frameDragHighlightId,
      }))
    );

  // Memoized viewport culling + sort — only recomputes when objects or viewport change.
  // Uses R-tree spatial index for O(log N + k) queries instead of O(N) linear scan.
  const { layeredObjects, connectors } = useMemo(() => {
    const padding = 200;
    const vpLeft = -stageX / stageScale - padding;
    const vpTop = -stageY / stageScale - padding;
    const vpRight = vpLeft + width / stageScale + padding * 2;
    const vpBottom = vpTop + height / stageScale + padding * 2;

    // O(log N + k) spatial query — vastly faster than O(N) linear scan at 7k+ objects.
    const candidates = spatialIndex.search({
      minX: vpLeft,
      minY: vpTop,
      maxX: vpRight,
      maxY: vpBottom,
    });

    const visibleIds = new Set<string>(
      candidates.map((item: { id: string }) => item.id)
    );
    const layered: BoardObject[] = candidates
      .map((item: { id: string }) => objects[item.id])
      .filter((obj: BoardObject | undefined): obj is BoardObject => obj !== undefined);

    // Cull connectors by endpoint visibility — connectors have no meaningful bbox.
    // Iterating only connectors (typically <5% of total objects) is acceptable.
    const conns: BoardObject[] = [];
    for (const obj of Object.values(objects)) {
      if (obj.type !== "connector") continue;
      const endpoints = obj.connectedTo;
      if (!endpoints || endpoints.length < 2) continue;
      if (visibleIds.has(endpoints[0]) || visibleIds.has(endpoints[1])) {
        conns.push(obj);
      }
    }

    // Sort by zIndex first, then createdAt as tiebreaker
    layered.sort(zSort);
    conns.sort(zSort);

    return { layeredObjects: layered, connectors: conns };
  }, [objects, stageX, stageY, stageScale, width, height]);

  // LOD: below threshold zoom, render simplified shapes to reduce draw calls.
  const isSimpleLod = stageScale < LOD_SIMPLE_THRESHOLD;

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
            isSimpleLod={isSimpleLod}
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
            isSimpleLod={isSimpleLod}
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
            isSimpleLod={isSimpleLod}
            isFrameDragTarget={frameDragHighlightId === obj.id}
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
