"use client";

import { useState } from "react";
import { useCanvasStore } from "@/lib/store/canvasStore";
import type { ObjectType } from "@/lib/types";
import AlignMenu from "./AlignMenu";
import ArrangeMenu from "./ArrangeMenu";

interface ToolbarProps {
  boardId: string; // kept for AlignMenu / ArrangeMenu which need it
}

interface Tool {
  id: string;
  label: string;
  icon: React.ReactNode;
  mode: "pointer" | "create";
  creationTool?: ObjectType;
  shortcut: string;
}

/** SVG icon showing two boxes connected by a horizontal line. */
const ConnectorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="0.75" y="5" width="4.5" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="10.75" y="5" width="4.5" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <line x1="5.25" y1="8" x2="10.75" y2="8" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** SVG icon showing a diagonal line with circular endpoints. */
const LineIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="2.5" cy="13.5" r="1.5" fill="currentColor" />
    <circle cx="13.5" cy="2.5" r="1.5" fill="currentColor" />
  </svg>
);

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
    id: "line",
    label: "Line",
    icon: <LineIcon />,
    mode: "create",
    creationTool: "line",
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
    icon: <ConnectorIcon />,
    mode: "create",
    creationTool: "connector",
    shortcut: "7",
  },
  {
    id: "text",
    label: "Text",
    icon: <span className="font-bold text-base leading-none">T</span>,
    mode: "create",
    creationTool: "text",
    shortcut: "8",
  },
];

export default function Toolbar({ boardId }: ToolbarProps) {
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);

  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const setMode = useCanvasStore((s) => s.setMode);
  const enterCreateMode = useCanvasStore((s) => s.enterCreateMode);

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
          onMouseEnter={() => setHoveredToolId(tool.id)}
          onMouseLeave={() => setHoveredToolId(null)}
          title={`${tool.label} (${tool.shortcut})`}
          className={`relative flex h-9 w-9 items-center justify-center rounded-md text-base font-medium transition-colors ${
            isActive(tool)
              ? "bg-indigo-100 text-indigo-600"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>{tool.icon}</span>
          {hoveredToolId === tool.id && (
            <span className="pointer-events-none absolute left-full ml-2 z-50 flex items-center gap-1.5 whitespace-nowrap rounded-md bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
              {tool.label}
              <kbd className="rounded border border-white/20 bg-white/10 px-1 font-mono text-[10px]">
                {tool.shortcut}
              </kbd>
            </span>
          )}
        </button>
      ))}

      {/* Separator */}
      <div className="my-0.5 h-px w-full bg-gray-200" />

      {/* Align & Arrange dropdowns */}
      <AlignMenu boardId={boardId} />
      <ArrangeMenu boardId={boardId} />
    </div>
  );
}
