"use client";

import { useEffect, useRef, useCallback } from "react";
import { Transformer } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
import { acquireLock, releaseLock } from "@/lib/firebase/rtdb";
import { useAuthStore } from "@/lib/store/authStore";
import { setTransforming, borderResizingIds } from "@/lib/resizeState";
import { syncKonvaChildren } from "@/lib/konvaSync";

import {
  SHAPE_SIZE_LIMITS,
  FRAME_SIZE_LIMITS,
  STICKY_NOTE_SIZE_LIMITS,
} from "@/lib/types";

function getLimitsForType(type: string) {
  switch (type) {
    case "stickyNote":
      return {
        minW: STICKY_NOTE_SIZE_LIMITS.min.width,
        minH: STICKY_NOTE_SIZE_LIMITS.min.height,
        maxW: STICKY_NOTE_SIZE_LIMITS.max.width,
        maxH: STICKY_NOTE_SIZE_LIMITS.max.height,
      };
    case "rectangle":
    case "circle":
      return {
        minW: SHAPE_SIZE_LIMITS.min.width,
        minH: SHAPE_SIZE_LIMITS.min.height,
        maxW: SHAPE_SIZE_LIMITS.max.width,
        maxH: SHAPE_SIZE_LIMITS.max.height,
      };
    case "frame":
      return {
        minW: FRAME_SIZE_LIMITS.min.width,
        minH: FRAME_SIZE_LIMITS.min.height,
        maxW: FRAME_SIZE_LIMITS.max.width,
        maxH: FRAME_SIZE_LIMITS.max.height,
      };
    default:
      return { minW: 1, minH: 1, maxW: 100000, maxH: 100000 };
  }
}

// Maps an anchor handle name to which edges are fixed (i.e. the opposite side of the drag).
// xFixed=true means left edge is fixed (user dragging right side).
// xFixed=false means right edge is fixed (user dragging left side).
// null means no horizontal constraint (e.g. "top-center" only affects vertical).
function getFixedEdges(anchor: string | null): { xFixed: boolean | null; yFixed: boolean | null } {
  if (!anchor) return { xFixed: null, yFixed: null };
  return {
    xFixed: anchor.includes("left") ? false : anchor.includes("right") ? true : null,
    yFixed: anchor.includes("top") ? false : anchor.includes("bottom") ? true : null,
  };
}

interface SelectionLayerProps {
  stageRef: React.RefObject<Konva.Stage | null>;
}

export default function SelectionLayer({ stageRef }: SelectionLayerProps) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const activeAnchorRef = useRef<string | null>(null);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  // Reactive counter — bumped on border resize start/end to trigger Transformer re-sync
  const borderResizeGeneration = useCanvasStore((s) => s.borderResizeGeneration);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  // Determine transformer config based on selected objects
  // Subscribe to objects for rendering config only (not used in effect/callbacks)
  const objects = useObjectStore((s) => s.objects);
  const selectedObjects = selectedObjectIds
    .map((id) => objects[id])
    .filter(Boolean);

  const hasMixedTypes =
    new Set(selectedObjects.map((o) => o.type)).size > 1;
  const singleType =
    selectedObjects.length === 1 ? selectedObjects[0].type : null;

  // Determine enabled anchors based on selection
  let enabledAnchors: string[] = [];
  let keepRatio = false;

  if (!hasMixedTypes && singleType) {
    switch (singleType) {
      case "stickyNote":
        enabledAnchors = [
          "top-left",
          "top-center",
          "top-right",
          "middle-left",
          "middle-right",
          "bottom-left",
          "bottom-center",
          "bottom-right",
        ];
        break;
      case "rectangle":
        enabledAnchors = [
          "top-left",
          "top-center",
          "top-right",
          "middle-left",
          "middle-right",
          "bottom-left",
          "bottom-center",
          "bottom-right",
        ];
        break;
      case "circle":
        enabledAnchors = [
          "top-left",
          "top-center",
          "top-right",
          "middle-left",
          "middle-right",
          "bottom-left",
          "bottom-center",
          "bottom-right",
        ];
        keepRatio = true;
        break;
      case "frame":
        enabledAnchors = [
          "top-left",
          "top-center",
          "top-right",
          "middle-left",
          "middle-right",
          "bottom-left",
          "bottom-center",
          "bottom-right",
        ];
        break;
      case "colorLegend":
        enabledAnchors = ["bottom-right"];
        break;
      case "connector":
        enabledAnchors = [];
        break;
    }
  }

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;

    const currentObjects = useObjectStore.getState().objects;
    const nodes: Konva.Node[] = [];
    for (const id of selectedObjectIds) {
      if (!currentObjects[id]) continue;
      // Skip nodes being border-resized to prevent Transformer from interfering
      // with direct Konva manipulation during border resize
      if (borderResizingIds.has(id)) continue;
      const node = stage.findOne(`#${id}`);
      if (node) nodes.push(node);
    }

    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();

    // Cleanup: if selection changes mid-transform, reset any accumulated scale
    // on outgoing nodes to prevent stale scale on next interaction
    return () => {
      const cleanupObjects = useObjectStore.getState().objects;
      for (const node of nodes) {
        if (node.scaleX() !== 1 || node.scaleY() !== 1) {
          const id = node.id();
          const obj = cleanupObjects[id];
          const limits = getLimitsForType(obj?.type || "");
          const w = Math.round(node.width() * Math.abs(node.scaleX()));
          const h = Math.round(node.height() * Math.abs(node.scaleY()));
          node.scaleX(1);
          node.scaleY(1);
          node.width(Math.max(limits.minW, w));
          node.height(Math.max(limits.minH, h));
        }
      }
    };
    // borderResizeGeneration triggers re-sync when border resize starts/ends
  }, [selectedObjectIds, stageRef, borderResizeGeneration]);

  // Cleanup: ensure isTransforming is reset if component unmounts mid-transform
  useEffect(() => {
    return () => {
      setTransforming(false);
    };
  }, []);

  const handleTransformStart = useCallback(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    activeAnchorRef.current = transformer.getActiveAnchor() || null;
    setTransforming(true);
    const { startLocalEdit } = useObjectStore.getState();
    const { user, displayName } = useAuthStore.getState();
    const boardId = getBoardIdFromUrl();
    for (const node of transformer.nodes()) {
      startLocalEdit(node.id());
      if (user && boardId) {
        acquireLock(boardId, node.id(), user.uid, displayName || "Guest");
      }
    }
  }, []);

  const handleTransformEnd = useCallback(
    () => {
      const transformer = transformerRef.current;
      if (!transformer) return;

      activeAnchorRef.current = null;
      setTransforming(false);

      const currentObjects = useObjectStore.getState().objects;
      const { endLocalEdit } = useObjectStore.getState();

      for (const node of transformer.nodes()) {
        const id = node.id();
        const obj = currentObjects[id];
        if (!obj) continue;

        // Per-object limits so multi-select applies correct bounds per type
        const limits = getLimitsForType(obj.type);
        const isCircle = obj.type === "circle";

        // Use node.width()/height() — these are kept in sync by applyResizeToKonvaNode
        // during border resize and by react-konva reconciliation otherwise.
        // Avoids getClientRect which can return stale child bounding boxes after
        // direct Konva manipulation, causing anchor instability on subsequent resizes.
        let newWidth = Math.round(node.width() * Math.abs(node.scaleX()));
        let newHeight = Math.round(node.height() * Math.abs(node.scaleY()));

        // CRUCIAL: Reset scale immediately to clear Konva's transform matrix
        // before any downstream state updates
        node.scaleX(1);
        node.scaleY(1);

        // Clamp — floor raw dimensions at type minimum, cap at max
        newWidth = Math.max(limits.minW, Math.min(limits.maxW, newWidth));
        newHeight = Math.max(limits.minH, Math.min(limits.maxH, newHeight));

        // Circle constraint: keepRatio means width === height
        if (isCircle) {
          const maxDim = Math.max(newWidth, newHeight);
          newWidth = maxDim;
          newHeight = maxDim;
        }

        // Sync Konva node dimensions (React will also update via store)
        node.width(newWidth);
        node.height(newHeight);

        // CRITICAL: Sync children immediately to prevent ghost frame.
        // After scale reset, children still have old dimensions. Without this,
        // Konva may draw a frame showing the Group at scale=1 with old child
        // sizes before React reconciles with the new store values.
        syncKonvaChildren(node as Konva.Group, obj.type, newWidth, newHeight);

        const newX = Math.round(node.x());
        const newY = Math.round(node.y());
        node.x(newX);
        node.y(newY);

        // Persist to local store and Firestore
        const updates = {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
        };

        updateObjectLocal(id, updates);
        updateObject(getBoardIdFromUrl(), id, updates).catch(console.error);

        // Release local edit guard and soft lock after persisting
        endLocalEdit(id);
        const boardId = getBoardIdFromUrl();
        if (boardId) {
          releaseLock(boardId, id);
        }
      }

      // Force a synchronous draw of the objects layer to paint correct dimensions
      // before the React re-render cycle. Prevents the ghost frame where
      // scale=1 but children have stale sizes.
      transformer.getLayer()?.batchDraw();
    },
    [updateObjectLocal]
  );

  return (
    <Transformer
      ref={transformerRef}
      enabledAnchors={enabledAnchors}
      rotateEnabled={false}
      keepRatio={keepRatio}
      flipEnabled={false}
      centeredScaling={false}
      ignoreStroke={true}
      borderStroke="#2196F3"
      borderStrokeWidth={2}
      anchorFill="#ffffff"
      anchorStroke="#2196F3"
      anchorSize={8}
      anchorCornerRadius={2}
      onTransformStart={handleTransformStart}
      onTransformEnd={handleTransformEnd}
      boundBoxFunc={(oldBox, newBox) => {
        const limits = getLimitsForType(singleType || "");
        const clamped = { ...newBox };
        const { xFixed, yFixed } = getFixedEdges(activeAnchorRef.current);

        // Normalize: ensure positive dimensions (prevents flipping artifacts
        // when user drags handle past the opposite edge quickly)
        clamped.width = Math.abs(clamped.width);
        clamped.height = Math.abs(clamped.height);

        // Clamp width to min/max, adjusting position based on which edge is fixed
        if (clamped.width < limits.minW) {
          if (xFixed === false) {
            // Right edge is fixed (user dragging left side) — adjust x
            clamped.x = oldBox.x + oldBox.width - limits.minW;
          }
          clamped.width = limits.minW;
        }
        if (clamped.width > limits.maxW) {
          if (xFixed === false) {
            clamped.x = oldBox.x + oldBox.width - limits.maxW;
          }
          clamped.width = limits.maxW;
        }

        // Clamp height to min/max, adjusting position based on which edge is fixed
        if (clamped.height < limits.minH) {
          if (yFixed === false) {
            // Bottom edge is fixed (user dragging top side) — adjust y
            clamped.y = oldBox.y + oldBox.height - limits.minH;
          }
          clamped.height = limits.minH;
        }
        if (clamped.height > limits.maxH) {
          if (yFixed === false) {
            clamped.y = oldBox.y + oldBox.height - limits.maxH;
          }
          clamped.height = limits.maxH;
        }

        return clamped;
      }}
    />
  );
}

function getBoardIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/");
  const boardIdx = parts.indexOf("board");
  return boardIdx >= 0 && parts[boardIdx + 1] ? parts[boardIdx + 1] : "";
}
