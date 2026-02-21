"use client";

import { useRef, useState, useCallback, memo } from "react";
import { Group, Rect, Text, Line } from "react-konva";
import ResizeBorder from "./ResizeBorder";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { updateObject } from "@/lib/firebase/firestore";
import { acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import type { BoardObject } from "@/lib/types";
import { FONT_FAMILY_MAP } from "@/lib/types";
import { borderResizingIds } from "@/lib/resizeState";
import { overlapFraction } from "@/lib/utils";

interface StickyNoteProps {
  object: BoardObject;
  boardId: string;
  isLocked: boolean;
  lockedByName: string | null;
  isConnectorTarget?: boolean;
  isSimpleLod?: boolean;
}

export default memo(function StickyNote({
  object,
  boardId,
  isLocked,
  lockedByName,
  isConnectorTarget,
  isSimpleLod,
}: StickyNoteProps) {
  const preDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const groupRef = useRef<Konva.Group>(null);
  // RAF handle for frame-glow detection during drag — coalesces move events per frame
  const frameDragRafRef = useRef(0);

  const mode = useCanvasStore((s) => s.mode);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const setEditingObject = useCanvasStore((s) => s.setEditingObject);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);
  const setLastUsedColor = useCanvasStore((s) => s.setLastUsedColor);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const [isHoveringBorder, setIsHoveringBorder] = useState(false);
  const handleBorderHover = useCallback((hovering: boolean) => {
    setIsHoveringBorder(hovering);
  }, []);

  // RAF-throttled drag-move handler — drives frame capture glow effect at display refresh rate.
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
  const fontFamily = FONT_FAMILY_MAP[object.fontFamily || "sans-serif"];

  // LOD: simplified render for extreme zoom-out — no text, lines, shadows
  if (isSimpleLod) {
    return (
      <Rect
        x={object.x}
        y={object.y}
        width={object.width}
        height={object.height}
        fill={object.color}
        listening={false}
      />
    );
  }

  // Generate notepad lines
  const lineSpacing = 22;
  const lineStartY = 30; // Start below top padding
  const lineMarginX = 8;
  const notepadLines: number[] = [];
  for (let y = lineStartY; y < object.height - 10; y += lineSpacing) {
    notepadLines.push(y);
  }

  const handleDragStart = () => {
    if (!user) return;
    // Snapshot before move so the drag is undoable via Ctrl+Z
    useObjectStore.getState().snapshot();
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

    // Auto-expand parent frame if child was dragged beyond its boundary
    if (object.parentFrame) {
      const expansion = useObjectStore.getState().expandFrameToContainChild(object.id);
      if (expansion) {
        updateObject(boardId, expansion.frameId, expansion.patch).catch(console.error);
      }
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
    if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) {
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
    // If the clicked object is part of a multi-selection, target the whole group.
    const currentSelectedIds = useCanvasStore.getState().selectedObjectIds;
    const isInGroup = currentSelectedIds.includes(object.id) && currentSelectedIds.length > 1;
    showContextMenu({
      visible: true,
      x: e.evt.clientX,
      y: e.evt.clientY,
      targetObjectId: isInGroup ? null : object.id,
      targetObjectIds: isInGroup ? [...currentSelectedIds] : [],
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
      onDblClick={handleDblClick}
      onContextMenu={handleContextMenu}
      opacity={(isLocked ? 0.6 : object.isAIPending ? 0.5 : 1) * (object.opacity ?? 1)}
    >
      {/* Background */}
      <Rect
        width={object.width}
        height={object.height}
        fill={object.color}
        cornerRadius={4}
        shadowColor={isConnectorTarget ? "#6366f1" : "rgba(0,0,0,0.1)"}
        shadowBlur={isConnectorTarget ? 15 : 4}
        shadowOffsetY={isConnectorTarget ? 0 : 2}
        shadowEnabled={true}
        stroke={isSelected ? "#2196F3" : undefined}
        strokeWidth={isSelected ? 2 : 0}
      />

      {/* Notepad lines */}
      {notepadLines.map((y) => (
        <Line
          key={y}
          points={[lineMarginX, y, object.width - lineMarginX, y]}
          stroke="rgba(0,0,0,0.08)"
          strokeWidth={1}
          listening={false}
        />
      ))}

      {/* Text content — y/lineHeight aligned with notepad lines.
          fill uses textColor when set so StickyNoteModule color changes take effect. */}
      {object.text !== undefined && object.text !== "" && (
        <Text
          text={object.text}
          width={object.width - 24}
          x={12}
          y={30}
          fontSize={object.fontSize ?? 14}
          lineHeight={Math.max(1, 22 / (object.fontSize ?? 14))}
          fontFamily={fontFamily}
          fill={object.textColor ?? '#1a1a1a'}
          wrap="word"
          height={object.height - 40}
          listening={false}
        />
      )}

      {/* Framed-child indicator — bold purple border when captured inside a frame */}
      {object.parentFrame && (
        <Rect
          width={object.width}
          height={object.height}
          stroke="#7C3AED"
          strokeWidth={3}
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

      <ResizeBorder
        objectId={object.id}
        width={object.width}
        height={object.height}
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
