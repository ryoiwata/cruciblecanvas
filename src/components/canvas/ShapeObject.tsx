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
import { overlapFraction } from "@/lib/utils";

interface ShapeObjectProps {
  object: BoardObject;
  boardId: string;
  isLocked: boolean;
  lockedByName: string | null;
  isConnectorTarget?: boolean;
  isSimpleLod?: boolean;
}

export default memo(function ShapeObject({
  object,
  boardId,
  isLocked,
  lockedByName,
  isConnectorTarget,
  isSimpleLod,
}: ShapeObjectProps) {
  const preDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const groupRef = useRef<Konva.Group>(null);
  // RAF handle for frame-glow detection during drag — coalesces move events per frame
  const frameDragRafRef = useRef(0);

  const mode = useCanvasStore((s) => s.mode);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);
  const setLastUsedColor = useCanvasStore((s) => s.setLastUsedColor);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const [isHoveringBorder, setIsHoveringBorder] = useState(false);
  const handleBorderHover = useCallback((hovering: boolean) => {
    setIsHoveringBorder(hovering);
  }, []);

  // RAF-throttled drag-move handler — computes best-candidate frame overlap to drive the glow effect.
  // Avoids drag-flooding by coalescing multiple move events to one computation per animation frame.
  // Defined before the LOD guard to satisfy rules-of-hooks (no conditional hook calls).
  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (frameDragRafRef.current) {
      cancelAnimationFrame(frameDragRafRef.current);
    }
    frameDragRafRef.current = requestAnimationFrame(() => {
      frameDragRafRef.current = 0;
      const node = e.target as Konva.Group;
      const curX = node.x();
      const curY = node.y();
      const dragBounds = { x: curX, y: curY, width: object.width, height: object.height };

      const allObjects = useObjectStore.getState().objects;
      let bestId: string | null = null;
      let bestOverlap = 0;
      for (const candidate of Object.values(allObjects)) {
        if (candidate.type !== "frame" || candidate.id === object.id) continue;
        const frac = overlapFraction(dragBounds, candidate);
        if (frac > 0.5 && frac > bestOverlap) {
          bestOverlap = frac;
          bestId = candidate.id;
        }
      }
      useCanvasStore.getState().setFrameDragHighlightId(bestId);
    });
  }, [object.id, object.width, object.height]);

  const isSelected = selectedObjectIds.includes(object.id);
  const isDraggable = mode === "pointer" && !isLocked && !isHoveringBorder;

  // LOD: simplified render for extreme zoom-out — no text, borders, shadows
  if (isSimpleLod) {
    return object.type === 'rectangle' ? (
      <Rect
        x={object.x}
        y={object.y}
        width={object.width}
        height={object.height}
        fill={object.color}
        listening={false}
      />
    ) : (
      <Circle
        x={object.x + object.width / 2}
        y={object.y + object.height / 2}
        radius={object.width / 2}
        fill={object.color}
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
    // Clear frame glow highlight immediately on drop
    if (frameDragRafRef.current) {
      cancelAnimationFrame(frameDragRafRef.current);
      frameDragRafRef.current = 0;
    }
    useCanvasStore.getState().setFrameDragHighlightId(null);

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

    // Trigger frame nesting check
    window.dispatchEvent(
      new CustomEvent("object-drag-end", { detail: { objectId: object.id } })
    );
  };

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== "pointer") return;
    e.cancelBubble = true;
    // Sync active color in toolbar to match the clicked object's color
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

  return (
    <Group
      ref={groupRef}
      id={object.id}
      x={object.x}
      y={object.y}
      width={object.width}
      height={object.height}
      rotation={object.rotation ?? 0}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onContextMenu={handleContextMenu}
      opacity={(isLocked ? 0.6 : object.isAIPending ? 0.5 : 1) * (object.opacity ?? 1)}
    >
      {/* Framed-child indicator — dashed purple border when nested inside a frame */}
      {object.parentFrame && !isSimpleLod && (
        <Rect
          width={object.width}
          height={object.height}
          stroke="#6366f1"
          strokeWidth={1.5}
          dash={[4, 3]}
          fill="transparent"
          listening={false}
          cornerRadius={4}
        />
      )}

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
      {object.type === "rectangle" ? (
        <Rect
          width={object.width}
          height={object.height}
          fill={object.color}
          cornerRadius={4}
          stroke={isSelected ? "#2196F3" : undefined}
          strokeWidth={isSelected ? 2 : 0}
          shadowColor={isConnectorTarget ? "#6366f1" : undefined}
          shadowBlur={isConnectorTarget ? 15 : 0}
          shadowEnabled={!!isConnectorTarget}
        />
      ) : (
        <Circle
          x={object.width / 2}
          y={object.height / 2}
          radius={object.width / 2}
          fill={object.color}
          stroke={isSelected ? "#2196F3" : undefined}
          strokeWidth={isSelected ? 2 : 0}
          shadowColor={isConnectorTarget ? "#6366f1" : undefined}
          shadowBlur={isConnectorTarget ? 15 : 0}
          shadowEnabled={!!isConnectorTarget}
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
    prevProps.lockedByName === nextProps.lockedByName &&
    prevProps.isConnectorTarget === nextProps.isConnectorTarget &&
    prevProps.isSimpleLod === nextProps.isSimpleLod
  );
});
