# Phase 3: Board Features — Implementation Plan

**Gate:** Full CRUD operations work for all object types (sticky notes, shapes, frames, connectors). Multi-select functional.

**Estimated Duration:** 6 hours (Hours 12–18)

---

## Updated Directory Structure

Files marked `[NEW]` are created in Phase 3. Files marked `[MOD]` are modified from Phase 2.

```
src/
├── middleware.ts
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── globals.css                              [MOD] add textarea overlay + context menu + dialog styles
│   ├── auth/
│   │   └── page.tsx
│   ├── dashboard/
│   │   └── page.tsx
│   └── board/
│       └── [boardId]/
│           └── page.tsx                         [MOD] wire keyboard shortcuts hook
├── components/
│   ├── canvas/
│   │   ├── Canvas.tsx                           [MOD] text editor overlay, selection rect, connector creation mode
│   │   ├── DotGrid.tsx
│   │   ├── BoardObjects.tsx                     [MOD] render shapes, frames, connectors + orphan cleanup
│   │   ├── StickyNote.tsx                       [MOD] double-click text edit, right-click context menu, resize
│   │   ├── ShapeObject.tsx                      [NEW] Konva Rect/Circle, drag/resize, lock check
│   │   ├── FrameObject.tsx                      [NEW] Konva frame container with title bar, child movement
│   │   ├── ConnectorObject.tsx                  [NEW] Konva Line with edge-to-edge endpoints, label
│   │   ├── AnchorPoints.tsx                     [NEW] edge anchor dots on hover for connector creation
│   │   ├── SelectionLayer.tsx                   [MOD] enable resize anchors, drag-select rectangle
│   │   ├── SelectionRect.tsx                    [NEW] rubber-band selection rectangle (AABB hit-test)
│   │   ├── TextEditor.tsx                       [NEW] scale-aware HTML textarea overlay
│   │   ├── ColorLegendObject.tsx                [NEW] special canvas object for shared color meanings
│   │   └── CursorLayer.tsx
│   ├── auth/
│   │   └── AuthCard.tsx
│   └── ui/
│       ├── Toolbar.tsx                          [MOD] add Shape, Frame, Connector tools + shortcuts 4/5/6
│       ├── ContextMenu.tsx                      [NEW] right-click menu (delete, color, frame actions)
│       ├── ColorPicker.tsx                      [NEW] dual-mode: legend palette + hex power mode
│       └── DeleteDialog.tsx                     [NEW] confirmation dialog for delete
├── lib/
│   ├── firebase/
│   │   ├── config.ts
│   │   ├── auth.ts
│   │   ├── firestore.ts                         [MOD] add batch create/delete helpers
│   │   └── rtdb.ts
│   ├── store/
│   │   ├── authStore.ts
│   │   ├── canvasStore.ts                       [MOD] add clipboard, editingObjectId, contextMenu state
│   │   └── objectStore.ts                       [MOD] add batchRemove, getChildrenOfFrame helpers
│   ├── types.ts                                 [MOD] add connector/frame/shape constants + new interfaces
│   └── utils.ts                                 [MOD] add AABB, edge intersection, bounding box, overlap helpers
├── hooks/
│   ├── useFirestoreSync.ts
│   ├── useLockSync.ts
│   ├── useKeyboardShortcuts.ts                  [NEW] consolidated keyboard handler (delete, copy, paste, dup)
│   └── useFrameNesting.ts                       [NEW] auto-nest/unnest logic on object move
└── providers/
    └── AuthProvider.tsx
```

---

## 1. New & Updated Type Definitions

### Additions to `src/lib/types.ts`

```typescript
// --- Connector-specific types ---

export type ConnectorStyle = 'solid' | 'dashed' | 'dotted';

export interface ConnectorEndpoints {
  startObjectId: string;
  endObjectId: string;
}

// --- Shape defaults ---

export const SHAPE_DEFAULTS = {
  rectangle: { width: 100, height: 100, color: '#E3E8EF', cornerRadius: 4 },
  circle:    { width: 100, height: 100, color: '#E3E8EF' },
} as const;

export const SHAPE_SIZE_LIMITS = {
  min: { width: 20, height: 20 },
  max: { width: 800, height: 800 },
} as const;

// --- Frame defaults ---

export const FRAME_DEFAULTS = {
  width: 400,
  height: 300,
  color: '#6366f1',            // Brand purple border
  titleBarHeight: 40,
  backgroundOpacity: 0.1,
} as const;

export const FRAME_SIZE_LIMITS = {
  min: { width: 150, height: 100 },
  max: { width: 4000, height: 4000 },
} as const;

// --- Connector defaults ---

export const CONNECTOR_DEFAULTS = {
  color: '#6B7280',            // Gray-500
  style: 'solid' as ConnectorStyle,
  strokeWidth: 2,
} as const;

// --- Sticky note size limits ---

export const STICKY_NOTE_SIZE_LIMITS = {
  min: { width: 80, height: 60 },
  max: { width: 600, height: 600 },
} as const;

// --- Color Legend defaults ---

export const COLOR_LEGEND_DEFAULTS = {
  width: 200,
  height: 160,
  color: '#FFFFFF',
} as const;

// --- Context menu types ---

export interface ContextMenuState {
  visible: boolean;
  x: number;                    // Screen-space X
  y: number;                    // Screen-space Y
  targetObjectId: string | null;
  nearbyFrames: { id: string; title: string }[];
}
```

The existing `BoardObject` interface already contains `parentFrame`, `connectedTo`, and `legendEntries` fields from Phase 2's forward-looking types. No structural changes needed.

---

## 2. Store Updates

### `canvasStore` — New State for Text Editing, Clipboard, Context Menu

```typescript
// Additions to src/lib/store/canvasStore.ts

interface CanvasState {
  // ... existing Phase 2 fields ...

  // Text editing
  editingObjectId: string | null;         // ID of object being text-edited (textarea visible)

  // Clipboard
  clipboard: BoardObject[];               // Copied objects (deep clones, stripped IDs)

  // Context menu
  contextMenu: ContextMenuState;

  // Actions (new)
  setEditingObject: (id: string | null) => void;
  copyToClipboard: (objects: BoardObject[]) => void;
  clearClipboard: () => void;
  showContextMenu: (state: ContextMenuState) => void;
  hideContextMenu: () => void;

  // Connector creation mode
  connectorStart: string | null;          // Source object ID during connector drag
  setConnectorStart: (id: string | null) => void;
}
```

**Key behaviors:**
- `setEditingObject(id)` opens the textarea overlay; `setEditingObject(null)` closes it and commits text
- `copyToClipboard(objects)` deep-clones objects, strips `id`, `createdAt`, `updatedAt` fields
- `showContextMenu(state)` positions the context menu at screen coords
- `connectorStart` tracks the source object while dragging a connector anchor to a target

### `objectStore` — Batch Operations + Frame Helpers

```typescript
// Additions to src/lib/store/objectStore.ts

interface ObjectState {
  // ... existing Phase 2 fields ...

  // Batch actions
  batchRemove: (ids: string[]) => void;
  batchUpsert: (objects: BoardObject[]) => void;

  // Frame helpers (read-only selectors)
  getChildrenOfFrame: (frameId: string) => BoardObject[];
  getFramesContaining: (objectId: string) => BoardObject[];
}
```

**Key behaviors:**
- `batchRemove(ids)` deletes multiple objects from local state in one atomic update
- `batchUpsert(objects)` inserts or replaces multiple objects at once
- `getChildrenOfFrame(frameId)` returns all objects where `parentFrame === frameId`
- `getFramesContaining(objectId)` returns frames that spatially overlap the object (for context menu "Add to Frame")

---

## 3. Shape Object — Rectangle & Circle

### Creation Flow

```
User clicks canvas in Create Mode (tool = rectangle | circle)
    │
    ▼
Calculate canvas-space coords from pointer + stage transform
    │
    ▼
Snap to 20px grid
    │
    ▼
Generate Firestore doc ID
    │
    ▼
Optimistic: objectStore.upsertObject({
    id, type: 'rectangle' | 'circle',
    x, y,
    width: 100, height: 100,
    color: '#E3E8EF', text: '',
    createdBy: userId,
    createdAt: now, updatedAt: now
})
    │
    ▼
Async: createObject(boardId, { ... })
    │
    ▼
onSnapshot reconciles
```

### `ShapeObject.tsx` Component

```
Konva Group
  ├── Rect (type=rectangle) OR Circle (type=circle)
  │     fill: object.color
  │     cornerRadius: 4 (rectangle only)
  │     stroke: #2196F3 (when selected)
  │     strokeWidth: 2 (when selected)
  │
  └── Lock indicator (if locked by another user)

Props: BoardObject + isLocked + lockedByName + boardId
Events: onDragStart/Move/End (same lock + snap pattern as StickyNote)
        onClick (select in select mode, Ctrl+Click toggle)
        onDblClick (no-op for shapes — no text editing)
        onContextMenu → showContextMenu
Draggable: mode === 'select' && !isLocked
```

### Resize via Transformer

When a shape is selected, `SelectionLayer.tsx` attaches a Konva `Transformer` with resize anchors enabled:
- **Anchors:** All 8 positions (`top-left`, `top-center`, `top-right`, `middle-left`, `middle-right`, `bottom-left`, `bottom-center`, `bottom-right`)
- **Constraints:** Enforce `SHAPE_SIZE_LIMITS` via `boundBoxFunc`
- **On transform end:** Snap new width/height to grid, update Firestore
- **Aspect ratio:** Circle maintains equal width/height (symmetric anchors only)

```
Shape selected (in Select mode)
    │
    ▼
Transformer attaches with enabled anchors
    │
    ▼
User drags resize handle
    │
    ▼
boundBoxFunc clamps to SHAPE_SIZE_LIMITS
    │
    ▼
On transform end:
  ├── Read node.scaleX(), node.scaleY() → compute new width/height
  ├── Reset node scale to 1,1
  ├── Snap width/height to grid
  ├── objectStore.updateObjectLocal(id, { x, y, width, height })
  └── Async: updateObject(boardId, id, { x, y, width, height })
```

---

## 4. Text Editing — Scale-Aware Textarea Overlay

### Flow

```
User double-clicks a sticky note or frame title
    │
    ▼
canvasStore.setEditingObject(objectId)
    │
    ▼
Canvas.tsx renders <TextEditor> (HTML div overlay, positioned above Konva Stage)
    │
    ▼
TextEditor calculates screen-space position:
  screenX = object.x * stageScale + stageX
  screenY = object.y * stageScale + stageY
  screenWidth = object.width * stageScale
  screenHeight = object.height * stageScale
    │
    ▼
<textarea> renders at calculated position:
  - transform: scale({stageScale})
  - transformOrigin: top left
  - fontSize: 14px (inherits canvas font size)
  - padding: 10px
  - Background: matches object color
  - Autofocus on mount
    │
    ▼
User types text
    │
    ▼
On blur / Escape / click outside:
  ├── Read textarea value
  ├── objectStore.updateObjectLocal(id, { text: newText })
  ├── canvasStore.setEditingObject(null)
  └── Async: updateObject(boardId, id, { text: newText })
```

### Auto-Resize Height

For sticky notes, width is fixed. When text content overflows:
1. Measure text height using a hidden `<div>` with matching font/padding/width
2. Clamp new height between `STICKY_NOTE_SIZE_LIMITS.min.height` and `STICKY_NOTE_SIZE_LIMITS.max.height`
3. Update both local store and Firestore with new height
4. Textarea resizes in real-time as user types

### Rotation Handling

Per spec: "rotation ignored — note snaps to 0° during editing." If the object has rotation, temporarily set visual rotation to 0° while editing, restore on blur.

---

## 5. Multi-Selection System

### Ctrl+Click Multi-Select (already partially implemented in Phase 2)

Phase 2 has basic Ctrl+Click in `StickyNote.tsx`. Phase 3 extends this to all object types by extracting click handling into a shared pattern used by `ShapeObject`, `FrameObject`, and `StickyNote`.

### Drag-Rectangle Selection

```
User presses mouse button on empty canvas in Select Mode
    │
    ▼
Record start position (canvas-space)
    │
    ▼
Mouse move → draw semi-transparent rectangle (SelectionRect component on Selection Layer)
  - Fill: rgba(33, 150, 243, 0.1)
  - Stroke: #2196F3, 1px
    │
    ▼
Mouse up → compute AABB bounds of the rectangle
    │
    ▼
Hit-test all objects: select those with >0% overlap with the selection rectangle
  (Objects fully or partially inside the rectangle are selected)
    │
    ▼
canvasStore.selectedObjectIds = [...matchingIds]
    │
    ▼
SelectionRect disappears
Transformer attaches to all selected nodes
```

### `SelectionRect.tsx` Component

```typescript
// Renders on the Selection Layer (Layer 3)
// Props: startX, startY, currentX, currentY (all canvas-space)
// Renders: Konva Rect with semi-transparent blue fill + border
// listening={false} — does not consume mouse events
```

### AABB Hit-Test Utility (`utils.ts`)

```typescript
// src/lib/utils.ts additions

interface Bounds {
  x: number; y: number; width: number; height: number;
}

/**
 * Returns true if two axis-aligned bounding boxes overlap.
 */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width  < b.x ||
    a.x > b.x + b.width  ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}

/**
 * Returns the fraction of area of `inner` that overlaps with `outer`.
 * Used for frame auto-nesting (>50% threshold).
 */
export function overlapFraction(inner: Bounds, outer: Bounds): number {
  const overlapX = Math.max(0, Math.min(inner.x + inner.width, outer.x + outer.width) - Math.max(inner.x, outer.x));
  const overlapY = Math.max(0, Math.min(inner.y + inner.height, outer.y + outer.height) - Math.max(inner.y, outer.y));
  const overlapArea = overlapX * overlapY;
  const innerArea = inner.width * inner.height;
  return innerArea > 0 ? overlapArea / innerArea : 0;
}
```

### Multi-Select Move

When multiple objects are selected and one is dragged:
1. Compute delta from drag start to current position
2. Apply delta to all selected objects' positions
3. On drag end: snap all positions to grid, batch-update Firestore

---

## 6. Frame Logic

### `FrameObject.tsx` Component

```
Konva Group
  ├── Rect (full frame area)
  │     fill: object.color at 10% opacity
  │     stroke: object.color, 2px solid
  │     cornerRadius: 4
  │
  ├── Rect (title bar, 40px height)
  │     fill: object.color at 20% opacity
  │
  ├── Text (title, bold, 14px, padded 10px)
  │     text: object.text || 'Untitled Frame'
  │     y: 10
  │
  └── Lock indicator (if locked)

Props: BoardObject + isLocked + lockedByName + boardId
Events:
  onDragStart → acquire lock, save pre-drag positions of ALL children
  onDragMove  → move frame + all children by delta
  onDragEnd   → snap all positions, batch-update Firestore, release lock
  onDblClick  → edit frame title (TextEditor overlay)
  onContextMenu → show context menu with "Deframe All"
Draggable: mode === 'select' && !isLocked
```

### Frame Creation Flow

Same pattern as shapes:
- Default size: 400x300
- Default color: `#6366f1` (brand purple)
- Default text: empty (shows "Untitled Frame")

### Auto-Nesting Logic (`useFrameNesting.ts`)

```
Object drag ends (any type except frame and connector)
    │
    ▼
Find all frame objects on the board
    │
    ▼
For each frame, calculate overlapFraction(object, frame)
    │
    ▼
If overlapFraction > 0.50:
  ├── Set object.parentFrame = frame.id
  ├── objectStore.updateObjectLocal(objectId, { parentFrame: frameId })
  └── Async: updateObject(boardId, objectId, { parentFrame: frameId })
    │
    ▼
Else if object currently has a parentFrame:
  ├── Clear parentFrame (object was dragged out)
  ├── objectStore.updateObjectLocal(objectId, { parentFrame: null })
  └── Async: updateObject(boardId, objectId, { parentFrame: '' })
```

**Nesting rules:**
- Frames cannot nest inside other frames (Phase 3 scope)
- Connectors do not nest into frames
- An object can only belong to one frame at a time
- The frame with the highest overlap (if multiple) wins

### Frame Child Movement

When a frame is dragged:
```
Frame dragstart:
  ├── Find all objects where parentFrame === frame.id
  └── Store each child's initial position: { id, x, y }

Frame dragmove:
  ├── Compute delta: dx = frame.newX - frame.startX, dy = frame.newY - frame.startY
  └── For each child: updateObjectLocal(child.id, { x: child.startX + dx, y: child.startY + dy })

Frame dragend:
  ├── Snap frame position to grid
  ├── Snap each child position to grid
  ├── Batch Firestore update: frame + all children
  └── Release lock
```

### Deframe All (Context Menu Action)

```
User right-clicks a frame → Context menu → "Deframe All"
    │
    ▼
Find all objects where parentFrame === frame.id
    │
    ▼
For each child:
  ├── objectStore.updateObjectLocal(child.id, { parentFrame: '' })
  └── Async: updateObject(boardId, child.id, { parentFrame: '' })
    │
    ▼
Children remain at their current positions (no spatial movement)
Frame itself is NOT deleted — just emptied
```

### Manual Frame Assignment (Context Menu)

```
User right-clicks an object → Context menu → "Add to Frame: {title}"
    │
    ▼
objectStore.updateObjectLocal(objectId, { parentFrame: frameId })
    │
    ▼
Async: updateObject(boardId, objectId, { parentFrame: frameId })
```

The context menu shows nearby frames (within 200px of the object's center) as assignment options.

---

## 7. Connectors — Edge-to-Edge

### Connector Data Model

A connector is a `BoardObject` of type `'connector'` with:
- `connectedTo: [startObjectId, endObjectId]`
- `color`: line color (default gray-500)
- `text`: optional label at midpoint
- `metadata.connectorStyle`: `'solid' | 'dashed' | 'dotted'` (stored in metadata for now)

The connector itself has no meaningful x/y/width/height — its position is derived from the two endpoint objects.

### Connector Creation Flow

```
User clicks Connector tool in toolbar (or presses "6")
    │
    ▼
Mode = 'create', creationTool = 'connector'
    │
    ▼
Hovering an object → AnchorPoints component renders 4 dots at edge midpoints:
  Top:    (x + width/2, y)
  Bottom: (x + width/2, y + height)
  Left:   (x, y + height/2)
  Right:  (x + width, y + height/2)
    │
    ▼
User clicks an anchor dot:
  canvasStore.setConnectorStart(objectId)
    │
    ▼
Mouse moves → temporary line drawn from source anchor to cursor
    │
    ▼
User clicks a second object's anchor dot:
  ├── If same object → cancel (no self-connections)
  ├── If duplicate connector exists → cancel
  │
  ├── Generate Firestore doc ID
  ├── Optimistic: objectStore.upsertObject({
  │     id, type: 'connector',
  │     x: 0, y: 0, width: 0, height: 0,  // Derived from endpoints
  │     color: CONNECTOR_DEFAULTS.color,
  │     connectedTo: [startObjectId, endObjectId],
  │     createdBy: userId,
  │     createdAt: now, updatedAt: now,
  │     metadata: { connectorStyle: 'solid' }
  │   })
  ├── Async: createObject(boardId, { ... })
  └── canvasStore.setConnectorStart(null)
    │
    ▼
Escape or click empty canvas → cancel connector creation
  canvasStore.setConnectorStart(null)
```

### `ConnectorObject.tsx` Component

```
Konva Group
  ├── Line (or Arrow)
  │     points: [startX, startY, endX, endY]
  │     stroke: object.color
  │     strokeWidth: 2
  │     dash: [] (solid), [10,5] (dashed), [2,4] (dotted)
  │
  └── Text (optional label at midpoint)
        x: (startX + endX) / 2
        y: (startY + endY) / 2
        text: object.text
        fontSize: 12
```

### Edge-to-Edge Endpoint Calculation

```typescript
// src/lib/utils.ts

/**
 * Calculates the nearest edge point on a rectangle to a target point.
 * Returns the point on the border of the rect closest to (tx, ty).
 */
export function nearestEdgePoint(
  rect: { x: number; y: number; width: number; height: number },
  tx: number,
  ty: number
): { x: number; y: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  // Direction from rect center to target
  const dx = tx - cx;
  const dy = ty - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: rect.y }; // Default to top

  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  // Scale factor to reach the edge
  const scaleX = halfW / Math.abs(dx || 1);
  const scaleY = halfH / Math.abs(dy || 1);
  const scale = Math.min(scaleX, scaleY);

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  };
}
```

The connector reads both endpoint objects from `objectStore` and recalculates edge points on every render. When objects are dragged, connectors update in real-time because the component re-renders when `objectStore.objects` changes.

### Orphan Cleanup

When an object is deleted:
1. Find all connectors where `connectedTo` includes the deleted object's ID
2. Delete those connectors from both local store and Firestore
3. This is handled in `BoardObjects.tsx` as a side-effect of the onSnapshot reconciliation

```
onSnapshot fires with 'removed' change for an object
    │
    ▼
objectStore.removeObject(id)
    │
    ▼
BoardObjects scans remaining connectors:
  For each connector where connectedTo includes the removed ID:
    ├── objectStore.removeObject(connectorId)
    └── Async: deleteObject(boardId, connectorId)
```

---

## 8. Color Picker

### `ColorPicker.tsx` — Dual-Mode Component

Appears when an object is selected and the user triggers it (context menu → "Change Color" or toolbar color button).

```
┌────────────────────────────┐
│ Quick Access (Legend Mode)  │
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ │
│ │🟡│ │🩷│ │🩵│ │🟢│ │🟣│ │   ← Color swatches from STICKY_NOTE_COLORS
│ └──┘ └──┘ └──┘ └──┘ └──┘ │
│ (click to apply instantly) │
├────────────────────────────┤
│ ▼ Power Mode               │
│ ┌─────────┐ ┌────────────┐│
│ │ Preview │ │ #FEFF9C    ││   ← Hex input
│ └─────────┘ └────────────┘│
│              [Apply]       │
└────────────────────────────┘
```

**Behavior:**
- Quick-access grid: one click applies the color immediately
- Power mode: expandable section with hex input + preview swatch + Apply button
- Applies to all selected objects (multi-select aware)
- Positioned near the selected object (floating, doesn't overlap)

---

## 9. Delete & Clipboard Operations

### Delete with Confirmation

```
User presses Delete key (with objects selected)
    │
    ▼
Show DeleteDialog: "Delete {n} object(s)? This cannot be undone."
  [Cancel] [Delete]
    │
    ▼
On confirm:
  ├── For each selected object:
  │     ├── objectStore.removeObject(id)
  │     └── Async: deleteObject(boardId, id)
  ├── Orphan connector cleanup (as described in §7)
  ├── Frame children: children of deleted frames get parentFrame cleared
  └── canvasStore.clearSelection()
```

**Ctrl+Delete:** Bypasses the confirmation dialog, immediately deletes.

### Copy / Paste / Duplicate

```
Ctrl+C (Copy):
  ├── Deep-clone selected objects
  ├── Strip id, createdAt, updatedAt
  ├── Store relative positions (offset from first object's top-left)
  └── canvasStore.copyToClipboard(clones)

Ctrl+V (Paste):
  ├── For each object in clipboard:
  │     ├── Generate new Firestore doc ID
  │     ├── Apply +20px offset to x, y
  │     ├── Set createdBy to current user
  │     ├── Optimistic: objectStore.upsertObject(...)
  │     └── Async: createObject(boardId, ...)
  └── Select the pasted objects

Ctrl+D (Duplicate):
  ├── Copy + Paste in one step (no clipboard involvement)
  ├── Same +20px offset behavior
  └── Select the duplicates
```

**Multi-select aware:** All selected objects are copied/pasted as a group, maintaining their relative positions.

**Connectors between copied objects:** If both endpoints of a connector are in the selection, the connector is duplicated with updated endpoint IDs pointing to the new copies. Connectors with only one endpoint in the selection are not copied.

---

## 10. Color Legend Canvas Object

### `ColorLegendObject.tsx`

```
Konva Group
  ├── Rect (white background, rounded corners, shadow)
  │     width: 200, height: dynamic based on entries
  │
  ├── Text ("Color Legend", bold, 14px, header)
  │
  └── For each legendEntry:
        ├── Rect (16x16, filled with entry.color)
        └── Text (entry.meaning, 12px, next to swatch)

Props: BoardObject (type='colorLegend') + isLocked + boardId
Events: Same drag/lock/select pattern as other objects
        onDblClick → opens editor overlay (textarea for meanings)
```

### Creation

- Created via toolbar (no shortcut in Phase 3 scope) or context menu
- Default entries: the 6 STICKY_NOTE_COLORS with empty meanings
- Syncs in real-time like any other object
- `legendEntries` field on `BoardObject` stores `{ color: string, meaning: string }[]`

---

## 11. Context Menu

### `ContextMenu.tsx`

Rendered as an absolutely-positioned HTML `<div>` overlay (not Konva), triggered by right-click on objects or empty canvas.

**Menu items vary by context:**

| Target | Menu Items |
|--------|-----------|
| Sticky Note | Change Color, Edit Text, Duplicate, Delete, *Add to Frame: {title}* (if near a frame) |
| Shape | Change Color, Duplicate, Delete, *Add to Frame: {title}* |
| Frame | Change Color, Edit Title, Deframe All, Duplicate, Delete |
| Connector | Change Color, Change Style (solid/dashed/dotted), Edit Label, Delete |
| Color Legend | Edit Legend, Duplicate, Delete |
| Empty Canvas | Paste (if clipboard has items), Create Sticky Note, Create Shape, Create Frame |

**Dismissal:** Click outside, Escape key, or selecting an action.

---

## 12. Toolbar Update

### New Tools (added to existing toolbar)

```typescript
const tools: Tool[] = [
  { id: "pan",        label: "Pan",        icon: "✋", mode: "pan",    shortcut: "1" },
  { id: "select",     label: "Select",     icon: "↖", mode: "select", shortcut: "2" },
  { id: "stickyNote", label: "Sticky Note", icon: "📝", mode: "create", creationTool: "stickyNote", shortcut: "3" },
  { id: "rectangle",  label: "Rectangle",  icon: "◻",  mode: "create", creationTool: "rectangle",  shortcut: "4" },
  { id: "circle",     label: "Circle",     icon: "○",  mode: "create", creationTool: "circle",     shortcut: "5" },
  { id: "frame",      label: "Frame",      icon: "▣",  mode: "create", creationTool: "frame",      shortcut: "6" },
  { id: "connector",  label: "Connector",  icon: "╱",  mode: "create", creationTool: "connector",  shortcut: "7" },
];
```

### Updated Keyboard Shortcuts

| Key     | Action                          |
|---------|---------------------------------|
| `1`     | Pan mode                        |
| `2`     | Select mode                     |
| `3`     | Sticky Note create mode         |
| `4`     | Rectangle create mode           |
| `5`     | Circle create mode              |
| `6`     | Frame create mode               |
| `7`     | Connector create mode           |
| Escape  | Return to Pan mode, deselect    |
| Delete  | Delete selected (with confirm)  |
| Ctrl+Delete | Delete selected (no confirm) |
| Ctrl+C  | Copy selected                   |
| Ctrl+V  | Paste from clipboard            |
| Ctrl+D  | Duplicate selected              |

---

## 13. Updated `SelectionLayer.tsx`

Phase 2 skeleton → Phase 3 full implementation:

```
Transformer configuration per object type:

┌─────────────┬──────────────────────────┬────────────┬──────────────┐
│ Object Type │ Enabled Anchors          │ Rotation   │ Constraints  │
├─────────────┼──────────────────────────┼────────────┼──────────────┤
│ Sticky Note │ bottom-right only        │ Disabled   │ Fixed width, │
│             │ (height resize)          │            │ clamp height │
├─────────────┼──────────────────────────┼────────────┼──────────────┤
│ Rectangle   │ All 8 anchors            │ Disabled   │ SHAPE_SIZE   │
│             │                          │ (Phase 3)  │ _LIMITS      │
├─────────────┼──────────────────────────┼────────────┼──────────────┤
│ Circle      │ Symmetric anchors only   │ Disabled   │ Keep square, │
│             │ (corners)                │            │ SHAPE_SIZE   │
├─────────────┼──────────────────────────┼────────────┼──────────────┤
│ Frame       │ All 8 anchors            │ Disabled   │ FRAME_SIZE   │
│             │                          │            │ _LIMITS      │
├─────────────┼──────────────────────────┼────────────┼──────────────┤
│ Connector   │ None                     │ Disabled   │ N/A          │
├─────────────┼──────────────────────────┼────────────┼──────────────┤
│ Color Legend│ bottom-right only        │ Disabled   │ Min 150x100  │
└─────────────┴──────────────────────────┴────────────┴──────────────┘
```

**Mixed selection:** When multiple types are selected, use the most restrictive anchor set (e.g., if sticky note + shape selected, disable resizing for all to avoid inconsistency). Alternatively, use separate Transformers per type group.

---

## 14. Canvas.tsx Updates

### New Responsibilities

1. **Text Editor overlay:** Render `<TextEditor>` as a DOM element positioned over the Konva `<Stage>` when `editingObjectId` is set
2. **Selection rectangle:** Track mousedown → mousemove → mouseup in select mode to draw `SelectionRect` and perform AABB hit-test
3. **Connector creation:** When `creationTool === 'connector'`, render temporary line from `connectorStart` object to cursor
4. **Context menu:** Render `<ContextMenu>` as a DOM overlay on right-click
5. **Shape/Frame creation:** Handle clicks in create mode for `rectangle`, `circle`, `frame` types (same pattern as `stickyNote`)
6. **Delete dialog:** Render `<DeleteDialog>` when triggered by Delete key

### Click Handler Update

```typescript
// Extend existing handleClick in Canvas.tsx

if (mode === "create") {
  switch (creationTool) {
    case "stickyNote":
      // existing logic
      break;
    case "rectangle":
    case "circle":
      // same pattern, use SHAPE_DEFAULTS[creationTool]
      break;
    case "frame":
      // same pattern, use FRAME_DEFAULTS
      break;
    case "connector":
      // No click-to-create on empty canvas
      // Connector creation is anchor-to-anchor (handled by AnchorPoints)
      break;
  }
}
```

### Right-Click Handler

```typescript
const handleContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
  e.evt.preventDefault();
  const target = e.target;
  const stage = stageRef.current;
  if (!stage) return;

  const pointer = stage.getPointerPosition();
  if (!pointer) return;

  // Find target object ID (walk up Konva tree to find Group with ID)
  const objectId = findObjectId(target);

  // Find nearby frames for "Add to Frame" option
  const nearbyFrames = findNearbyFrames(objectId, pointer);

  canvasStore.showContextMenu({
    visible: true,
    x: e.evt.clientX,
    y: e.evt.clientY,
    targetObjectId: objectId,
    nearbyFrames,
  });
};
```

---

## 15. Firestore Helpers Update

### New Functions in `firestore.ts`

```typescript
/**
 * Batch-deletes multiple objects from Firestore.
 * Uses writeBatch for atomic operation.
 */
export async function deleteObjects(
  boardId: string,
  objectIds: string[]
): Promise<void>;

/**
 * Batch-creates multiple objects in Firestore.
 * Used for paste/duplicate operations.
 */
export async function createObjects(
  boardId: string,
  objects: Omit<BoardObject, "createdAt" | "updatedAt">[]
): Promise<string[]>;

/**
 * Batch-updates multiple objects in Firestore.
 * Used for frame child movement (frame + all children).
 */
export async function updateObjects(
  boardId: string,
  updates: { id: string; changes: Partial<BoardObject> }[]
): Promise<void>;
```

All batch operations use Firestore `writeBatch` for atomicity. Batch limit: 500 writes per batch (Firestore limit).

---

## 16. Implementation Tasks

| #  | Task | Files | Description | Est. |
|----|------|-------|-------------|------|
| 1  | **Update types and constants** | `types.ts` [MOD] | Add `ConnectorStyle`, `ContextMenuState`, `SHAPE_DEFAULTS`, `SHAPE_SIZE_LIMITS`, `FRAME_DEFAULTS`, `FRAME_SIZE_LIMITS`, `CONNECTOR_DEFAULTS`, `STICKY_NOTE_SIZE_LIMITS`, `COLOR_LEGEND_DEFAULTS`. | 15 min |
| 2  | **Add utility functions** | `utils.ts` [MOD] | Add `boundsOverlap`, `overlapFraction`, `nearestEdgePoint`, `getBoundingBox` (for multi-select bounds). | 20 min |
| 3  | **Update canvasStore** | `canvasStore.ts` [MOD] | Add `editingObjectId`, `clipboard`, `contextMenu`, `connectorStart` state and actions. | 15 min |
| 4  | **Update objectStore** | `objectStore.ts` [MOD] | Add `batchRemove`, `batchUpsert`, `getChildrenOfFrame`, `getFramesContaining` helpers. | 15 min |
| 5  | **Add batch Firestore helpers** | `firestore.ts` [MOD] | Add `deleteObjects`, `createObjects`, `updateObjects` using `writeBatch`. | 20 min |
| 6  | **Build ShapeObject component** | `ShapeObject.tsx` [NEW] | Konva Group with Rect or Circle based on `type`. Drag with lock+snap, click to select, right-click context menu. | 30 min |
| 7  | **Build FrameObject component** | `FrameObject.tsx` [NEW] | Konva Group with background Rect + title bar + title Text. Frame drag moves children. Drag/lock/snap pattern. | 40 min |
| 8  | **Build useFrameNesting hook** | `useFrameNesting.ts` [NEW] | Hook called on object drag end. Computes `overlapFraction` with all frames, auto-sets `parentFrame`. Clears on drag-out. | 20 min |
| 9  | **Build TextEditor component** | `TextEditor.tsx` [NEW] | Scale-aware HTML `<textarea>` overlay positioned over Konva stage. Auto-resize height. Commits on blur/Escape. | 35 min |
| 10 | **Update StickyNote for text editing** | `StickyNote.tsx` [MOD] | Add `onDblClick` → `setEditingObject(id)`. Add `onContextMenu` dispatch. Enable height resize via Transformer. | 15 min |
| 11 | **Build SelectionRect component** | `SelectionRect.tsx` [NEW] | Konva Rect rendered during drag-select in select mode. Semi-transparent blue. | 15 min |
| 12 | **Update SelectionLayer** | `SelectionLayer.tsx` [MOD] | Enable resize anchors per object type (see §13 table). Handle `onTransformEnd` → snap + Firestore write. Add drag-select logic. | 30 min |
| 13 | **Build ConnectorObject component** | `ConnectorObject.tsx` [NEW] | Konva Line between two objects. Reads endpoint positions from objectStore. Computes edge points via `nearestEdgePoint`. Renders optional label. | 30 min |
| 14 | **Build AnchorPoints component** | `AnchorPoints.tsx` [NEW] | Renders 4 small circles at edge midpoints on hover (in connector create mode). Click starts connector. | 20 min |
| 15 | **Build ContextMenu component** | `ContextMenu.tsx` [NEW] | HTML overlay menu. Items vary by target type (see §11 table). Positioned at click coords. Dismiss on click-outside/Escape. | 25 min |
| 16 | **Build ColorPicker component** | `ColorPicker.tsx` [NEW] | Dual-mode: swatch grid (quick) + hex input (power). Applies color to selected objects. | 20 min |
| 17 | **Build DeleteDialog component** | `DeleteDialog.tsx` [NEW] | Modal confirmation: "Delete N object(s)?" with Cancel/Delete buttons. Handles orphan connectors and frame children cleanup. | 15 min |
| 18 | **Build useKeyboardShortcuts hook** | `useKeyboardShortcuts.ts` [NEW] | Consolidated handler for Delete, Ctrl+Delete, Ctrl+C/V/D, tool shortcuts 4-7. Respects input/textarea focus. | 20 min |
| 19 | **Build ColorLegendObject component** | `ColorLegendObject.tsx` [NEW] | Konva Group rendering color swatches + meaning labels. Drag/lock/select pattern. DblClick opens editor. | 25 min |
| 20 | **Update BoardObjects renderer** | `BoardObjects.tsx` [MOD] | Remove Phase 2 `stickyNote`-only filter. Add rendering for `ShapeObject`, `FrameObject`, `ConnectorObject`, `ColorLegendObject`. Add orphan connector cleanup on object removal. Z-sort: frames first (behind), then other objects, connectors on top. | 25 min |
| 21 | **Update Canvas.tsx** | `Canvas.tsx` [MOD] | Add: shape/frame creation in handleClick, right-click handler, TextEditor overlay, selection rectangle tracking, connector temp line, context menu render, delete dialog render. | 35 min |
| 22 | **Update Toolbar** | `Toolbar.tsx` [MOD] | Add Rectangle, Circle, Frame, Connector tools with shortcuts 4-7. Update keyboard handler. | 15 min |
| 23 | **Update board page** | `board/[boardId]/page.tsx` [MOD] | Wire `useKeyboardShortcuts` hook. | 5 min |
| 24 | **Update globals.css** | `globals.css` [MOD] | Textarea overlay styles (no border, transparent bg match), context menu styles, delete dialog modal styles. | 10 min |
| 25 | **Integration test: all object types + multi-select + frames + connectors** | Manual testing | Create all object types. Multi-select drag. Frame nesting. Connector creation. Delete with orphan cleanup. Copy/paste. Text editing. Two-user concurrent testing. | 30 min |

**Total estimated: ~9 hours 10 min**

---

## 17. Task Dependencies

```
[1] Types ─────────────┬──► [3] canvasStore ───────────────────┐
                       ├──► [4] objectStore ───────────────────┤
                       ├──► [5] Firestore batch helpers         │
                       ├──► [6] ShapeObject                     │
                       └──► [7] FrameObject                     │
                                                                │
[2] Utils ─────────────┬──► [8] useFrameNesting                 │
                       ├──► [12] SelectionLayer                 │
                       └──► [13] ConnectorObject                │
                                                                │
[3] canvasStore ───────┬──► [9] TextEditor                      │
                       ├──► [11] SelectionRect                  │
                       ├──► [14] AnchorPoints                   │
                       ├──► [15] ContextMenu                    │
                       └──► [21] Canvas.tsx ◄───────────────────┤
                                                                │
[4] objectStore ───────┬──► [7] FrameObject                     │
                       ├──► [8] useFrameNesting                 │
                       ├──► [13] ConnectorObject                │
                       └──► [20] BoardObjects ◄────────────────┤
                                                                │
[5] Firestore batch ───┬──► [17] DeleteDialog                   │
                       └──► [18] useKeyboardShortcuts           │
                                                                │
[6] ShapeObject ───────┐                                        │
[7] FrameObject ───────┤                                        │
[9] TextEditor ────────┤                                        │
[10] StickyNote (mod) ─┤                                        │
[11] SelectionRect ────┤                                        │
[12] SelectionLayer ───┤                                        │
[13] ConnectorObject ──┤                                        │
[14] AnchorPoints ─────┤                                        │
[19] ColorLegendObject ┤                                        │
                       ▼                                        │
                 [20] BoardObjects ─────────────────┐           │
                                                    ▼           │
                                              [21] Canvas.tsx ◄─┘
                                                    │
[15] ContextMenu (parallel) ────────────────────────┤
[16] ColorPicker (parallel) ────────────────────────┤
[17] DeleteDialog (parallel) ───────────────────────┤
[18] useKeyboardShortcuts (parallel) ───────────────┤
                                                    ▼
                                              [22] Toolbar
                                                    │
                                              [23] Board Page
                                                    │
                                              [24] CSS
                                                    │
                                              [25] Integration Test
```

**Parallelizable groups:**
- **Group A** (foundation, can run in parallel): Tasks 1, 2
- **Group B** (stores + helpers, after A): Tasks 3, 4, 5
- **Group C** (components, after B): Tasks 6, 7, 8, 9, 10, 11, 12, 13, 14, 19
- **Group D** (UI overlays, after B — independent of C): Tasks 15, 16, 17, 18
- **Group E** (integration, after C + D): Tasks 20, 21
- **Group F** (wiring, after E): Tasks 22, 23, 24
- **Final:** Task 25 (after all)

---

## 18. Key Implementation Notes

### Konva + SSR

Same as Phase 2: all canvas components must use `dynamic(() => import(...), { ssr: false })`. HTML overlay components (TextEditor, ContextMenu, ColorPicker, DeleteDialog) are pure DOM elements and do not require dynamic import.

### Z-Index Rendering Order

Objects are rendered in this order (back to front):
1. **Frames** — rendered first (behind everything), sorted by `createdAt`
2. **Shapes + Sticky Notes + Color Legend** — rendered on top of frames, sorted by `createdAt`
3. **Connectors** — rendered on top of all objects (so lines are always visible)

During drag, the dragged object (or its group for frames) is brought to the top of its layer via `moveToTop()`.

### Transformer Scale vs Size

Konva `Transformer` changes the node's `scaleX`/`scaleY`, not `width`/`height`. On `transformend`:
```typescript
const node = e.target;
const newWidth = Math.max(MIN_WIDTH, node.width() * node.scaleX());
const newHeight = Math.max(MIN_HEIGHT, node.height() * node.scaleY());
node.scaleX(1);
node.scaleY(1);
node.width(newWidth);
node.height(newHeight);
// Snap and persist...
```

### Circle Rendering with Konva

Konva `Circle` uses center-based coordinates (`x`, `y` = center). But `BoardObject` stores top-left corner. The `ShapeObject` component must offset:
```typescript
// For circle type:
<Circle
  x={object.width / 2}   // Center relative to group
  y={object.height / 2}
  radius={object.width / 2}
  fill={object.color}
/>
```

The `Group` is positioned at `(object.x, object.y)` (top-left), and the `Circle` is centered within it.

### Connector Re-rendering on Object Move

Connectors don't have their own position. They derive coordinates from endpoint objects. When any object moves:
1. `objectStore.updateObjectLocal` triggers re-render
2. `ConnectorObject` reads both endpoint objects from the store
3. `nearestEdgePoint` recalculates where the line starts/ends
4. Line updates automatically — no explicit connector update needed

### Frame Nesting Edge Cases

- **Delete a frame with children:** Children's `parentFrame` is cleared (not deleted)
- **Paste into a frame:** Pasted objects do not auto-nest; user must manually drag or use context menu
- **Resize frame smaller than children:** Children are not moved; they visually overflow. Frame resize does not trigger re-nesting.
- **Move child directly:** On drag end, `useFrameNesting` re-evaluates — child may un-nest or switch frames

### Performance Considerations

- **Connector recalc:** `nearestEdgePoint` is O(1) per connector. With 100 connectors, this adds ~0.1ms per render cycle — negligible.
- **Frame nesting check:** Runs only on drag end (not during drag). Iterates all frames (typically <20). No performance concern.
- **Selection rectangle:** Only drawn during active drag (no persistent state). Hit-test runs once on mouse-up.
- **TextEditor overlay:** Single DOM element. No React reconciliation overhead beyond one absolute-positioned div.
- **Batch Firestore writes:** Use `writeBatch` for multi-object operations (frame move, paste, delete) to reduce round-trips.
