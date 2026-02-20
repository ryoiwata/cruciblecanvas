"use client";

/**
 * LineObject — renders a freeform line on the canvas.
 * A line is stored as a BoardObject with type "line".
 * The start point is (x, y) and the end point is (x + width, y + height),
 * so width/height encode the direction vector — both can be negative.
 */

import { useRef, memo } from "react";
import { Group, Line } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { updateObject } from "@/lib/firebase/firestore";
import { acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import type { BoardObject } from "@/lib/types";
import { borderResizingIds } from "@/lib/resizeState";
import { getStrokeDash } from "@/lib/utils";

interface LineObjectProps {
  object: BoardObject;
  boardId: string;
  isLocked: boolean;
  isSimpleLod?: boolean;
}

export default memo(function LineObject({
  object,
  boardId,
  isLocked,
  isSimpleLod,
}: LineObjectProps) {
  const preDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const groupRef = useRef<Konva.Group>(null);

  const mode = useCanvasStore((s) => s.mode);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);
  const setLastUsedColor = useCanvasStore((s) => s.setLastUsedColor);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const isSelected = selectedObjectIds.includes(object.id);
  const isDraggable = mode === "pointer" && !isLocked;

  // LOD: simplified single-color line at extreme zoom-out
  if (isSimpleLod) {
    return (
      <Line
        x={object.x}
        y={object.y}
        points={[0, 0, object.width, object.height]}
        stroke={object.color}
        strokeWidth={2}
        listening={false}
      />
    );
  }

  const handleDragStart = () => {
    if (!user) return;
    preDragPos.current = { x: object.x, y: object.y };
    groupRef.current?.moveToTop();
    useObjectStore.getState().startLocalEdit(object.id);
    acquireLock(boardId, object.id, user.uid, displayName || "Guest");
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
    setLastUsedColor(object.type, object.color);
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

  const strokeStyle = object.metadata?.connectorStyle;
  const dash = getStrokeDash(strokeStyle);

  return (
    <Group
      ref={groupRef}
      id={object.id}
      x={object.x}
      y={object.y}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onContextMenu={handleContextMenu}
      opacity={(isLocked ? 0.6 : object.isAIPending ? 0.5 : 1) * (object.opacity ?? 1)}
    >
      {/* Invisible wide hit area so thin lines are easy to click */}
      <Line
        points={[0, 0, object.width, object.height]}
        stroke="transparent"
        strokeWidth={12}
        lineCap="round"
      />
      {/* Visible line */}
      <Line
        points={[0, 0, object.width, object.height]}
        stroke={isSelected ? "#2196F3" : object.color}
        strokeWidth={object.metadata?.connectorStyle !== undefined ? 2 : (object.width === 0 && object.height === 0 ? 2 : 2)}
        dash={dash}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
    </Group>
  );
}, (prevProps, nextProps) => {
  if (borderResizingIds.has(nextProps.object.id)) return true;
  return (
    prevProps.object === nextProps.object &&
    prevProps.boardId === nextProps.boardId &&
    prevProps.isLocked === nextProps.isLocked &&
    prevProps.isSimpleLod === nextProps.isSimpleLod
  );
});
