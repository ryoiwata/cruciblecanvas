"use client";

import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
import type { ObjectType } from "@/lib/types";
import AlignMenu from "./AlignMenu";
import ArrangeMenu from "./ArrangeMenu";

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

  // Compute average opacity of selected non-connector objects
  const selectedNonConnectors = selectedObjectIds
    .map((id) => objects[id])
    .filter((o) => o && o.type !== "connector");
  const avgOpacity =
    selectedNonConnectors.length > 0
      ? selectedNonConnectors.reduce((sum, o) => sum + (o.opacity ?? 1), 0) /
        selectedNonConnectors.length
      : 1;

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
    <div className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-white/80 px-2 py-1.5 shadow-md backdrop-blur-md">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => handleClick(tool)}
          title={`${tool.label} (${tool.shortcut})`}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            isActive(tool)
              ? "bg-indigo-100 text-indigo-600"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>{tool.icon}</span>
          <span className="hidden sm:inline">{tool.label}</span>
        </button>
      ))}

      {/* Separator */}
      <div className="mx-1 h-6 w-px bg-gray-200" />

      {/* Align & Arrange dropdowns */}
      <AlignMenu boardId={boardId} />
      <ArrangeMenu boardId={boardId} />

      {/* Opacity slider (visible when non-connector objects are selected) */}
      {selectedNonConnectors.length > 0 && (
        <>
          <div className="mx-1 h-6 w-px bg-gray-200" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Opacity</span>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(avgOpacity * 100)}
              onChange={(e) => handleOpacityChange(Number(e.target.value))}
              className="h-1 w-20 cursor-pointer accent-indigo-500"
            />
            <span className="text-xs text-gray-400 w-7 text-right tabular-nums">
              {Math.round(avgOpacity * 100)}%
            </span>
          </div>
        </>
      )}
    </div>
  );
}
