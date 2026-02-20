"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject, deleteObject } from "@/lib/firebase/firestore";
import { STICKY_NOTE_SIZE_LIMITS, FONT_FAMILY_MAP } from "@/lib/types";

interface TextEditorProps {
  boardId: string;
}

export default function TextEditor({ boardId }: TextEditorProps) {
  const editingObjectId = useCanvasStore((s) => s.editingObjectId);
  const setEditingObject = useCanvasStore((s) => s.setEditingObject);
  const stageX = useCanvasStore((s) => s.stageX);
  const stageY = useCanvasStore((s) => s.stageY);
  const stageScale = useCanvasStore((s) => s.stageScale);

  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const removeObject = useObjectStore((s) => s.removeObject);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");

  const object = editingObjectId ? objects[editingObjectId] : null;

  useEffect(() => {
    if (object) {
      setText(object.text || "");
      // Focus textarea after mount
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      });
    }
  }, [object?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(() => {
    if (!editingObjectId || !object) return;

    const trimmed = text;

    // Auto-delete empty text objects rather than leaving invisible elements.
    if (object.type === 'text' && trimmed.trim() === '') {
      removeObject(editingObjectId);
      deleteObject(boardId, editingObjectId).catch(console.error);
      setEditingObject(null);
      return;
    }

    updateObjectLocal(editingObjectId, { text: trimmed });

    // Auto-resize height for sticky notes and text objects based on content.
    if ((object.type === "stickyNote" || object.type === "text") && textareaRef.current) {
      const measuredHeight = textareaRef.current.scrollHeight + (object.type === "text" ? 4 : 20);
      const newHeight = Math.max(
        STICKY_NOTE_SIZE_LIMITS.min.height,
        Math.min(STICKY_NOTE_SIZE_LIMITS.max.height, measuredHeight)
      );
      if (newHeight !== object.height) {
        updateObjectLocal(editingObjectId, { height: newHeight });
        updateObject(boardId, editingObjectId, {
          text: trimmed,
          height: newHeight,
        }).catch(console.error);
      } else {
        updateObject(boardId, editingObjectId, { text: trimmed }).catch(
          console.error
        );
      }
    } else {
      updateObject(boardId, editingObjectId, { text: trimmed }).catch(
        console.error
      );
    }

    setEditingObject(null);
  }, [
    editingObjectId,
    object,
    text,
    boardId,
    updateObjectLocal,
    removeObject,
    setEditingObject,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        commit();
      }
    },
    [commit]
  );

  if (!object || !editingObjectId) return null;

  // Calculate screen-space position from canvas-space
  const screenX = object.x * stageScale + stageX;
  const screenY = object.y * stageScale + stageY;
  const screenWidth = object.width * stageScale;
  const screenHeight = object.height * stageScale;

  // For frames, only edit the title bar area
  const isFrame = object.type === "frame";
  const isText = object.type === "text";
  const editHeight = isFrame ? 40 * stageScale : screenHeight;

  // Font size: text objects respect object.fontSize; others use 14px
  const baseFontSize = isText ? (object.fontSize ?? 16) : 14;

  // Background: text objects are transparent to match Konva rendering
  const bgColor = isFrame
    ? "rgba(255,255,255,0.95)"
    : isText
    ? "rgba(255,255,255,0.0)"
    : object.color;

  const textColor = isText ? object.color : "#1a1a1a";

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 100,
      }}
      onClick={(e) => {
        // Click outside the textarea → commit
        if (e.target === e.currentTarget) {
          commit();
        }
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        style={{
          position: "absolute",
          left: screenX,
          top: screenY,
          width: screenWidth,
          height: editHeight,
          transform: `scale(1)`,
          transformOrigin: "top left",
          fontSize: `${baseFontSize * stageScale}px`,
          fontFamily: object.type === "stickyNote" || object.type === "text"
            ? FONT_FAMILY_MAP[object.fontFamily ?? "sans-serif"]
            : "sans-serif",
          fontWeight: isFrame ? "bold" : "normal",
          padding: isText ? `0` : `${10 * stageScale}px`,
          border: isText ? `1px dashed #6366f1` : "2px solid #6366f1",
          borderRadius: `${4 * stageScale}px`,
          outline: "none",
          resize: "none",
          overflow: "hidden",
          background: bgColor,
          color: textColor,
          lineHeight: "1.4",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
