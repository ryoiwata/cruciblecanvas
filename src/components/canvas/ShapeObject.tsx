"use client";

import { useRef, useState, useCallback, memo } from "react";
import { Group, Rect, Circle, Text } from "react-konva";
import ResizeBorder from "./ResizeBorder";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { updateObject } from "@/lib/firebase/firestore";
import { acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import type { BoardObject } from "@/lib/types";
import { borderResizingIds } from "@/lib/resizeState";

interface ShapeObjectProps {
  object: BoardObject;
  boardId: string;
  isLocked: boolean;
  lockedByName: string | null;
}

export default memo(function ShapeObject({
  object,
  boardId,
  isLocked,
  lockedByName,
}: ShapeObjectProps) {
  const preDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const groupRef = useRef<Konva.Group>(null);

  const mode = useCanvasStore((s) => s.mode);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const [isHoveringBorder, setIsHoveringBorder] = useState(false);
  const handleBorderHover = useCallback((hovering: boolean) => {
    setIsHoveringBorder(hovering);
  }, []);

  const isSelected = selectedObjectIds.includes(object.id);
  const isDraggable = mode === "pointer" && !isLocked && !isHoveringBorder;

  const handleDragStart = () => {
    if (!user) return;
    preDragPos.current = { x: object.x, y: object.y };
    groupRef.current?.moveToTop();
    acquireLock(boardId, object.id, user.uid, displayName || "Guest");
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    updateObjectLocal(object.id, { x: node.x(), y: node.y() });
  };

  const handleDragEnd = async (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const finalX = Math.round(node.x());
    const finalY = Math.round(node.y());
    node.x(finalX);
    node.y(finalY);
    updateObjectLocal(object.id, { x: finalX, y: finalY });
    releaseLock(boardId, object.id);

    try {
      await updateObject(boardId, object.id, { x: finalX, y: finalY });
    } catch {
      const { x, y } = preDragPos.current;
      node.x(x);
      node.y(y);
      updateObjectLocal(object.id, { x, y });
    }

    // Trigger frame nesting check
    window.dispatchEvent(
      new CustomEvent("object-drag-end", { detail: { objectId: object.id } })
    );
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
      onContextMenu={handleContextMenu}
      opacity={isLocked ? 0.6 : 1}
    >
      {object.type === "rectangle" ? (
        <Rect
          width={object.width}
          height={object.height}
          fill={object.color}
          cornerRadius={4}
          stroke={isSelected ? "#2196F3" : undefined}
          strokeWidth={isSelected ? 2 : 0}
        />
      ) : (
        <Circle
          x={object.width / 2}
          y={object.height / 2}
          radius={object.width / 2}
          fill={object.color}
          stroke={isSelected ? "#2196F3" : undefined}
          strokeWidth={isSelected ? 2 : 0}
        />
      )}

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

      <ResizeBorder
        objectId={object.id}
        width={object.width}
        height={object.height}
        isCircle={object.type === "circle"}
        enabled={mode === "pointer" && !isLocked}
        onHoverChange={handleBorderHover}
      />
    </Group>
  );
}, (prevProps, nextProps) => {
  if (borderResizingIds.has(nextProps.object.id)) return true;
  return (
    prevProps.object === nextProps.object &&
    prevProps.boardId === nextProps.boardId &&
    prevProps.isLocked === nextProps.isLocked &&
    prevProps.lockedByName === nextProps.lockedByName
  );
});
