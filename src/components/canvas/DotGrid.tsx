"use client";

import { Shape } from "react-konva";
import { GRID_SIZE } from "@/lib/types";

interface DotGridProps {
  stageX: number;
  stageY: number;
  stageScale: number;
  width: number;
  height: number;
}

/**
 * Infinite dot grid background rendered on a static layer (listening={false}).
 *
 * Adaptive density: reduces dots at low zoom to maintain performance.
 * At scale < 0.1, grid is hidden entirely.
 */
export default function DotGrid({
  stageX,
  stageY,
  stageScale,
  width,
  height,
}: DotGridProps) {
  return (
    <Shape
      sceneFunc={(context) => {
        // Hide grid at extreme zoom-out to avoid rendering millions of dots
        if (stageScale < 0.1) return;

        // Adaptive step: show fewer dots at low zoom
        let step = GRID_SIZE;
        if (stageScale < 0.2) {
          step = GRID_SIZE * 5;
        } else if (stageScale < 0.4) {
          step = GRID_SIZE * 2;
        }

        // Calculate visible area in canvas-space
        const vpLeft = -stageX / stageScale;
        const vpTop = -stageY / stageScale;
        const vpRight = vpLeft + width / stageScale;
        const vpBottom = vpTop + height / stageScale;

        // Align start to grid
        const startX = Math.floor(vpLeft / step) * step;
        const startY = Math.floor(vpTop / step) * step;

        // Dot style
        const dotRadius = 1 / stageScale; // Keep dots visually consistent across zoom
        const clampedRadius = Math.max(0.5, Math.min(dotRadius, 2));

        context.fillStyle = "#d0d0d0";

        for (let x = startX; x <= vpRight; x += step) {
          for (let y = startY; y <= vpBottom; y += step) {
            context.beginPath();
            context.arc(x, y, clampedRadius, 0, Math.PI * 2);
            context.fill();
          }
        }
      }}
      listening={false}
    />
  );
}
