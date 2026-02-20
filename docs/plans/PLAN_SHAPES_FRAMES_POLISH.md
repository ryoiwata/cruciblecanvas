# Plan: Advanced Shapes, Frame Logic & UI Polish

**Source:** User requirements — 4-sprint roadmap
**Depends on:** PLAN_REMAINING_FEATURES.md (line object, frame glow, selection bar — already built)

---

## Summary

Four sprints that complete the canvas's object-manipulation story. Sprints 1–2 touch core data-flow (types, z-index layering, frame capture) and must ship first. Sprints 3–4 are pure UX improvements that can follow independently.

---

## Sprint 1: Advanced Shapes & Connectors

**Goal:** Add `thickness` and `borderType` fields to `BoardObject`; wire them to line, connector, and shape rendering; improve default visibility.

---

### Step 1.1 — Extend `BoardObject` type

**File:** `src/lib/types.ts`

Add two optional fields to `BoardObject`:

```typescript
// Visual properties (extend existing section)
thickness?: number;      // stroke width in canvas units; 1–10; defaults to type-specific constant
borderType?: 'solid' | 'dashed' | 'dotted';  // border/stroke style for shapes and lines
```

Add constants for defaults:

```typescript
export const LINE_DEFAULTS = {
  width: 120,
  height: 0,
  color: '#374151',
  thickness: 2,
} as const;

// Update existing:
export const CONNECTOR_DEFAULTS = {
  color: '#6B7280',
  style: 'solid' as ConnectorStyle,
  strokeWidth: 2.5,  // was 2
} as const;
```

---

### Step 1.2 — Wire `thickness` to `LineObject`

**File:** `src/components/canvas/LineObject.tsx`

Replace hardcoded `strokeWidth={2}` with:
```tsx
strokeWidth={object.thickness ?? LINE_DEFAULTS.thickness}
```

Wire `borderType` to dash pattern (same `getStrokeDash` helper already in utils.ts):
```typescript
const dash = getStrokeDash(object.borderType ?? object.metadata?.connectorStyle);
```

---

### Step 1.3 — Wire `thickness` to `ConnectorObject`

**File:** `src/components/canvas/ConnectorObject.tsx`

Replace hardcoded `strokeWidth`:
```tsx
// Was: strokeWidth={isSelected ? 3 : 2}
strokeWidth={isSelected ? (object.thickness ?? 2.5) + 1 : (object.thickness ?? 2.5)}
```

---

### Step 1.4 — Thickness slider in Toolbar

**File:** `src/components/ui/Toolbar.tsx`

When selected objects include a `line` or `connector`, show a compact "Thickness" range input (1–10) in the toolbar, alongside the font selector:

```tsx
{selectedLines.length > 0 && (
  <div className="flex flex-col gap-1 px-0.5">
    <span className="text-center text-[10px] text-gray-500">Thickness</span>
    <input
      type="range" min={1} max={10} step={0.5}
      value={selectedLines[0].thickness ?? 2}
      onChange={(e) => handleThicknessChange(Number(e.target.value))}
      className="h-1 w-full cursor-pointer accent-indigo-500"
    />
  </div>
)}
```

`handleThicknessChange` calls `updateObjectLocal` + `updateObject` for each selected line/connector.

---

### Step 1.5 — Connector anchoring to framed objects

**Status:** Already works. `ConnectorObject` looks up endpoints by ID — frame membership (`parentFrame`) doesn't affect the lookup. No changes needed.

**Verification:** The `AnchorPoints` component is rendered for all non-connector, non-colorLegend, non-line objects in connector mode. Since framed objects render in `BoardObjects` and z-index puts them above frames, their hit areas are reachable.

---

## Sprint 2: Deep Frame Logic & Selection

**Goal:** Frame z-index layering, reverse capture, containment semantics, bolder framed indicators, contextual right-click.

---

### Step 2.1 — Frame Z-Index layering system

**File:** `src/lib/types.ts`

Add layering constants:
```typescript
/** Frames are always rendered below all other objects. */
export const FRAME_ZINDEX_MAX = 1000;
/** Non-frame objects always start above frames. */
export const OBJECT_ZINDEX_MIN = 1001;
```

**File:** `src/components/canvas/Canvas.tsx`

Replace `getMaxZIndex()` with a type-aware version:
```typescript
function getMaxZIndexForTool(tool: ObjectType): number {
  const objs = useObjectStore.getState().objects;
  if (tool === 'frame') {
    let max = 0;
    for (const o of Object.values(objs)) {
      if (o.type === 'frame') max = Math.max(max, o.zIndex ?? 0);
    }
    return Math.min(max + 1, FRAME_ZINDEX_MAX);
  }
  // Non-frame: start at OBJECT_ZINDEX_MIN, grow upward
  let max = OBJECT_ZINDEX_MIN - 1;
  for (const o of Object.values(objs)) {
    if (o.type !== 'frame') max = Math.max(max, o.zIndex ?? 0);
  }
  return max + 1;
}
```

Replace all `getMaxZIndex() + 1` calls in the creation flow with `getMaxZIndexForTool(creationTool)`.

**Effect:** All existing objects keep their current z-indexes. New frames are assigned ≤ 1000; new non-frames ≥ 1001. Since `BoardObjects.tsx` already sorts by `zIndex`, frames will naturally render below all non-frame objects.

---

### Step 2.2 — Reverse Capture (dragging frame over objects)

**File:** `src/components/canvas/FrameObject.tsx`

In `handleDragEnd`, after writing the frame's new position, run an AABB check and capture any objects that are now ≥ 50% inside the frame's new bounds:

```typescript
// Reverse capture: objects overlapping the frame's new position are auto-assigned
const newBounds = { x: finalX, y: finalY, width: object.width, height: object.height };
const captureUpdates: { id: string; changes: Partial<BoardObject> }[] = [];

for (const obj of Object.values(useObjectStore.getState().objects)) {
  if (obj.type === 'frame' || obj.type === 'connector' || obj.id === object.id) continue;
  if (obj.parentFrame && obj.parentFrame !== object.id) continue; // belongs to another frame
  const frac = overlapFraction(obj, newBounds);
  if (frac > 0.5 && obj.parentFrame !== object.id) {
    updateObjectLocal(obj.id, { parentFrame: object.id });
    captureUpdates.push({ id: obj.id, changes: { parentFrame: object.id } });
  }
}

// Batch-persist captures alongside the frame move
if (captureUpdates.length > 0) {
  await updateObjects(boardId, captureUpdates);
}
```

This re-uses the existing `updateObjects` batch helper already imported in `FrameObject.tsx`.

---

### Step 2.3 — Containment semantics (no auto-deframe on drag-out)

**File:** `src/hooks/useFrameNesting.ts`

Currently `checkNesting` clears `parentFrame` when a dragged object no longer overlaps any frame. Change it to only SET `parentFrame`, never clear it — clearing is now exclusively done via the "Deframe" context menu.

```typescript
// BEFORE: newParent = bestFrame ? bestFrame.id : ""
// if (currentParent !== newParent) { update parentFrame... }

// AFTER: only capture; never auto-remove
if (bestFrame && bestFrame.id !== currentParent) {
  updateObjectLocal(objectId, { parentFrame: bestFrame.id, ... });
  updateObject(boardId, objectId, { parentFrame: bestFrame.id, ... }).catch(console.error);
}
// If no bestFrame, do nothing — object remains captured until explicit Deframe
```

---

### Step 2.4 — Bolder framed-child visual indicator

**Files:** `src/components/canvas/StickyNote.tsx`, `src/components/canvas/ShapeObject.tsx`

The current indicator is a `strokeWidth={1.5}` dashed border. Change it to a solid `strokeWidth={2}` border for better visibility:

```tsx
{object.parentFrame && !isSimpleLod && (
  <Rect
    width={object.width}
    height={object.height}
    stroke="#6366f1"
    strokeWidth={2}           // was 1.5 dashed
    fill="transparent"
    listening={false}
    cornerRadius={4}
    // No dash — solid border is visually bolder
  />
)}
```

---

### Step 2.5 — Contextual right-click for framed items

**Status:** Already implemented.
- `FrameObject.handleClick` performs a canvas-coordinate hit-test and selects the child object directly
- `ContextMenu.tsx` shows "Deframe", "Duplicate", "Delete" for child objects with `parentFrame`

No further changes needed for this step.

---

## Sprint 3: Selection & Grouping UX

**Goal:** Shift+Click multi-select, group context menu, Shift → pointer mode already done.

---

### Step 3.1 — Shift+Click additive multi-select

**Status:** Partially implemented.
- `Ctrl+Click` already toggles selection on `StickyNote`, `ShapeObject`, `FrameObject`
- `Shift+drag` marquee is already supported (the selection rect accepts `shiftHeld`)

**Remaining:** Update all object `handleClick` handlers to also treat `e.evt.shiftKey` as additive select:
```typescript
// In StickyNote, ShapeObject, FrameObject handleClick:
if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) {
  toggleSelection(object.id);
} else {
  selectObject(object.id);
}
```

**Files:** `StickyNote.tsx`, `ShapeObject.tsx`, `FrameObject.tsx`, `LineObject.tsx`, `ConnectorObject.tsx`

---

### Step 3.2 — Group context menu for multi-selection

**File:** `src/components/ui/ContextMenu.tsx`

Currently the context menu always references `contextMenu.targetObjectId` (single object). When `selectedObjectIds.length > 1` and the right-click target is one of the selected objects, show a "group" menu instead:

Condition: `target !== null && selectedObjectIds.includes(target.id) && selectedObjectIds.length > 1`

Group menu items:
- "Duplicate All" — duplicates all selected objects
- "Delete All" — deletes all selected objects
- "Group to Frame" — creates a new Frame sized to the bounding box of the selection, assigns all selected objects as children

No color or opacity controls in the group menu (mixed types).

**File:** `src/components/ui/ContextMenu.tsx`
```typescript
const isGroupSelection =
  target !== null &&
  selectedObjectIds.includes(target.id) &&
  selectedObjectIds.length > 1;
```

---

### Step 3.3 — "Group to Frame" action

**Files:** `src/components/ui/ContextMenu.tsx`, `src/lib/firebase/firestore.ts`

1. Compute bounding box of all selected objects using `getBoundingBox()` from `utils.ts`
2. Add `FRAME_ZINDEX_MAX` padding (so new frame gets proper z-index)
3. Create a new frame at the bounding box with 20px padding
4. Assign `parentFrame` to all selected objects

```typescript
const handleGroupToFrame = async () => {
  const selectedObjs = selectedObjectIds.map(id => objects[id]).filter(Boolean);
  const bb = getBoundingBox(selectedObjs);
  if (!bb || !user) return;

  const padding = 20;
  const newFrameId = generateObjectId(boardId);
  const newFrame = {
    id: newFrameId,
    type: 'frame' as const,
    x: bb.x - padding, y: bb.y - padding,
    width: bb.width + padding * 2, height: bb.height + padding * 2,
    color: FRAME_DEFAULTS.color, text: 'Group',
    zIndex: getMaxZIndexForTool('frame'),  // ≤ 1000
    createdBy: user.uid, createdAt: Date.now(), updatedAt: Date.now(),
  };
  upsertObject(newFrame);
  await createObject(boardId, { ...newFrame }, newFrameId);

  for (const id of selectedObjectIds) {
    updateObjectLocal(id, { parentFrame: newFrameId });
    updateObject(boardId, id, { parentFrame: newFrameId }).catch(console.error);
  }
  hideContextMenu();
};
```

---

## Sprint 4: UI Polish & Toolbar Layout

**Goal:** Opacity pop-out, standalone text elements, shortcut legend 2-row layout, sidebar collision fix.

---

### Step 4.1 — Opacity slider pop-out

**New file:** `src/components/ui/OpacityPopup.tsx`

Replicate the portal pattern used by `ColorPickerPopup`. Trigger: a small `%` badge button in the Toolbar when non-connectors are selected. Click opens a right-docked panel with a 0–100 range slider.

```typescript
interface OpacityPopupProps {
  value: number;       // 0–1
  onChange: (v: number) => void;
}
```

Remove the inline opacity display from `Toolbar.tsx` and replace with `<OpacityPopup>`.

---

### Step 4.2 — Standalone text elements

**Files:** `src/lib/types.ts`, `src/components/canvas/BoardObjects.tsx`, `src/components/canvas/TextObject.tsx` (new), `src/components/ui/Toolbar.tsx`

Add `"text"` to `ObjectType`. A `TextObject` is a transparent-background, directly-editable text node. Unlike StickyNote it has no background or shadow.

`TextObject` props:
- `fontSize`: 16px default
- `color`: text color (not fill)
- `fontFamily`: uses same `FONT_FAMILY_MAP`
- No `ResizeBorder` — resize is implicit (width-only, height auto-grows)

Double-click opens `TextEditor` inline (same path as StickyNote).

**Schema addition to `BoardObject`:**
```typescript
fontSize?: number;   // for text objects; default 16
```

---

### Step 4.3 — Shortcut legend 2-row layout

**File:** `src/components/ui/ShortcutLegend.tsx`

Current: single row, 5 items, can overflow on narrow screens.

Change to a 2-column × 3-row grid. Use `grid grid-cols-2` inside the legend container. Keep the same `Shortcut` data structure.

Also shift horizontal position when the chat sidebar is open:
```tsx
// In board/[boardId]/page.tsx, pass sidebarOpen + sidebarWidth as props
// or read from useChatStore directly in ShortcutLegend
const { sidebarOpen, sidebarWidth } = useChatStore(...);
<div style={{ right: sidebarOpen ? sidebarWidth + 8 : 'auto' }} className="fixed bottom-4 left-1/2 ..." />
```

Wait — ShortcutLegend is `left-1/2` centered. If the sidebar is open, it should shift left by `sidebarWidth / 2`:
```tsx
const offsetRight = sidebarOpen ? sidebarWidth : 0;
<div style={{ transform: `translateX(calc(-50% - ${offsetRight / 2}px))` }} ... />
```

---

### Step 4.4 — Toolbar sidebar collision prevention

**File:** `src/components/ui/Toolbar.tsx`

The Toolbar is `fixed left-4 top-1/2`. No collision risk with the right-side chat sidebar. No changes needed.

The `SelectionActionBar` at `bottom-10` and `ShortcutLegend` at `bottom-4` need to shift left when the sidebar is open to avoid being cut off or partially hidden. Apply the same `right: sidebarOpen ? sidebarWidth + 8 : 'auto'` offset pattern used in the top-right header controls.

---

## Files Summary

| Sprint | New Files | Modified Files |
|--------|-----------|----------------|
| 1 | — | `types.ts`, `LineObject.tsx`, `ConnectorObject.tsx`, `Toolbar.tsx` |
| 2 | — | `types.ts`, `Canvas.tsx`, `FrameObject.tsx`, `useFrameNesting.ts`, `StickyNote.tsx`, `ShapeObject.tsx` |
| 3 | — | `StickyNote.tsx`, `ShapeObject.tsx`, `FrameObject.tsx`, `LineObject.tsx`, `ConnectorObject.tsx`, `ContextMenu.tsx` |
| 4 | `OpacityPopup.tsx`, `TextObject.tsx` | `types.ts`, `Toolbar.tsx`, `BoardObjects.tsx`, `ShortcutLegend.tsx`, `board/[boardId]/page.tsx` |

## Dependency Map

```
Sprint 1 — independent (types + rendering)
Sprint 2.1 (z-index) — independent
Sprint 2.2 (reverse capture) — can run in parallel with 2.1
Sprint 2.3 (no-auto-deframe) — depends on 2.2 conceptually; can implement independently
Sprint 3.2 (group menu) — depends on Sprint 3.1 (shift+click)
Sprint 3.3 (group-to-frame) — depends on Sprint 2.1 (z-index constants)
Sprint 4.1 (opacity pop-out) — independent
Sprint 4.2 (text objects) — independent
Sprint 4.3/4.4 (legend/sidebar) — independent
```
