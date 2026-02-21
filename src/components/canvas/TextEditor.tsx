"use client";

/**
 * TextEditor — floating textarea overlay that renders over a Konva object
 * when the user enters text-edit mode. For sticky notes it renders in-place
 * with padding/font settings that precisely match the Konva Text node, so the
 * text never appears to "jump" when entering or leaving edit mode.
 *
 * Sticky notes grow vertically in real-time as the user types more lines, and
 * shrink back to the minimum needed height on commit.
 */

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
    if (!object) return;

    // Snapshot before editing begins so the text change is undoable via Ctrl+Z.
    useObjectStore.getState().snapshot();

    // Consume pendingEditChar if set (set by useKeyboardShortcuts for "type to edit").
    const { pendingEditChar, setPendingEditChar } = useCanvasStore.getState();
    const initialChar = pendingEditChar;
    if (initialChar !== null) {
      setPendingEditChar(null);
      setText(initialChar);
      useObjectStore.getState().updateObjectLocal(object.id, { text: initialChar });
    } else {
      setText(object.text || "");
    }

    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;

      // For sticky notes: auto-expand immediately if current content already
      // overflows the existing object height (e.g. after a font-size increase).
      if (object.type === "stickyNote") {
        ta.style.height = "1px";
        const scrollH = ta.scrollHeight;
        const minScreenH = STICKY_NOTE_SIZE_LIMITS.min.height * stageScale;
        const maxScreenH = STICKY_NOTE_SIZE_LIMITS.max.height * stageScale;
        const newScreenH = Math.max(minScreenH, Math.min(maxScreenH, scrollH));
        ta.style.height = `${newScreenH}px`;
        const newCanvasH = Math.ceil(newScreenH / stageScale);
        if (newCanvasH !== object.height) {
          useObjectStore.getState().updateObjectLocal(object.id, { height: newCanvasH });
        }
      }

      ta.focus();
      if (initialChar !== null) {
        ta.setSelectionRange(ta.value.length, ta.value.length);
      } else {
        ta.select();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object?.id]);

  const commit = useCallback(() => {
    if (!editingObjectId || !object) return;

    const trimmed = text;

    // Auto-delete empty text objects rather than leaving invisible elements.
    if (object.type === "text" && trimmed.trim() === "") {
      removeObject(editingObjectId);
      deleteObject(boardId, editingObjectId).catch(console.error);
      setEditingObject(null);
      return;
    }

    if (object.type === "stickyNote" && textareaRef.current) {
      // Compute the final required height (may be smaller if user deleted text).
      const ta = textareaRef.current;
      ta.style.height = "1px";
      const scrollH = ta.scrollHeight;
      const currentScale = useCanvasStore.getState().stageScale;
      const newHeight = Math.max(
        STICKY_NOTE_SIZE_LIMITS.min.height,
        Math.min(
          STICKY_NOTE_SIZE_LIMITS.max.height,
          Math.ceil(scrollH / currentScale)
        )
      );
      updateObjectLocal(editingObjectId, { text: trimmed, height: newHeight });
      updateObject(boardId, editingObjectId, {
        text: trimmed,
        height: newHeight,
      }).catch(console.error);
    } else if (object.type === "text" && textareaRef.current) {
      const measuredHeight = textareaRef.current.scrollHeight + 4;
      const newHeight = Math.max(
        STICKY_NOTE_SIZE_LIMITS.min.height,
        Math.min(STICKY_NOTE_SIZE_LIMITS.max.height, measuredHeight)
      );
      if (newHeight !== object.height) {
        updateObjectLocal(editingObjectId, { text: trimmed, height: newHeight });
        updateObject(boardId, editingObjectId, {
          text: trimmed,
          height: newHeight,
        }).catch(console.error);
      } else {
        updateObjectLocal(editingObjectId, { text: trimmed });
        updateObject(boardId, editingObjectId, { text: trimmed }).catch(console.error);
      }
    } else {
      updateObjectLocal(editingObjectId, { text: trimmed });
      updateObject(boardId, editingObjectId, { text: trimmed }).catch(console.error);
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

  // ---- Layout ----------------------------------------------------------------

  // Calculate screen-space position from canvas-space
  const screenX = object.x * stageScale + stageX;
  const screenY = object.y * stageScale + stageY;
  const screenWidth = object.width * stageScale;
  const screenHeight = object.height * stageScale;

  const isStickyNote = object.type === "stickyNote";
  const isFrame = object.type === "frame";
  const isText = object.type === "text";

  // For frames, only edit the title bar area
  const editHeight = isFrame ? 40 * stageScale : screenHeight;

  // Font size: sticky notes and text objects respect object.fontSize
  const effectiveFontSize = isStickyNote
    ? (object.fontSize ?? 14)
    : isText
    ? (object.fontSize ?? 16)
    : 14;

  // CSS line-height for sticky notes matches Konva: lineHeight multiplier is
  // max(1, 22/fontSize), so pixel line height = max(fontSize, 22).
  const cssLineHeight = isStickyNote
    ? `${Math.max(effectiveFontSize, 22) * stageScale}px`
    : "1.4";

  // Padding: for sticky notes match Konva text position (x=12, y=30).
  // Other objects use 10px all sides; text objects have no padding.
  const paddingTop = isStickyNote
    ? 30 * stageScale
    : isText
    ? 0
    : 10 * stageScale;
  const paddingHoriz = isStickyNote
    ? 12 * stageScale
    : isText
    ? 0
    : 10 * stageScale;
  const paddingBottom = isStickyNote
    ? 10 * stageScale
    : isText
    ? 0
    : 10 * stageScale;

  // Background:
  //  - Sticky notes: transparent — the Konva background rect shows through, giving a
  //    true in-place feel. The Konva <Text> node is hidden while editing so there
  //    is no double-text underneath.
  //  - Frame title bar: near-white so editing area is readable.
  //  - Text objects: fully transparent to match the Konva Text node appearance.
  const bgColor = isFrame
    ? "rgba(255,255,255,0.95)"
    : "transparent";

  // Text color: sticky notes use the object's textColor field; text objects use
  // the object color (same as Konva); frames use dark for readability.
  const textColor = isStickyNote
    ? (object.textColor ?? "#1a1a1a")
    : isText
    ? object.color
    : "#1a1a1a";

  // Border:
  //  - Sticky notes: none — removes the purple flash when entering edit mode.
  //    Also ensures the content width exactly matches the Konva Text node width
  //    (box-sizing: border-box subtracts border from content width, so border: none
  //    gives content width = screenWidth − 24*scale, matching Konva's x=12, width−24).
  //  - Text objects: a subtle dashed outline so the editing region is visible.
  //  - Frames/others: solid accent border.
  const borderStyle = isStickyNote
    ? "none"
    : isText
    ? "1px dashed #6366f1"
    : "2px solid #6366f1";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
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
        onChange={(e) => {
          const newText = e.target.value;
          setText(newText);
          // Sync canvas in real-time as the user types — Firestore is written on blur/Escape.
          if (editingObjectId) {
            useObjectStore.getState().updateObjectLocal(editingObjectId, { text: newText });
          }

          // Sticky notes grow vertically in real-time as content overflows.
          // We only expand here; shrinking happens on commit so the note doesn't
          // jump as the user deletes characters mid-edit.
          if (isStickyNote && textareaRef.current) {
            const ta = textareaRef.current;
            ta.style.height = "1px";
            const scrollH = ta.scrollHeight;
            const minScreenH = STICKY_NOTE_SIZE_LIMITS.min.height * stageScale;
            const maxScreenH = STICKY_NOTE_SIZE_LIMITS.max.height * stageScale;
            const newScreenH = Math.max(minScreenH, Math.min(maxScreenH, scrollH));
            ta.style.height = `${newScreenH}px`;
            const newCanvasH = Math.ceil(newScreenH / stageScale);
            if (newCanvasH > (useObjectStore.getState().objects[editingObjectId]?.height ?? 0)) {
              useObjectStore.getState().updateObjectLocal(editingObjectId, { height: newCanvasH });
            }
          }
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        style={{
          position: "absolute",
          left: screenX,
          top: screenY,
          width: screenWidth,
          height: editHeight,
          // Rotate the textarea to match the object's canvas rotation.
          transform: `rotate(${object.rotation ?? 0}deg)`,
          transformOrigin: "top left",
          fontSize: `${effectiveFontSize * stageScale}px`,
          fontFamily:
            isStickyNote || isText
              ? FONT_FAMILY_MAP[object.fontFamily ?? "sans-serif"]
              : "sans-serif",
          fontWeight: isFrame ? "bold" : "normal",
          paddingTop: `${paddingTop}px`,
          paddingLeft: `${paddingHoriz}px`,
          paddingRight: `${paddingHoriz}px`,
          paddingBottom: `${paddingBottom}px`,
          border: borderStyle,
          borderRadius: isStickyNote ? 0 : `${4 * stageScale}px`,
          outline: "none",
          resize: "none",
          overflow: "hidden",
          background: bgColor,
          color: textColor,
          // Cursor color matches the sticky's text color so it's legible on any background.
          caretColor: textColor,
          lineHeight: cssLineHeight,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
