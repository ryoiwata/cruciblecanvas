"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";

interface AlignMenuProps {
  boardId: string;
}

type AlignAction =
  | "alignLeft"
  | "alignCenterH"
  | "alignRight"
  | "alignTop"
  | "alignMiddle"
  | "alignBottom"
  | "distributeH"
  | "distributeV";

interface MenuItem {
  action: AlignAction;
  label: string;
  icon: React.ReactNode;
  minObjects: number;
}

// --- SVG Icons ---
function AlignLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="1" x2="2" y2="15" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="3" width="8" height="3" rx="0.5" fill="currentColor" />
      <rect x="4" y="9" width="10" height="3" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function AlignCenterHIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="8" y1="1" x2="8" y2="15" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1" />
      <rect x="3" y="3" width="10" height="3" rx="0.5" fill="currentColor" />
      <rect x="5" y="9" width="6" height="3" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function AlignRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="14" y1="1" x2="14" y2="15" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="3" width="8" height="3" rx="0.5" fill="currentColor" />
      <rect x="2" y="9" width="10" height="3" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function AlignTopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="1" y1="2" x2="15" y2="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="4" width="3" height="8" rx="0.5" fill="currentColor" />
      <rect x="9" y="4" width="3" height="10" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function AlignMiddleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1" />
      <rect x="3" y="3" width="3" height="10" rx="0.5" fill="currentColor" />
      <rect x="9" y="5" width="3" height="6" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function AlignBottomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="1" y1="14" x2="15" y2="14" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="4" width="3" height="8" rx="0.5" fill="currentColor" />
      <rect x="9" y="2" width="3" height="10" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function DistributeHIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="1" y1="2" x2="1" y2="14" stroke="currentColor" strokeWidth="1.2" />
      <line x1="15" y1="2" x2="15" y2="14" stroke="currentColor" strokeWidth="1.2" />
      <rect x="4" y="4" width="3" height="8" rx="0.5" fill="currentColor" />
      <rect x="9" y="4" width="3" height="8" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function DistributeVIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="1" x2="14" y2="1" stroke="currentColor" strokeWidth="1.2" />
      <line x1="2" y1="15" x2="14" y2="15" stroke="currentColor" strokeWidth="1.2" />
      <rect x="4" y="4" width="8" height="3" rx="0.5" fill="currentColor" />
      <rect x="4" y="9" width="8" height="3" rx="0.5" fill="currentColor" />
    </svg>
  );
}

const alignItems: MenuItem[] = [
  { action: "alignTop", label: "Top", icon: <AlignTopIcon />, minObjects: 2 },
  { action: "alignMiddle", label: "Middle", icon: <AlignMiddleIcon />, minObjects: 2 },
  { action: "alignBottom", label: "Bottom", icon: <AlignBottomIcon />, minObjects: 2 },
  { action: "alignLeft", label: "Left", icon: <AlignLeftIcon />, minObjects: 2 },
  { action: "alignCenterH", label: "Center", icon: <AlignCenterHIcon />, minObjects: 2 },
  { action: "alignRight", label: "Right", icon: <AlignRightIcon />, minObjects: 2 },
];

const distributeItems: MenuItem[] = [
  { action: "distributeV", label: "Vertically", icon: <DistributeVIcon />, minObjects: 3 },
  { action: "distributeH", label: "Horizontally", icon: <DistributeHIcon />, minObjects: 3 },
];

export default function AlignMenu({ boardId }: AlignMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const selCount = selectedObjectIds.length;

  // Close on click outside
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
    (action: AlignAction) => {
      const selected = selectedObjectIds.map((id) => objects[id]).filter(Boolean);
      if (selected.length < 2) return;

      switch (action) {
        case "alignLeft": {
          const minX = Math.min(...selected.map((o) => o.x));
          for (const obj of selected) {
            updateObjectLocal(obj.id, { x: minX });
            updateObject(boardId, obj.id, { x: minX }).catch(console.error);
          }
          break;
        }
        case "alignCenterH": {
          const centers = selected.map((o) => o.x + o.width / 2);
          const avg = centers.reduce((a, b) => a + b, 0) / centers.length;
          for (const obj of selected) {
            const newX = Math.round(avg - obj.width / 2);
            updateObjectLocal(obj.id, { x: newX });
            updateObject(boardId, obj.id, { x: newX }).catch(console.error);
          }
          break;
        }
        case "alignRight": {
          const maxRight = Math.max(...selected.map((o) => o.x + o.width));
          for (const obj of selected) {
            const newX = maxRight - obj.width;
            updateObjectLocal(obj.id, { x: newX });
            updateObject(boardId, obj.id, { x: newX }).catch(console.error);
          }
          break;
        }
        case "alignTop": {
          const minY = Math.min(...selected.map((o) => o.y));
          for (const obj of selected) {
            updateObjectLocal(obj.id, { y: minY });
            updateObject(boardId, obj.id, { y: minY }).catch(console.error);
          }
          break;
        }
        case "alignMiddle": {
          const middles = selected.map((o) => o.y + o.height / 2);
          const avg = middles.reduce((a, b) => a + b, 0) / middles.length;
          for (const obj of selected) {
            const newY = Math.round(avg - obj.height / 2);
            updateObjectLocal(obj.id, { y: newY });
            updateObject(boardId, obj.id, { y: newY }).catch(console.error);
          }
          break;
        }
        case "alignBottom": {
          const maxBottom = Math.max(...selected.map((o) => o.y + o.height));
          for (const obj of selected) {
            const newY = maxBottom - obj.height;
            updateObjectLocal(obj.id, { y: newY });
            updateObject(boardId, obj.id, { y: newY }).catch(console.error);
          }
          break;
        }
        case "distributeH": {
          if (selected.length < 3) break;
          const sorted = [...selected].sort((a, b) => a.x - b.x);
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          const totalWidth = sorted.reduce((s, o) => s + o.width, 0);
          const totalSpan = last.x + last.width - first.x;
          const gap = (totalSpan - totalWidth) / (sorted.length - 1);
          let cursor = first.x + first.width + gap;
          for (let i = 1; i < sorted.length - 1; i++) {
            const newX = Math.round(cursor);
            updateObjectLocal(sorted[i].id, { x: newX });
            updateObject(boardId, sorted[i].id, { x: newX }).catch(console.error);
            cursor += sorted[i].width + gap;
          }
          break;
        }
        case "distributeV": {
          if (selected.length < 3) break;
          const sorted = [...selected].sort((a, b) => a.y - b.y);
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          const totalHeight = sorted.reduce((s, o) => s + o.height, 0);
          const totalSpan = last.y + last.height - first.y;
          const gap = (totalSpan - totalHeight) / (sorted.length - 1);
          let cursor = first.y + first.height + gap;
          for (let i = 1; i < sorted.length - 1; i++) {
            const newY = Math.round(cursor);
            updateObjectLocal(sorted[i].id, { y: newY });
            updateObject(boardId, sorted[i].id, { y: newY }).catch(console.error);
            cursor += sorted[i].height + gap;
          }
          break;
        }
      }

      setOpen(false);
    },
    [selectedObjectIds, objects, updateObjectLocal, boardId]
  );

  const triggerRef = useRef<HTMLButtonElement>(null);

  const getPopupStyle = (): React.CSSProperties => {
    if (!triggerRef.current) return { display: "none" };
    const rect = triggerRef.current.getBoundingClientRect();
    const popupWidth = 224; // w-56
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
        disabled={selCount < 2}
        title="Align & Distribute"
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          selCount >= 2
            ? "text-gray-600 hover:bg-gray-100"
            : "cursor-not-allowed text-gray-300"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <line x1="8" y1="1" x2="8" y2="15" stroke="currentColor" strokeWidth="1.5" />
          <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.5" />
          <line x1="1" y1="3" x2="15" y2="3" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1.5" />
          <line x1="1" y1="13" x2="15" y2="13" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1.5" />
        </svg>
        <span className="hidden sm:inline">Align</span>
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

            {/* Align section header */}
            <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Align
            </div>
            <div className="grid grid-cols-2 gap-0">
              {alignItems.map((item) => (
                <button
                  key={item.action}
                  onClick={() => perform(item.action)}
                  disabled={selCount < item.minObjects}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                    selCount >= item.minObjects
                      ? "text-gray-700 hover:bg-gray-50/60"
                      : "cursor-not-allowed text-gray-300"
                  }`}
                >
                  <span className="text-gray-500">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>

            <div className="my-1 border-t border-gray-200/60" />

            {/* Distribute section header */}
            <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Distribute evenly
            </div>
            <div className="grid grid-cols-2 gap-0">
              {distributeItems.map((item) => (
                <button
                  key={item.action}
                  onClick={() => perform(item.action)}
                  disabled={selCount < item.minObjects}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                    selCount >= item.minObjects
                      ? "text-gray-700 hover:bg-gray-50/60"
                      : "cursor-not-allowed text-gray-300"
                  }`}
                >
                  <span className="text-gray-500">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
