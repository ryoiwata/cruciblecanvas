'use client';

/**
 * PropertiesSidebar — the persistent left panel that dynamically shows property
 * controls for the currently selected canvas object.
 *
 * Layout behaviour:
 *   - Rendered as a flex sibling of the canvas column in the workspace layout.
 *   - w-72 when an object is selected, w-0 (collapsed) otherwise, with a CSS
 *     transition so the canvas gracefully expands/contracts.
 *   - All property changes are applied optimistically via updateObjectLocal and
 *     then synced to Firestore via a debounced updateObject call.
 *
 * Module routing:
 *   stickyNote  → StickyNoteModule + TextModule
 *   rectangle   → ShapeModule + TextModule
 *   circle      → ShapeModule + TextModule
 *   frame       → FrameModule
 *   text        → TextModule
 *   line        → LineModule
 *   connector   → LineModule
 */

import { useCallback, useRef } from 'react';
import { useCanvasStore } from '@/lib/store/canvasStore';
import { useObjectStore } from '@/lib/store/objectStore';
import { updateObject } from '@/lib/firebase/firestore';
import type { BoardObject } from '@/lib/types';
import PresetsSection from './PresetsSection';
import TransparencyControl from './TransparencyControl';
import ShapeModule from './modules/ShapeModule';
import TextModule from './modules/TextModule';
import LineModule from './modules/LineModule';
import FrameModule from './modules/FrameModule';
import StickyNoteModule from './modules/StickyNoteModule';

interface PropertiesSidebarProps {
  boardId: string;
}

/** Determines which modules are shown for a given object type. */
type ModuleSet = 'shape' | 'stickyNote' | 'line' | 'frame' | 'text' | 'none';

function getModuleSet(type: BoardObject['type']): ModuleSet {
  switch (type) {
    case 'rectangle':
    case 'circle':
      return 'shape';
    case 'stickyNote':
      return 'stickyNote';
    case 'line':
    case 'connector':
      return 'line';
    case 'frame':
      return 'frame';
    case 'text':
      return 'text';
    default:
      return 'none';
  }
}

export default function PropertiesSidebar({ boardId }: PropertiesSidebarProps) {
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  // Debounce Firestore writes — rapid slider drags only trigger one network call
  // per 300 ms per object. The map key is objectId.
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const activeObject = selectedObjectIds.length > 0 ? objects[selectedObjectIds[0]] : null;
  const isOpen = activeObject !== null;

  const handleChange = useCallback(
    (patch: Partial<BoardObject>) => {
      for (const id of selectedObjectIds) {
        // Optimistic local update — canvas reflects changes at 60 fps
        updateObjectLocal(id, patch);

        // Debounced Firestore write — only commits once the user pauses
        const existing = debounceTimers.current.get(id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          updateObject(boardId, id, patch).catch(console.error);
          debounceTimers.current.delete(id);
        }, 300);
        debounceTimers.current.set(id, timer);
      }
    },
    [boardId, selectedObjectIds, updateObjectLocal]
  );

  return (
    <aside
      className={`flex h-full flex-col overflow-hidden border-r border-gray-200 bg-[#F8F9FA] transition-all duration-200 ${
        isOpen ? 'w-72' : 'w-0'
      }`}
      aria-label="Properties"
      aria-hidden={!isOpen}
    >
      {/* Inner content — fixed width so it doesn't squash during the transition */}
      <div className="flex h-full w-72 flex-col overflow-y-auto">
        {activeObject ? (
          <div className="flex flex-col gap-4 p-4">
            {/* Styles / Presets */}
            <section>
              <p className="mb-2 text-sm font-semibold text-gray-700">Styles</p>
              <PresetsSection object={activeObject} onChange={handleChange} />
            </section>

            <div className="border-t border-gray-200" />

            {/* Transparency — shared across all types */}
            <section>
              <TransparencyControl object={activeObject} onChange={handleChange} />
            </section>

            <div className="border-t border-gray-200" />

            {/* Type-specific modules */}
            <section>
              {getModuleSet(activeObject.type) === 'shape' && (
                <>
                  <ShapeModule object={activeObject} onChange={handleChange} />
                  <div className="my-3 border-t border-gray-100" />
                  <TextModule object={activeObject} onChange={handleChange} />
                </>
              )}
              {getModuleSet(activeObject.type) === 'stickyNote' && (
                <>
                  <StickyNoteModule object={activeObject} onChange={handleChange} />
                  <div className="my-3 border-t border-gray-100" />
                  <TextModule object={activeObject} onChange={handleChange} />
                </>
              )}
              {getModuleSet(activeObject.type) === 'line' && (
                <LineModule object={activeObject} onChange={handleChange} />
              )}
              {getModuleSet(activeObject.type) === 'frame' && (
                <FrameModule object={activeObject} onChange={handleChange} />
              )}
              {getModuleSet(activeObject.type) === 'text' && (
                <TextModule object={activeObject} onChange={handleChange} />
              )}
            </section>

            {/* Multi-select indicator */}
            {selectedObjectIds.length > 1 && (
              <p className="text-center text-xs text-gray-400">
                {selectedObjectIds.length} objects selected — changes apply to all
              </p>
            )}
          </div>
        ) : (
          /* Empty state — shown when nothing is selected */
          <div className="flex flex-col items-center gap-3 p-6 pt-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="7" stroke="#9CA3AF" strokeWidth="1.5" />
                <line x1="15.5" y1="15.5" x2="20" y2="20" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-500">No object selected</p>
            <p className="text-xs text-gray-400">
              Click any object on the canvas to edit its properties here.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
