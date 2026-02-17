"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Stage, Layer, Line } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { setCursor } from "@/lib/firebase/rtdb";
import { createObject, generateObjectId } from "@/lib/firebase/firestore";
import { snapToGrid, getCanvasPoint, getUserColor, boundsOverlap } from "@/lib/utils";
import {
  STICKY_NOTE_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
  SHAPE_DEFAULTS,
  FRAME_DEFAULTS,
  CONNECTOR_DEFAULTS,
} from "@/lib/types";
import DotGrid from "./DotGrid";
import BoardObjects from "./BoardObjects";
import SelectionLayer from "./SelectionLayer";
import SelectionRect from "./SelectionRect";
import CursorLayer from "./CursorLayer";
import TextEditor from "./TextEditor";
import { useFrameNesting } from "@/hooks/useFrameNesting";

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

  // Selection rectangle state
  const [selRect, setSelRect] = useState({
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  // Hovered object for anchor points
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);

  // Temporary connector line endpoint
  const [connectorEndpoint, setConnectorEndpoint] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });

  // Store selectors
  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const stageX = useCanvasStore((s) => s.stageX);
  const stageY = useCanvasStore((s) => s.stageY);
  const stageScale = useCanvasStore((s) => s.stageScale);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const editingObjectId = useCanvasStore((s) => s.editingObjectId);
  const connectorStart = useCanvasStore((s) => s.connectorStart);
  const setConnectorStart = useCanvasStore((s) => s.setConnectorStart);

  const objects = useObjectStore((s) => s.objects);
  const upsertObject = useObjectStore((s) => s.upsertObject);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const { checkNesting } = useFrameNesting(boardId);

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
    setViewport(stage.x(), stage.y(), stageScale);
  }, [stageScale, setViewport]);

  const handleDragEnd = useCallback(() => {
    isPanning.current = false;
    const stage = stageRef.current;
    if (!stage) return;
    setViewport(stage.x(), stage.y(), stageScale);
  }, [stageScale, setViewport]);

  // --- Anchor click for connector creation ---
  const handleAnchorClick = useCallback(
    (objectId: string) => {
      if (!user) return;
      if (!connectorStart) {
        // Start connector
        setConnectorStart(objectId);
      } else {
        // Complete connector
        if (connectorStart === objectId) {
          // Self-connection — cancel
          setConnectorStart(null);
          setConnectorEndpoint(null);
          return;
        }

        // Check for duplicate connector
        const isDuplicate = Object.values(objects).some(
          (o) =>
            o.type === "connector" &&
            o.connectedTo &&
            ((o.connectedTo[0] === connectorStart &&
              o.connectedTo[1] === objectId) ||
              (o.connectedTo[0] === objectId &&
                o.connectedTo[1] === connectorStart))
        );

        if (isDuplicate) {
          setConnectorStart(null);
          setConnectorEndpoint(null);
          return;
        }

        const newId = generateObjectId(boardId);
        const newConnector = {
          id: newId,
          type: "connector" as const,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          color: CONNECTOR_DEFAULTS.color,
          connectedTo: [connectorStart, objectId],
          createdBy: user.uid,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          metadata: { connectorStyle: CONNECTOR_DEFAULTS.style },
        };

        upsertObject(newConnector);
        createObject(
          boardId,
          {
            type: "connector",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            color: CONNECTOR_DEFAULTS.color,
            connectedTo: [connectorStart, objectId],
            createdBy: user.uid,
            metadata: { connectorStyle: CONNECTOR_DEFAULTS.style },
          },
          newId
        ).catch(console.error);

        setConnectorStart(null);
        setConnectorEndpoint(null);
      }
    },
    [connectorStart, objects, user, boardId, upsertObject, setConnectorStart]
  );

  // --- Click (create object / clear selection) ---
  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage || !user) return;

      // Only handle clicks on empty canvas (not on objects)
      if (e.target !== stage) return;

      if (mode === "create" && creationTool) {
        // Cancel connector start on empty canvas click
        if (creationTool === "connector") {
          setConnectorStart(null);
          setConnectorEndpoint(null);
          return;
        }

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

        const objectId = generateObjectId(boardId);

        let newObject;

        switch (creationTool) {
          case "stickyNote":
            newObject = {
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
            break;
          case "rectangle":
            newObject = {
              id: objectId,
              type: "rectangle" as const,
              x,
              y,
              width: SHAPE_DEFAULTS.rectangle.width,
              height: SHAPE_DEFAULTS.rectangle.height,
              color: SHAPE_DEFAULTS.rectangle.color,
              text: "",
              createdBy: user.uid,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            break;
          case "circle":
            newObject = {
              id: objectId,
              type: "circle" as const,
              x,
              y,
              width: SHAPE_DEFAULTS.circle.width,
              height: SHAPE_DEFAULTS.circle.height,
              color: SHAPE_DEFAULTS.circle.color,
              text: "",
              createdBy: user.uid,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            break;
          case "frame":
            newObject = {
              id: objectId,
              type: "frame" as const,
              x,
              y,
              width: FRAME_DEFAULTS.width,
              height: FRAME_DEFAULTS.height,
              color: FRAME_DEFAULTS.color,
              text: "",
              createdBy: user.uid,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            break;
          default:
            return;
        }

        // Optimistic local render
        upsertObject(newObject);

        // Async Firestore write
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
      setConnectorStart,
    ]
  );

  // --- Mouse down (start selection rect) ---
  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (mode !== "select") return;
      if (e.target !== stageRef.current) return; // Only on empty canvas

      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const canvasPoint = getCanvasPoint(stageX, stageY, stageScale, pointer.x, pointer.y);

      setSelRect({
        active: true,
        startX: canvasPoint.x,
        startY: canvasPoint.y,
        currentX: canvasPoint.x,
        currentY: canvasPoint.y,
      });
    },
    [mode, stageX, stageY, stageScale]
  );

  // --- Mouse move (update selection rect + cursor sync + connector temp line) ---
  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      // Track hovered object for anchor points
      if (mode === "create" && creationTool === "connector") {
        const target = e.target;
        if (target !== stage) {
          // Walk up to find group with ID
          let node: Konva.Node | null = target;
          while (node && !node.id()) {
            node = node.parent;
          }
          if (node && node.id()) {
            setHoveredObjectId(node.id());
          }
        } else {
          setHoveredObjectId(null);
        }

        // Update temp connector endpoint
        if (connectorStart) {
          const canvasPoint = getCanvasPoint(
            stage.x(),
            stage.y(),
            stage.scaleX(),
            pointer.x,
            pointer.y
          );
          setConnectorEndpoint(canvasPoint);
        }
      }

      // Update selection rect
      if (selRect.active) {
        const canvasPoint = getCanvasPoint(
          stageX,
          stageY,
          stageScale,
          pointer.x,
          pointer.y
        );
        setSelRect((prev) => ({
          ...prev,
          currentX: canvasPoint.x,
          currentY: canvasPoint.y,
        }));
      }

      // Cursor sync (throttled)
      if (!user) return;
      const now = Date.now();
      if (now - lastCursorSend.current < CURSOR_THROTTLE_MS) return;

      const canvasPoint = getCanvasPoint(
        stage.x(),
        stage.y(),
        stage.scaleX(),
        pointer.x,
        pointer.y
      );

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
    },
    [
      boardId,
      user,
      displayName,
      mode,
      creationTool,
      connectorStart,
      selRect.active,
      stageX,
      stageY,
      stageScale,
    ]
  );

  // --- Mouse up (finish selection rect) ---
  const handleMouseUp = useCallback(() => {
    if (!selRect.active) return;

    const x = Math.min(selRect.startX, selRect.currentX);
    const y = Math.min(selRect.startY, selRect.currentY);
    const w = Math.abs(selRect.currentX - selRect.startX);
    const h = Math.abs(selRect.currentY - selRect.startY);

    // Only perform hit-test if rect is large enough
    if (w > 5 && h > 5) {
      const selBounds = { x, y, width: w, height: h };
      const matchingIds: string[] = [];

      for (const obj of Object.values(objects)) {
        if (obj.type === "connector") continue;
        if (boundsOverlap(selBounds, obj)) {
          matchingIds.push(obj.id);
        }
      }

      if (matchingIds.length > 0) {
        useCanvasStore.setState({ selectedObjectIds: matchingIds });
      }
    }

    setSelRect({
      active: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
    });
  }, [selRect, objects]);

  // --- Right-click (context menu) ---
  const handleContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;

      const target = e.target;
      if (target === stage) {
        // Empty canvas right-click
        useCanvasStore.getState().showContextMenu({
          visible: true,
          x: e.evt.clientX,
          y: e.evt.clientY,
          targetObjectId: null,
          nearbyFrames: [],
        });
      }
      // Object right-clicks are handled by individual components
    },
    []
  );

  // Expose checkNesting for child components via a custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const objectId = (e as CustomEvent).detail?.objectId;
      if (objectId) checkNesting(objectId);
    };
    window.addEventListener("object-drag-end", handler);
    return () => window.removeEventListener("object-drag-end", handler);
  }, [checkNesting]);

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

  // Compute selection rect display values
  const selRectDisplay = {
    x: Math.min(selRect.startX, selRect.currentX),
    y: Math.min(selRect.startY, selRect.currentY),
    width: Math.abs(selRect.currentX - selRect.startX),
    height: Math.abs(selRect.currentY - selRect.startY),
  };

  // Compute temp connector line
  const connectorTempLine = (() => {
    if (!connectorStart || !connectorEndpoint) return null;
    const startObj = objects[connectorStart];
    if (!startObj) return null;
    const startCx = startObj.x + startObj.width / 2;
    const startCy = startObj.y + startObj.height / 2;
    return [startCx, startCy, connectorEndpoint.x, connectorEndpoint.y];
  })();

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
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
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
            hoveredObjectId={hoveredObjectId}
            onAnchorClick={handleAnchorClick}
          />

          {/* Temporary connector line */}
          {connectorTempLine && (
            <Line
              points={connectorTempLine}
              stroke="#6366f1"
              strokeWidth={2}
              dash={[6, 3]}
              listening={false}
            />
          )}
        </Layer>

        {/* Layer 3: Selection UI (Transformer handles + selection rect) */}
        <Layer>
          <SelectionLayer stageRef={stageRef} />
          <SelectionRect
            x={selRectDisplay.x}
            y={selRectDisplay.y}
            width={selRectDisplay.width}
            height={selRectDisplay.height}
            visible={selRect.active}
          />
        </Layer>

        {/* Layer 4: Remote cursors (always on top) */}
        <Layer listening={false}>
          <CursorLayer boardId={boardId} />
        </Layer>
      </Stage>

      {/* HTML overlays (above Konva) */}
      {editingObjectId && <TextEditor boardId={boardId} />}
    </div>
  );
}
