"use client";

import { useEffect, useRef, useCallback } from "react";
import { Transformer } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";

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
      return { minW: 20, minH: 20, maxW: 4000, maxH: 4000 };
  }
}

interface SelectionLayerProps {
  stageRef: React.RefObject<Konva.Stage | null>;
}

export default function SelectionLayer({ stageRef }: SelectionLayerProps) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  // Determine transformer config based on selected objects
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

    const nodes: Konva.Node[] = [];
    for (const id of selectedObjectIds) {
      if (!objects[id]) continue;
      const node = stage.findOne(`#${id}`);
      if (node) nodes.push(node);
    }

    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedObjectIds, objects, stageRef]);

  const handleTransformEnd = useCallback(
    () => {
      const transformer = transformerRef.current;
      if (!transformer) return;

      for (const node of transformer.nodes()) {
        const id = node.id();
        const obj = objects[id];
        if (!obj) continue;

        // Per-object limits so multi-select applies correct bounds per type
        const limits = getLimitsForType(obj.type);
        const isCircle = obj.type === "circle";

        // Atomic dimension calculation from current scale
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

        // Apply final dimensions to the Konva node
        node.width(newWidth);
        node.height(newHeight);

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
      }
    },
    [objects, updateObjectLocal]
  );

  return (
    <Transformer
      ref={transformerRef}
      enabledAnchors={enabledAnchors}
      rotateEnabled={false}
      keepRatio={keepRatio}
      flipEnabled={false}
      centeredScaling={false}
      borderStroke="#2196F3"
      borderStrokeWidth={2}
      anchorFill="#ffffff"
      anchorStroke="#2196F3"
      anchorSize={8}
      anchorCornerRadius={2}
      onTransformEnd={handleTransformEnd}
      boundBoxFunc={(oldBox, newBox) => {
        const limits = getLimitsForType(singleType || "");

        // Reject transform when dimensions go below minimum or negative
        // (happens when user drags handle past the opposite edge quickly)
        if (newBox.width < limits.minW || newBox.height < limits.minH) {
          return oldBox;
        }

        // Clamp to maximum
        const clamped = { ...newBox };
        clamped.width = Math.min(limits.maxW, clamped.width);
        clamped.height = Math.min(limits.maxH, clamped.height);
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
