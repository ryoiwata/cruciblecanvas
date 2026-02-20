"use client";

/**
 * BorderStyleMenu — pop-out toolbar panel for stroke thickness and border style.
 *
 * Applies to selected rectangle, circle, frame, line, and connector objects.
 * Renders to the right of its trigger button via a portal so it is never
 * clipped by the toolbar's overflow.
 */

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
import type { BoardObject } from "@/lib/types";

interface BorderStyleMenuProps {
  boardId: string;
}

/** Object types whose stroke/thickness can be configured via this menu. */
const STYLABLE_TYPES = new Set(['rectangle', 'circle', 'frame', 'line', 'connector']);

function BorderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5" />
    </svg>
  );
}

function StylePreview({ style }: { style: 'solid' | 'dashed' | 'dotted' }) {
  const common = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const };
  if (style === 'solid') {
    return (
      <svg width="28" height="8" viewBox="0 0 28 8" fill="none">
        <line x1="2" y1="4" x2="26" y2="4" {...common} />
      </svg>
    );
  }
  if (style === 'dashed') {
    return (
      <svg width="28" height="8" viewBox="0 0 28 8" fill="none">
        <line x1="2" y1="4" x2="26" y2="4" {...common} strokeDasharray="6 3" />
      </svg>
    );
  }
  return (
    <svg width="28" height="8" viewBox="0 0 28 8" fill="none">
      <line x1="2" y1="4" x2="26" y2="4" {...common} strokeDasharray="2 3" />
    </svg>
  );
}

export default function BorderStyleMenu({ boardId }: BorderStyleMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const stylableObjects = selectedObjectIds
    .map((id) => objects[id])
    .filter((o): o is BoardObject => !!o && STYLABLE_TYPES.has(o.type));

  // Close popup on outside click
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

  // Close popup on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (stylableObjects.length === 0) return null;

  const firstThickness = stylableObjects[0].thickness ?? 2;
  const firstStyle = stylableObjects[0].borderType ?? 'solid';

  const applyThickness = (value: number) => {
    for (const obj of stylableObjects) {
      updateObjectLocal(obj.id, { thickness: value });
      updateObject(boardId, obj.id, { thickness: value }).catch(console.error);
    }
  };

  const applyBorderType = (borderType: 'solid' | 'dashed' | 'dotted') => {
    for (const obj of stylableObjects) {
      updateObjectLocal(obj.id, { borderType });
      updateObject(boardId, obj.id, { borderType }).catch(console.error);
    }
  };

  /** Position popup to the right of the trigger, vertically centred on it. */
  const getPopupStyle = (): React.CSSProperties => {
    if (!triggerRef.current) return { display: 'none' };
    const rect = triggerRef.current.getBoundingClientRect();
    const popupWidth = 200;
    const popupHeight = 110;
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
        title="Border Style"
        className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
          open ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        <BorderIcon />
      </button>

      {open &&
        createPortal(
          <div
            ref={popupRef}
            style={getPopupStyle()}
            className="rounded-xl border border-white/20 bg-white/90 p-3 shadow-xl backdrop-blur-lg"
          >
            {/* Thickness row */}
            <div className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Thickness
                </span>
                <span className="tabular-nums text-[10px] text-gray-500">
                  {firstThickness % 1 === 0 ? firstThickness : firstThickness.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={firstThickness}
                onChange={(e) => applyThickness(Number(e.target.value))}
                className="h-1 w-full cursor-pointer accent-indigo-500"
              />
            </div>

            {/* Border style buttons */}
            <div>
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Style
              </span>
              <div className="flex gap-1">
                {(['solid', 'dashed', 'dotted'] as const).map((style) => (
                  <button
                    key={style}
                    onClick={() => applyBorderType(style)}
                    title={style.charAt(0).toUpperCase() + style.slice(1)}
                    className={`flex flex-1 items-center justify-center rounded px-1 py-1.5 transition-colors ${
                      firstStyle === style
                        ? 'bg-indigo-100 text-indigo-600 ring-1 ring-indigo-300'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <StylePreview style={style} />
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
