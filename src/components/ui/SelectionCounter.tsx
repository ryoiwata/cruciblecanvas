"use client";

import { useCanvasStore } from "@/lib/store/canvasStore";

/**
 * SelectionCounter — inline pill showing how many objects are currently selected.
 * Renders without any positional styles; positioning is handled by the parent
 * info-stack container in board/[boardId]/page.tsx.
 */
export default function SelectionCounter() {
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const count = selectedObjectIds.length;

  if (count === 0) return null;

  return (
    <div className="rounded-md bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur-sm">
      <span className="text-xs font-medium text-gray-600">
        {count} item{count !== 1 ? "s" : ""} selected
      </span>
    </div>
  );
}
