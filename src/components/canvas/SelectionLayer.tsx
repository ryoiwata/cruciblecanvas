"use client";

import { useEffect, useRef, useCallback } from "react";
import { Transformer } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
import { snapToGrid } from "@/lib/utils";
import {
  SHAPE_SIZE_LIMITS,
  FRAME_SIZE_LIMITS,
  STICKY_NOTE_SIZE_LIMITS,
} from "@/lib/types";

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
        // Allow height resize from bottom only
        enabledAnchors = ["bottom-center", "bottom-right"];
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
          "top-right",
          "bottom-left",
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

  // Get size limits for the selected type
  const getSizeLimits = useCallback(() => {
    if (!singleType)
      return { minW: 20, minH: 20, maxW: 4000, maxH: 4000 };
    switch (singleType) {
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
  }, [singleType]);

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

  const handleTransformEnd = useCallback(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const limits = getSizeLimits();

    for (const node of transformer.nodes()) {
      const id = node.id();
      const obj = objects[id];
      if (!obj) continue;

      // Compute actual size from scale
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      let newWidth = Math.round(node.width() * scaleX);
      let newHeight = Math.round(node.height() * scaleY);

      // Clamp
      newWidth = Math.max(limits.minW, Math.min(limits.maxW, newWidth));
      newHeight = Math.max(limits.minH, Math.min(limits.maxH, newHeight));

      // Snap
      newWidth = snapToGrid(newWidth);
      newHeight = snapToGrid(newHeight);
      if (newWidth < limits.minW) newWidth = limits.minW;
      if (newHeight < limits.minH) newHeight = limits.minH;

      // Reset scale
      node.scaleX(1);
      node.scaleY(1);
      node.width(newWidth);
      node.height(newHeight);

      const newX = snapToGrid(node.x());
      const newY = snapToGrid(node.y());
      node.x(newX);
      node.y(newY);

      updateObjectLocal(id, {
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      });

      updateObject(
        // boardId is not directly available here, so we get it from URL
        // This is a simplification — in practice, boardId should be passed as a prop
        getBoardIdFromUrl(),
        id,
        { x: newX, y: newY, width: newWidth, height: newHeight }
      ).catch(console.error);
    }
  }, [objects, getSizeLimits, updateObjectLocal]);

  return (
    <Transformer
      ref={transformerRef}
      enabledAnchors={enabledAnchors}
      rotateEnabled={false}
      keepRatio={keepRatio}
      borderStroke="#2196F3"
      borderStrokeWidth={2}
      anchorFill="#ffffff"
      anchorStroke="#2196F3"
      anchorSize={8}
      anchorCornerRadius={2}
      onTransformEnd={handleTransformEnd}
      boundBoxFunc={(oldBox, newBox) => {
        const limits = getSizeLimits();
        if (
          newBox.width < limits.minW ||
          newBox.height < limits.minH ||
          newBox.width > limits.maxW ||
          newBox.height > limits.maxH
        ) {
          return oldBox;
        }
        return newBox;
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
