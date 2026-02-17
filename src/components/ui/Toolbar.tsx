"use client";

import { useCanvasStore } from "@/lib/store/canvasStore";
import type { ObjectType } from "@/lib/types";

interface Tool {
  id: string;
  label: string;
  icon: string;
  mode: "pan" | "select" | "create";
  creationTool?: ObjectType;
  shortcut: string;
}

const tools: Tool[] = [
  { id: "pan", label: "Pan", icon: "\u270b", mode: "pan", shortcut: "1" },
  { id: "select", label: "Select", icon: "\u2196", mode: "select", shortcut: "2" },
  {
    id: "stickyNote",
    label: "Sticky Note",
    icon: "\ud83d\udcdd",
    mode: "create",
    creationTool: "stickyNote",
    shortcut: "3",
  },
  {
    id: "rectangle",
    label: "Rectangle",
    icon: "\u25fb",
    mode: "create",
    creationTool: "rectangle",
    shortcut: "4",
  },
  {
    id: "circle",
    label: "Circle",
    icon: "\u25cb",
    mode: "create",
    creationTool: "circle",
    shortcut: "5",
  },
  {
    id: "frame",
    label: "Frame",
    icon: "\u25a3",
    mode: "create",
    creationTool: "frame",
    shortcut: "6",
  },
  {
    id: "connector",
    label: "Connector",
    icon: "\u2571",
    mode: "create",
    creationTool: "connector",
    shortcut: "7",
  },
];

export default function Toolbar() {
  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const setMode = useCanvasStore((s) => s.setMode);
  const enterCreateMode = useCanvasStore((s) => s.enterCreateMode);

  // Keyboard shortcuts are now handled by useKeyboardShortcuts hook

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
    </div>
  );
}
