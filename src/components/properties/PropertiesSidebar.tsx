'use client';

/**
 * PropertiesSidebar — the persistent left panel showing property controls for
 * the currently selected canvas object, or Canvas Presets when nothing is selected.
 *
 * Layout behaviour:
 *   - Always visible; open/closed state driven by `isPropertiesOpen` in canvasStore.
 *   - w-72 when open, w-10 (narrow strip) when collapsed — CSS transition so
 *     the canvas Stage gracefully expands via the ResizeObserver in Canvas.tsx.
 *   - A chevron button in the panel header toggles the collapsed state.
 *   - When no object is selected the panel shows "Canvas Presets" with global
 *     style presets that set the active color for the next created object.
 *   - When an object is selected the panel switches to the relevant type module.
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
import { STYLE_PRESETS } from '@/lib/types';
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

// ---- Chevron icons -----------------------------------------------------------

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M5 2L10 7L5 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- Canvas Presets empty state ----------------------------------------------

/** Shown when no object is selected — lets users pick a default fill color. */
function CanvasPresetsPanel() {
  const setActiveColor = useCanvasStore((s) => s.setActiveColor);
  const activeColor = useCanvasStore((s) => s.activeColor);
  const recentColors = useCanvasStore((s) => s.recentColors);

  return (
    <div className="flex flex-col gap-4 p-4">
      <section>
        <p className="mb-1 text-sm font-semibold text-gray-700">Canvas Presets</p>
        <p className="mb-3 text-xs text-gray-400">
          Choose a default fill color applied to the next object you create.
        </p>

        {/* Preset swatches grid */}
        <div className="grid grid-cols-6 gap-1">
          {STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setActiveColor(preset.color)}
              title={preset.label}
              aria-label={preset.label}
              aria-pressed={activeColor === preset.color}
              className={`flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition-all hover:scale-105 hover:shadow-sm ${
                activeColor === preset.color
                  ? 'ring-2 ring-blue-500 ring-offset-1'
                  : ''
              }`}
              style={{
                backgroundColor: preset.previewBg,
                borderColor: preset.previewBorder ?? preset.previewBg,
                color: preset.textColor ?? '#111827',
              }}
            >
              Aa
            </button>
          ))}
        </div>
      </section>

      {/* Recent colors */}
      {recentColors.length > 0 && (
        <>
          <div className="border-t border-gray-200" />
          <section>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Recent Colors
            </p>
            <div className="flex flex-wrap gap-1.5">
              {recentColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setActiveColor(color)}
                  className={`h-8 w-8 rounded-md border transition-all hover:scale-105 hover:shadow-sm ${
                    activeColor === color
                      ? 'border-indigo-500 ring-2 ring-indigo-200'
                      : 'border-black/10'
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                  aria-label={`Set default color to ${color}`}
                />
              ))}
            </div>
          </section>
        </>
      )}

      <div className="border-t border-gray-200" />

      <p className="text-center text-xs text-gray-400">
        Select an object on the canvas to edit its properties.
      </p>
    </div>
  );
}

// ---- Main component ----------------------------------------------------------

export default function PropertiesSidebar({ boardId }: PropertiesSidebarProps) {
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const addRecentColor = useCanvasStore((s) => s.addRecentColor);
  const isPropertiesOpen = useCanvasStore((s) => s.isPropertiesOpen);
  const setIsPropertiesOpen = useCanvasStore((s) => s.setIsPropertiesOpen);

  // Debounce Firestore writes — rapid slider drags only trigger one network call
  // per 300 ms per object. The map key is objectId.
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const activeObject = selectedObjectIds.length > 0 ? objects[selectedObjectIds[0]] : null;

  // Frozen object pattern: keep the last non-null object so the panel retains
  // its content when the user clicks empty canvas — avoids jarring panel flash.
  const lastObjectRef = useRef<BoardObject | null>(null);
  if (activeObject) lastObjectRef.current = activeObject;
  const displayObject = activeObject ?? lastObjectRef.current;

  const handleChange = useCallback(
    (patch: Partial<BoardObject>) => {
      // Track recently used fill/stroke colors for the quick-pick row in ColorRow.
      if (patch.color) addRecentColor(patch.color);
      if (patch.strokeColor) addRecentColor(patch.strokeColor);

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
    [boardId, selectedObjectIds, updateObjectLocal, addRecentColor]
  );

  return (
    <aside
      className={`relative flex h-full flex-col overflow-hidden border-r border-gray-200 bg-[#F8F9FA] transition-all duration-200 ${
        isPropertiesOpen ? 'w-72' : 'w-10'
      }`}
      aria-label="Properties"
    >
      {/* Collapse / expand button — always in the top-right corner */}
      <button
        type="button"
        onClick={() => setIsPropertiesOpen(!isPropertiesOpen)}
        title={isPropertiesOpen ? 'Collapse properties panel' : 'Expand properties panel'}
        className="absolute right-1 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
        aria-label={isPropertiesOpen ? 'Collapse' : 'Expand'}
      >
        {isPropertiesOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </button>

      {/* Collapsed strip — show a vertical "Properties" label */}
      {!isPropertiesOpen && (
        <div className="flex flex-1 items-center justify-center">
          <span
            className="text-[10px] font-semibold uppercase tracking-widest text-gray-300"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            Properties
          </span>
        </div>
      )}

      {/* Expanded content — fixed width so it doesn't squash during the transition */}
      {isPropertiesOpen && (
        <div className="flex h-full w-72 flex-col overflow-y-auto pt-9">
          {displayObject ? (
            <div className="flex flex-col gap-4 p-4 pt-2">
              {/* Styles / Presets */}
              <section>
                <p className="mb-2 text-sm font-semibold text-gray-700">Styles</p>
                <PresetsSection object={displayObject} onChange={handleChange} />
              </section>

              <div className="border-t border-gray-200" />

              {/* Transparency — shared across all types */}
              <section>
                <TransparencyControl object={displayObject} onChange={handleChange} />
              </section>

              <div className="border-t border-gray-200" />

              {/* Type-specific modules */}
              <section>
                {getModuleSet(displayObject.type) === 'shape' && (
                  <>
                    <ShapeModule object={displayObject} onChange={handleChange} />
                    <div className="my-3 border-t border-gray-100" />
                    <TextModule object={displayObject} onChange={handleChange} />
                  </>
                )}
                {getModuleSet(displayObject.type) === 'stickyNote' && (
                  <>
                    <StickyNoteModule object={displayObject} onChange={handleChange} />
                    <div className="my-3 border-t border-gray-100" />
                    <TextModule object={displayObject} onChange={handleChange} />
                  </>
                )}
                {getModuleSet(displayObject.type) === 'line' && (
                  <LineModule object={displayObject} onChange={handleChange} />
                )}
                {getModuleSet(displayObject.type) === 'frame' && (
                  <FrameModule object={displayObject} onChange={handleChange} />
                )}
                {getModuleSet(displayObject.type) === 'text' && (
                  <TextModule object={displayObject} onChange={handleChange} />
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
            // No prior selection — show global canvas presets
            <CanvasPresetsPanel />
          )}
        </div>
      )}
    </aside>
  );
}
