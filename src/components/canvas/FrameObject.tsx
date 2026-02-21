"use client";

import { useRef, useCallback, memo } from "react";
import { Group, Rect, Text } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { updateObjects } from "@/lib/firebase/firestore";
import { acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import type { BoardObject } from "@/lib/types";
import { FRAME_DEFAULTS } from "@/lib/types";
import { overlapFraction } from "@/lib/utils";
import { borderResizingIds } from "@/lib/resizeState";

interface FrameObjectProps {
  object: BoardObject;
  boardId: string;
  isLocked: boolean;
  lockedByName: string | null;
  isConnectorTarget?: boolean;
  isSimpleLod?: boolean;
  /** True when a dragged object overlaps this frame >50% — triggers capture glow. */
  isFrameDragTarget?: boolean;
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
  isSimpleLod,
  isFrameDragTarget,
}: FrameObjectProps) {
  const preDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const childSnapshots = useRef<ChildSnapshot[]>([]);
  const groupRef = useRef<Konva.Group>(null);
  // RAF handle for frame drag preview — coalesces move events to display refresh rate
  const frameDragRafRef = useRef(0);

  const mode = useCanvasStore((s) => s.mode);
  const stageScale = useCanvasStore((s) => s.stageScale);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const setEditingObject = useCanvasStore((s) => s.setEditingObject);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);
  const setLastUsedColor = useCanvasStore((s) => s.setLastUsedColor);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const getChildrenOfFrame = useObjectStore((s) => s.getChildrenOfFrame);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const isSelected = selectedObjectIds.includes(object.id);
  const isDraggable = mode === "pointer" && !isLocked;

  // RAF-throttled drag-move handler — updates child positions locally for live preview.
  // Must be defined before the LOD guard to satisfy rules-of-hooks.
  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (frameDragRafRef.current) cancelAnimationFrame(frameDragRafRef.current);
    frameDragRafRef.current = requestAnimationFrame(() => {
      frameDragRafRef.current = 0;
      const node = e.target as Konva.Group;
      const dx = node.x() - preDragPos.current.x;
      const dy = node.y() - preDragPos.current.y;
      for (const snap of childSnapshots.current) {
        updateObjectLocal(snap.id, { x: snap.x + dx, y: snap.y + dy });
      }
    });
  }, [updateObjectLocal]);

  // LOD: simplified border-only render for extreme zoom-out
  if (isSimpleLod) {
    return (
      <Rect
        x={object.x}
        y={object.y}
        width={object.width}
        height={object.height}
        fill={object.color}
        opacity={FRAME_DEFAULTS.backgroundOpacity}
        stroke={object.color}
        strokeWidth={2}
        listening={false}
      />
    );
  }

  const handleDragStart = () => {
    if (!user) return;
    // Snapshot before move so the drag (and all child moves) is undoable via Ctrl+Z
    useObjectStore.getState().snapshot();
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

  const handleDragEnd = async (e: Konva.KonvaEventObject<DragEvent>) => {
    // Cancel any pending preview RAF so final state is clean
    if (frameDragRafRef.current) {
      cancelAnimationFrame(frameDragRafRef.current);
      frameDragRafRef.current = 0;
    }
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
      return;
    }

    // Reverse capture: assign any unowned objects that now overlap >50% of this frame's new position.
    // Connectors and other frames are excluded; objects belonging to a different frame are left alone.
    const newBounds = { x: finalX, y: finalY, width: object.width, height: object.height };
    const captureUpdates: { id: string; changes: Partial<BoardObject> }[] = [];

    for (const obj of Object.values(useObjectStore.getState().objects)) {
      if (obj.type === 'frame' || obj.type === 'connector' || obj.id === object.id) continue;
      if (obj.parentFrame && obj.parentFrame !== object.id) continue;
      if (overlapFraction(obj, newBounds) > 0.5 && obj.parentFrame !== object.id) {
        updateObjectLocal(obj.id, { parentFrame: object.id });
        captureUpdates.push({ id: obj.id, changes: { parentFrame: object.id } });
      }
    }

    if (captureUpdates.length > 0) {
      await updateObjects(boardId, captureUpdates);
    }
  };

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== "pointer") return;
    e.cancelBubble = true;
    setLastUsedColor(object.type, object.color);

    // Check if the click hit a child object — if so, select it instead of the frame.
    // This is a fallback hit test for cases where z-index hasn't yet propagated.
    const stage = e.target.getStage();
    if (stage) {
      const pos = stage.getPointerPosition();
      if (pos) {
        const transform = stage.getAbsoluteTransform().copy().invert();
        const canvasPos = transform.point(pos);
        const allObjects = useObjectStore.getState().objects;
        const hit = Object.values(allObjects).find(
          (o) =>
            o.parentFrame === object.id &&
            canvasPos.x >= o.x &&
            canvasPos.x <= o.x + o.width &&
            canvasPos.y >= o.y &&
            canvasPos.y <= o.y + o.height
        );
        if (hit) {
          if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) toggleSelection(hit.id);
          else selectObject(hit.id);
          return;
        }
      }
    }

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

  const titleBarHeight = FRAME_DEFAULTS.titleBarHeight;

  // Frame title font size: targets 12px on screen, clamped to keep readable at any zoom.
  const titleFontSize = Math.min(36, Math.max(11, 12 / stageScale));

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
      {/* Frame background — glows purple when a dragged object overlaps >50% (capture preview).
          strokeColor field overrides the default accent color when set via Properties Sidebar.
          strokeScaleEnabled={false} keeps the border a constant screen-space thickness. */}
      <Rect
        width={object.width}
        height={object.height}
        fill={object.color}
        opacity={FRAME_DEFAULTS.backgroundOpacity}
        stroke={isFrameDragTarget ? "#6366f1" : (object.strokeColor ?? object.color)}
        strokeWidth={isFrameDragTarget ? 3 : (object.thickness ?? 2)}
        strokeScaleEnabled={false}
        cornerRadius={4}
        shadowColor="#6366f1"
        shadowBlur={isConnectorTarget ? 15 : isFrameDragTarget ? 20 : 0}
        shadowOpacity={isFrameDragTarget ? 0.7 : 0.8}
        shadowEnabled={!!isConnectorTarget || !!isFrameDragTarget}
      />

      {/* Title bar */}
      <Rect
        width={object.width}
        height={titleBarHeight}
        fill={object.color}
        opacity={0.2}
        cornerRadius={[4, 4, 0, 0]}
      />

      {/* Framed-child indicator — dashed purple border when this frame is nested inside another */}
      {object.parentFrame && (
        <Rect
          width={object.width}
          height={object.height}
          stroke="#7C3AED"
          strokeWidth={3}
          dash={[8, 4]}
          fill="transparent"
          listening={false}
          cornerRadius={4}
        />
      )}

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

      {/* Title text — fontSize scales with zoom so it stays readable at any zoom level.
          textColor overrides the legacy accent-color fill when set by the Properties Sidebar. */}
      <Text
        text={object.text || "Untitled Frame"}
        x={10}
        y={10}
        width={object.width - 20}
        fontSize={titleFontSize}
        fontFamily="sans-serif"
        fontStyle="bold"
        fill={object.textColor ?? object.color}
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
    prevProps.isConnectorTarget === nextProps.isConnectorTarget &&
    prevProps.isSimpleLod === nextProps.isSimpleLod &&
    prevProps.isFrameDragTarget === nextProps.isFrameDragTarget
  );
});
