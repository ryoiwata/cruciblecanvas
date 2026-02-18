"use client";

import { useRef, memo } from "react";
import { Group, Rect, Text } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { updateObject } from "@/lib/firebase/firestore";
import { acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import type { BoardObject } from "@/lib/types";

interface ColorLegendObjectProps {
  object: BoardObject;
  boardId: string;
  isLocked: boolean;
  lockedByName: string | null;
}

export default memo(function ColorLegendObject({
  object,
  boardId,
  isLocked,
  lockedByName,
}: ColorLegendObjectProps) {
  const preDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const groupRef = useRef<Konva.Group>(null);

  const mode = useCanvasStore((s) => s.mode);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const setEditingObject = useCanvasStore((s) => s.setEditingObject);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const isSelected = selectedObjectIds.includes(object.id);
  const isDraggable = mode === "pointer" && !isLocked;
  const entries = object.legendEntries || [];

  const handleDragStart = () => {
    if (!user) return;
    preDragPos.current = { x: object.x, y: object.y };
    groupRef.current?.moveToTop();
    useObjectStore.getState().startLocalEdit(object.id);
    acquireLock(boardId, object.id, user.uid, displayName || "Guest");
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    updateObjectLocal(object.id, { x: e.target.x(), y: e.target.y() });
  };

  const handleDragEnd = async (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const finalX = Math.round(node.x());
    const finalY = Math.round(node.y());
    node.x(finalX);
    node.y(finalY);
    updateObjectLocal(object.id, { x: finalX, y: finalY });
    releaseLock(boardId, object.id);
    useObjectStore.getState().endLocalEdit(object.id);

    try {
      await updateObject(boardId, object.id, { x: finalX, y: finalY });
    } catch {
      const { x, y } = preDragPos.current;
      node.x(x);
      node.y(y);
      updateObjectLocal(object.id, { x, y });
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

  const entryHeight = 24;
  const headerHeight = 30;
  const dynamicHeight = headerHeight + entries.length * entryHeight + 10;

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
      onDblClick={handleDblClick}
      onContextMenu={handleContextMenu}
      opacity={(isLocked ? 0.6 : 1) * (object.opacity ?? 1)}
    >
      {/* Background */}
      <Rect
        width={object.width}
        height={Math.max(dynamicHeight, object.height)}
        fill="#FFFFFF"
        cornerRadius={8}
        shadowColor="rgba(0,0,0,0.1)"
        shadowBlur={6}
        shadowOffsetY={2}
        stroke={isSelected ? "#2196F3" : "#E5E7EB"}
        strokeWidth={isSelected ? 2 : 1}
      />

      {/* Header */}
      <Text
        text="Color Legend"
        x={10}
        y={8}
        fontSize={14}
        fontFamily="sans-serif"
        fontStyle="bold"
        fill="#1a1a1a"
      />

      {/* Legend entries */}
      {entries.map((entry, i) => (
        <Group key={i} y={headerHeight + i * entryHeight}>
          <Rect
            x={10}
            y={2}
            width={16}
            height={16}
            fill={entry.color}
            cornerRadius={3}
          />
          <Text
            x={32}
            y={3}
            text={entry.meaning || "(no label)"}
            fontSize={12}
            fontFamily="sans-serif"
            fill="#4B5563"
            width={object.width - 44}
            ellipsis
          />
        </Group>
      ))}

      {entries.length === 0 && (
        <Text
          x={10}
          y={headerHeight + 4}
          text="Double-click to add entries"
          fontSize={11}
          fontFamily="sans-serif"
          fill="#9CA3AF"
        />
      )}

      {isLocked && lockedByName && (
        <Text
          text={`🔒 ${lockedByName}`}
          x={4}
          y={Math.max(dynamicHeight, object.height) - 20}
          fontSize={11}
          fontFamily="sans-serif"
          fill="#666"
        />
      )}
    </Group>
  );
});
