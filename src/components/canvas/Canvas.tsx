"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Stage, Layer } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { setCursor } from "@/lib/firebase/rtdb";
import { createObject, generateObjectId } from "@/lib/firebase/firestore";
import { snapToGrid, getCanvasPoint, getUserColor } from "@/lib/utils";
import { STICKY_NOTE_DEFAULT, ZOOM_MIN, ZOOM_MAX } from "@/lib/types";
import DotGrid from "./DotGrid";
import BoardObjects from "./BoardObjects";
import SelectionLayer from "./SelectionLayer";
import CursorLayer from "./CursorLayer";

interface CanvasProps {
  boardId: string;
}

const CURSOR_THROTTLE_MS = 33; // ~30 Hz
const CURSOR_MIN_DISTANCE = 5; // px

export default function Canvas({ boardId }: CanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const lastCursorSend = useRef(0);
  const lastCursorPos = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);

  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });

  // Store selectors
  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const stageX = useCanvasStore((s) => s.stageX);
  const stageY = useCanvasStore((s) => s.stageY);
  const stageScale = useCanvasStore((s) => s.stageScale);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const clearSelection = useCanvasStore((s) => s.clearSelection);

  const upsertObject = useObjectStore((s) => s.upsertObject);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  // --- Window dimensions ---
  useEffect(() => {
    setDimensions({ width: window.innerWidth, height: window.innerHeight });

    let timeoutId: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setDimensions({ width: window.innerWidth, height: window.innerHeight });
      }, 100);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timeoutId);
    };
  }, []);

  // --- Zoom (mouse wheel) ---
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const oldScale = stageScale;
      const factor = e.evt.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldScale * factor));

      // Zoom centered on cursor position
      const mousePointTo = {
        x: (pointer.x - stageX) / oldScale,
        y: (pointer.y - stageY) / oldScale,
      };

      const newX = pointer.x - mousePointTo.x * newScale;
      const newY = pointer.y - mousePointTo.y * newScale;

      setViewport(newX, newY, newScale);
    },
    [stageX, stageY, stageScale, setViewport]
  );

  // --- Pan (stage drag) ---
  const handleDragStart = useCallback(() => {
    isPanning.current = true;
  }, []);

  const handleDragMove = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // Sync viewport during drag so DotGrid updates
    setViewport(stage.x(), stage.y(), stageScale);
  }, [stageScale, setViewport]);

  const handleDragEnd = useCallback(() => {
    isPanning.current = false;
    const stage = stageRef.current;
    if (!stage) return;
    setViewport(stage.x(), stage.y(), stageScale);
  }, [stageScale, setViewport]);

  // --- Click (create object / clear selection) ---
  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage || !user) return;

      // Only handle clicks on empty canvas (not on objects)
      if (e.target !== stage) return;

      if (mode === "create" && creationTool === "stickyNote") {
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const canvasPoint = getCanvasPoint(
          stageX,
          stageY,
          stageScale,
          pointer.x,
          pointer.y
        );
        const x = snapToGrid(canvasPoint.x);
        const y = snapToGrid(canvasPoint.y);

        // Pre-generate Firestore doc ID for stable optimistic key
        const objectId = generateObjectId(boardId);

        const newObject = {
          id: objectId,
          type: "stickyNote" as const,
          x,
          y,
          width: STICKY_NOTE_DEFAULT.width,
          height: STICKY_NOTE_DEFAULT.height,
          color: STICKY_NOTE_DEFAULT.color,
          text: "",
          createdBy: user.uid,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // Optimistic local render
        upsertObject(newObject);

        // Async Firestore write (fire-and-forget, onSnapshot will reconcile)
        createObject(
          boardId,
          {
            type: newObject.type,
            x,
            y,
            width: newObject.width,
            height: newObject.height,
            color: newObject.color,
            text: newObject.text,
            createdBy: user.uid,
          },
          objectId
        ).catch((err) => {
          console.error("Failed to create object:", err);
        });
      } else if (mode === "select") {
        clearSelection();
      }
    },
    [
      mode,
      creationTool,
      stageX,
      stageY,
      stageScale,
      boardId,
      user,
      upsertObject,
      clearSelection,
    ]
  );

  // --- Mouse move (cursor sync) ---
  const handleMouseMove = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !user) return;

    const now = Date.now();
    if (now - lastCursorSend.current < CURSOR_THROTTLE_MS) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const canvasPoint = getCanvasPoint(
      stage.x(),
      stage.y(),
      stage.scaleX(),
      pointer.x,
      pointer.y
    );

    // Distance threshold — only send if moved >5px in canvas-space
    const dx = canvasPoint.x - lastCursorPos.current.x;
    const dy = canvasPoint.y - lastCursorPos.current.y;
    if (dx * dx + dy * dy < CURSOR_MIN_DISTANCE * CURSOR_MIN_DISTANCE) return;

    lastCursorSend.current = now;
    lastCursorPos.current = { x: canvasPoint.x, y: canvasPoint.y };

    setCursor(boardId, user.uid, {
      x: canvasPoint.x,
      y: canvasPoint.y,
      name: displayName || "Guest",
      color: getUserColor(user.uid),
      timestamp: now,
    });
  }, [boardId, user, displayName]);

  // --- Cursor style per mode ---
  const getCursorStyle = () => {
    if (isPanning.current) return "grabbing";
    switch (mode) {
      case "pan":
        return "grab";
      case "select":
        return "default";
      case "create":
        return "crosshair";
    }
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        cursor: getCursorStyle(),
      }}
    >
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        draggable={mode === "pan"}
        x={stageX}
        y={stageY}
        scaleX={stageScale}
        scaleY={stageScale}
        onWheel={handleWheel}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        onTap={handleClick}
        onMouseMove={handleMouseMove}
      >
        {/* Layer 1: Dot grid background (static, no events) */}
        <Layer listening={false}>
          <DotGrid
            stageX={stageX}
            stageY={stageY}
            stageScale={stageScale}
            width={dimensions.width}
            height={dimensions.height}
          />
        </Layer>

        {/* Layer 2: Board objects */}
        <Layer>
          <BoardObjects
            boardId={boardId}
            width={dimensions.width}
            height={dimensions.height}
          />
        </Layer>

        {/* Layer 3: Selection UI (Transformer handles) */}
        <Layer>
          <SelectionLayer stageRef={stageRef} />
        </Layer>

        {/* Layer 4: Remote cursors (always on top) */}
        <Layer listening={false}>
          <CursorLayer boardId={boardId} />
        </Layer>
      </Stage>
    </div>
  );
}
