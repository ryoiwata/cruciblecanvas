"use client";

import { useState } from "react";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
import { STICKY_NOTE_COLORS } from "@/lib/types";

interface ColorPickerProps {
  boardId: string;
}

export default function ColorPicker({ boardId }: ColorPickerProps) {
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const [expanded, setExpanded] = useState(false);
  const [hexInput, setHexInput] = useState("");

  if (selectedObjectIds.length === 0) return null;

  // Don't show for connectors
  const selectedObjects = selectedObjectIds
    .map((id) => objects[id])
    .filter(Boolean);
  if (selectedObjects.every((o) => o.type === "connector")) return null;

  const applyColor = (color: string) => {
    for (const id of selectedObjectIds) {
      const obj = objects[id];
      if (!obj || obj.type === "connector") continue;
      updateObjectLocal(id, { color });
      updateObject(boardId, id, { color }).catch(console.error);
    }
  };

  const handleHexApply = () => {
    const color = hexInput.startsWith("#") ? hexInput : `#${hexInput}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      applyColor(color);
      setHexInput("");
      setExpanded(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
      {/* Quick-access swatches */}
      <div className="flex gap-1.5">
        {STICKY_NOTE_COLORS.map((color) => (
          <button
            key={color}
            onClick={() => applyColor(color)}
            className="h-7 w-7 rounded-full border-2 border-gray-200 transition-transform hover:scale-110 hover:border-gray-400"
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-gray-200 text-xs text-gray-500 hover:bg-gray-100"
          title="Custom color"
        >
          #
        </button>
      </div>

      {/* Power mode */}
      {expanded && (
        <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2">
          <div
            className="h-7 w-7 rounded border border-gray-300"
            style={{
              backgroundColor: hexInput.startsWith("#")
                ? hexInput
                : `#${hexInput}`,
            }}
          />
          <input
            type="text"
            value={hexInput}
            onChange={(e) => setHexInput(e.target.value)}
            placeholder="#FEFF9C"
            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleHexApply();
            }}
          />
          <button
            onClick={handleHexApply}
            className="rounded bg-indigo-500 px-2 py-1 text-xs text-white hover:bg-indigo-600"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
