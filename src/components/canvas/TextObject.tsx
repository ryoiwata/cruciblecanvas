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

import { useRef, useCallback, memo } from 'react';
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

  const mode = useCanvasStore((s) => s.mode);
  const selectObject = useCanvasStore((s) => s.selectObject);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const editingObjectId = useCanvasStore((s) => s.editingObjectId);
  const setEditingObject = useCanvasStore((s) => s.setEditingObject);
  const showContextMenu = useCanvasStore((s) => s.showContextMenu);
  const setLastUsedColor = useCanvasStore((s) => s.setLastUsedColor);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const user = useAuthStore((s) => s.user);

  const isEditing = editingObjectId === object.id;

  // ---- Event handlers — defined before LOD guard to satisfy rules-of-hooks ----

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== 'pointer') return;
    e.cancelBubble = true;
    if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) {
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
      {/* Transparent hit area covering the full bounding box */}
      <Rect
        width={object.width}
        height={object.height}
        fill="transparent"
      />

      {/* Text content — hidden while the HTML textarea overlay is active to prevent double-text.
          textColor overrides the legacy color field when set. */}
      <Text
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
