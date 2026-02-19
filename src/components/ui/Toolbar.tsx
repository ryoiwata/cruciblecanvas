"use client";

import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
import type { ObjectType, StickyFontFamily } from "@/lib/types";
import AlignMenu from "./AlignMenu";
import ArrangeMenu from "./ArrangeMenu";
import ColorPickerPopup from "./ColorPickerPopup";

interface ToolbarProps {
  boardId: string;
}

interface Tool {
  id: string;
  label: string;
  icon: string;
  mode: "pointer" | "create";
  creationTool?: ObjectType;
  shortcut: string;
}

const tools: Tool[] = [
  { id: "pointer", label: "Pointer", icon: "\u2196", mode: "pointer", shortcut: "1" },
  {
    id: "stickyNote",
    label: "Sticky Note",
    icon: "\ud83d\udcdd",
    mode: "create",
    creationTool: "stickyNote",
    shortcut: "2",
  },
  {
    id: "rectangle",
    label: "Rectangle",
    icon: "\u25fb",
    mode: "create",
    creationTool: "rectangle",
    shortcut: "3",
  },
  {
    id: "circle",
    label: "Circle",
    icon: "\u25cb",
    mode: "create",
    creationTool: "circle",
    shortcut: "4",
  },
  {
    id: "frame",
    label: "Frame",
    icon: "\u25a3",
    mode: "create",
    creationTool: "frame",
    shortcut: "5",
  },
  {
    id: "connector",
    label: "Connector",
    icon: "\u2571",
    mode: "create",
    creationTool: "connector",
    shortcut: "6",
  },
];

export default function Toolbar({ boardId }: ToolbarProps) {
  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const setMode = useCanvasStore((s) => s.setMode);
  const enterCreateMode = useCanvasStore((s) => s.enterCreateMode);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  // Selected sticky notes (for font selector)
  const selectedStickies = selectedObjectIds
    .map((id) => objects[id])
    .filter((o) => o && o.type === "stickyNote");

  // Compute average opacity of selected non-connector objects
  const selectedNonConnectors = selectedObjectIds
    .map((id) => objects[id])
    .filter((o) => o && o.type !== "connector");
  const avgOpacity =
    selectedNonConnectors.length > 0
      ? selectedNonConnectors.reduce((sum, o) => sum + (o.opacity ?? 1), 0) /
        selectedNonConnectors.length
      : 1;

  const handleFontChange = (font: StickyFontFamily) => {
    for (const obj of selectedStickies) {
      updateObjectLocal(obj.id, { fontFamily: font });
      updateObject(boardId, obj.id, { fontFamily: font }).catch(console.error);
    }
  };

  const handleOpacityChange = (value: number) => {
    const opacity = Math.round(value) / 100;
    for (const obj of selectedNonConnectors) {
      updateObjectLocal(obj.id, { opacity });
      updateObject(boardId, obj.id, { opacity }).catch(console.error);
    }
  };

  const isActive = (tool: Tool) => {
    if (tool.mode === "create") {
      return mode === "create" && creationTool === tool.creationTool;
    }
    return mode === tool.mode;
  };

  const handleClick = (tool: Tool) => {
    if (tool.creationTool) {
      enterCreateMode(tool.creationTool);
    } else {
      setMode(tool.mode);
    }
  };

  return (
    <div className="fixed left-4 top-1/2 z-50 flex -translate-y-1/2 flex-col items-stretch gap-0.5 rounded-xl bg-white/80 px-1.5 py-2 shadow-lg backdrop-blur-md">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => handleClick(tool)}
          title={`${tool.label} (${tool.shortcut})`}
          className={`flex h-9 w-9 items-center justify-center rounded-md text-base font-medium transition-colors ${
            isActive(tool)
              ? "bg-indigo-100 text-indigo-600"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>{tool.icon}</span>
        </button>
      ))}

      {/* Separator */}
      <div className="my-0.5 h-px w-full bg-gray-200" />

      {/* Color picker */}
      <div className="flex items-center justify-center">
        <ColorPickerPopup boardId={boardId} />
      </div>

      {/* Separator */}
      <div className="my-0.5 h-px w-full bg-gray-200" />

      {/* Align & Arrange dropdowns */}
      <AlignMenu boardId={boardId} />
      <ArrangeMenu boardId={boardId} />

      {/* Font selector (visible when sticky notes are selected) */}
      {selectedStickies.length > 0 && (
        <>
          <div className="my-0.5 h-px w-full bg-gray-200" />
          <div className="flex flex-col gap-1 px-0.5">
            <span className="text-center text-[10px] text-gray-500">Font</span>
            <select
              value={selectedStickies[0].fontFamily || "sans-serif"}
              onChange={(e) => handleFontChange(e.target.value as StickyFontFamily)}
              className="w-full rounded border border-gray-200 bg-white px-1 py-0.5 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none"
            >
              <option value="sans-serif">Sans</option>
              <option value="handwritten">Hand</option>
              <option value="monospace">Mono</option>
            </select>
          </div>
        </>
      )}

      {/* Opacity slider (visible when non-connector objects are selected) */}
      {selectedNonConnectors.length > 0 && (
        <>
          <div className="my-0.5 h-px w-full bg-gray-200" />
          <div className="flex flex-col items-center gap-1 px-0.5">
            <span className="text-[10px] text-gray-500">Opacity</span>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(avgOpacity * 100)}
              onChange={(e) => handleOpacityChange(Number(e.target.value))}
              className="h-1 w-full cursor-pointer accent-indigo-500"
            />
            <span className="text-[10px] tabular-nums text-gray-400">
              {Math.round(avgOpacity * 100)}%
            </span>
          </div>
        </>
      )}
    </div>
  );
}
