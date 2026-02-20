"use client";

import { useState } from "react";
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
];

export default function Toolbar({ boardId }: ToolbarProps) {
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);

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

  // Selected lines and connectors (for thickness slider)
  const selectedLines = selectedObjectIds
    .map((id) => objects[id])
    .filter((o) => o && (o.type === 'line' || o.type === 'connector'));

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

  const handleThicknessChange = (value: number) => {
    for (const obj of selectedLines) {
      updateObjectLocal(obj.id, { thickness: value });
      updateObject(boardId, obj.id, { thickness: value }).catch(console.error);
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

      {/* Thickness slider (visible when lines or connectors are selected) */}
      {selectedLines.length > 0 && (
        <>
          <div className="my-0.5 h-px w-full bg-gray-200" />
          <div className="flex flex-col gap-1 px-0.5">
            <span className="text-center text-[10px] text-gray-500">Thickness</span>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={selectedLines[0].thickness ?? 2}
              onChange={(e) => handleThicknessChange(Number(e.target.value))}
              className="h-1 w-full cursor-pointer accent-indigo-500"
            />
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
