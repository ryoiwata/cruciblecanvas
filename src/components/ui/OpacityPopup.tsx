"use client";

/**
 * OpacityPopup — pop-out toolbar panel for adjusting object opacity.
 *
 * Applies to all currently selected non-connector objects.
 * The trigger button shows the current average opacity as a percentage.
 * Renders the slider panel to the right of the button via a portal.
 */

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
import type { BoardObject } from "@/lib/types";

interface OpacityPopupProps {
  boardId: string;
}

export default function OpacityPopup({ boardId }: OpacityPopupProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const selectedObjects = selectedObjectIds
    .map((id) => objects[id])
    .filter((o): o is BoardObject => !!o && o.type !== 'connector');

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (selectedObjects.length === 0) return null;

  const avgOpacity =
    selectedObjects.reduce((sum, o) => sum + (o.opacity ?? 1), 0) / selectedObjects.length;
  const displayOpacity = Math.round(avgOpacity * 100);

  const handleOpacityChange = (value: number) => {
    const opacity = Math.round(value) / 100;
    for (const obj of selectedObjects) {
      updateObjectLocal(obj.id, { opacity });
      updateObject(boardId, obj.id, { opacity }).catch(console.error);
    }
  };

  /** Position popup to the right of the trigger, vertically centred on it. */
  const getPopupStyle = (): React.CSSProperties => {
    if (!triggerRef.current) return { display: 'none' };
    const rect = triggerRef.current.getBoundingClientRect();
    const popupWidth = 180;
    const popupHeight = 68;
    const left = rect.right + 8;
    let top = rect.top + rect.height / 2 - popupHeight / 2;
    if (top < 8) top = 8;
    if (top + popupHeight > window.innerHeight - 8) top = window.innerHeight - 8 - popupHeight;
    return { position: 'fixed', left, top, width: popupWidth, zIndex: 200 };
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        title="Opacity"
        className={`flex h-9 w-9 items-center justify-center rounded-md text-[10px] font-medium tabular-nums transition-colors ${
          open ? 'bg-indigo-100 text-indigo-600' : 'text-gray-500 hover:bg-gray-100'
        }`}
      >
        {displayOpacity}%
      </button>

      {open &&
        createPortal(
          <div
            ref={popupRef}
            style={getPopupStyle()}
            className="rounded-xl border border-white/20 bg-white/90 p-3 shadow-xl backdrop-blur-lg"
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Opacity
              </span>
              <span className="tabular-nums text-[10px] text-gray-500">{displayOpacity}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={displayOpacity}
              onChange={(e) => handleOpacityChange(Number(e.target.value))}
              className="h-1 w-full cursor-pointer accent-indigo-500"
            />
          </div>,
          document.body
        )}
    </>
  );
}
