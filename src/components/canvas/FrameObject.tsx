"use client";

import { useRef, memo } from "react";
import { Group, Rect, Text } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { updateObjects } from "@/lib/firebase/firestore";
import { acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import type { BoardObject } from "@/lib/types";
import { FRAME_DEFAULTS } from "@/lib/types";
import { borderResizingIds } from "@/lib/resizeState";

interface FrameObjectProps {
  object: BoardObject;
  boardId: string;
  isLocked: boolean;
  lockedByName: string | null;
  isConnectorTarget?: boolean;
}

interface ChildSnapshot {
  id: string;
  x: number;
  y: number;
}

export default memo(function FrameObject({
  object,
  boardId,
  isLocked,
  lockedByName,
  isConnectorTarget,
}: FrameObjectProps) {
  const preDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const childSnapshots = useRef<ChildSnapshot[]>([]);
  const groupRef = useRef<Konva.Group>(null);

  const mode = useCanvasStore((s) => s.mode);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const setEditingObject = useCanvasStore((s) => s.setEditingObject);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const getChildrenOfFrame = useObjectStore((s) => s.getChildrenOfFrame);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const isSelected = selectedObjectIds.includes(object.id);
  const isDraggable = mode === "pointer" && !isLocked;

  const handleDragStart = () => {
    if (!user) return;
    preDragPos.current = { x: object.x, y: object.y };
    groupRef.current?.moveToTop();

    // Snapshot children positions for delta movement
    const children = getChildrenOfFrame(object.id);
    childSnapshots.current = children.map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
    }));

    const { startLocalEdit } = useObjectStore.getState();
    startLocalEdit(object.id);
    for (const snap of childSnapshots.current) {
      startLocalEdit(snap.id);
    }

    acquireLock(boardId, object.id, user.uid, displayName || "Guest");
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const dx = node.x() - preDragPos.current.x;
    const dy = node.y() - preDragPos.current.y;

    updateObjectLocal(object.id, { x: node.x(), y: node.y() });

    // Move children by delta
    for (const snap of childSnapshots.current) {
      updateObjectLocal(snap.id, { x: snap.x + dx, y: snap.y + dy });
    }
  };

  const handleDragEnd = async (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const finalX = Math.round(node.x());
    const finalY = Math.round(node.y());
    node.x(finalX);
    node.y(finalY);

    const dx = finalX - preDragPos.current.x;
    const dy = finalY - preDragPos.current.y;

    updateObjectLocal(object.id, { x: finalX, y: finalY });

    // Move children by delta
    const childUpdates: { id: string; changes: Partial<BoardObject> }[] = [];
    for (const snap of childSnapshots.current) {
      const cx = Math.round(snap.x + dx);
      const cy = Math.round(snap.y + dy);
      updateObjectLocal(snap.id, { x: cx, y: cy });
      childUpdates.push({ id: snap.id, changes: { x: cx, y: cy } });
    }

    releaseLock(boardId, object.id);

    const { endLocalEdit } = useObjectStore.getState();
    endLocalEdit(object.id);
    for (const snap of childSnapshots.current) {
      endLocalEdit(snap.id);
    }

    try {
      await updateObjects(boardId, [
        { id: object.id, changes: { x: finalX, y: finalY } },
        ...childUpdates,
      ]);
    } catch {
      // Revert frame
      const { x, y } = preDragPos.current;
      node.x(x);
      node.y(y);
      updateObjectLocal(object.id, { x, y });
      // Revert children
      for (const snap of childSnapshots.current) {
        updateObjectLocal(snap.id, { x: snap.x, y: snap.y });
      }
    }
  };

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== "pointer") return;
    e.cancelBubble = true;
    if (e.evt.ctrlKey || e.evt.metaKey) {
      toggleSelection(object.id);
    } else {
      selectObject(object.id);
    }
  };

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    setEditingObject(object.id);
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

  const titleBarHeight = FRAME_DEFAULTS.titleBarHeight;

  return (
    <Group
      ref={groupRef}
      id={object.id}
      x={object.x}
      y={object.y}
      width={object.width}
      height={object.height}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onDblClick={handleDblClick}
      onContextMenu={handleContextMenu}
      opacity={(isLocked ? 0.6 : object.isAIPending ? 0.5 : 1) * (object.opacity ?? 1)}
    >
      {/* AI badge */}
      {object.isAIGenerated && (
        <Text
          text="✨"
          x={object.width - 22}
          y={4}
          fontSize={14}
          listening={false}
        />
      )}
      {/* Frame background */}
      <Rect
        width={object.width}
        height={object.height}
        fill={object.color}
        opacity={FRAME_DEFAULTS.backgroundOpacity}
        stroke={object.color}
        strokeWidth={2}
        cornerRadius={4}
        shadowColor={isConnectorTarget ? "#6366f1" : undefined}
        shadowBlur={isConnectorTarget ? 15 : 0}
        shadowEnabled={!!isConnectorTarget}
      />

      {/* Title bar */}
      <Rect
        width={object.width}
        height={titleBarHeight}
        fill={object.color}
        opacity={0.2}
        cornerRadius={[4, 4, 0, 0]}
      />

      {/* Selection border */}
      {isSelected && (
        <Rect
          width={object.width}
          height={object.height}
          stroke="#2196F3"
          strokeWidth={2}
          cornerRadius={4}
        />
      )}

      {/* Title text */}
      <Text
        text={object.text || "Untitled Frame"}
        x={10}
        y={10}
        width={object.width - 20}
        fontSize={14}
        fontFamily="sans-serif"
        fontStyle="bold"
        fill={object.color}
        ellipsis
        wrap="none"
      />

      {/* Lock indicator */}
      {isLocked && lockedByName && (
        <Text
          text={`🔒 ${lockedByName}`}
          x={4}
          y={object.height - 20}
          fontSize={11}
          fontFamily="sans-serif"
          fill="#666"
        />
      )}
    </Group>
  );
}, (prevProps, nextProps) => {
  if (borderResizingIds.has(nextProps.object.id)) return true;
  return (
    prevProps.object === nextProps.object &&
    prevProps.boardId === nextProps.boardId &&
    prevProps.isLocked === nextProps.isLocked &&
    prevProps.lockedByName === nextProps.lockedByName &&
    prevProps.isConnectorTarget === nextProps.isConnectorTarget
  );
});
