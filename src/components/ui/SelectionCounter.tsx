"use client";

import { useCanvasStore } from "@/lib/store/canvasStore";

export default function SelectionCounter() {
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const count = selectedObjectIds.length;

  if (count === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 rounded-md bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur-sm">
      <span className="text-xs font-medium text-gray-600">
        {count} item{count !== 1 ? "s" : ""} selected
      </span>
    </div>
  );
}
