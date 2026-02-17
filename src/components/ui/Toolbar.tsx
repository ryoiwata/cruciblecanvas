"use client";

import { useEffect } from "react";
import { useCanvasStore } from "@/lib/store/canvasStore";
import type { CanvasMode } from "@/lib/store/canvasStore";

interface Tool {
  id: string;
  label: string;
  icon: string;
  mode: CanvasMode;
  creationTool?: "stickyNote";
  shortcut: string;
}

const tools: Tool[] = [
  { id: "pan", label: "Pan", icon: "✋", mode: "pan", shortcut: "1" },
  { id: "select", label: "Select", icon: "↖", mode: "select", shortcut: "2" },
  {
    id: "stickyNote",
    label: "Sticky Note",
    icon: "📝",
    mode: "create",
    creationTool: "stickyNote",
    shortcut: "3",
  },
];

export default function Toolbar() {
  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const setMode = useCanvasStore((s) => s.setMode);
  const enterCreateMode = useCanvasStore((s) => s.enterCreateMode);
  const exitToPan = useCanvasStore((s) => s.exitToPan);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire when typing in input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      switch (e.key) {
        case "1":
          setMode("pan");
          break;
        case "2":
          setMode("select");
          break;
        case "3":
          enterCreateMode("stickyNote");
          break;
        case "Escape":
          exitToPan();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setMode, enterCreateMode, exitToPan]);

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
          <span>{tool.label}</span>
        </button>
      ))}
    </div>
  );
}
