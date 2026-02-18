"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";

interface ArrangeMenuProps {
  boardId: string;
}

type LayerAction = "bringForward" | "bringToFront" | "sendBackward" | "sendToBack";

// --- SVG Icons ---
function BringForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="5" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="white" />
      <path d="M9 3.5V6.5M7.5 5H10.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function BringToFrontIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="5" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="white" />
      <path d="M9 2.5V6.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7.5 4L9 2.5L10.5 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendBackwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="1" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="white" />
      <path d="M5 7.5V10.5M3.5 9H6.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function SendToBackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="1" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="white" />
      <path d="M5 8V12" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 10.5L5 12L6.5 10.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface MenuItem {
  action: LayerAction;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
}

const items: MenuItem[] = [
  { action: "bringForward", label: "Bring Forward", icon: <BringForwardIcon />, shortcut: "Ctrl+]" },
  { action: "bringToFront", label: "Bring to Front", icon: <BringToFrontIcon />, shortcut: "Ctrl+Shift+]" },
  { action: "sendBackward", label: "Send Backward", icon: <SendBackwardIcon />, shortcut: "Ctrl+[" },
  { action: "sendToBack", label: "Send to Back", icon: <SendToBackIcon />, shortcut: "Ctrl+Shift+[" },
];

/** Shared layering logic — also called from keyboard shortcuts. */
export function performLayerAction(
  action: LayerAction,
  selectedObjectIds: string[],
  objects: Record<string, import("@/lib/types").BoardObject>,
  updateObjectLocal: (id: string, updates: Partial<import("@/lib/types").BoardObject>) => void,
  boardId: string
) {
  if (selectedObjectIds.length === 0) return;

  // Gather all non-connector objects for z-ordering context
  const allLayered = Object.values(objects).filter((o) => o.type !== "connector");

  // Compute current max/min zIndex
  let maxZ = 0;
  let minZ = 0;
  for (const o of allLayered) {
    const z = o.zIndex ?? 0;
    if (z > maxZ) maxZ = z;
    if (z < minZ) minZ = z;
  }

  for (const id of selectedObjectIds) {
    const obj = objects[id];
    if (!obj || obj.type === "connector") continue;

    let newZ: number;
    switch (action) {
      case "bringToFront":
        newZ = maxZ + 1;
        maxZ = newZ; // in case multiple selected objects
        break;
      case "sendToBack":
        newZ = minZ - 1;
        minZ = newZ;
        break;
      case "bringForward":
        newZ = (obj.zIndex ?? 0) + 1;
        break;
      case "sendBackward":
        newZ = (obj.zIndex ?? 0) - 1;
        break;
    }

    updateObjectLocal(id, { zIndex: newZ });
    updateObject(boardId, id, { zIndex: newZ }).catch(console.error);
  }
}

export default function ArrangeMenu({ boardId }: ArrangeMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const hasSelection = selectedObjectIds.length > 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        popupRef.current && !popupRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const perform = useCallback(
    (action: LayerAction) => {
      performLayerAction(action, selectedObjectIds, objects, updateObjectLocal, boardId);
      setOpen(false);
    },
    [selectedObjectIds, objects, updateObjectLocal, boardId]
  );

  const triggerRef = useRef<HTMLButtonElement>(null);

  const getPopupStyle = (): React.CSSProperties => {
    if (!triggerRef.current) return { display: "none" };
    const rect = triggerRef.current.getBoundingClientRect();
    const popupWidth = 240; // w-60
    let left = rect.left + rect.width / 2 - popupWidth / 2;
    if (left < 8) left = 8;
    if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - 8 - popupWidth;
    let bottom = window.innerHeight - rect.top + 8;
    if (bottom > window.innerHeight - 16) bottom = window.innerHeight - 16;
    return { position: "fixed", left, bottom, width: popupWidth, zIndex: 200 };
  };

  const getArrowStyle = (): React.CSSProperties => {
    if (!triggerRef.current) return { display: "none" };
    const rect = triggerRef.current.getBoundingClientRect();
    const popupStyle = getPopupStyle();
    const arrowLeft = rect.left + rect.width / 2 - (popupStyle.left as number) - 6;
    return { left: arrowLeft };
  };

  return (
    <div ref={menuRef}>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        disabled={!hasSelection}
        title="Arrange (Layer order)"
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          hasSelection
            ? "text-gray-600 hover:bg-gray-100"
            : "cursor-not-allowed text-gray-300"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="7" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <rect x="7" y="1" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
        <span className="hidden sm:inline">Arrange</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popupRef}
            style={getPopupStyle()}
            className="rounded-xl border border-white/20 bg-white/80 py-1 shadow-xl backdrop-blur-lg transition-all"
          >
            {/* Downward-pointing arrow nub */}
            <div
              className="absolute -bottom-[6px] h-3 w-3 rotate-45 border-b border-r border-white/20 bg-white/80 backdrop-blur-lg"
              style={getArrowStyle()}
            />

            {items.map((item) => (
              <button
                key={item.action}
                onClick={() => perform(item.action)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50/60"
              >
                <span className="text-gray-500">{item.icon}</span>
                <span className="flex-1 text-left">{item.label}</span>
                <kbd className="text-[10px] font-mono text-gray-400">{item.shortcut}</kbd>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
