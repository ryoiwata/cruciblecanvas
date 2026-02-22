'use client';

/**
 * TextObject — standalone, freely-positioned text element on the canvas.
 *
 * Unlike StickyNote, a TextObject has no background fill — it renders as a
 * transparent Konva Text node. Double-click opens the shared TextEditor overlay.
 * When editing ends and the text is empty, the object is auto-deleted.
 *
 * Supports: drag, rotation, Ctrl/Shift+click multi-select, context menu.
 */

import { useRef, useCallback, useEffect, memo } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore } from '@/lib/store/canvasStore';
import { useObjectStore } from '@/lib/store/objectStore';
import { useAuthStore } from '@/lib/store/authStore';
import { updateObject } from '@/lib/firebase/firestore';
import { acquireLock, releaseLock } from '@/lib/firebase/rtdb';
import type { BoardObject } from '@/lib/types';
import { FONT_FAMILY_MAP } from '@/lib/types';

interface TextObjectProps {
  object: BoardObject;
  boardId: string;
  isLocked: boolean;
  lockedByName: string | null;
  isSimpleLod?: boolean;
}

export default memo(function TextObject({
  object,
  boardId,
  isLocked,
  isSimpleLod,
}: TextObjectProps) {
  const preDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Ref to the Konva Text node — used to read the actual rendered height after layout.
  const textRef = useRef<Konva.Text>(null);

  const mode = useCanvasStore((s) => s.mode);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  // Narrow boolean — only re-renders when this object's own selection state changes.
  const isSelected = useCanvasStore((s) => s.selectedObjectIds.includes(object.id));
  const editingObjectId = useCanvasStore((s) => s.editingObjectId);
  const setEditingObject = useCanvasStore((s) => s.setEditingObject);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);
  const setLastUsedColor = useCanvasStore((s) => s.setLastUsedColor);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const user = useAuthStore((s) => s.user);

  const isEditing = editingObjectId === object.id;

  // ---- Event handlers — defined before LOD guard to satisfy rules-of-hooks ----

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Only handle left-click; right-click fires contextmenu and should not change selection
    if (e.evt.button !== 0) return;
    if (mode !== 'pointer') return;
    e.cancelBubble = true;
    // Multi-select mode: clicking always toggles (no Ctrl needed)
    if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey || useCanvasStore.getState().isMultiSelectMode) {
      toggleSelection(object.id);
    } else {
      selectObject(object.id);
      setLastUsedColor('text', object.color);
    }
  };

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== 'pointer') return;
    e.cancelBubble = true;
    if (!isLocked) {
      setEditingObject(object.id);
    }
  };

  const handleContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    // Auto-select on right-click if not already in current selection
    let currentSelectedIds = useCanvasStore.getState().selectedObjectIds;
    if (!currentSelectedIds.includes(object.id)) {
      useCanvasStore.getState().selectObject(object.id);
      currentSelectedIds = [object.id];
    }
    // If the clicked object is part of a multi-selection, target the whole group.
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

  const handleDragStart = useCallback(() => {
    // Snapshot before move so the drag is undoable via Ctrl+Z
    useObjectStore.getState().snapshot();
    preDragPos.current = { x: object.x, y: object.y };
    if (user) acquireLock(boardId, object.id, user.uid, user.displayName || 'User');
  }, [object.x, object.y, boardId, object.id, user]);

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target as Konva.Group;
      const newX = Math.round(node.x());
      const newY = Math.round(node.y());
      updateObjectLocal(object.id, { x: newX, y: newY });
      updateObject(boardId, object.id, { x: newX, y: newY }).catch(console.error);
      if (user) releaseLock(boardId, object.id);

      // Deframe child if dragged fully outside its parent frame; otherwise expand frame.
      if (object.parentFrame) {
        const result = useObjectStore.getState().deframeOrExpandChild(object.id);
        if (result?.action === 'deframe') {
          updateObject(boardId, result.childId, { parentFrame: '' }).catch(console.error);
        } else if (result?.action === 'expand') {
          updateObject(boardId, result.frameId, result.patch).catch(console.error);
        }
      }
    },
    [boardId, object.id, object.parentFrame, updateObjectLocal, user]
  );

  // ---- Sync rendered text height back to the store ----------------------------
  // Konva Text with wrap="word" auto-computes its height from content. We read
  // the actual height after each layout-affecting change and persist it so the
  // transparent hit Rect and the Transformer bounding box stay accurate.
  // object.height is intentionally excluded from deps to prevent a sync loop.
  useEffect(() => {
    if (!textRef.current) return;
    const renderedHeight = Math.ceil(textRef.current.height());
    if (renderedHeight > 0 && renderedHeight !== Math.round(object.height)) {
      updateObjectLocal(object.id, { height: renderedHeight });
      updateObject(boardId, object.id, { height: renderedHeight }).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object.text, object.fontSize, object.width, object.fontFamily, object.id, boardId, updateObjectLocal]);

  // ---- LOD guard (after all hooks) ----------------------------------------
  if (isSimpleLod) {
    return (
      <Group id={object.id} x={object.x} y={object.y} rotation={object.rotation ?? 0}>
        <Rect
          width={object.width}
          height={object.height}
          fill="transparent"
          stroke="#9ca3af"
          strokeWidth={0.5}
          listening={false}
        />
      </Group>
    );
  }

  const fontFamily = FONT_FAMILY_MAP[object.fontFamily ?? 'sans-serif'];
  const fontSize = object.fontSize ?? 16;

  return (
    <Group
      id={object.id}
      x={object.x}
      y={object.y}
      // Explicit width/height on the Group ensures node.width()/node.height() return
      // correct values in SelectionLayer.handleTransformEnd during rotation — without
      // these, Konva returns 0 for Group dimensions and the stored dims get corrupted.
      width={object.width}
      height={object.height}
      rotation={object.rotation ?? 0}
      draggable={mode === 'pointer' && !isLocked}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onDblClick={handleDblClick}
      onDblTap={handleDblClick}
      onContextMenu={handleContextMenu}
      opacity={object.opacity ?? 1}
    >
      {/* Transparent hit area covering the full bounding box.
          Height is kept in sync with the actual rendered text height via the
          useEffect above, so the entire text region is draggable. */}
      <Rect
        width={object.width}
        height={object.height}
        fill="transparent"
        // Selection indicator — replaces the generic Transformer border box.
        // Matches the style used by StickyNote for visual consistency.
        stroke={isSelected ? '#2196F3' : undefined}
        strokeWidth={isSelected ? 2 : 0}
      />

      {/* Text content — hidden while the HTML textarea overlay is active to prevent double-text.
          textColor overrides the legacy color field when set. */}
      <Text
        ref={textRef}
        text={object.text ?? ''}
        width={object.width}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={object.textColor ?? object.color}
        align={object.textAlign ?? 'left'}
        wrap="word"
        listening={false}
        visible={!isEditing}
      />

      {/* Capture indicator — purple stroke when parented to a frame */}
      {object.parentFrame && (
        <Rect
          width={object.width}
          height={object.height}
          stroke="#7C3AED"
          strokeWidth={3}
          fill="transparent"
          listening={false}
        />
      )}

      {/* Lock indicator */}
      {isLocked && (
        <Text
          text="🔒"
          x={object.width - 20}
          y={-20}
          fontSize={12}
          listening={false}
        />
      )}
    </Group>
  );
});
