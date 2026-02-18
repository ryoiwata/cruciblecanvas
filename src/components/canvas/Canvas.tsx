"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Stage, Layer, Line, Rect } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { setCursor, acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import { presenceLogger } from "@/lib/debug/presenceLogger";
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
import CursorLayer from "./CursorLayer";
import TextEditor from "./TextEditor";
import GhostPreview from "./GhostPreview";
import { useFrameNesting } from "@/hooks/useFrameNesting";
import { borderResizingIds } from "@/lib/resizeState";
import { syncKonvaChildren } from "@/lib/konvaSync";

interface CanvasProps {
  boardId: string;
}

const CURSOR_THROTTLE_MS = 16; // ~60 Hz — minimizes throttle contribution to <50ms sync latency
const CURSOR_MIN_DISTANCE = 3; // px — tighter threshold for smoother remote cursor movement

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

// --- Helper: compute max zIndex across all objects ---
function getMaxZIndex(): number {
  const objs = useObjectStore.getState().objects;
  let max = 0;
  for (const o of Object.values(objs)) {
    const z = o.zIndex ?? 0;
    if (z > max) max = z;
  }
  return max;
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
  group.width(w);
  group.height(h);

  syncKonvaChildren(group, objectType, w, h);

  group.getLayer()?.batchDraw();
}

// --- Helper: compute border resize dimensions with flipping support ---
// The origin point (corner diagonally opposite the drag handle) is strictly
// locked in global coordinates. When the cursor crosses past the origin,
// the shape inverts but the origin remains the pivot.
function computeBorderResize(
  br: BorderResizeState,
  cursorX: number,
  cursorY: number,
  limits: { min: { width: number; height: number }; max: { width: number; height: number } }
): { x: number; y: number; width: number; height: number } {
  const { edge, startX, startY, startW, startH, startRight, startBottom, objectType } = br;

  let newX = startX;
  let newY = startY;
  let newW = startW;
  let newH = startH;

  // Which axes does this edge affect?
  const resizesH = edge !== "n" && edge !== "s";
  const resizesV = edge !== "e" && edge !== "w";

  // Which side of the shape is the drag handle on?
  const isEast = edge === "e" || edge === "se" || edge === "ne";
  const isSouth = edge === "s" || edge === "se" || edge === "sw";

  // Track raw signed deltas for position calculation after clamping
  let rawW = 0;
  let rawH = 0;

  if (resizesH) {
    // Anchor is the opposite edge: east drag → left edge fixed, west drag → right edge fixed
    const anchorX = isEast ? startX : startRight;
    rawW = cursorX - anchorX;
    newW = Math.abs(rawW);
  }

  if (resizesV) {
    const anchorY = isSouth ? startY : startBottom;
    rawH = cursorY - anchorY;
    newH = Math.abs(rawH);
  }

  // Clamp to type limits
  newW = Math.max(limits.min.width, Math.min(limits.max.width, newW));
  newH = Math.max(limits.min.height, Math.min(limits.max.height, newH));

  // Circle constraint: enforce square
  if (objectType === "circle") {
    const maxDim = Math.max(newW, newH);
    newW = maxDim;
    newH = maxDim;
  }

  // Round dimensions FIRST to preserve anchor integrity
  newW = Math.round(newW);
  newH = Math.round(newH);

  // Recalculate position from the locked anchor AFTER rounding.
  // The sign of the raw delta determines which side of the anchor the cursor is on:
  //   rawW >= 0 → shape extends right from anchor → newX = anchor
  //   rawW <  0 → shape extends left from anchor  → newX = anchor - width (flipped)
  if (resizesH) {
    const anchorX = isEast ? startX : startRight;
    newX = rawW >= 0 ? anchorX : anchorX - newW;
    newX = Math.round(newX);
  }

  if (resizesV) {
    const anchorY = isSouth ? startY : startBottom;
    newY = rawH >= 0 ? anchorY : anchorY - newH;
    newY = Math.round(newY);
  }

  return { x: newX, y: newY, width: newW, height: newH };
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
  const drawingRef = useRef<DrawingState | null>(null);
  const borderResizeRef = useRef<BorderResizeState | null>(null);
  const borderResizeLatestRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  // RAF handle for border resize rendering — coalesces mouse events to display refresh rate
  const borderResizeRafRef = useRef(0);

  // Pointer mode interaction tracking (pan or selection rect)
  const pointerInteractionRef = useRef<{
    type: "pan";
    startMouseX: number;
    startMouseY: number;
    startStageX: number;
    startStageY: number;
  } | {
    type: "selRect";
    shiftHeld: boolean; // true = additive selection (merge with existing)
  } | null>(null);

  // Selection rect live coords (ref-based for RAF performance)
  const selRectRef = useRef({ startX: 0, startY: 0, currentX: 0, currentY: 0 });
  const selRectRafRef = useRef(0);
  const selRectNodeRef = useRef<Konva.Rect>(null);

  // Minimal state for cursor display during pan
  const [isPanActive, setIsPanActive] = useState(false);

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

      if (mode === "pointer" && !e.evt.ctrlKey && !e.evt.metaKey) {
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

      if (mode === "pointer") {
        if (e.evt.ctrlKey || e.evt.metaKey) {
          // Ctrl+drag: start selection rectangle (marquee)
          pointerInteractionRef.current = { type: "selRect", shiftHeld: e.evt.shiftKey };
          selRectRef.current = {
            startX: canvasPoint.x,
            startY: canvasPoint.y,
            currentX: canvasPoint.x,
            currentY: canvasPoint.y,
          };
          // Show the rect node immediately
          const node = selRectNodeRef.current;
          if (node) {
            node.x(canvasPoint.x);
            node.y(canvasPoint.y);
            node.width(0);
            node.height(0);
            node.visible(true);
            node.getLayer()?.batchDraw();
          }
        } else {
          // Plain drag on empty canvas: start manual pan
          pointerInteractionRef.current = {
            type: "pan",
            startMouseX: pointer.x,
            startMouseY: pointer.y,
            startStageX: stageX,
            startStageY: stageY,
          };
          setIsPanActive(true);
        }
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
              zIndex: getMaxZIndex() + 1,
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

      // --- Border resize: compute new dimensions + RAF-gated render ---
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

        // Compute with anchor-locked flipping support (pure arithmetic, ~ns)
        const result = computeBorderResize(br, canvasPoint.x, canvasPoint.y, limits);

        // Store latest values — always current, read on mouseUp for commit
        borderResizeLatestRef.current = result;

        // RAF-gate the Konva render to sync with display refresh rate.
        // Multiple mousemove events between frames are coalesced — only the
        // latest result (from borderResizeLatestRef) is painted.
        if (!borderResizeRafRef.current) {
          borderResizeRafRef.current = requestAnimationFrame(() => {
            borderResizeRafRef.current = 0;
            const latest = borderResizeLatestRef.current;
            const activeBr = borderResizeRef.current;
            const activeStage = stageRef.current;
            if (!latest || !activeBr || !activeStage) return;

            applyResizeToKonvaNode(
              activeStage,
              activeBr.objectId,
              activeBr.objectType,
              latest.x,
              latest.y,
              latest.width,
              latest.height
            );
          });
        }
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

      // --- Pointer mode: manual pan or selection rect ---
      if (pointerInteractionRef.current) {
        const interaction = pointerInteractionRef.current;

        if (interaction.type === "pan") {
          // Manual pan: compute new viewport from mouse delta
          const dx = pointer.x - interaction.startMouseX;
          const dy = pointer.y - interaction.startMouseY;
          const newX = interaction.startStageX + dx;
          const newY = interaction.startStageY + dy;
          setViewport(newX, newY, stageScale);
        } else if (interaction.type === "selRect") {
          // Selection rect: RAF-gated direct Konva node manipulation
          const canvasPoint = getCanvasPoint(
            stageX,
            stageY,
            stageScale,
            pointer.x,
            pointer.y
          );
          selRectRef.current.currentX = canvasPoint.x;
          selRectRef.current.currentY = canvasPoint.y;

          if (!selRectRafRef.current) {
            selRectRafRef.current = requestAnimationFrame(() => {
              selRectRafRef.current = 0;
              const node = selRectNodeRef.current;
              if (!node) return;
              const sr = selRectRef.current;
              node.x(Math.min(sr.startX, sr.currentX));
              node.y(Math.min(sr.startY, sr.currentY));
              node.width(Math.abs(sr.currentX - sr.startX));
              node.height(Math.abs(sr.currentY - sr.startY));
              node.getLayer()?.batchDraw();
            });
          }
        }
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

      presenceLogger.cursorSent(user.uid, cursorCanvasPoint);
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
      stageX,
      stageY,
      stageScale,
      lastUsedColors,
      upsertObject,
      updateObjectLocal,
      setViewport,
    ]
  );

  // --- Mouse up (finalize border resize / drag-to-create / click-to-create / selection rect) ---
  const handleMouseUp = useCallback(() => {
    // --- Border resize finalization ---
    if (borderResizeRef.current) {
      const br = borderResizeRef.current;
      const latest = borderResizeLatestRef.current;

      // STEP 0: Cancel any pending RAF and apply final dimensions synchronously.
      // This ensures the Konva node is at the exact latest cursor position
      // before we commit to React state.
      if (borderResizeRafRef.current) {
        cancelAnimationFrame(borderResizeRafRef.current);
        borderResizeRafRef.current = 0;
      }
      const stage = stageRef.current;
      if (stage && latest) {
        applyResizeToKonvaNode(
          stage, br.objectId, br.objectType,
          latest.x, latest.y, latest.width, latest.height
        );
      }

      // STEP 1: Commit correct values to Zustand while memo guard is STILL active.
      // This ensures the store has final dimensions before any re-render can see them.
      if (latest) {
        updateObjectLocal(br.objectId, latest);
      }

      // STEP 2: Remove memo guard AFTER Zustand has correct values.
      // The next re-render will see: guard=false AND correct values — no ghosting flash.
      borderResizingIds.delete(br.objectId);

      // STEP 3: Bump generation to re-sync Transformer (re-attaches the node now
      // that the border resize is done). This triggers SelectionLayer's useEffect.
      useCanvasStore.getState().bumpBorderResizeGeneration();

      // STEP 4: End local edit guard (allows Firestore echoes for this object again)
      useObjectStore.getState().endLocalEdit(br.objectId);

      // STEP 5: Persist to Firestore (async, non-blocking)
      if (latest) {
        updateObject(boardId, br.objectId, latest).catch(console.error);
      }

      // STEP 6: Release lock and clear refs
      releaseLock(boardId, br.objectId);
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
              zIndex: obj.zIndex,
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
        const maxZ = getMaxZIndex() + 1;

        const newObject = {
          id: drawing.objectId,
          type: creationTool,
          x: drawing.startX,
          y: drawing.startY,
          width: defaults.width,
          height: defaults.height,
          color,
          text: "",
          zIndex: maxZ,
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
            zIndex: maxZ,
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

    // --- Pointer mode finalization (pan or selection rect) ---
    if (pointerInteractionRef.current) {
      const interaction = pointerInteractionRef.current;

      if (interaction.type === "selRect") {
        // Cancel pending RAF
        if (selRectRafRef.current) {
          cancelAnimationFrame(selRectRafRef.current);
          selRectRafRef.current = 0;
        }

        // AABB hit test
        const sr = selRectRef.current;
        const x = Math.min(sr.startX, sr.currentX);
        const y = Math.min(sr.startY, sr.currentY);
        const w = Math.abs(sr.currentX - sr.startX);
        const h = Math.abs(sr.currentY - sr.startY);

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
            if (interaction.shiftHeld) {
              // Additive selection: merge with existing selection
              const existing = useCanvasStore.getState().selectedObjectIds;
              const merged = Array.from(new Set([...existing, ...matchingIds]));
              useCanvasStore.setState({ selectedObjectIds: merged });
            } else {
              useCanvasStore.setState({ selectedObjectIds: matchingIds });
            }
          }
        }

        // Hide selection rect node
        const node = selRectNodeRef.current;
        if (node) {
          node.visible(false);
          node.getLayer()?.batchDraw();
        }
      } else if (interaction.type === "pan") {
        setIsPanActive(false);
      }

      pointerInteractionRef.current = null;
    }
  }, [mode, creationTool, user, boardId, objects, lastUsedColors, upsertObject, updateObjectLocal]);

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
        startRight: obj.x + obj.width,
        startBottom: obj.y + obj.height,
        objectType: obj.type,
      };

      // Signal that this object is being border-resized (suppresses React re-renders)
      borderResizingIds.add(objectId);

      // Bump generation to detach this node from the Transformer during border resize,
      // preventing the Transformer from interfering with direct Konva manipulation
      useCanvasStore.getState().bumpBorderResizeGeneration();

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
      // Cancel any pending RAF to prevent stale renders
      if (borderResizeRafRef.current) {
        cancelAnimationFrame(borderResizeRafRef.current);
        borderResizeRafRef.current = 0;
      }
      borderResizingIds.delete(borderResizeRef.current.objectId);
      // Re-sync Transformer so it re-attaches to the node after abort
      useCanvasStore.getState().bumpBorderResizeGeneration();
      releaseLock(boardId, borderResizeRef.current.objectId);
      useObjectStore.getState().endLocalEdit(borderResizeRef.current.objectId);
      borderResizeRef.current = null;
      setCursorOverride(null);
    }
  }, [mode, boardId]);

  // --- Mode-change cleanup: cancel pending selection-rect RAF, reset interaction ---
  useEffect(() => {
    if (selRectRafRef.current) {
      cancelAnimationFrame(selRectRafRef.current);
      selRectRafRef.current = 0;
    }
    const node = selRectNodeRef.current;
    if (node) {
      node.visible(false);
      node.getLayer()?.batchDraw();
    }
    pointerInteractionRef.current = null;
    setIsPanActive(false);
  }, [mode]);

  // --- Cursor style per mode ---
  const getCursorStyle = () => {
    if (cursorOverride) return cursorOverride;
    if (isPanActive) return "grabbing";
    switch (mode) {
      case "pointer":
        return "default";
      case "create":
        return "crosshair";
    }
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
        draggable={false}
        x={stageX}
        y={stageY}
        scaleX={stageScale}
        scaleY={stageScale}
        onWheel={handleWheel}
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
          <Rect
            ref={selRectNodeRef}
            fill="rgba(33, 150, 243, 0.1)"
            stroke="#2196F3"
            strokeWidth={1}
            visible={false}
            listening={false}
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
