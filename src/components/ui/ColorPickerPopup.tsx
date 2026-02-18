"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
import { STICKY_NOTE_COLORS } from "@/lib/types";

interface ColorPickerPopupProps {
  boardId: string;
}

const COLOR_PRESETS = [
  ...STICKY_NOTE_COLORS,
  "#FEF3C7", // Light Yellow (default)
  "#E3E8EF", // Light Gray
  "#BFDBFE", // Light Blue
  "#BBF7D0", // Light Green
  "#FECACA", // Light Red
  "#E9D5FF", // Light Purple
  "#FFFFFF", // White
];

export default function ColorPickerPopup({ boardId }: ColorPickerPopupProps) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const activeColor = useCanvasStore((s) => s.activeColor);
  const setActiveColor = useCanvasStore((s) => s.setActiveColor);
  const setLastUsedColor = useCanvasStore((s) => s.setLastUsedColor);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const applyColor = useCallback(
    (color: string) => {
      setActiveColor(color);

      // Also apply to any selected objects
      if (selectedObjectIds.length > 0) {
        for (const id of selectedObjectIds) {
          const obj = objects[id];
          if (!obj || obj.type === "connector") continue;
          updateObjectLocal(id, { color });
          updateObject(boardId, id, { color }).catch(console.error);
          setLastUsedColor(obj.type, color);
        }
      }
    },
    [selectedObjectIds, objects, updateObjectLocal, boardId, setActiveColor, setLastUsedColor]
  );

  const handleHexApply = () => {
    const color = hexInput.startsWith("#") ? hexInput : `#${hexInput}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      applyColor(color);
      setHexInput("");
    }
  };

  // Calculate popup position (above the trigger button)
  const getPopupStyle = (): React.CSSProperties => {
    if (!triggerRef.current) return { display: "none" };
    const rect = triggerRef.current.getBoundingClientRect();
    const popupWidth = 260;
    let left = rect.left + rect.width / 2 - popupWidth / 2;

    // Clamp to viewport edges
    if (left < 8) left = 8;
    if (left + popupWidth > window.innerWidth - 8) {
      left = window.innerWidth - 8 - popupWidth;
    }

    // Position above the toolbar, ensure it doesn't go above viewport
    let bottom = window.innerHeight - rect.top + 8;
    if (bottom > window.innerHeight - 16) {
      bottom = window.innerHeight - 16;
    }

    return {
      position: "fixed" as const,
      left,
      bottom,
      width: popupWidth,
      zIndex: 200,
    };
  };

  // Arrow nub position
  const getArrowStyle = (): React.CSSProperties => {
    if (!triggerRef.current) return { display: "none" };
    const rect = triggerRef.current.getBoundingClientRect();
    const popupStyle = getPopupStyle();
    const arrowLeft = rect.left + rect.width / 2 - (popupStyle.left as number) - 6;
    return { left: arrowLeft };
  };

  return (
    <>
      {/* Compact circular color indicator */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        title="Color Picker"
        className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-gray-100"
      >
        <span
          className="block h-6 w-6 rounded-full border border-black/10 shadow-sm transition-transform hover:scale-110"
          style={{ backgroundColor: activeColor }}
        />
      </button>

      {/* Portal-rendered popup */}
      {open &&
        createPortal(
          <div
            ref={popupRef}
            style={getPopupStyle()}
            className="animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-white/20 bg-white/80 p-3 shadow-xl backdrop-blur-lg"
          >
            {/* Downward-pointing arrow nub */}
            <div
              className="absolute -bottom-[6px] h-3 w-3 rotate-45 border-b border-r border-white/20 bg-white/80 backdrop-blur-lg"
              style={getArrowStyle()}
            />

            {/* Color presets grid */}
            <div className="mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Presets
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    onClick={() => applyColor(color)}
                    className={`h-7 w-7 rounded-full border-2 transition-all hover:scale-110 ${
                      activeColor === color
                        ? "border-indigo-500 ring-2 ring-indigo-200"
                        : "border-black/10 hover:border-gray-400"
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>

            {/* Hex input */}
            <div className="mb-3 border-t border-gray-200/60 pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Hex Code
              </div>
              <div className="flex items-center gap-1.5">
                <div
                  className="h-7 w-7 flex-shrink-0 rounded border border-black/10"
                  style={{
                    backgroundColor:
                      /^#?[0-9A-Fa-f]{6}$/.test(hexInput)
                        ? hexInput.startsWith("#")
                          ? hexInput
                          : `#${hexInput}`
                        : activeColor,
                  }}
                />
                <input
                  type="text"
                  value={hexInput}
                  onChange={(e) => setHexInput(e.target.value)}
                  placeholder={activeColor}
                  className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleHexApply();
                  }}
                />
                <button
                  onClick={handleHexApply}
                  className="rounded bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-600 transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Color wheel */}
            <div className="border-t border-gray-200/60 pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Color Wheel
              </div>
              <HexColorPicker
                color={activeColor}
                onChange={applyColor}
                style={{ width: "100%", height: 150 }}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
