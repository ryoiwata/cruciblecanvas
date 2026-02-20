# Plan: Remaining Core & Polish Features

**Source:** `docs/TODO.MD` lines 29–70
**Depends on:** All Phase 1–3 features, AI integration, and performance optimizations (already built)

---

## Summary

Five sprints to close out the remaining core whiteboard features and UX polish items tracked in TODO.MD. Each sprint is self-contained and ordered by user-visible impact. Sprints 1–2 address missing object types and frame interaction quality. Sprints 3–4 add workflow polish. Sprint 5 closes the shortcut/discoverability gap.

---

## Sprint 1: Line Object & Connector UX

**Goal:** Add a standalone `line` object type and improve the connector drag UX.

---

### Step 1.1 — Add `LineObject` component

**File to create:** `src/components/canvas/LineObject.tsx`

A line is stored as a `BoardObject` with `type: "line"`. The points are derived from `(x, y)` as start and `(x + width, y + height)` as end so the existing resize/move system applies without schema changes.

```typescript
// LineObject renders as a Konva.Line between two derived endpoints.
// width/height encode the vector (dx, dy) from origin point.
// Negative width/height are valid — they point left or upward.
import { Group, Line, Circle } from 'react-konva';
import type { BoardObject } from '@/lib/types';

interface LineObjectProps {
  object: BoardObject;   // type === 'line'
  boardId: string;
  isLocked: boolean;
  lockedByName: string | null;
  isSimpleLod?: boolean;
}
```

Key render logic:
```typescript
// Always 2 points: start (0,0) and end (width, height) in local Group coords.
const points = [0, 0, object.width, object.height];
// Dash pattern: null = solid, [8,4] = dashed
const dash = object.strokeStyle === 'dashed' ? [8, 4] : undefined;

<Group x={object.x} y={object.y} draggable={isDraggable} ...>
  <Line
    points={points}
    stroke={object.color}
    strokeWidth={object.strokeWidth ?? 2}
    dash={dash}
    lineCap="round"
    lineJoin="round"
    hitStrokeWidth={12}   // wider hit area for thin lines
  />
</Group>
```

Place a LOD early return (`if (isSimpleLod)`) after all hooks — same pattern as `ShapeObject`.

---

### Step 1.2 — Register `LineObject` in `BoardObjects.tsx`

**File to modify:** `src/components/canvas/BoardObjects.tsx`

Add `case 'line':` in the object render switch:
```typescript
case 'line':
  return (
    <LineObject
      key={obj.id}
      object={obj}
      boardId={boardId}
      isLocked={!!locks[obj.id]}
      lockedByName={locks[obj.id]?.lockedByName ?? null}
      isSimpleLod={isSimpleLod}
    />
  );
```

---

### Step 1.3 — Add line tool to Toolbar

**File to modify:** `src/components/ui/Toolbar.tsx`

Add a `LineIcon` SVG (diagonal line with endpoints) and insert between circle and frame tools:
```typescript
const LineIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="2" cy="14" r="1.5" fill="currentColor" />
    <circle cx="14" cy="2" r="1.5" fill="currentColor" />
  </svg>
);

// In tools array, after circle:
{ id: 'line', label: 'Line', icon: <LineIcon />, mode: 'create', creationTool: 'line', shortcut: '5' },
// Shift remaining shortcuts: frame → 6, connector → 7
```

---

### Step 1.4 — Handle line creation in `Canvas.tsx`

**File to modify:** `src/components/canvas/Canvas.tsx`

In the `handleStageMouseDown` / `handleStageClick` creation path, add a `line` case:
```typescript
case 'line':
  newObject = {
    ...defaults,
    type: 'line',
    width: 120,    // initial length along X
    height: 0,     // horizontal line by default
    color: lastUsedColors['line'] ?? '#374151',
    strokeWidth: 2,
  };
  break;
```

For a better line creation UX, allow click-drag to set direction: record `mousedown` position as start, `mouseup` as end. This is a freeform drag rather than a rectangle bounding box. The delta becomes `(width, height)`.

---

### Step 1.5 — Add dotted-line toggle

**Files to modify:** `src/lib/types.ts`, `src/components/ui/Toolbar.tsx`

`strokeStyle` already exists on `BoardObject` (used by `ConnectorObject`). Expose it for line and connector objects:
```typescript
// In types.ts — already present; ensure it's on BoardObject:
strokeStyle?: 'solid' | 'dashed' | 'dotted';
```

In Toolbar, when a `line` or `connector` is selected, show a stroke-style toggle below the color picker:
```tsx
{selectedLines.length > 0 && (
  <select value={strokeStyle} onChange={handleStrokeStyleChange} ...>
    <option value="solid">—— Solid</option>
    <option value="dashed">- - Dashed</option>
    <option value="dotted">··· Dotted</option>
  </select>
)}
```

Use `getDash()` from ConnectorObject for consistent dash arrays:
```typescript
// src/lib/utils.ts — add helper
export function getStrokeDash(style: 'solid' | 'dashed' | 'dotted' | undefined): number[] | undefined {
  if (style === 'dashed') return [8, 4];
  if (style === 'dotted') return [2, 4];
  return undefined;
}
```

---

### Step 1.6 — Scale AnchorPoints with viewport zoom

**File to modify:** `src/components/canvas/AnchorPoints.tsx`

The connector anchor circles are radius `6` regardless of zoom. At low zoom they become enormous; at high zoom they disappear.

Add `stageScale` prop and compute display radius:
```typescript
interface AnchorPointsProps {
  object: BoardObject;
  stageScale: number;          // from canvasStore.stageScale
  onAnchorClick: (objectId: string) => void;
  onAnchorDragStart?: (objectId: string) => void;
}

// In component body:
const ANCHOR_SCREEN_RADIUS = 6;   // pixels on screen regardless of zoom
const radius = ANCHOR_SCREEN_RADIUS / stageScale;
```

**File to modify:** `src/components/canvas/BoardObjects.tsx`

Pass `stageScale={stageScale}` to `AnchorPoints`. Add `stageScale` to the `useShallow` subscription.

---

## Sprint 2: Frame Interaction Quality

**Goal:** Make framed objects click-through correctly and add clear visual indicators for framed items.

---

### Step 2.1 — Child object click-through in FrameObject

**File to modify:** `src/components/canvas/FrameObject.tsx`

Currently, clicking inside a frame body always selects the frame. The fix: in `handleClick`, check if the click hit a child object at those canvas coordinates, and if so, select the child instead.

Approach: Convert the Konva pointer event to canvas coords, then check the spatial index for overlapping non-frame objects that have `parentFrame === object.id`:
```typescript
const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
  if (mode !== 'pointer') return;
  e.cancelBubble = true;
  setLastUsedColor(object.type, object.color);

  // Check if a child object was hit first
  const stage = e.target.getStage();
  if (stage) {
    const pos = stage.getPointerPosition();
    if (pos) {
      const transform = stage.getAbsoluteTransform().copy().invert();
      const canvasPos = transform.point(pos);
      const allObjects = useObjectStore.getState().objects;
      const hit = Object.values(allObjects).find(
        (o) =>
          o.parentFrame === object.id &&
          canvasPos.x >= o.x && canvasPos.x <= o.x + o.width &&
          canvasPos.y >= o.y && canvasPos.y <= o.y + o.height
      );
      if (hit) {
        if (e.evt.ctrlKey || e.evt.metaKey) toggleSelection(hit.id);
        else selectObject(hit.id);
        return;
      }
    }
  }

  // No child hit — select the frame itself
  if (e.evt.ctrlKey || e.evt.metaKey) toggleSelection(object.id);
  else selectObject(object.id);
};
```

Note: this is a fallback hit test. Konva's own z-index bump (from Sprint 1 Step 1.6 / useFrameNesting) already routes most clicks to children via the render layer. This fallback handles edge cases where the child's bounding box doesn't perfectly match Konva's hit region (e.g., rotated objects).

---

### Step 2.2 — Frame child visual indicator

**Goal:** Framed objects get a subtle visual indicator (a small colored tag or border treatment) so users know they're nested.

**Option A (simpler):** Overlay a small corner badge on framed StickyNotes/ShapeObjects:
```tsx
// In StickyNote.tsx return JSX, before ResizeBorder:
{object.parentFrame && (
  <Rect
    x={0}
    y={0}
    width={object.width}
    height={object.height}
    stroke="#6366f1"
    strokeWidth={1.5}
    dash={[4, 3]}
    fill="transparent"
    listening={false}
    cornerRadius={4}
  />
)}
```

**Option B (richer):** Show a small frame icon badge at the top-right corner. Only visible when `mode === 'pointer'` and not `isSimpleLod`.

Recommendation: Option A — a dashed purple border is unambiguous and zero-cost to implement.

Also add the same indicator to `ShapeObject.tsx`.

---

### Step 2.3 — Frame context menu: "Deframe All"

**File to modify:** `src/components/ui/ContextMenu.tsx`

When right-clicking a Frame object itself, add "Deframe All Children" which clears `parentFrame` for every object that has `parentFrame === frame.id`:
```typescript
const handleDeframeAll = async () => {
  const frameId = targetObjectId;
  const children = Object.values(useObjectStore.getState().objects).filter(
    (o) => o.parentFrame === frameId
  );
  for (const child of children) {
    updateObjectLocal(child.id, { parentFrame: undefined });
    updateObject(boardId, child.id, { parentFrame: undefined }).catch(console.error);
  }
  closeContextMenu();
};

// Menu item (show when target.type === 'frame'):
{ target?.type === 'frame' && (
  <button onClick={handleDeframeAll}>Deframe All Children</button>
) }
```

---

## Sprint 3: Frame Drag Preview & Readability

**Goal:** Children follow the frame during a drag preview. Frame title and border scale with zoom.

---

### Step 3.1 — Children follow frame during drag (preview)

**File to modify:** `src/components/canvas/FrameObject.tsx`

Currently `FrameObject` already snapshots child positions in `childSnapshots.current` on `handleDragStart` and updates them on `handleDragEnd`. The missing piece is the **live preview** during drag — children should visually move with the frame.

Add a `handleDragMove` with RAF throttling:
```typescript
const frameDragRafRef = useRef(0);

const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
  if (frameDragRafRef.current) cancelAnimationFrame(frameDragRafRef.current);
  frameDragRafRef.current = requestAnimationFrame(() => {
    frameDragRafRef.current = 0;
    const node = e.target as Konva.Group;
    const dx = node.x() - preDragPos.current.x;
    const dy = node.y() - preDragPos.current.y;
    for (const snap of childSnapshots.current) {
      updateObjectLocal(snap.id, {
        x: snap.x + dx,
        y: snap.y + dy,
      });
    }
  });
}, [updateObjectLocal]);
```

**Important:** `updateObjectLocal` is a local-only update (no Firestore write). The authoritative positions are written in `handleDragEnd` which already iterates `childSnapshots`. This keeps the preview cheap.

Also define `handleDragMove` BEFORE the `if (isSimpleLod)` guard (rules-of-hooks).

---

### Step 3.2 — Frame title readability: font scales with zoom

**File to modify:** `src/components/canvas/FrameObject.tsx`

The frame title Text node uses a fixed `fontSize`. At low zoom the label becomes illegibly small. Pass `stageScale` and compute a clamped screen-space font size:

```typescript
// In FrameObject props — add stageScale
const stageScale = useCanvasStore((s) => s.stageScale);

// Compute a font size that stays readable on screen:
// Target: 12px on screen → canvas pixels = 12 / stageScale, clamped [11, 36]
const titleFontSize = Math.min(36, Math.max(11, 12 / stageScale));
```

Apply to the `<Text>` node that renders the frame title.

---

### Step 3.3 — Frame border width scales with zoom

**File to modify:** `src/components/canvas/FrameObject.tsx`

Thick borders become distractingly large when zoomed in. Use `strokeScaleEnabled={false}` on the border Rect to keep it 1–2 px on screen regardless of zoom:

```tsx
<Rect
  strokeScaleEnabled={false}   // Konva: stroke width is in screen px, not canvas px
  strokeWidth={isFrameDragTarget ? 3 : 2}
  ...
/>
```

This is a 1-line change — `strokeScaleEnabled` is already in Konva's API.

---

## Sprint 4: Toolbar & Workflow Polish

**Goal:** Tool labels, opacity pop-out, recent colors, expanded shortcut legend, copy toast, Shift → pointer.

---

### Step 4.1 — Toolbar: show tool name label on hover

**File to modify:** `src/components/ui/Toolbar.tsx`

The Toolbar is a vertical pill on the left. The `title` attribute already provides browser tooltips. To make it more intentional, add a visible label to the right of each button when the Toolbar is in an expanded state, or show a floating label tag on hover.

Approach — add a hover label that slides in from the right:
```tsx
<button
  key={tool.id}
  onMouseEnter={() => setHoveredTool(tool.id)}
  onMouseLeave={() => setHoveredTool(null)}
  className="relative flex h-9 w-9 items-center justify-center ..."
>
  <span>{tool.icon}</span>
  {hoveredTool === tool.id && (
    <span className="absolute left-full ml-2 whitespace-nowrap rounded bg-gray-800 px-2 py-0.5 text-xs text-white shadow-lg">
      {tool.label}
      <kbd className="ml-1.5 rounded border border-white/20 bg-white/10 px-1 font-mono text-[10px]">
        {tool.shortcut}
      </kbd>
    </span>
  )}
</button>
```

State: `const [hoveredTool, setHoveredTool] = useState<string | null>(null)`.

---

### Step 4.2 — Opacity: pop-out slider instead of inline widget

**File to modify:** `src/components/ui/Toolbar.tsx`

Currently, when objects are selected the opacity slider appears inline in the toolbar, making it taller. Refactor it to a pop-out panel similar to `ColorPickerPopup`:

1. Extract `OpacityPopup` component to `src/components/ui/OpacityPopup.tsx`.
2. Show a small percentage badge button when non-connectors are selected (e.g., `"80%"`).
3. Clicking opens a portal-rendered slider panel to the right of the Toolbar.

```typescript
// OpacityPopup.tsx
interface OpacityPopupProps {
  value: number;              // 0–1
  onChange: (v: number) => void;
}
```

The slider range is `0–100` with `step={5}`. Display the numeric value as `Math.round(value * 100) + '%'`.

---

### Step 4.3 — Recent colors in ColorPickerPopup

**Files to modify:** `src/lib/store/canvasStore.ts`, `src/components/ui/ColorPickerPopup.tsx`

Add `recentColors: string[]` (max 8) to `canvasStore`. Updated whenever `applyColor` is called:

```typescript
// In canvasStore state interface:
recentColors: string[];

// In initial state:
recentColors: [],

// New action:
addRecentColor: (color: string) => set((state) => {
  const filtered = state.recentColors.filter((c) => c !== color);
  return { recentColors: [color, ...filtered].slice(0, 8) };
}),
```

In `ColorPickerPopup`, call `addRecentColor` inside `applyColor`. Render a "Recent" row above Presets:

```tsx
{recentColors.length > 0 && (
  <div className="mb-3">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Recent</div>
    <div className="flex gap-1.5">
      {recentColors.map((color) => (
        <button key={color} onClick={() => applyColor(color)}
          className="h-7 w-7 rounded-full border-2 border-black/10 hover:scale-110 hover:border-gray-400 transition-all"
          style={{ backgroundColor: color }} title={color} />
      ))}
    </div>
  </div>
)}
```

---

### Step 4.4 — ShortcutLegend: add Ctrl+A, Ctrl+C/V, Delete

**File to modify:** `src/components/ui/ShortcutLegend.tsx`

The legend currently has 2 entries. Add 3 more:

```typescript
function SelectAllIcon() { /* ⌄ dashed rect with all-corners selected */ }
function CopyPasteIcon() { /* two overlapping docs */ }
function DeleteIcon()    { /* backspace key outline */ }

const shortcuts: Shortcut[] = [
  { icon: <MarqueeIcon />,    label: 'Select',      keys: 'Ctrl + Drag'  },
  { icon: <MultiSelectIcon />, label: 'Multi-Select', keys: 'Ctrl + Click' },
  { icon: <SelectAllIcon />,  label: 'Select All',  keys: 'Ctrl + A'    },
  { icon: <CopyPasteIcon />,  label: 'Copy / Paste', keys: 'Ctrl + C / V' },
  { icon: <DeleteIcon />,     label: 'Delete',       keys: 'Delete'      },
];
```

The bar may need to scroll horizontally on narrow screens — add `overflow-x-auto` and remove `gap-4` max so items wrap. Consider a 2-row layout if more than 4 entries.

---

### Step 4.5 — Shift key → temporary pointer mode

**File to modify:** `src/hooks/useKeyboardShortcuts.ts`

Mirror the existing `Ctrl` → pointer behavior for `Shift`. Use `keydown`/`keyup` with a stored "pre-shift mode" so the user returns to their previous tool when Shift is released:

```typescript
// In useKeyboardShortcuts, outside useEffect (stable ref):
const preShiftModeRef = useRef<{ mode: CanvasMode; tool: ObjectType | null } | null>(null);

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift' && !e.repeat) {
      const { mode, creationTool } = useCanvasStore.getState();
      if (mode !== 'pointer') {
        preShiftModeRef.current = { mode, tool: creationTool };
        useCanvasStore.getState().setMode('pointer');
      }
    }
    // ... existing shortcuts ...
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift' && preShiftModeRef.current) {
      const prev = preShiftModeRef.current;
      preShiftModeRef.current = null;
      if (prev.tool) useCanvasStore.getState().enterCreateMode(prev.tool);
      else useCanvasStore.getState().setMode(prev.mode);
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
}, [/* stable deps only */]);
```

**Important:** Skip if focus is in an `INPUT` or `TEXTAREA` (same guard used for `/` shortcut).

---

### Step 4.6 — Copy toast notification

**File to modify:** `src/hooks/useKeyboardShortcuts.ts` or `src/components/canvas/Canvas.tsx`

When `Ctrl+C` copies objects, show a brief toast: `"Copied N object(s)"`.

Use a simple DOM-based toast rather than a library. A lightweight approach:
```typescript
function showToast(message: string) {
  const el = document.createElement('div');
  el.textContent = message;
  el.className = 'fixed bottom-16 left-1/2 -translate-x-1/2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white shadow-lg z-[300] pointer-events-none';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}
```

Call inside the Ctrl+C handler after `copyToClipboard(selectedObjects)`.

---

## Sprint 5: Bottom Action Bar (Copy / Paste / Delete)

**Goal:** Visible action buttons appear when objects are selected, so users discover these operations without knowing shortcuts.

---

### Step 5.1 — Create `SelectionActionBar` component

**File to create:** `src/components/ui/SelectionActionBar.tsx`

A fixed bar that appears above the shortcut legend (`bottom-10`) when `selectedObjectIds.length > 0`.

```typescript
'use client';

import { useCanvasStore } from '@/lib/store/canvasStore';
import { useObjectStore } from '@/lib/store/objectStore';
import { deleteObject } from '@/lib/firebase/firestore';

interface SelectionActionBarProps {
  boardId: string;
}

export default function SelectionActionBar({ boardId }: SelectionActionBarProps) {
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const clipboard = useCanvasStore((s) => s.clipboard);
  const copyToClipboard = useCanvasStore((s) => s.copyToClipboard);
  const pasteFromClipboard = useCanvasStore((s) => s.pasteFromClipboard); // see Step 5.2
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const objects = useObjectStore((s) => s.objects);
  const deleteObjectLocal = useObjectStore((s) => s.deleteObjectLocal);

  if (selectedObjectIds.length === 0) return null;

  const handleCopy = () => {
    const selected = selectedObjectIds.map((id) => objects[id]).filter(Boolean);
    copyToClipboard(selected);
  };

  const handlePaste = () => pasteFromClipboard(boardId);

  const handleDelete = async () => {
    for (const id of selectedObjectIds) {
      deleteObjectLocal(id);
      await deleteObject(boardId, id);
    }
    clearSelection();
  };

  return (
    <div className="fixed bottom-10 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-white/80 px-2 py-1 shadow-md backdrop-blur-sm">
      <span className="mr-2 text-xs text-gray-400">{selectedObjectIds.length} selected</span>
      <button onClick={handleCopy} className="rounded px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">
        Copy
      </button>
      {clipboard.length > 0 && (
        <button onClick={handlePaste} className="rounded px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">
          Paste
        </button>
      )}
      <div className="mx-1 h-4 w-px bg-gray-200" />
      <button
        onClick={handleDelete}
        className="rounded px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
      >
        Delete
      </button>
    </div>
  );
}
```

---

### Step 5.2 — Extract `pasteFromClipboard` action into canvasStore

**File to modify:** `src/lib/store/canvasStore.ts`

Currently, paste logic lives in `useKeyboardShortcuts`. Extract it into the store so `SelectionActionBar` can call it without duplicating logic:

```typescript
// In canvasStore interface:
pasteFromClipboard: (boardId: string) => Promise<void>;

// In create():
pasteFromClipboard: async (boardId) => {
  const { clipboard, pasteCount } = get();
  if (clipboard.length === 0) return;
  const offset = (pasteCount + 1) * 20;
  // import addObject from firestore inside the action or use a passed-in handler
  // (see note below)
  set({ pasteCount: pasteCount + 1 });
},
```

**Note on Firestore dependency in store:** The store already imports from `@/lib/firebase/firestore` in some places. If the team prefers to keep the store import-free, keep paste logic in `useKeyboardShortcuts` and expose it via a React context or a stable ref instead. The simplest path for now is to allow the `addObject` import in the store.

---

### Step 5.3 — Mount `SelectionActionBar` in board page

**File to modify:** `src/app/board/[boardId]/page.tsx` or `src/components/canvas/Canvas.tsx`

Add alongside the existing UI overlays:
```tsx
import SelectionActionBar from '@/components/ui/SelectionActionBar';

// In JSX (inside the board page wrapper, after Canvas):
<SelectionActionBar boardId={boardId} />
```

The `bottom-10` positioning places it just above the `ShortcutLegend` (which is at `bottom-4`). Adjust if the shortcut legend expands vertically in Sprint 4.

---

## Dependency Map

```
Sprint 1 (Line shape) — independent; can start any time
Sprint 2 (Frame click-through) — independent; no Sprint 1 dep
Sprint 3.1 (Frame drag preview) — no deps; FrameObject.tsx already has childSnapshots
Sprint 3.2/3.3 (readability) — no deps
Sprint 4.3 (recent colors) — no deps on other sprints
Sprint 4.4 (shortcut legend) — no deps
Sprint 4.5 (Shift → pointer) — no deps
Sprint 4.6 (copy toast) — no deps
Sprint 5 — Step 5.2 must precede Step 5.3
```

Sprints 1–4 are all independent and can be parallelised. Sprint 5 is 3 sequential steps.

---

## Files Summary

| Sprint | New Files | Modified Files |
|--------|-----------|----------------|
| 1 | `LineObject.tsx`, `src/lib/utils.ts` (getStrokeDash) | `types.ts`, `Toolbar.tsx`, `BoardObjects.tsx`, `Canvas.tsx`, `AnchorPoints.tsx` |
| 2 | — | `FrameObject.tsx`, `StickyNote.tsx`, `ShapeObject.tsx`, `ContextMenu.tsx` |
| 3 | — | `FrameObject.tsx` |
| 4 | `OpacityPopup.tsx` | `canvasStore.ts`, `ColorPickerPopup.tsx`, `ShortcutLegend.tsx`, `Toolbar.tsx`, `useKeyboardShortcuts.ts` |
| 5 | `SelectionActionBar.tsx` | `canvasStore.ts`, `Canvas.tsx` or `board/[boardId]/page.tsx` |
