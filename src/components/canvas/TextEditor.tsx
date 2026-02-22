"use client";

/**
 * TextEditor — floating textarea overlay that renders over a Konva object
 * when the user enters text-edit mode.
 *
 * Sticky notes: grow vertically in real-time, shrink on commit, clamped to
 * STICKY_NOTE_SIZE_LIMITS. Font/padding matches the Konva text node exactly
 * so the text never appears to jump when entering or leaving edit mode.
 *
 * Freeform text objects (BioRender-style auto-expansion):
 *   1. A hidden "mirror" div with identical text styling is measured to obtain
 *      the natural (unwrapped) content width via scrollWidth.
 *   2. The textarea expands horizontally until it reaches a viewport-relative
 *      max (min of 800 canvas-px or the space to the right edge of the container).
 *   3. Once the max width is reached, the box wraps and grows vertically.
 *   4. If vertical growth would overflow the container, the textarea is capped
 *      by a CSS max-height and content scrolls internally.
 *   5. Both width and height are persisted to Firestore on commit so the Konva
 *      Text node renders at the exact same dimensions as the editor.
 *   6. CSS transitions (60ms ease-out) make the growth feel smooth, but they
 *      are enabled only after the first measurement so the initial snap to
 *      content size is instantaneous.
 *
 * Frames: only the 40px title bar is editable; dimensions are fixed.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject, deleteObject } from "@/lib/firebase/firestore";
import { STICKY_NOTE_SIZE_LIMITS, FONT_FAMILY_MAP } from "@/lib/types";

// Maximum canvas-unit width for a freeform text editor (before it starts
// wrapping). Chosen so that very long single-line strings don't run off a
// typical 1440px viewport at zoom=1.
const TEXT_MAX_CANVAS_WIDTH = 800;

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
  // Mirror div for content measurement — invisible, same text styling as textarea.
  const mirrorRef = useRef<HTMLDivElement>(null);
  // Outer wrapper div — used to read the container's clientWidth for max-width calc.
  const outerDivRef = useRef<HTMLDivElement>(null);
  // RAF handle — cancelling the previous before scheduling a new one coalesces
  // rapid keystrokes into a single measurement per frame.
  const measureRafRef = useRef<number>(0);
  // Stable ref to the current object id — lets measureAndSync have empty deps
  // while still reading the latest id without closing over a stale value.
  const objectIdRef = useRef<string | null>(null);

  const [text, setText] = useState("");

  const object = editingObjectId ? objects[editingObjectId] : null;

  // Keep objectIdRef in sync whenever the editing session changes.
  useEffect(() => {
    objectIdRef.current = object?.id ?? null;
  }, [object?.id]);

  // ---- Mirror measurement (text objects only) --------------------------------
  //
  // measureAndSync reads the mirror div's scrollWidth/scrollHeight to find the
  // natural content dimensions, clamps them to viewport bounds, then applies
  // the result directly to the textarea's inline style (no React state → no
  // extra re-renders). The canvas object is also updated in the store so that
  // the selection bounding box tracks the live dimensions during editing.
  //
  // Two-phase approach:
  //   Phase 1 — set mirror to white-space:pre, width:auto → read scrollWidth
  //             to get the single-line content width (no wrapping).
  //   Phase 2 — clamp width to [minW, maxW], apply to mirror, switch to
  //             white-space:pre-wrap → read scrollHeight for the wrapped height.
  //
  // Empty deps array: all dynamic values are read from refs / getState() so the
  // function never needs to be recreated, preventing RAF closure staleness issues.
  const measureAndSync = useCallback(() => {
    const mirror = mirrorRef.current;
    const ta = textareaRef.current;
    const outer = outerDivRef.current;
    const objId = objectIdRef.current;
    if (!mirror || !ta || !objId) return;

    const { stageScale: scale, stageX: sx } = useCanvasStore.getState();
    const obj = useObjectStore.getState().objects[objId];
    if (!obj || obj.type !== "text") return;

    // Available container width from the object's left edge to the right boundary.
    const containerW = outer?.clientWidth ?? 800;
    const objScreenX = Math.max(0, obj.x * scale + sx);
    const maxW = Math.min(
      TEXT_MAX_CANVAS_WIDTH * scale,
      Math.max(60 * scale, containerW - objScreenX - 16),
    );
    // Minimum width: enough for one character at the current font size.
    const minW = Math.max(32, (obj.fontSize ?? 24) * scale);

    // Phase 1: measure natural single-line content width (no word-wrap).
    mirror.style.whiteSpace = "pre";
    mirror.style.width = "auto";
    // +4px accounts for sub-pixel rendering and textarea caret clearance so
    // the last character is never clipped by a tight bounding box.
    const naturalW = mirror.scrollWidth + 4;

    // Phase 2: clamp width and measure wrapped height.
    const finalW = Math.min(Math.max(naturalW, minW), maxW);
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.width = `${finalW}px`;
    const finalH = mirror.scrollHeight;

    // Apply directly to the textarea DOM node — bypasses React reconciliation
    // for immediate visual feedback at 60 fps without re-renders.
    ta.style.width = `${finalW}px`;
    ta.style.height = `${finalH}px`;

    // Sync the canvas object so the Transformer / selection rect reflects the
    // live editing dimensions without waiting for the commit.
    const canvasW = Math.ceil(finalW / scale);
    const canvasH = Math.ceil(finalH / scale);
    const cur = useObjectStore.getState().objects[objId];
    if (cur && (cur.width !== canvasW || cur.height !== canvasH)) {
      useObjectStore.getState().updateObjectLocal(objId, { width: canvasW, height: canvasH });
    }
  }, []); // intentionally empty — reads all dynamic values imperatively

  // ---- Edit session initialisation ------------------------------------------

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

      if (object.type === "stickyNote") {
        // Sticky notes: vertical-only auto-expand, clamped to size limits.
        ta.style.height = "1px";
        const scrollH = ta.scrollHeight;
        const currentScale = useCanvasStore.getState().stageScale;
        const minScreenH = STICKY_NOTE_SIZE_LIMITS.min.height * currentScale;
        const maxScreenH = STICKY_NOTE_SIZE_LIMITS.max.height * currentScale;
        const newScreenH = Math.max(minScreenH, Math.min(maxScreenH, scrollH));
        ta.style.height = `${newScreenH}px`;
        const newCanvasH = Math.ceil(newScreenH / currentScale);
        if (newCanvasH !== object.height) {
          useObjectStore.getState().updateObjectLocal(object.id, { height: newCanvasH });
        }
      } else if (object.type === "text") {
        // Freeform text: bidirectional expansion via mirror measurement.
        // Apply size instantly (no transition) so edit-start is snappy.
        ta.style.transition = "none";
        measureAndSync();
        // Enable smooth transitions for all subsequent keystrokes.
        // Wrapping in a RAF ensures the first instant resize has painted
        // before we start animating subsequent changes.
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.transition =
              "width 60ms ease-out, height 60ms ease-out";
          }
        });
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

  // Cleanup pending RAF when the component unmounts or editing ends.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(measureRafRef.current);
    };
  }, []);

  // ---- Commit ----------------------------------------------------------------

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
      // Sticky note: re-measure final scrollHeight (may be smaller if user deleted text).
      const ta = textareaRef.current;
      ta.style.height = "1px";
      const scrollH = ta.scrollHeight;
      const currentScale = useCanvasStore.getState().stageScale;
      const newHeight = Math.max(
        STICKY_NOTE_SIZE_LIMITS.min.height,
        Math.min(
          STICKY_NOTE_SIZE_LIMITS.max.height,
          Math.ceil(scrollH / currentScale),
        ),
      );
      updateObjectLocal(editingObjectId, { text: trimmed, height: newHeight });
      updateObject(boardId, editingObjectId, {
        text: trimmed,
        height: newHeight,
      }).catch(console.error);
    } else if (object.type === "text" && textareaRef.current) {
      // Freeform text: read the dimensions that measureAndSync last applied to
      // the textarea's inline style — these already account for the mirror
      // measurement and the viewport max-width constraint.
      const ta = textareaRef.current;
      const currentScale = useCanvasStore.getState().stageScale;
      const rawW = parseFloat(ta.style.width);
      const rawH = parseFloat(ta.style.height);
      // Fallback to scrollHeight / object dimensions if styles were not yet set.
      const finalW = rawW > 0 ? rawW : object.width * currentScale;
      const finalH = rawH > 0 ? rawH : ta.scrollHeight;
      const newWidth = Math.max(10, Math.ceil(finalW / currentScale));
      const newHeight = Math.max(10, Math.ceil(finalH / currentScale));
      updateObjectLocal(editingObjectId, { text: trimmed, width: newWidth, height: newHeight });
      updateObject(boardId, editingObjectId, {
        text: trimmed,
        width: newWidth,
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
    [commit],
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

  // For freeform text objects: clamp the textarea origin to the visible canvas
  // area (>= 0) so it never slides behind the SubHeaderToolbar when the canvas
  // is panned down. The canvas container uses overflow:hidden, so a negative
  // screenY would silently clip the top of the textarea.
  const clampedScreenX = isText ? Math.max(0, screenX) : screenX;
  const clampedScreenY = isText ? Math.max(0, screenY) : screenY;

  // Max height available from the clamped top to the container's bottom edge.
  // measureAndSync grows the textarea freely up to this CSS cap; if content
  // exceeds it, overflowY:auto provides an internal scrollbar.
  const textMaxHeight = isText
    ? `calc(100% - ${clampedScreenY}px - 8px)`
    : undefined;

  // For frames, only edit the title bar area.
  const editHeight = isFrame ? 40 * stageScale : screenHeight;

  const effectiveFontSize = isStickyNote
    ? (object.fontSize ?? 14)
    : isText
    ? (object.fontSize ?? 24)
    : 14;

  // CSS line-height must match Konva's text node:
  //   - Sticky notes: Konva lineHeight = max(1, 22/fontSize) → pixel = max(fontSize, 22)
  //   - Text objects: Konva default lineHeight = 1 → each line = exactly fontSize px
  //   - Others: 1.4 approximation
  const cssLineHeight = isStickyNote
    ? `${Math.max(effectiveFontSize, 22) * stageScale}px`
    : isText
    ? "1"
    : "1.4";

  // Padding: sticky notes match Konva text position (x=12, y=30).
  // Text objects have no padding so the overlay aligns exactly with the Konva Text node.
  const paddingTop = isStickyNote ? 30 * stageScale : isText ? 0 : 10 * stageScale;
  const paddingHoriz = isStickyNote ? 12 * stageScale : isText ? 0 : 10 * stageScale;
  const paddingBottom = isStickyNote ? 10 * stageScale : isText ? 0 : 10 * stageScale;

  // Background: transparent for sticky notes (Konva rect shows through) and
  // text objects; near-white for frames.
  const bgColor = isFrame ? "rgba(255,255,255,0.95)" : "transparent";

  // Text color must exactly match the Konva Text node's fill so the swap from
  // Konva Text → textarea on edit-start has no perceptible colour change.
  const textColor = isStickyNote
    ? (object.textColor ?? "#1a1a1a")
    : isText
    ? (object.textColor ?? object.color)
    : "#1a1a1a";

  const borderStyle = isStickyNote || isText ? "none" : "2px solid #6366f1";

  // text-align matches the Konva Text node's `align` prop for visual parity.
  const cssTextAlign = isText ? (object.textAlign ?? "left") : undefined;

  // Shared text-style properties used on both the mirror div and the textarea
  // so that scrollWidth/scrollHeight measurements are accurate.
  const sharedTextStyle = isText
    ? ({
        fontFamily: FONT_FAMILY_MAP[object.fontFamily ?? "sans-serif"],
        fontSize: `${effectiveFontSize * stageScale}px`,
        lineHeight: cssLineHeight,
        fontWeight: "normal" as const,
        textAlign: cssTextAlign,
        boxSizing: "border-box" as const,
      } as const)
    : {};

  return (
    <div
      ref={outerDivRef}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        // For freeform text: pointer events pass through to the canvas so the
        // user can scroll/pan without committing first. onBlur handles commit.
        pointerEvents: isText ? "none" : "auto",
      }}
      onClick={(e) => {
        // Click outside the textarea → commit (sticky notes / frames only).
        if (!isText && e.target === e.currentTarget) {
          commit();
        }
      }}
    >
      {/* Hidden mirror div — used only for freeform text objects.
          Placed at an off-screen position so it's invisible but still
          participates in layout (required for accurate scrollWidth/scrollHeight).
          Its content tracks the textarea's text state via React render so
          measurements are always based on the current text. */}
      {isText && (
        <div
          ref={mirrorRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "-9999px",
            left: "-9999px",
            // whiteSpace and width are overwritten inside measureAndSync.
            whiteSpace: "pre",
            wordBreak: "break-word",
            overflow: "hidden",
            pointerEvents: "none",
            ...sharedTextStyle,
          }}
        >
          {/* Zero-width space ensures the mirror has non-zero height even when
              text is empty, and preserves trailing newlines in measurements. */}
          {text + "\u200B"}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          const newText = e.target.value;
          setText(newText);
          // Persist text to local store in real-time; Firestore write happens on commit.
          if (editingObjectId) {
            useObjectStore.getState().updateObjectLocal(editingObjectId, { text: newText });
          }

          if (isStickyNote && textareaRef.current) {
            // Sticky notes: vertical-only growth (shrink deferred to commit).
            const ta = textareaRef.current;
            ta.style.height = "1px";
            const scrollH = ta.scrollHeight;
            const currentScale = useCanvasStore.getState().stageScale;
            const minScreenH = STICKY_NOTE_SIZE_LIMITS.min.height * currentScale;
            const maxScreenH = STICKY_NOTE_SIZE_LIMITS.max.height * currentScale;
            const newScreenH = Math.max(minScreenH, Math.min(maxScreenH, scrollH));
            ta.style.height = `${newScreenH}px`;
            const newCanvasH = Math.ceil(newScreenH / currentScale);
            if (newCanvasH > (useObjectStore.getState().objects[editingObjectId]?.height ?? 0)) {
              useObjectStore.getState().updateObjectLocal(editingObjectId, { height: newCanvasH });
            }
          }

          if (isText) {
            // Freeform text: coalesce measurements to one per animation frame.
            // The mirror's React-rendered content ({text + '\u200B'}) will be
            // updated by the re-render triggered by setText above, which happens
            // synchronously before the next paint, so the RAF fires with accurate
            // mirror content.
            cancelAnimationFrame(measureRafRef.current);
            measureRafRef.current = requestAnimationFrame(measureAndSync);
          }
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        style={{
          position: "absolute",
          left: isText ? clampedScreenX : screenX,
          top: isText ? clampedScreenY : screenY,
          // Initial dimensions from the stored object. For text objects,
          // measureAndSync overwrites these via ta.style within the first RAF
          // after edit-start. Using the stored width prevents a visible collapse
          // to 0 before the first measurement fires.
          width: isText ? screenWidth : screenWidth,
          height: isText ? screenHeight : editHeight,
          // CSS cap: prevents the textarea from expanding below the container
          // bottom edge. When natural height exceeds this cap, overflowY:auto
          // provides an internal scrollbar (the "scroll fallback").
          maxHeight: textMaxHeight,
          // Rotate the textarea to match the object's canvas rotation.
          transform: `rotate(${object.rotation ?? 0}deg)`,
          transformOrigin: "top left",
          // Transitions are enabled via ta.style.transition after the first
          // measurement so the initial snap to content size is instant.
          ...sharedTextStyle,
          fontFamily:
            isStickyNote || isText
              ? FONT_FAMILY_MAP[object.fontFamily ?? "sans-serif"]
              : "sans-serif",
          fontSize: `${effectiveFontSize * stageScale}px`,
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
          // Freeform text: overflow-y:auto enables internal scrolling when the
          // textarea height hits the CSS max-height cap at the container edge.
          overflowX: "hidden",
          overflowY: isText ? "auto" : "hidden",
          background: bgColor,
          color: textColor,
          caretColor: textColor,
          lineHeight: cssLineHeight,
          boxSizing: "border-box",
          // Freeform text: pointer events must be explicitly enabled on the
          // textarea even though the parent div has pointer-events:none.
          pointerEvents: "auto",
        }}
      />
    </div>
  );
}
