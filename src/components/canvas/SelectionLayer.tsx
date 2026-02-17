"use client";

import { useEffect, useRef } from "react";
import { Transformer } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";

interface SelectionLayerProps {
  stageRef: React.RefObject<Konva.Stage | null>;
}

/**
 * Phase 2 skeleton: renders Konva Transformer attached to selected object nodes.
 * Drag-rectangle multi-select is deferred to Phase 3.
 */
export default function SelectionLayer({ stageRef }: SelectionLayerProps) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;

    // Find Konva nodes matching selected IDs that still exist in the store
    const nodes: Konva.Node[] = [];
    for (const id of selectedObjectIds) {
      if (!objects[id]) continue; // Object was deleted by another user
      const node = stage.findOne(`#${id}`);
      if (node) nodes.push(node);
    }

    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedObjectIds, objects, stageRef]);

  return (
    <Transformer
      ref={transformerRef}
      // Phase 2: disable resize (sticky notes are fixed size)
      enabledAnchors={[]}
      rotateEnabled={false}
      borderStroke="#2196F3"
      borderStrokeWidth={2}
    />
  );
}
