'use client';

/**
 * SubHeaderToolbar — the full-width horizontal tool strip that sits directly
 * below the top header bar, following the BioRender two-tier layout pattern.
 *
 * Tool order (left → right):
 *   [Undo] [Redo] │ [Select] [Line] [Connector] [Shapes▾] [Text] [Sticky] [Frame] │ [Align▾] [Layer▾]
 *
 * Shapes ▾ expands to: Rectangle, Circle (portal-rendered to avoid overflow clipping)
 * Frame is a primary standalone tool (not in Shapes dropdown)
 * Align ▾ and Layer ▾ match the vertical icon+label style via showLabel prop
 *
 * Undo/Redo are wired to objectStore history. Firestore is patched with the
 * delta so other collaborators see the reverted state.
 *
 * Each button renders the icon above a small text label (flex-col layout).
 * Toolbar height is h-14 to accommodate the stacked icon+label.
 * z-index is above canvas content (z-30) but below global overlays (z-50).
 */

import { useCallback } from 'react';
import { Cable } from 'lucide-react';
import { useCanvasStore } from '@/lib/store/canvasStore';
import { useObjectStore } from '@/lib/store/objectStore';
import { useAuthStore } from '@/lib/store/authStore';
import {
  createObject,
  updateObject,
  deleteObject,
  generateObjectId,
} from '@/lib/firebase/firestore';
import type { BoardObject } from '@/lib/types';
import AlignMenu from './AlignMenu';
import ArrangeMenu from './ArrangeMenu';

// ---- Shortcut chip icons (inline, matching ShortcutLegend visual language) ---

function MarqueeChipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 1.5" fill="none" />
    </svg>
  );
}

function MultiSelectChipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="0.5" y="3.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="4.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function SelectAllChipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="1" cy="1" r="1.2" fill="currentColor" />
      <circle cx="13" cy="1" r="1.2" fill="currentColor" />
      <circle cx="1" cy="13" r="1.2" fill="currentColor" />
      <circle cx="13" cy="13" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CopyPasteChipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="0.5" y="3.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="4" y="0.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="white" />
      <rect x="4" y="0.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function PasteChipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="2" y="3" width="10" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="4.5" y="0.5" width="5" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="white" />
      <line x1="4.5" y1="7.5" x2="9.5" y2="7.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="4.5" y1="10" x2="9.5" y2="10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

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


// ---- Divider helper ----------------------------------------------------------

function Divider() {
  return <div className="mx-1 h-8 w-px bg-gray-200 self-center" />;
}

// ---- Shortcut chip — clickable hint button in the far-right legend area -----

interface ShortcutChipProps {
  icon: React.ReactNode;
  label: string;
  keys: string;
  onClick: () => void;
  disabled?: boolean;
  isActive?: boolean;
}

/**
 * Clickable shortcut chip rendered in the same vertical icon+label+key style as
 * ToolButton. Clicking activates the associated canvas sub-mode.
 *
 * onMouseDown preventDefault prevents browser focus shift, keeping canvas
 * pointer events working correctly for the next interaction.
 */
function ShortcutChip({ icon, label, keys, onClick, disabled, isActive }: ShortcutChipProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={`${label}: ${keys}`}
      className={`flex flex-col items-center justify-center h-14 w-14 gap-0.5 rounded-md transition-colors shrink-0 ${
        disabled
          ? 'cursor-not-allowed text-gray-300'
          : isActive
          ? 'bg-indigo-50 text-indigo-600'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium leading-none">{label}</span>
      <kbd className={`rounded border px-1 py-px font-mono text-[9px] leading-none mt-0.5 ${
        disabled ? 'border-gray-100 bg-gray-50 text-gray-300'
        : isActive ? 'border-indigo-200 bg-indigo-50 text-indigo-400'
        : 'border-gray-200 bg-gray-100 text-gray-400'
      }`}>
        {keys}
      </kbd>
    </button>
  );
}

// ---- Vertical tool button (icon above label) ---------------------------------

interface ToolButtonProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  disabled?: boolean;
  shortcut?: string;
  onClick: () => void;
}

function ToolButton({ label, icon, isActive, disabled, shortcut, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`flex flex-col items-center justify-center h-14 w-14 gap-0.5 rounded-md transition-colors ${
        disabled
          ? 'cursor-not-allowed text-gray-300'
          : isActive
          ? 'bg-indigo-50 text-indigo-600'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium leading-none">{label}</span>
      {shortcut && (
        <span className="text-[9px] leading-none font-mono text-gray-400 bg-gray-100 rounded px-0.5 mt-0.5">
          {shortcut}
        </span>
      )}
    </button>
  );
}


// ---- Undo/Redo logic ---------------------------------------------------------

/**
 * Applies a snapshot delta to Firestore so collaborators see the reverted state.
 * Called after undo() or redo() returns the before/after pair.
 */
async function syncDeltaToFirestore(
  before: Record<string, BoardObject>,
  after: Record<string, BoardObject>,
  boardId: string,
  uid: string
): Promise<void> {
  // Objects deleted by the action we're undoing/redoing: recreate them
  for (const [id, obj] of Object.entries(after)) {
    if (!before[id]) {
      createObject(boardId, { ...obj, createdBy: uid }, id).catch(console.error);
    }
  }
  // Objects created by the action: delete them
  for (const id of Object.keys(before)) {
    if (!after[id]) {
      deleteObject(boardId, id).catch(console.error);
    }
  }
  // Objects modified: update them
  for (const [id, obj] of Object.entries(after)) {
    if (before[id] && JSON.stringify(before[id]) !== JSON.stringify(obj)) {
      updateObject(boardId, id, obj as Partial<BoardObject>).catch(console.error);
    }
  }
}

// ---- Main component ----------------------------------------------------------

export default function SubHeaderToolbar({ boardId }: SubHeaderToolbarProps) {
  const mode = useCanvasStore((s) => s.mode);
  const creationTool = useCanvasStore((s) => s.creationTool);
  const setMode = useCanvasStore((s) => s.setMode);
  const enterCreateMode = useCanvasStore((s) => s.enterCreateMode);
  const setSelectedObjectIds = useCanvasStore((s) => s.setSelectedObjectIds);
  const copyToClipboard = useCanvasStore((s) => s.copyToClipboard);
  const isMarqueeMode = useCanvasStore((s) => s.isMarqueeMode);
  const isMultiSelectMode = useCanvasStore((s) => s.isMultiSelectMode);
  const setMarqueeMode = useCanvasStore((s) => s.setMarqueeMode);
  const setMultiSelectMode = useCanvasStore((s) => s.setMultiSelectMode);

  const clipboard = useCanvasStore((s) => s.clipboard);
  const past = useObjectStore((s) => s.past);
  const future = useObjectStore((s) => s.future);
  const user = useAuthStore((s) => s.user);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const canPaste = clipboard.length > 0;

  const handleUndo = useCallback(async () => {
    const result = useObjectStore.getState().undo();
    if (!result || !user) return;
    await syncDeltaToFirestore(result.before, result.after, boardId, user.uid);
  }, [boardId, user]);

  const handleRedo = useCallback(async () => {
    const result = useObjectStore.getState().redo();
    if (!result || !user) return;
    await syncDeltaToFirestore(result.before, result.after, boardId, user.uid);
  }, [boardId, user]);

  // Cascading-diagonal paste — same behavior as Ctrl+V (no cursor position context here)
  const handlePaste = useCallback(() => {
    if (!user) return;
    const { clipboard: cb } = useCanvasStore.getState();
    if (cb.length === 0) return;

    const pasteCount = useCanvasStore.getState().pasteCount + 1;
    useCanvasStore.setState({ pasteCount });
    const offset = pasteCount * 20;

    const allObjects = useObjectStore.getState().objects;
    let maxZ = 0;
    for (const o of Object.values(allObjects)) {
      const z = o.zIndex ?? 0;
      if (z > maxZ) maxZ = z;
    }

    const { upsertObject } = useObjectStore.getState();
    for (let i = 0; i < cb.length; i++) {
      const obj = cb[i];
      const newId = generateObjectId(boardId);
      const newObj = {
        ...obj,
        id: newId,
        x: obj.x + offset,
        y: obj.y + offset,
        zIndex: maxZ + 1 + i,
        createdBy: user.uid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        parentFrame: undefined,
      };
      upsertObject(newObj);
      createObject(
        boardId,
        {
          type: newObj.type,
          x: newObj.x,
          y: newObj.y,
          width: newObj.width,
          height: newObj.height,
          color: newObj.color,
          text: newObj.text,
          zIndex: newObj.zIndex,
          createdBy: user.uid,
        },
        newId
      ).catch(console.error);
    }
  }, [boardId, user]);

  const isPointerActive = mode === 'pointer';
  const isLineActive = mode === 'create' && creationTool === 'line';
  const isConnectorActive = mode === 'create' && creationTool === 'connector';
  const isRectActive = mode === 'create' && creationTool === 'rectangle';
  const isCircleActive = mode === 'create' && creationTool === 'circle';
  const isTextActive = mode === 'create' && creationTool === 'text';
  const isStickyActive = mode === 'create' && creationTool === 'stickyNote';
  const isFrameActive = mode === 'create' && creationTool === 'frame';

  return (
    <div className="flex h-14 w-full shrink-0 items-center border-b border-gray-200 bg-white px-3 z-30 overflow-x-auto">
      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
            canUndo
              ? 'text-gray-600 hover:bg-gray-100'
              : 'text-gray-300 cursor-not-allowed'
          }`}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
            canRedo
              ? 'text-gray-600 hover:bg-gray-100'
              : 'text-gray-300 cursor-not-allowed'
          }`}
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
        shortcut="L"
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

      {/* Rectangle — standalone primary tool */}
      <ToolButton
        label="Rect"
        icon={<RectIcon />}
        isActive={isRectActive}
        shortcut="3"
        onClick={() => enterCreateMode('rectangle')}
      />

      {/* Circle — standalone primary tool */}
      <ToolButton
        label="Circle"
        icon={<CircleIcon />}
        isActive={isCircleActive}
        shortcut="4"
        onClick={() => enterCreateMode('circle')}
      />

      {/* Text */}
      <ToolButton
        label="Text"
        icon={<span className="font-bold text-sm leading-none" aria-hidden="true">T</span>}
        isActive={isTextActive}
        shortcut="5"
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
        shortcut="6"
        onClick={() => enterCreateMode('frame')}
      />

      <Divider />

      {/* Align — uses showLabel to match vertical icon+label style */}
      <AlignMenu boardId={boardId} showLabel />

      {/* Layer — uses showLabel to match vertical icon+label style */}
      <ArrangeMenu boardId={boardId} showLabel />

      {/* Flexible spacer pushes shortcut legend to the far right */}
      <div className="flex-1" />

      <Divider />

      {/* Shortcut legend chips — clickable, each activates a persistent pointer sub-mode */}
      <ShortcutChip
        icon={<MarqueeChipIcon />}
        label="Marquee"
        keys="Ctrl+Drag"
        isActive={isMarqueeMode}
        onClick={() => {
          // Switch to pointer first, then toggle marquee sub-mode
          if (mode !== 'pointer') setMode('pointer');
          setMarqueeMode(!isMarqueeMode);
        }}
      />
      <ShortcutChip
        icon={<MultiSelectChipIcon />}
        label="Multi-sel"
        keys="Ctrl+Click"
        isActive={isMultiSelectMode}
        onClick={() => {
          if (mode !== 'pointer') setMode('pointer');
          setMultiSelectMode(!isMultiSelectMode);
        }}
      />
      <ShortcutChip
        icon={<SelectAllChipIcon />}
        label="Select All"
        keys="Ctrl+A"
        onClick={() => {
          setMode('pointer');
          setSelectedObjectIds(Object.keys(useObjectStore.getState().objects));
        }}
      />
      <ShortcutChip
        icon={<CopyPasteChipIcon />}
        label="Copy"
        keys="Ctrl+C"
        onClick={() => {
          const { selectedObjectIds } = useCanvasStore.getState();
          const { objects } = useObjectStore.getState();
          const selected = selectedObjectIds
            .map((id) => objects[id])
            .filter((obj): obj is BoardObject => obj !== undefined);
          if (selected.length > 0) copyToClipboard(selected);
        }}
      />
      <ShortcutChip
        icon={<PasteChipIcon />}
        label="Paste"
        keys="Ctrl+V"
        disabled={!canPaste}
        onClick={handlePaste}
      />
    </div>
  );
}
