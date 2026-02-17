"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Stage, Layer, Line } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { setCursor, acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import { createObject, generateObjectId, updateObject } from "@/lib/firebase/firestore";
import { getCanvasPoint, getUserColor, boundsOverlap } from "@/lib/utils";
import type { ObjectType, ResizeEdge, BorderResizeState } from "@/lib/types";
import {
  STICKY_NOTE_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
  SHAPE_DEFAULTS,
  SHAPE_SIZE_LIMITS,
  FRAME_DEFAULTS,
  FRAME_SIZE_LIMITS,
  STICKY_NOTE_SIZE_LIMITS,
  CONNECTOR_DEFAULTS,
  COLOR_LEGEND_DEFAULTS,
  MIN_DRAG_THRESHOLD,
} from "@/lib/types";
import DotGrid from "./DotGrid";
import BoardObjects from "./BoardObjects";
import SelectionLayer from "./SelectionLayer";
import SelectionRect from "./SelectionRect";
import CursorLayer from "./CursorLayer";
import TextEditor from "./TextEditor";
import GhostPreview from "./GhostPreview";
import { useFrameNesting } from "@/hooks/useFrameNesting";

interface CanvasProps {
  boardId: string;
}

const CURSOR_THROTTLE_MS = 33; // ~30 Hz
const CURSOR_MIN_DISTANCE = 5; // px

// --- Helper: get last-used or default color for a tool ---
function getColorForTool(
  tool: ObjectType,
  lastUsedColors: Record<string, string>
): string {
  if (lastUsedColors[tool]) return lastUsedColors[tool];
  switch (tool) {
    case "stickyNote":
      return STICKY_NOTE_DEFAULT.color;
    case "rectangle":
      return SHAPE_DEFAULTS.rectangle.color;
    case "circle":
      return SHAPE_DEFAULTS.circle.color;
    case "frame":
      return FRAME_DEFAULTS.color;
    case "colorLegend":
      return COLOR_LEGEND_DEFAULTS.color;
    default:
      return "#E3E8EF";
  }
}

// --- Helper: get default dimensions for a tool ---
function getDefaultsForTool(tool: ObjectType): { width: number; height: number } {
  switch (tool) {
    case "stickyNote":
      return { width: STICKY_NOTE_DEFAULT.width, height: STICKY_NOTE_DEFAULT.height };
    case "rectangle":
      return { width: SHAPE_DEFAULTS.rectangle.width, height: SHAPE_DEFAULTS.rectangle.height };
    case "circle":
      return { width: SHAPE_DEFAULTS.circle.width, height: SHAPE_DEFAULTS.circle.height };
    case "frame":
      return { width: FRAME_DEFAULTS.width, height: FRAME_DEFAULTS.height };
    case "colorLegend":
      return { width: COLOR_LEGEND_DEFAULTS.width, height: COLOR_LEGEND_DEFAULTS.height };
    default:
      return { width: 100, height: 100 };
  }
}

// --- Helper: get size limits for a tool ---
function getSizeLimitsForTool(tool: ObjectType): {
  min: { width: number; height: number };
  max: { width: number; height: number };
} {
  switch (tool) {
    case "stickyNote":
      return STICKY_NOTE_SIZE_LIMITS;
    case "rectangle":
    case "circle":
      return SHAPE_SIZE_LIMITS;
    case "frame":
      return FRAME_SIZE_LIMITS;
    default:
      return SHAPE_SIZE_LIMITS;
  }
}

// --- Helper: directly manipulate Konva nodes during border resize ---
// Bypasses React reconciliation for smooth 60fps performance.
// Only the primary visual elements are updated; React state is committed on mouseUp.
function applyResizeToKonvaNode(
  stage: Konva.Stage,
  objectId: string,
  objectType: string,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const node = stage.findOne(`#${objectId}`);
  if (!node) return;

  const group = node as Konva.Group;
  group.x(x);
  group.y(y);

  for (const child of group.getChildren()) {
    const cls = child.getClassName();
    if (objectType === "circle" && cls === "Circle") {
      const c = child as unknown as Konva.Circle;
      c.x(w / 2);
      c.y(h / 2);
      c.radius(w / 2);
    } else if (cls === "Rect") {
      const r = child as unknown as Konva.Rect;
      r.width(w);
      r.height(h);
    }
  }

  group.getLayer()?.batchDraw();
}

interface DrawingState {
  objectId: string;
  startX: number;
  startY: number;
  created: boolean;
}

export default function Canvas({ boardId }: CanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const lastCursorSend = useRef(0);
  const lastCursorPos = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const drawingRef = useRef<DrawingState | null>(null);
  const borderResizeRef = useRef<BorderResizeState | null>(null);
  const borderResizeLatestRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Selection rectangle state
  const [selRect, setSelRect] = useState({
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  // Ghost preview position
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  // Cursor override (for border resize hover)
  const [cursorOverride, setCursorOverride] = useState<string | null>(null);

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
  const lastUsedColors = useCanvasStore((s) => s.lastUsedColors);

  const objects = useObjectStore((s) => s.objects);
  const upsertObject = useObjectStore((s) => s.upsertObject);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const removeObject = useObjectStore((s) => s.removeObject);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const { checkNesting } = useFrameNesting(boardId);

  // --- Clear ghost + cleanup drawing when mode changes ---
  useEffect(() => {
    setGhostPos(null);
    if (drawingRef.current) {
      if (drawingRef.current.created) {
        removeObject(drawingRef.current.objectId);
      }
      drawingRef.current = null;
    }
  }, [mode, creationTool, removeObject]);

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

  // --- Click (connector cancel / select clear only) ---
  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage || !user) return;

      // Only handle clicks on empty canvas (not on objects)
      if (e.target !== stage) return;

      if (mode === "create" && creationTool === "connector") {
        // Cancel connector start on empty canvas click
        setConnectorStart(null);
        setConnectorEndpoint(null);
        return;
      }

      if (mode === "select") {
        clearSelection();
      }
    },
    [mode, creationTool, user, clearSelection, setConnectorStart]
  );

  // --- Mouse down (start drag-to-create or selection rect) ---
  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.target !== stageRef.current) return; // Only on empty canvas

      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const canvasPoint = getCanvasPoint(stageX, stageY, stageScale, pointer.x, pointer.y);

      if (mode === "create" && creationTool && creationTool !== "connector") {
        // Start drag-to-create
        const sx = Math.round(canvasPoint.x);
        const sy = Math.round(canvasPoint.y);
        const objectId = generateObjectId(boardId);

        drawingRef.current = {
          objectId,
          startX: sx,
          startY: sy,
          created: false,
        };
        setGhostPos(null); // Hide ghost while drawing
        return;
      }

      if (mode === "select") {
        setSelRect({
          active: true,
          startX: canvasPoint.x,
          startY: canvasPoint.y,
          currentX: canvasPoint.x,
          currentY: canvasPoint.y,
        });
      }
    },
    [mode, creationTool, stageX, stageY, stageScale, boardId]
  );

  // --- Mouse move (drag-to-create / ghost / selection rect / cursor sync / connector) ---
  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      // --- Create mode (non-connector): drag-to-create or ghost ---
      if (mode === "create" && creationTool && creationTool !== "connector") {
        const canvasPoint = getCanvasPoint(
          stage.x(),
          stage.y(),
          stage.scaleX(),
          pointer.x,
          pointer.y
        );

        if (drawingRef.current) {
          // Actively drawing — compute size
          const endX = canvasPoint.x;
          const endY = canvasPoint.y;

          let w = Math.abs(endX - drawingRef.current.startX);
          let h = Math.abs(endY - drawingRef.current.startY);

          // Circle constraint: enforce square
          if (creationTool === "circle") {
            const maxDim = Math.max(w, h);
            w = maxDim;
            h = maxDim;
          }

          // Clamp to size limits
          const limits = getSizeLimitsForTool(creationTool);
          w = Math.max(limits.min.width, Math.min(limits.max.width, w));
          h = Math.max(limits.min.height, Math.min(limits.max.height, h));

          // Handle negative drag direction
          const objX = Math.min(drawingRef.current.startX, endX);
          const objY = Math.min(drawingRef.current.startY, endY);

          const dist = Math.max(
            Math.abs(endX - drawingRef.current.startX),
            Math.abs(endY - drawingRef.current.startY)
          );

          if (!drawingRef.current.created && dist > MIN_DRAG_THRESHOLD && user) {
            // First time past threshold — create object
            const color = getColorForTool(creationTool, lastUsedColors);
            const newObject = {
              id: drawingRef.current.objectId,
              type: creationTool,
              x: objX,
              y: objY,
              width: w,
              height: h,
              color,
              text: "",
              createdBy: user.uid,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            upsertObject(newObject);
            drawingRef.current.created = true;
          } else if (drawingRef.current.created) {
            // Already created — resize
            updateObjectLocal(drawingRef.current.objectId, {
              x: objX,
              y: objY,
              width: w,
              height: h,
            });
          }
        } else {
          // Not drawing — update ghost preview position
          setGhostPos({
            x: Math.round(canvasPoint.x),
            y: Math.round(canvasPoint.y),
          });
        }
      }

      // --- Border resize: compute new dimensions ---
      if (borderResizeRef.current) {
        const br = borderResizeRef.current;
        const canvasPoint = getCanvasPoint(
          stage.x(),
          stage.y(),
          stage.scaleX(),
          pointer.x,
          pointer.y
        );

        const limits = getSizeLimitsForTool(br.objectType);
        const { edge, startX, startY, startW, startH } = br;
        const startRight = startX + startW;
        const startBottom = startY + startH;

        let newX = startX;
        let newY = startY;
        let newW = startW;
        let newH = startH;

        // Horizontal axis
        if (edge === "e" || edge === "se" || edge === "ne") {
          newW = canvasPoint.x - startX;
        } else if (edge === "w" || edge === "sw" || edge === "nw") {
          newW = startRight - canvasPoint.x;
        }

        // Vertical axis
        if (edge === "s" || edge === "se" || edge === "sw") {
          newH = canvasPoint.y - startY;
        } else if (edge === "n" || edge === "ne" || edge === "nw") {
          newH = startBottom - canvasPoint.y;
        }

        // Clamp to limits (prevents negative/zero dimensions)
        newW = Math.max(limits.min.width, Math.min(limits.max.width, newW));
        newH = Math.max(limits.min.height, Math.min(limits.max.height, newH));

        // Circle constraint: enforce square
        if (br.objectType === "circle") {
          const maxDim = Math.max(newW, newH);
          newW = maxDim;
          newH = maxDim;
        }

        // Round dimensions FIRST to preserve anchor integrity
        newW = Math.round(newW);
        newH = Math.round(newH);

        // Recalculate position from fixed anchor AFTER rounding.
        // This ensures the opposite corner stays perfectly fixed.
        if (edge === "w" || edge === "nw" || edge === "sw") {
          newX = startRight - newW;
        }
        if (edge === "n" || edge === "nw" || edge === "ne") {
          newY = startBottom - newH;
        }

        newX = Math.round(newX);
        newY = Math.round(newY);

        // Store latest values for commit on mouseUp
        borderResizeLatestRef.current = {
          x: newX,
          y: newY,
          width: newW,
          height: newH,
        };

        // Direct Konva manipulation — bypass React for smooth performance
        applyResizeToKonvaNode(
          stage,
          br.objectId,
          br.objectType,
          newX,
          newY,
          newW,
          newH
        );
      }

      // Track hovered object for anchor points (connector mode)
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

      const cursorCanvasPoint = getCanvasPoint(
        stage.x(),
        stage.y(),
        stage.scaleX(),
        pointer.x,
        pointer.y
      );

      const dx = cursorCanvasPoint.x - lastCursorPos.current.x;
      const dy = cursorCanvasPoint.y - lastCursorPos.current.y;
      if (dx * dx + dy * dy < CURSOR_MIN_DISTANCE * CURSOR_MIN_DISTANCE) return;

      lastCursorSend.current = now;
      lastCursorPos.current = { x: cursorCanvasPoint.x, y: cursorCanvasPoint.y };

      setCursor(boardId, user.uid, {
        x: cursorCanvasPoint.x,
        y: cursorCanvasPoint.y,
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
      lastUsedColors,
      upsertObject,
      updateObjectLocal,
    ]
  );

  // --- Mouse up (finalize border resize / drag-to-create / click-to-create / selection rect) ---
  const handleMouseUp = useCallback(() => {
    // --- Border resize finalization ---
    if (borderResizeRef.current) {
      const br = borderResizeRef.current;
      const latest = borderResizeLatestRef.current;

      if (latest) {
        // Commit final dimensions to React state
        updateObjectLocal(br.objectId, latest);
        // Persist to Firestore
        updateObject(boardId, br.objectId, latest).catch(console.error);
      }

      releaseLock(boardId, br.objectId);
      useObjectStore.getState().endLocalEdit(br.objectId);
      borderResizeRef.current = null;
      borderResizeLatestRef.current = null;
      setCursorOverride(null);
      return;
    }

    // --- Drag-to-create finalization ---
    if (mode === "create" && creationTool && creationTool !== "connector" && drawingRef.current && user) {
      const drawing = drawingRef.current;

      if (drawing.created) {
        // Dragged past threshold — persist to Firestore
        const obj = useObjectStore.getState().objects[drawing.objectId];
        if (obj) {
          createObject(
            boardId,
            {
              type: obj.type,
              x: obj.x,
              y: obj.y,
              width: obj.width,
              height: obj.height,
              color: obj.color,
              text: obj.text ?? "",
              createdBy: user.uid,
            },
            drawing.objectId
          ).catch((err) => {
            console.error("Failed to create object:", err);
          });
        }
      } else {
        // Click (no drag) — create at default size
        const defaults = getDefaultsForTool(creationTool);
        const color = getColorForTool(creationTool, lastUsedColors);

        const newObject = {
          id: drawing.objectId,
          type: creationTool,
          x: drawing.startX,
          y: drawing.startY,
          width: defaults.width,
          height: defaults.height,
          color,
          text: "",
          createdBy: user.uid,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        upsertObject(newObject);

        createObject(
          boardId,
          {
            type: creationTool,
            x: drawing.startX,
            y: drawing.startY,
            width: defaults.width,
            height: defaults.height,
            color,
            text: "",
            createdBy: user.uid,
          },
          drawing.objectId
        ).catch((err) => {
          console.error("Failed to create object:", err);
        });
      }

      drawingRef.current = null;
      return;
    }

    // --- Selection rect finalization ---
    if (selRect.active) {
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
    }
  }, [mode, creationTool, user, boardId, selRect, objects, lastUsedColors, upsertObject]);

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

  // --- Border resize: cursor override ---
  useEffect(() => {
    const handler = (e: Event) => {
      const cursor = (e as CustomEvent).detail?.cursor as string | null;
      setCursorOverride(cursor);
    };
    window.addEventListener("border-cursor", handler);
    return () => window.removeEventListener("border-cursor", handler);
  }, []);

  // --- Border resize: start ---
  useEffect(() => {
    const handler = (e: Event) => {
      const { objectId, edge } = (e as CustomEvent).detail as {
        objectId: string;
        edge: ResizeEdge;
      };
      if (!user) return;

      const obj = useObjectStore.getState().objects[objectId];
      if (!obj) return;

      borderResizeRef.current = {
        objectId,
        edge,
        startX: obj.x,
        startY: obj.y,
        startW: obj.width,
        startH: obj.height,
        objectType: obj.type,
      };

      // Guard against Firestore echoes during resize
      useObjectStore.getState().startLocalEdit(objectId);

      // Acquire soft lock
      acquireLock(boardId, objectId, user.uid, displayName || "Guest");
    };
    window.addEventListener("border-resize-start", handler);
    return () => window.removeEventListener("border-resize-start", handler);
  }, [boardId, user, displayName]);

  // --- Cleanup border resize on mode change ---
  useEffect(() => {
    if (borderResizeRef.current) {
      releaseLock(boardId, borderResizeRef.current.objectId);
      useObjectStore.getState().endLocalEdit(borderResizeRef.current.objectId);
      borderResizeRef.current = null;
      setCursorOverride(null);
    }
  }, [mode, boardId]);

  // --- Cursor style per mode ---
  const getCursorStyle = () => {
    if (cursorOverride) return cursorOverride;
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

  // Should we show the ghost preview?
  const showGhost =
    mode === "create" &&
    creationTool &&
    creationTool !== "connector" &&
    ghostPos &&
    !drawingRef.current;

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

        {/* Layer 2: Board objects + ghost preview */}
        <Layer>
          <BoardObjects
            boardId={boardId}
            width={dimensions.width}
            height={dimensions.height}
            hoveredObjectId={hoveredObjectId}
            onAnchorClick={handleAnchorClick}
          />

          {/* Ghost preview for shape creation */}
          {showGhost && (
            <GhostPreview
              tool={creationTool!}
              x={ghostPos!.x}
              y={ghostPos!.y}
              color={getColorForTool(creationTool!, lastUsedColors)}
            />
          )}

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
