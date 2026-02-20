'use client';

/**
 * SubHeaderToolbar — the full-width horizontal tool strip that sits directly
 * below the top header bar, following the BioRender two-tier layout pattern.
 *
 * Structure (left → right):
 *   [Undo] [Redo] │ [Pointer] │ [Lines ▾] [Shapes ▾] [T Text] [📝 Sticky] │ [Align] [Arrange]
 *
 * Lines ▾ expands to: Line, Connector
 * Shapes ▾ expands to: Rectangle, Circle, Frame
 *
 * Undo/Redo are rendered as disabled stubs — no history system yet.
 * z-index is above canvas content (z-30) but below global overlays (z-50).
 */

import { useState, useRef, useEffect } from 'react';
import { Cable } from 'lucide-react';
import { useCanvasStore } from '@/lib/store/canvasStore';
import type { ObjectType } from '@/lib/types';
import AlignMenu from './AlignMenu';
import ArrangeMenu from './ArrangeMenu';

interface SubHeaderToolbarProps {
  boardId: string;
}

// ---- Inline SVG Icons --------------------------------------------------------

function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M4 5H9.5C11.43 5 13 6.57 13 8.5S11.43 12 9.5 12H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6.5 2.5L4 5L6.5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M11 5H5.5C3.57 5 2 6.57 2 8.5S3.57 12 5.5 12H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8.5 2.5L11 5L8.5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PointerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 2L6.5 12L8.5 8.5L12 6.5L2 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function LineToolIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <line x1="2" y1="13" x2="13" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="2" cy="13" r="1.5" fill="currentColor" />
      <circle cx="13" cy="2" r="1.5" fill="currentColor" />
    </svg>
  );
}

function RectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <line x1="1" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function StickyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <line x1="3.5" y1="5" x2="10.5" y2="5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="3.5" y1="7.5" x2="10.5" y2="7.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="3.5" y1="10" x2="7.5" y2="10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
      <path d="M1.5 3L4.5 6L7.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- Dropdown helper ---------------------------------------------------------

interface DropdownItem {
  id: ObjectType;
  label: string;
  icon: React.ReactNode;
}

interface ToolDropdownProps {
  /** Button label shown in the toolbar */
  label: string;
  /** Icon shown in the toolbar button */
  icon: React.ReactNode;
  items: DropdownItem[];
  /** Whether any item in this dropdown is the active creation tool */
  isGroupActive: boolean;
  onSelect: (tool: ObjectType) => void;
  activeCreationTool: ObjectType | null;
}

function ToolDropdown({
  label,
  icon,
  items,
  isGroupActive,
  onSelect,
  activeCreationTool,
}: ToolDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 items-center gap-1 rounded-md px-2.5 text-sm font-medium transition-colors ${
          isGroupActive
            ? 'bg-indigo-50 text-indigo-600'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        <span className="flex items-center">{icon}</span>
        <span className="ml-1">{label}</span>
        <ChevronDownIcon />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                activeCreationTool === item.id
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex w-4 items-center justify-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Divider helper ----------------------------------------------------------

function Divider() {
  return <div className="mx-1 h-6 w-px bg-gray-200" />;
}

// ---- Tool button (non-dropdown) ---------------------------------------------

interface ToolButtonProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  shortcut?: string;
  onClick: () => void;
}

function ToolButton({ label, icon, isActive, shortcut, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-indigo-50 text-indigo-600'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ---- Line items — Connector is a primary tool button, not in this dropdown --

const LINE_ITEMS: DropdownItem[] = [
  { id: 'line', label: 'Line', icon: <LineToolIcon /> },
];

// ---- Shape items -------------------------------------------------------------

const SHAPE_ITEMS: DropdownItem[] = [
  { id: 'rectangle', label: 'Rectangle', icon: <RectIcon /> },
  { id: 'circle',    label: 'Circle',    icon: <CircleIcon /> },
  { id: 'frame',     label: 'Frame',     icon: <FrameIcon /> },
];

// ---- Main component ----------------------------------------------------------

export default function SubHeaderToolbar({ boardId }: SubHeaderToolbarProps) {
  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const setMode = useCanvasStore((s) => s.setMode);
  const enterCreateMode = useCanvasStore((s) => s.enterCreateMode);

  const isPointerActive = mode === 'pointer';
  const isLinesGroupActive = mode === 'create' && creationTool === 'line';
  const isConnectorActive = mode === 'create' && creationTool === 'connector';
  const isShapesGroupActive =
    mode === 'create' &&
    (creationTool === 'rectangle' || creationTool === 'circle' || creationTool === 'frame');
  const isTextActive = mode === 'create' && creationTool === 'text';
  const isStickyActive = mode === 'create' && creationTool === 'stickyNote';

  return (
    <div className="flex h-11 w-full shrink-0 items-center border-b border-gray-200 bg-white px-4 z-30">
      {/* Undo / Redo — disabled until history is implemented */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled
          title="Undo (Ctrl+Z) — not yet implemented"
          className="flex h-8 w-8 items-center justify-center rounded text-gray-300 cursor-not-allowed"
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          disabled
          title="Redo (Ctrl+Shift+Z) — not yet implemented"
          className="flex h-8 w-8 items-center justify-center rounded text-gray-300 cursor-not-allowed"
        >
          <RedoIcon />
        </button>
      </div>

      <Divider />

      {/* Pointer tool */}
      <ToolButton
        label="Select"
        icon={<PointerIcon />}
        isActive={isPointerActive}
        shortcut="1"
        onClick={() => setMode('pointer')}
      />

      <Divider />

      {/* Lines dropdown */}
      <ToolDropdown
        label="Lines"
        icon={<LineToolIcon />}
        items={LINE_ITEMS}
        isGroupActive={isLinesGroupActive}
        activeCreationTool={creationTool}
        onSelect={(tool) => enterCreateMode(tool)}
      />

      {/* Connector — primary tool button (two boxes connected by a line) */}
      <ToolButton
        label="Connector"
        icon={<Cable size={14} />}
        isActive={isConnectorActive}
        shortcut="C"
        onClick={() => enterCreateMode('connector')}
      />

      {/* Shapes dropdown */}
      <ToolDropdown
        label="Shapes"
        icon={<RectIcon />}
        items={SHAPE_ITEMS}
        isGroupActive={isShapesGroupActive}
        activeCreationTool={creationTool}
        onSelect={(tool) => enterCreateMode(tool)}
      />

      {/* Text */}
      <ToolButton
        label="Text"
        icon={<span className="font-bold text-sm leading-none">T</span>}
        isActive={isTextActive}
        shortcut="8"
        onClick={() => enterCreateMode('text')}
      />

      {/* Sticky Note */}
      <ToolButton
        label="Sticky"
        icon={<StickyIcon />}
        isActive={isStickyActive}
        shortcut="2"
        onClick={() => enterCreateMode('stickyNote')}
      />

      <Divider />

      {/* Align & Arrange — layout operations, stay here since they're canvas-wide */}
      <AlignMenu boardId={boardId} />
      <ArrangeMenu boardId={boardId} />

      {/* Spacer pushes nothing — right side is empty for now (Canvas Size etc. future) */}
    </div>
  );
}
