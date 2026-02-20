'use client';

/**
 * SubHeaderToolbar — the full-width horizontal tool strip that sits directly
 * below the top header bar, following the BioRender two-tier layout pattern.
 *
 * Tool order (left → right):
 *   [Undo] [Redo] │ [Select] [Line] [Connector] [Shapes▾] [Text] [Sticky] [Frame] │ [Align▾] [Layer▾]
 *
 * Shapes ▾ expands to: Rectangle, Circle
 * Frame is a primary standalone tool (not in Shapes dropdown)
 * Align ▾ and Layer ▾ match the vertical icon+label style via showLabel prop
 *
 * Each button renders the icon above a small text label (flex-col layout).
 * Toolbar height is h-14 to accommodate the stacked icon+label.
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
    <svg width="8" height="8" viewBox="0 0 9 9" fill="none" aria-hidden="true">
      <path d="M1.5 3L4.5 6L7.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- Divider helper ----------------------------------------------------------

function Divider() {
  return <div className="mx-1 h-8 w-px bg-gray-200 self-center" />;
}

// ---- Vertical tool button (icon above label) ---------------------------------

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
      className={`flex flex-col items-center justify-center h-14 w-14 gap-0.5 rounded-md transition-colors ${
        isActive
          ? 'bg-indigo-50 text-indigo-600'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

// ---- Shapes dropdown with vertical trigger -----------------------------------

interface DropdownItem {
  id: ObjectType;
  label: string;
  icon: React.ReactNode;
}

interface ShapesDropdownProps {
  isGroupActive: boolean;
  activeCreationTool: ObjectType | null;
  onSelect: (tool: ObjectType) => void;
}

const SHAPE_ITEMS: DropdownItem[] = [
  { id: 'rectangle', label: 'Rectangle', icon: <RectIcon /> },
  { id: 'circle',    label: 'Circle',    icon: <CircleIcon /> },
];

function ShapesDropdown({ isGroupActive, activeCreationTool, onSelect }: ShapesDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex flex-col items-center justify-center h-14 w-14 gap-0.5 rounded-md transition-colors ${
          isGroupActive
            ? 'bg-indigo-50 text-indigo-600'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        }`}
      >
        <span className="flex items-center gap-0.5">
          <RectIcon />
          <ChevronDownIcon />
        </span>
        <span className="text-[10px] font-medium leading-none">Shape</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {SHAPE_ITEMS.map((item) => (
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

// ---- Main component ----------------------------------------------------------

export default function SubHeaderToolbar({ boardId }: SubHeaderToolbarProps) {
  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const setMode = useCanvasStore((s) => s.setMode);
  const enterCreateMode = useCanvasStore((s) => s.enterCreateMode);

  const isPointerActive = mode === 'pointer';
  const isLineActive = mode === 'create' && creationTool === 'line';
  const isConnectorActive = mode === 'create' && creationTool === 'connector';
  const isShapesGroupActive =
    mode === 'create' && (creationTool === 'rectangle' || creationTool === 'circle');
  const isTextActive = mode === 'create' && creationTool === 'text';
  const isStickyActive = mode === 'create' && creationTool === 'stickyNote';
  const isFrameActive = mode === 'create' && creationTool === 'frame';

  return (
    <div className="flex h-14 w-full shrink-0 items-center border-b border-gray-200 bg-white px-3 z-30 overflow-x-auto">
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

      {/* Select (Pointer) */}
      <ToolButton
        label="Select"
        icon={<PointerIcon />}
        isActive={isPointerActive}
        shortcut="1"
        onClick={() => setMode('pointer')}
      />

      {/* Line */}
      <ToolButton
        label="Line"
        icon={<LineToolIcon />}
        isActive={isLineActive}
        onClick={() => enterCreateMode('line')}
      />

      {/* Connector */}
      <ToolButton
        label="Connector"
        icon={<Cable size={14} />}
        isActive={isConnectorActive}
        shortcut="C"
        onClick={() => enterCreateMode('connector')}
      />

      <Divider />

      {/* Shape dropdown (Rectangle, Circle) */}
      <ShapesDropdown
        isGroupActive={isShapesGroupActive}
        activeCreationTool={creationTool}
        onSelect={(tool) => enterCreateMode(tool)}
      />

      {/* Text */}
      <ToolButton
        label="Text"
        icon={<span className="font-bold text-sm leading-none" aria-hidden="true">T</span>}
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

      {/* Frame */}
      <ToolButton
        label="Frame"
        icon={<FrameIcon />}
        isActive={isFrameActive}
        onClick={() => enterCreateMode('frame')}
      />

      <Divider />

      {/* Align — uses showLabel to match vertical icon+label style */}
      <AlignMenu boardId={boardId} showLabel />

      {/* Layer — uses showLabel to match vertical icon+label style */}
      <ArrangeMenu boardId={boardId} showLabel />
    </div>
  );
}
