"use client";

import { useRef } from "react";
import { Group, Rect, Text } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { updateObject } from "@/lib/firebase/firestore";
import { acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import { snapToGrid } from "@/lib/utils";
import type { BoardObject } from "@/lib/types";

interface StickyNoteProps {
  object: BoardObject;
  boardId: string;
  isLocked: boolean;
  lockedByName: string | null;
}

export default function StickyNote({
  object,
  boardId,
  isLocked,
  lockedByName,
}: StickyNoteProps) {
  const preDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const groupRef = useRef<Konva.Group>(null);

  const mode = useCanvasStore((s) => s.mode);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const isSelected = selectedObjectIds.includes(object.id);
  const isDraggable = mode === "select" && !isLocked;

  const handleDragStart = () => {
    if (!user) return;

    // Save pre-drag position for revert on failure
    preDragPos.current = { x: object.x, y: object.y };

    // Bring to top visually during drag
    groupRef.current?.moveToTop();

    // Acquire soft lock
    acquireLock(boardId, object.id, user.uid, displayName || "Guest");
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    updateObjectLocal(object.id, { x: node.x(), y: node.y() });
  };

  const handleDragEnd = async (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;

    // Snap to grid
    const snappedX = snapToGrid(node.x());
    const snappedY = snapToGrid(node.y());

    // Update Konva node to snapped position
    node.x(snappedX);
    node.y(snappedY);

    // Optimistic local update
    updateObjectLocal(object.id, { x: snappedX, y: snappedY });

    // Release lock
    releaseLock(boardId, object.id);

    // Persist to Firestore
    try {
      await updateObject(boardId, object.id, { x: snappedX, y: snappedY });
    } catch {
      // Revert to pre-drag position on failure
      const { x, y } = preDragPos.current;
      node.x(x);
      node.y(y);
      updateObjectLocal(object.id, { x, y });
    }
  };

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== "select") return;

    e.cancelBubble = true; // Prevent Stage click handler from clearing selection

    if (e.evt.ctrlKey || e.evt.metaKey) {
      toggleSelection(object.id);
    } else {
      selectObject(object.id);
    }
  };

  return (
    <Group
      ref={groupRef}
      id={object.id}
      x={object.x}
      y={object.y}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      opacity={isLocked ? 0.6 : 1}
    >
      {/* Background */}
      <Rect
        width={object.width}
        height={object.height}
        fill={object.color}
        cornerRadius={4}
        shadowColor="rgba(0,0,0,0.1)"
        shadowBlur={4}
        shadowOffsetY={2}
        stroke={isSelected ? "#2196F3" : undefined}
        strokeWidth={isSelected ? 2 : 0}
      />

      {/* Text content */}
      {object.text !== undefined && object.text !== "" && (
        <Text
          text={object.text}
          width={object.width - 20}
          x={10}
          y={10}
          fontSize={14}
          fontFamily="sans-serif"
          fill="#1a1a1a"
          ellipsis={true}
          wrap="word"
          height={object.height - 20}
        />
      )}

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
}
