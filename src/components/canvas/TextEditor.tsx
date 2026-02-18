"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
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
    updateObjectLocal(editingObjectId, { text: trimmed });

    // Auto-resize height for sticky notes
    if (object.type === "stickyNote" && textareaRef.current) {
      const measuredHeight = textareaRef.current.scrollHeight + 20; // padding
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
  const editHeight = isFrame ? 40 * stageScale : screenHeight;

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
          fontSize: `${14 * stageScale}px`,
          fontFamily: object.type === "stickyNote"
            ? FONT_FAMILY_MAP[object.fontFamily || "sans-serif"]
            : "sans-serif",
          fontWeight: isFrame ? "bold" : "normal",
          padding: `${10 * stageScale}px`,
          border: "2px solid #6366f1",
          borderRadius: `${4 * stageScale}px`,
          outline: "none",
          resize: "none",
          overflow: "hidden",
          background: isFrame ? "rgba(255,255,255,0.95)" : object.color,
          color: "#1a1a1a",
          lineHeight: "1.4",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
