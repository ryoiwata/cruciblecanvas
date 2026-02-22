"use client";

/**
 * TextEditor — floating textarea overlay that renders over a Konva object
 * when the user enters text-edit mode. For sticky notes it renders in-place
 * with padding/font settings that precisely match the Konva Text node, so the
 * text never appears to "jump" when entering or leaving edit mode.
 *
 * Sticky notes grow vertically in real-time as the user types more lines, and
 * shrink back to the minimum needed height on commit.
 *
 * Freeform text objects also grow/shrink in real-time. The overlay div is made
 * pointer-events: none for text type so the canvas remains interactive while
 * editing (commit happens via onBlur when focus leaves the textarea).
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

      // Auto-expand immediately if current content already overflows the stored height.
      // Applies to both sticky notes and freeform text objects.
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
      } else if (object.type === "text") {
        // Freeform text: grow to fit existing content with no min/max clamp.
        ta.style.height = "1px";
        const scrollH = ta.scrollHeight;
        ta.style.height = `${scrollH}px`;
        const newCanvasH = Math.ceil(scrollH / stageScale);
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
      // Freeform text: measure the final scrollHeight and convert to canvas units.
      // The textarea auto-grew during typing, so scrollHeight == clientHeight here.
      const currentScale = useCanvasStore.getState().stageScale;
      const newHeight = Math.max(10, Math.ceil(textareaRef.current.scrollHeight / currentScale));
      updateObjectLocal(editingObjectId, { text: trimmed, height: newHeight });
      updateObject(boardId, editingObjectId, {
        text: trimmed,
        height: newHeight,
      }).catch(console.error);
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

  // CSS line-height must match Konva's text node:
  //   - Sticky notes: Konva lineHeight = max(1, 22/fontSize), so pixel height = max(fontSize, 22)
  //   - Text objects: Konva default lineHeight = 1, so each line = exactly 1 × fontSize
  //   - Others: standard 1.4 approximation
  const cssLineHeight = isStickyNote
    ? `${Math.max(effectiveFontSize, 22) * stageScale}px`
    : isText
    ? "1"
    : "1.4";

  // Padding: for sticky notes match Konva text position (x=12, y=30).
  // Text objects have no padding so the overlay aligns exactly with the Konva Text node.
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

  // Background: transparent for sticky notes (Konva background rect shows through)
  // and text objects; near-white for frames.
  const bgColor = isFrame ? "rgba(255,255,255,0.95)" : "transparent";

  // Text color must exactly match the Konva Text node's fill so the swap from
  // Konva Text → textarea on edit-start has no perceptible colour change.
  //   - Text objects: Konva uses `textColor ?? color`
  //   - Sticky notes: Konva uses `textColor ?? '#1a1a1a'`
  //   - Frames/others: dark for readability
  const textColor = isStickyNote
    ? (object.textColor ?? "#1a1a1a")
    : isText
    ? (object.textColor ?? object.color)
    : "#1a1a1a";

  // Border:
  //   - Sticky notes: none — the background Konva rect defines the editing area.
  //   - Text objects: none — the Konva selection Rect (blue stroke) already shows the
  //     text box boundary; a second border would be redundant and visually noisy.
  //   - Frames/others: solid accent border.
  const borderStyle = isStickyNote || isText
    ? "none"
    : "2px solid #6366f1";

  // The text-align on the textarea must match the Konva Text node's `align` prop
  // so horizontal alignment is consistent before/during/after editing.
  const cssTextAlign = isText ? (object.textAlign ?? "left") : undefined;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        // For freeform text: let pointer events pass through to the canvas so the
        // user can scroll/pan without needing to commit first. The textarea's
        // onBlur handles commit when focus leaves. The div's onClick is only used
        // for sticky notes / frames where a click-outside-to-commit is desired.
        pointerEvents: isText ? "none" : "auto",
      }}
      onClick={(e) => {
        // Click outside the textarea → commit (sticky notes / frames only).
        if (!isText && e.target === e.currentTarget) {
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

          // Sticky notes: grow vertically in real-time when content overflows.
          // Only expands here; shrinking happens on commit.
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

          // Freeform text: grow AND shrink in real-time so the blue selection border
          // always matches the actual content height. No min/max clamp needed.
          if (isText && textareaRef.current) {
            const ta = textareaRef.current;
            ta.style.height = "1px";
            const scrollH = ta.scrollHeight;
            ta.style.height = `${scrollH}px`;
            const newCanvasH = Math.ceil(scrollH / stageScale);
            const currentH = useObjectStore.getState().objects[editingObjectId]?.height ?? 0;
            if (newCanvasH !== currentH) {
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
          textAlign: cssTextAlign,
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
          // Cursor color matches the text color so it's legible on any background.
          caretColor: textColor,
          lineHeight: cssLineHeight,
          boxSizing: "border-box",
          // Freeform text: pointer events must be explicitly enabled on the textarea
          // even though the parent div has pointer-events: none.
          pointerEvents: "auto",
        }}
      />
    </div>
  );
}
