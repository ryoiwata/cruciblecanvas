# PLAN_PHASE_4_ENGINEERING.md — Final Architecture Fixes & UI Polish

**Status:** Planning
**Date:** 2026-02-20
**Branch target:** `ui_features`

---

## Overview

This plan addresses four engineering areas for the final CrucibleCanvas polish sprint, driven by a full codebase audit. Each area is ordered by dependency — undo/redo must be hardened first so that every subsequent change is immediately undoable by the user.

### Implementation Order

1. **Undo/Redo hardening** — foundational; all other changes depend on this being wired
2. **Properties Sidebar overhaul** — minimalist context-aware rendering + dimension inputs
3. **Frame spatial logic** — auto-expand on child boundary hit + no forced layout confirmation
4. **Cursor coordinates overlay**
5. **Text & Sticky Note refinements** — real-time editing, line alignment, standalone defaults
6. **Group right-click interaction** — maintain transformer when context menu opens
7. **Toolbar shortcut numbers** — inline shortcut labels per tool

---

## Audit Findings Summary

| Area | Key Gap | Files Affected |
|------|---------|----------------|
| Undo/Redo | `snapshot()` never called on drag, transform, text edit, or property change (~80% of actions) | objectStore, SelectionLayer, Canvas, PropertiesSidebar, TextEditor |
| Properties Sidebar | `TextModule` shown for shapes; no H/W dimension inputs | PropertiesSidebar, modules/ |
| Frame Spatial | Frame does not auto-expand when child approaches/crosses boundary | FrameObject, useFrameNesting |
| Text Editing | Firestore written only on editor close, not on keystroke; StickyNote hardcodes `#1a1a1a` (ignores textColor) | StickyNote, TextEditor |
| Group Right-click | Context menu may reset selection; transformer disappears during menu | ContextMenu, object components |
| Toolbar | Shortcut keys not shown inline next to tool label | SubHeaderToolbar |

---

## Phase 1 — Undo/Redo Hardening

### Problem

`objectStore.ts` has a full history system (`past`/`future`, max 30 snapshots) and working `undo()`/`redo()` actions with Firestore delta sync. However, `snapshot()` must be called **before** each mutation to save the pre-change state. Currently it's only auto-called in `removeObject` and `batchRemove`. Every other action — drag, resize, rotate, text edit, property change — is not undoable.

### 1.1 — Drag Start Snapshot

**Files:** `src/components/canvas/ShapeObject.tsx`, `StickyNote.tsx`, `FrameObject.tsx`, `TextObject.tsx`

In each component's `handleDragStart` callback, call `snapshot()` before the lock acquisition and local edit start:

```ts
// In handleDragStart (all draggable object components):
const handleDragStart = useCallback(() => {
  useObjectStore.getState().snapshot();   // ADD THIS LINE
  startLocalEdit(object.id);
  acquireLock(object.id);
  // ... rest of existing code
}, [object.id, acquireLock, startLocalEdit]);
```

**Why before, not after:** `snapshot()` saves the current state as the "before" image. Calling it after the drag would save the moved state, not the original.

**Deduplication note:** If a user starts then immediately stops a drag (mousedown + mouseup without moving), the snapshot is still created but undo will restore to an identical state — harmless but wastes a history slot. Acceptable for MVP.

### 1.2 — Transform Start Snapshot

**File:** `src/components/canvas/SelectionLayer.tsx`

In `handleTransformStart` (line 173), add snapshot before the lock loop:

```ts
const handleTransformStart = useCallback(() => {
  useObjectStore.getState().snapshot();   // ADD THIS LINE
  selectedObjectIds.forEach((id) => {
    acquireLock(id);
    startLocalEdit(id);
  });
}, [selectedObjectIds, acquireLock, startLocalEdit]);
```

### 1.3 — Spatial Index Rebuild After Transform

**File:** `src/components/canvas/SelectionLayer.tsx`

The audit found that `handleTransformEnd` (line 189) does NOT call `rebuildSpatialIndex()` after baking transform results, which means viewport culling uses stale bounding boxes after every resize/rotate.

In `handleTransformEnd`, after all objects are updated, add:

```ts
// At end of handleTransformEnd, after the selectedObjectIds.forEach loop:
useObjectStore.getState().rebuildSpatialIndex();
```

### 1.4 — Text Edit Snapshot

**File:** `src/components/canvas/TextEditor.tsx` (or wherever `editingObjectId` is set)

In `Canvas.tsx`, when double-click triggers text editing, call `snapshot()` before setting `editingObjectId`:

```ts
// In the dblclick handler that opens the text editor:
useObjectStore.getState().snapshot();
setEditingObject(objectId);
```

### 1.5 — Property Change Snapshot

**File:** `src/components/properties/PropertiesSidebar.tsx`

The sidebar already debounces Firestore writes (300ms). Add a `hasSnapshotted` ref per edit session so that exactly one snapshot is taken for a burst of property changes:

```ts
// Add at component level:
const hasSnapshottedRef = useRef(false);

// In handleChange (line 187), before the debounce logic:
const handleChange = useCallback((patch: Partial<BoardObject>) => {
  if (!hasSnapshottedRef.current) {
    useObjectStore.getState().snapshot();
    hasSnapshottedRef.current = true;
    // Reset on next frame so the next distinct user interaction gets its own snapshot
    setTimeout(() => { hasSnapshottedRef.current = false; }, 1000);
  }
  // ... existing debounce + multi-select logic
}, [/* deps */]);
```

### 1.6 — Object Creation Snapshot

**File:** `src/components/canvas/Canvas.tsx`

When `handleMouseUp` commits a new object (calls `addObject()`), call `snapshot()` first:

```ts
// Just before addObject() in handleMouseUp:
useObjectStore.getState().snapshot();
addObject(newObject);
```

### 1.7 — Context Menu Action Snapshots

**File:** `src/components/ui/ContextMenu.tsx`

Add `snapshot()` at the start of `handleDelete`, `handleGroupDelete`, `handleGroupDuplicate`, and `handleGroupDeframe`:

```ts
const handleDelete = () => {
  useObjectStore.getState().snapshot();   // ADD
  // ... existing delete logic
};
```

### 1.8 — Wire Undo/Redo Buttons

**File:** `src/components/ui/SubHeaderToolbar.tsx`

The undo/redo button handlers (lines 312–322) already call `useObjectStore.getState().undo()` and sync the delta to Firestore. Verify these work end-to-end after the snapshot gaps are closed. Also update the `disabled` state to check actual history length:

```ts
const canUndo = useObjectStore(s => s.past.length > 0);
const canRedo = useObjectStore(s => s.future.length > 0);
// Pass to buttons: disabled={!canUndo} / disabled={!canRedo}
```

---

## Phase 2 — Properties Sidebar Overhaul

### Problem

The sidebar shows `TextModule` for shapes (rectangle, circle), which clutters the interface with irrelevant controls. There are also no Height/Width dimension inputs for shapes, making precise sizing impossible.

### 2.1 — Minimalist Module Routing

**File:** `src/components/properties/PropertiesSidebar.tsx`

Update `getModuleSet()` (around line 47) to remove `TextModule` from shape contexts:

```ts
function getModuleSet(type: ObjectType): ModuleKey[] {
  switch (type) {
    case 'rectangle':
    case 'circle':
      return ['dimension', 'shape'];        // NO text module for pure shapes
    case 'stickyNote':
      return ['stickyNote', 'text'];        // font/size/color for sticky text
    case 'text':
      return ['dimension', 'text'];          // standalone text
    case 'frame':
      return ['dimension', 'frame'];
    case 'line':
    case 'connector':
      return ['line'];
    default:
      return [];
  }
}
```

**Rationale:** Shapes can hold text (double-click), but that is an advanced use case. The primary properties for a shape are its fill, stroke, and dimensions. Text styling for shape labels is a secondary concern and can be added back later if needed.

### 2.2 — Dimension Module (Height/Width Inputs)

**New file:** `src/components/properties/modules/DimensionModule.tsx`

```tsx
/**
 * DimensionModule — shows numeric width/height inputs for the selected object.
 * Applies to shapes, frames, and standalone text objects.
 */
interface DimensionModuleProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

export function DimensionModule({ object, onChange }: DimensionModuleProps) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Size</div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-gray-500 block mb-1">W</label>
          <input
            type="number"
            min={10}
            max={4000}
            value={Math.round(object.width ?? 100)}
            onChange={e => onChange({ width: Number(e.target.value) })}
            className="w-full text-sm border border-gray-200 rounded px-2 py-1 text-center"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 block mb-1">H</label>
          <input
            type="number"
            min={10}
            max={4000}
            value={Math.round(object.height ?? 100)}
            onChange={e => onChange({ height: Number(e.target.value) })}
            className="w-full text-sm border border-gray-200 rounded px-2 py-1 text-center"
          />
        </div>
      </div>
    </div>
  );
}
```

**Wire into PropertiesSidebar:** Import `DimensionModule` and add it to the `modules` map under the key `'dimension'`. The `getModuleSet` function above already references this key.

### 2.3 — Preset Colors Update

**File:** `src/lib/types.ts` — `STYLE_PRESETS` array

Replace the current preset colors with pastel variants. Use HSL values at 85–90% lightness for all presets. Each preset object should follow the existing `{ name, color, strokeColor, opacity }` shape. Remove any presets that have deeply saturated or dark background fills.

---

## Phase 3 — Frame Spatial Logic

### Problem

When a child object (ShapeObject, StickyNote) is dragged, it can freely exit the frame's bounding box without triggering any feedback. The frame does not expand to contain children approaching its edges. This causes children to visually "escape" their containing frame.

**Free Movement Confirmation:** The existing implementation has NO forced layout (no grid snapping within frames), so child free-movement within the frame is already working correctly. No changes needed for that requirement.

### 3.1 — Frame Auto-Expand on Child Boundary Hit

**Implementation strategy:** When a child's drag ends (or moves), check if its bounding box extends beyond the parent frame's bounds. If so, expand the frame outward to contain the child plus a padding margin.

**File:** `src/lib/store/objectStore.ts`

Add a new action `expandFrameToContainChild`:

```ts
expandFrameToContainChild: (childId: string) => {
  const { objects, updateObjectLocal } = get();
  const child = objects[childId];
  if (!child?.parentFrame) return;
  const frame = objects[child.parentFrame];
  if (!frame || frame.type !== 'frame') return;

  const PADDING = 24; // px padding inside frame edge
  const childRight  = child.x + (child.width  ?? 100);
  const childBottom = child.y + (child.height ?? 100);

  const newX      = Math.min(frame.x, child.x - PADDING);
  const newY      = Math.min(frame.y, child.y - PADDING);
  const newRight  = Math.max(frame.x + (frame.width  ?? 200), childRight  + PADDING);
  const newBottom = Math.max(frame.y + (frame.height ?? 200), childBottom + PADDING);

  const widthDelta  = frame.x - newX;
  const heightDelta = frame.y - newY;

  if (widthDelta > 0 || heightDelta > 0 || newRight > frame.x + (frame.width ?? 200) || newBottom > frame.y + (frame.height ?? 200)) {
    updateObjectLocal(frame.id, {
      x: newX,
      y: newY,
      width:  newRight  - newX,
      height: newBottom - newY,
    });
    // Persist frame expansion to Firestore
    updateObject(frame.id, {
      x: newX,
      y: newY,
      width:  newRight  - newX,
      height: newBottom - newY,
    });
  }
}
```

**Call site — child `handleDragEnd`:**

In `ShapeObject.tsx`, `StickyNote.tsx`, and `TextObject.tsx`, after the object's own position is committed to Firestore, call:

```ts
// At the end of handleDragEnd, after updateObject():
if (object.parentFrame) {
  useObjectStore.getState().expandFrameToContainChild(object.id);
}
```

### 3.2 — Frame Minimum Size on Resize

**File:** `src/components/canvas/SelectionLayer.tsx`

In `boundBoxFunc` of the Transformer (line ~305), add a minimum size guard that prevents shrinking a frame to smaller than its tallest/widest child:

```ts
boundBoxFunc={(oldBox, newBox) => {
  if (target.type === 'frame') {
    const children = Object.values(useObjectStore.getState().objects)
      .filter(o => o.parentFrame === target.id);
    if (children.length > 0) {
      const PADDING = 24;
      const minW = Math.max(50, ...children.map(c => (c.x - target.x) + (c.width ?? 100) + PADDING));
      const minH = Math.max(50, ...children.map(c => (c.y - target.y) + (c.height ?? 100) + PADDING));
      if (newBox.width < minW || newBox.height < minH) return oldBox;
    }
  }
  // ... existing min size checks
  return newBox;
}}
```

---

## Phase 4 — Cursor Coordinates Overlay

### Goal

Display the current canvas X/Y coordinates (stage-space, not screen-space) next to the user's cursor for precision placement.

### 4.1 — Canvas Coordinate Overlay

**File:** `src/components/canvas/Canvas.tsx`

Add a `cursorPos` state and update it on `onMouseMove` of the Stage:

```ts
const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

// On Stage onMouseMove:
const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
  const stage = stageRef.current;
  if (!stage) return;
  const pos = stage.getPointerPosition();
  if (!pos) return;
  const transform = stage.getAbsoluteTransform().copy().invert();
  const stagePos = transform.point(pos);
  setCursorPos({ x: Math.round(stagePos.x), y: Math.round(stagePos.y) });
  // ... throttled cursor presence update (existing)
};
```

Render the coordinate label as a DOM overlay (not Konva, to avoid canvas re-render):

```tsx
{cursorPos && (
  <div
    className="absolute pointer-events-none z-20 text-xs font-mono text-gray-500 bg-white/80 rounded px-1.5 py-0.5 shadow-sm select-none"
    style={{ left: screenCursorX + 16, top: screenCursorY + 16 }}
  >
    {cursorPos.x}, {cursorPos.y}
  </div>
)}
```

Track the screen cursor position separately (on the container's `onMouseMove`, not the Stage), using `e.clientX` and `e.clientY` for the DOM overlay position.

**Performance note:** The audit confirmed that cursor sync to Firestore is already throttled at 16ms with a 3px threshold. The coordinate display update should use a separate `useRef` with RAF coalescing so it doesn't trigger a full React re-render on every pixel of mouse movement. Use `useState` with a 32ms throttle (two frames) for the display state.

---

## Phase 5 — Text & Sticky Note Refinements

### 5.1 — Real-time Text Editing (Live Canvas Sync)

**Problem:** The TextEditor is an HTML textarea overlay. When the user types, the Konva Text node underneath is not updated until the editor closes. This means the canvas shows the old text during editing.

**File:** `src/components/canvas/TextEditor.tsx`

Add an `onChange` callback that fires on every keystroke, updating the object's local state (not Firestore) in real-time:

```ts
// In TextEditor, in the textarea onChange handler:
const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const newText = e.target.value;
  setLocalText(newText);
  // Update Konva immediately (local state only, no Firestore write):
  useObjectStore.getState().updateObjectLocal(editingObjectId, { text: newText });
};
```

On editor close (`onBlur` or Enter), the existing Firestore write persists the final value. The debounced Firestore write during typing should be added with a 500ms debounce to also persist in case the user navigates away mid-edit:

```ts
// 500ms debounced Firestore write during typing:
const debouncedFirestoreWrite = useMemo(
  () => debounce((text: string) => updateObject(editingObjectId, { text }), 500),
  [editingObjectId]
);
```

### 5.2 — Sticky Note Text Line Alignment

**Problem:** StickyNote renders notepad lines at 22px spacing with 30px top offset, but the Konva Text node's y position and lineHeight may not align with these lines, causing text to float between lines.

**File:** `src/components/canvas/StickyNote.tsx`

The Konva Text node should use `lineHeight={22/fontSize}` (Konva uses a ratio, not px) and `y` aligned to the first line baseline. For a default fontSize of 14:
- `lineHeight = 22 / 14 ≈ 1.57`
- Text `y` should be `30` (matches the first horizontal line)
- `padding={0}` to prevent Konva from adding internal padding that would shift text off the lines

```ts
<Text
  x={12}
  y={30}                              // align with first notepad line
  width={(object.width ?? 200) - 24}
  text={object.text ?? ''}
  fontSize={object.fontSize ?? 14}
  lineHeight={22 / (object.fontSize ?? 14)}  // match notepad line spacing
  fontFamily={getFontFamily(object.fontFamily)}
  fill={object.textColor ?? '#1a1a1a'}        // FIX: use textColor not hardcode
  wrap="word"
  listening={false}
/>
```

**Bug fix included:** The hardcoded `fill="#1a1a1a"` is replaced with `fill={object.textColor ?? '#1a1a1a'}` so that changing text color in StickyNoteModule actually takes effect.

### 5.3 — Standalone Text Defaults

**Problem:** New `text` objects default to fontSize 16 and inherit whatever `activeColor` is set. Users expect standalone text to be black and visibly larger.

**File:** `src/components/canvas/Canvas.tsx` — `getDefaultsForTool()` function (line 74)

Update the `'text'` case:

```ts
case 'text':
  return {
    fontSize: 24,            // larger default (was 16)
    color: '#000000',        // always default to black
    textColor: '#000000',
    width: 250,
    height: 50,
    text: '',
  };
```

**Last-used style inheritance:** If the user previously selected a standalone `text` object, the properties sidebar syncs `activeColor`. To inherit that instead of always forcing black, check if the last interaction was with a `text` type:

```ts
// In getDefaultsForTool('text'):
const lastTextColor = useCanvasStore.getState().lastUsedColors['text'];
return {
  fontSize: 24,
  color: lastTextColor ?? '#000000',
  textColor: lastTextColor ?? '#000000',
  // ...
};
```

---

## Phase 6 — Group Right-click Interaction

### Problem

When multiple objects are selected and the user right-clicks one of them, the selection visual (Transformer handles) may disappear because right-clicking calls `selectObject(id)` (single select), replacing the multi-selection.

### 6.1 — Suppress Selection Change on Right-click

**Files:** `src/components/canvas/ShapeObject.tsx`, `StickyNote.tsx`, `FrameObject.tsx`, `TextObject.tsx`, `ConnectorObject.tsx`

In each component's `handleContextMenu`, check if the right-clicked object is already in the multi-selection. If so, do NOT change the selection — just open the context menu for the group:

```ts
const handleContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
  e.cancelBubble = true;
  const { selectedObjectIds, setContextMenu } = useCanvasStore.getState();
  const isAlreadySelected = selectedObjectIds.includes(object.id);

  // If this object is part of a multi-selection, keep the full selection active.
  // Only switch to single-select if right-clicking an unselected object.
  if (!isAlreadySelected) {
    useCanvasStore.getState().selectObject(object.id);
  }

  const targetIds = (isAlreadySelected && selectedObjectIds.length > 1)
    ? selectedObjectIds
    : [object.id];

  setContextMenu({
    visible: true,
    x: e.evt.clientX,
    y: e.evt.clientY,
    targetObjectId: targetIds.length === 1 ? targetIds[0] : null,
    targetObjectIds: targetIds,
    nearbyFrames: [],
  });
}, [object.id]);
```

### 6.2 — canvasStore ContextMenuState Update

**File:** `src/lib/store/canvasStore.ts`

Ensure `ContextMenuState` includes `targetObjectIds: string[]` (may already exist per older plan):

```ts
interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetObjectId: string | null;
  targetObjectIds: string[];       // multi-select group target
  nearbyFrames: { id: string; title: string }[];
}
```

Initial value: `targetObjectIds: []`

### 6.3 — ContextMenu Group Actions

**File:** `src/components/ui/ContextMenu.tsx`

When `contextMenu.targetObjectIds.length > 1`, render group-specific actions:
- **Delete N objects** — calls existing `handleGroupDelete` with all IDs
- **Duplicate group** — calls `handleGroupDuplicate` with all IDs
- **Deframe all selected** — if any target has `parentFrame`, shows "Deframe" action

When `targetObjectIds.length === 1`, render the existing single-object menu.

---

## Phase 7 — Toolbar Shortcut Numbers

### Problem

Each tool in `SubHeaderToolbar.tsx` has a `shortcut` prop, but the `ToolButton` component renders it only as a tooltip (title attribute), not inline next to the label.

### 7.1 — Inline Shortcut Badge

**File:** `src/components/ui/SubHeaderToolbar.tsx` — `ToolButton` component (lines 140–159)

Update the render to show the shortcut key as a small badge below the icon+label stack:

```tsx
function ToolButton({ label, icon, isActive, disabled, shortcut, onClick }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`flex flex-col items-center justify-center gap-0.5 px-2 h-full min-w-[48px] rounded transition-colors
        ${isActive ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-[10px] leading-tight font-medium">{label}</span>
      {shortcut && (
        <span className="text-[9px] leading-none text-gray-400 font-mono bg-gray-100 rounded px-0.5">
          {shortcut}
        </span>
      )}
    </button>
  );
}
```

### 7.2 — Shortcut Number Assignment

Ensure each tool in the toolbar renders has correct shortcut values in this order:

| # | Tool | Shortcut |
|---|------|---------|
| 1 | Pointer/Select | `1` |
| 2 | Line | `L` |
| 3 | Connector | `C` |
| 4 | Shapes (dropdown) | `R` |
| 5 | Text | `T` |
| 6 | Sticky | `2` |

**File:** `src/hooks/useKeyboardShortcuts.ts`

Add missing shortcuts for tools that don't have them:
- `L` → `setCreationTool('line')`
- `R` → `setCreationTool('rectangle')`
- `T` → `setCreationTool('text')`

---

## File Change Summary

| File | Type | Phase | Description |
|------|------|-------|-------------|
| `src/lib/store/objectStore.ts` | Modify | 1, 3 | `expandFrameToContainChild` action |
| `src/components/canvas/ShapeObject.tsx` | Modify | 1, 3, 6 | Drag snapshot, frame expand call, group ctx menu |
| `src/components/canvas/StickyNote.tsx` | Modify | 1, 3, 5, 6 | Drag snapshot, frame expand call, line alignment, group ctx menu |
| `src/components/canvas/FrameObject.tsx` | Modify | 6 | Group ctx menu |
| `src/components/canvas/TextObject.tsx` | Modify | 1, 6 | Drag snapshot, group ctx menu |
| `src/components/canvas/ConnectorObject.tsx` | Modify | 6 | Group ctx menu |
| `src/components/canvas/SelectionLayer.tsx` | Modify | 1 | Transform snapshot, spatial index rebuild after transform |
| `src/components/canvas/Canvas.tsx` | Modify | 1, 4, 5 | Creation snapshot, cursor coordinates overlay, text defaults |
| `src/components/canvas/TextEditor.tsx` | Modify | 5 | Live local state update on keystroke + debounced Firestore write |
| `src/components/properties/PropertiesSidebar.tsx` | Modify | 1, 2 | Property change snapshot, updated `getModuleSet()` |
| `src/components/properties/modules/DimensionModule.tsx` | **New** | 2 | Width/Height numeric inputs |
| `src/lib/store/canvasStore.ts` | Modify | 6 | `ContextMenuState.targetObjectIds` |
| `src/components/ui/ContextMenu.tsx` | Modify | 1, 6 | Snapshot on delete/duplicate, group action rendering |
| `src/components/ui/SubHeaderToolbar.tsx` | Modify | 1, 7 | `canUndo`/`canRedo` from store, inline shortcut badges |
| `src/hooks/useKeyboardShortcuts.ts` | Modify | 7 | Missing tool shortcuts (L, R, T) |
| `src/lib/types.ts` | Modify | 2 | Pastel STYLE_PRESETS update |

---

## Open Questions / Risks

1. **Frame expand vs. drag clamp (conflict):** The old `PLAN_FINAL_POLISH.md` proposed `dragBoundFunc` to clamp children inside frame bounds. This plan proposes the opposite: auto-expand the frame to follow the child. These two approaches are mutually exclusive. **Decision: use auto-expand** (more natural UX; lets frames grow organically). Do NOT add `dragBoundFunc` to child objects.

2. **Undo of frame expansion:** When frame auto-expands due to child drag, the `snapshot()` is called at `handleDragStart` (before the drag). So undo will correctly restore both the child's position AND the frame's size to their pre-drag state. No extra snapshot needed.

3. **Cursor coordinates DOM overlay performance:** The coordinate label is a DOM div that updates position on every mousemove. To avoid layout thrash, use `transform: translate(${x}px, ${y}px)` instead of `left`/`top` for the position update. With RAF coalescing (one update per frame max), this is imperceptible overhead.

4. **TextEditor live sync and `updateObjectLocal`:** The `updateObjectLocal` action in `objectStore` updates the in-memory object but does NOT write to Firestore. This is the correct pattern — live canvas updates should be instant, Firestore writes debounced. Verify `updateObjectLocal` is already exported from the store (it is, based on the sidebar using it).

5. **StickyNote text alignment edge cases:** If `fontSize` is very large (e.g., 48px), the `lineHeight = 22 / fontSize` ratio becomes less than 1 — Konva clamps it to 1, meaning lines will overlap the notepad lines. Add a `Math.max(1, 22 / fontSize)` guard. For very large text, the notepad lines become decorative only.

6. **Group context menu `targetObjectIds` backward compatibility:** `ContextMenu.tsx` may have checks for `targetObjectId` being non-null. After the change, single-object menus set `targetObjectId` (non-null, same as before) and `targetObjectIds: [id]`. Group menus set `targetObjectId: null` and `targetObjectIds: [...ids]`. Existing `targetObjectId`-based checks remain valid for single-object case.
