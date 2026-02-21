# PLAN_ENGINEERING_SPRINT2.md — Remaining Fixes & UI Polish

**Status:** Planning
**Date:** 2026-02-20
**Branch target:** `ui_features`

---

## Audit Summary — Already Implemented (Do Not Redo)

| Requirement | Status | Location |
|-------------|--------|----------|
| `expandFrameToContainChild` in objectStore | ✅ Done | objectStore.ts:298 |
| `snapshot()` before drag in all draggable objects | ✅ Done | ShapeObject/StickyNote/FrameObject/TextObject/LineObject |
| Group context menu preserves multi-selection | ✅ Done | All object components `handleContextMenu` |
| `getModuleSet()` excludes TextModule from shapes | ✅ Done | PropertiesSidebar.tsx:51-68 |
| `DimensionModule` created and imported | ✅ Done | modules/DimensionModule.tsx |
| Sticky notepad line alignment + `textColor` fill | ✅ Done | StickyNote.tsx:247 |
| TextEditor live sync via `updateObjectLocal` | ✅ Done | TextEditor.tsx:152-154 |
| Snapshot before text edit in TextEditor | ✅ Done | TextEditor.tsx:33 |
| `getStrokeDash('dashed')` returns `[8,4]` | ✅ Done | utils.ts:145 |
| `getStrokeDash('dotted')` returns `[2,4]` | ✅ Done | utils.ts:146 |
| Properties sidebar collapse via chevron button | ✅ Done | PropertiesSidebar.tsx:238-246 |

---

## Implementation Order

1. Area 1a — Deframe on drag-out (replaces expand-on-drag-out behavior)
2. Area 1b — Separate Rectangle & Circle toolbar buttons
3. Area 2a — Fix TextEditor rotation positioning (most architecturally complex)
4. Area 2b — Fix TextObject double-box / double-text rendering bugs
5. Area 2c — Sticky note line spacing adapts to font size
6. Area 3a — Remove all stroke/outline controls from ShapeModule
7. Area 3b — Add Black preset to STYLE_PRESETS; handle white text
8. Area 3c — Add dimension module to StickyNote
9. Area 3d — Fix line dash rendering (ShapeModule wiring audit)
10. Area 3e — Fix PropertiesSidebar toggle to use side tab instead of top-right corner
11. Area 4a — Replace chat header button icon + add "Chat" label
12. Area 4b — Replace ✨ sparkle avatar with robot SVG in all chat components
13. Area 4c — Update toolbar shortcut number assignments (1–6)

---

## Area 1 — Critical Canvas & Frame Logic

### 1a — Deframe on Drag-Out (Replaces Expand Behavior)

**Problem:** The current `expandFrameToContainChild` action in `objectStore.ts` causes the parent frame to grow to follow a child being dragged out of its bounds. The correct behavior is: if a child is dragged **entirely outside** the frame (zero overlap), clear its `parentFrame` ID so it is deframed. If the child is still partially inside, keep it in the frame and expand if needed.

**Audit finding:** `handleDragEnd` in `ShapeObject.tsx` (line 145-153) and `StickyNote.tsx` (line 147-153) both call `expandFrameToContainChild` unconditionally. `TextObject.tsx` (line 105-109) does the same.

**Change:** Replace the unconditional expand call with a conditional deframe-or-expand check.

**File:** `src/lib/store/objectStore.ts`

Add a new action `deframeOrExpandChild` below `expandFrameToContainChild`:

```ts
/**
 * Called when a framed child finishes a drag.
 * - If the child's final position has NO overlap with its parent frame → clear parentFrame.
 * - If partial overlap → keep parentFrame and expand the frame to contain the child.
 * Returns an object describing what happened so the caller can persist to Firestore.
 */
deframeOrExpandChild: (childId: string) => {
  const { objects } = get();
  const child = objects[childId];
  if (!child?.parentFrame) return null;
  const frame = objects[child.parentFrame];
  if (!frame || frame.type !== 'frame') return null;

  const childRight = child.x + child.width;
  const childBottom = child.y + child.height;
  const frameRight = frame.x + frame.width;
  const frameBottom = frame.y + frame.height;

  // Bounding-box overlap test: no overlap means the child is fully outside
  const hasOverlap =
    child.x < frameRight &&
    childRight > frame.x &&
    child.y < frameBottom &&
    childBottom > frame.y;

  if (!hasOverlap) {
    // Child has left the frame entirely — deframe it
    get().updateObjectLocal(childId, { parentFrame: undefined });
    return { action: 'deframe' as const, childId, frameId: frame.id };
  }

  // Child still overlaps — keep in frame and expand if needed
  const PADDING = 24;
  const newX      = Math.min(frame.x, child.x - PADDING);
  const newY      = Math.min(frame.y, child.y - PADDING);
  const newRight  = Math.max(frameRight, childRight + PADDING);
  const newBottom = Math.max(frameBottom, childBottom + PADDING);

  const needsExpansion =
    newX < frame.x ||
    newY < frame.y ||
    newRight > frameRight ||
    newBottom > frameBottom;

  if (needsExpansion) {
    const patch: Partial<BoardObject> = {
      x: newX, y: newY, width: newRight - newX, height: newBottom - newY,
    };
    get().updateObjectLocal(frame.id, patch);
    return { action: 'expand' as const, frameId: frame.id, patch };
  }

  return null; // No change needed
},
```

**Files:** `src/components/canvas/ShapeObject.tsx`, `StickyNote.tsx`, `TextObject.tsx`

In each component's `handleDragEnd`, replace:

```ts
// OLD
if (object.parentFrame) {
  const expansion = useObjectStore.getState().expandFrameToContainChild(object.id);
  if (expansion) {
    updateObject(boardId, expansion.frameId, expansion.patch).catch(console.error);
  }
}
```

With:

```ts
// NEW
if (object.parentFrame) {
  const result = useObjectStore.getState().deframeOrExpandChild(object.id);
  if (result?.action === 'deframe') {
    updateObject(boardId, result.childId, { parentFrame: '' }).catch(console.error);
  } else if (result?.action === 'expand' && result.patch) {
    updateObject(boardId, result.frameId, result.patch).catch(console.error);
  }
}
```

**Drag glow behavior:** The existing `handleDragMove` RAF loop in ShapeObject and StickyNote already clears the glow when overlap < 50% (sets `frameDragHighlightId` to null). For framed children, the glow should also reflect whether they are still inside their frame. The existing logic is sufficient because it sets `bestId` based on overlap — if the child is dragged out, no frame reaches >50% overlap and the glow clears automatically.

---

### 1b — Separate Rectangle & Circle Toolbar Buttons

**Problem:** Rectangle and Circle are nested inside a `ShapesDropdown` requiring an extra click. The user wants them as independent primary buttons in the toolbar, each with their own icon and shortcut.

**File:** `src/components/ui/SubHeaderToolbar.tsx`

**Remove** the `ShapesDropdown` component and all its supporting types (`ShapesDropdownProps`, `SHAPE_ITEMS`, `DropdownItem`). The `ChevronDownIcon` can also be removed.

**Add** two independent `ToolButton` instances in the toolbar JSX where the dropdown previously appeared:

```tsx
{/* Rectangle */}
<ToolButton
  label="Rect"
  icon={<RectIcon />}
  isActive={mode === 'create' && creationTool === 'rectangle'}
  shortcut="3"
  onClick={() => enterCreateMode('rectangle')}
/>

{/* Circle */}
<ToolButton
  label="Circle"
  icon={<CircleIcon />}
  isActive={mode === 'create' && creationTool === 'circle'}
  shortcut="4"
  onClick={() => enterCreateMode('circle')}
/>
```

Remove `isShapesGroupActive` variable since it's no longer needed.

Update the `Divider` placement so the toolbar reads:
`[Undo/Redo] | [Select] [Line] [Connector] | [Rect] [Circle] [Text] [Sticky] [Frame] | [Align] [Arrange]`

---

## Area 2 — Text & Sticky Note Refinement

### 2a — Fix Text Disappears When Object Is Rotated

**Root cause:** `TextEditor.tsx` (lines 106-108) computes the overlay position as:
```ts
const screenX = object.x * stageScale + stageX;
const screenY = object.y * stageScale + stageY;
```
This is the stage-space origin, not the screen-space position after the object's rotation transform is applied. When a text object is rotated, its rendered top-left corner is rotated around the object's origin, which is **not** at `(screenX, screenY)`.

**Fix:** Use the stage's absolute transform to convert from canvas space to screen space, then apply the object's own rotation. The textarea must be positioned and rotated to match the Konva Group.

**File:** `src/components/canvas/TextEditor.tsx`

Replace the static screen-position calculation with one that reads the stage transform:

```ts
// In TextEditor, access the stage ref from Canvas via context or canvasStore.
// stageRef is available in Canvas.tsx — expose it via canvasStore.stageRef or a
// passed prop. Alternatively, read the Konva Group node directly using
// document.getElementById(editingObjectId) to get its absolute transform.

// Simpler approach: read the stage's current transform from canvasStore
// (stageX, stageY, stageScale are already available), then apply rotation:

const angle = (object.rotation ?? 0) * (Math.PI / 180);
// Origin in screen space (top-left of the object's bounding box, ignoring rotation)
const originX = object.x * stageScale + stageX;
const originY = object.y * stageScale + stageY;
```

Then, in the textarea's `style`, add:
```ts
transform: `rotate(${object.rotation ?? 0}deg)`,
transformOrigin: 'top left',
```

**Full style block for the textarea position:**
```ts
style={{
  position: 'absolute',
  left: originX,
  top: originY,
  width: screenWidth,
  height: editHeight,
  transform: `rotate(${object.rotation ?? 0}deg)`,
  transformOrigin: 'top left',
  fontSize: `${baseFontSize * stageScale}px`,
  // ... rest of existing styles
}}
```

This keeps the textarea anchored at the same screen-space origin as the Konva node and rotated to match. For sticky notes and frames (which are usually not rotated), `rotation = 0` so the existing behavior is unchanged.

---

### 2b — Fix TextObject Double-Box & Double-Text Rendering

**Problem 1 — Double box:** `TextObject.tsx` renders an explicit selection `<Rect>` (line 182-191) in addition to the Transformer handles that `SelectionLayer` adds. When selected, users see both.

**Fix:** Remove the explicit selection `<Rect>` from `TextObject.tsx`. The Transformer in `SelectionLayer` provides the blue selection border.

**Remove lines 182-191 from TextObject.tsx:**
```tsx
{/* Selection outline — REMOVE THIS BLOCK */}
{isSelected && (
  <Rect
    width={object.width}
    height={object.height}
    stroke="#2196F3"
    strokeWidth={2}
    fill="transparent"
    listening={false}
  />
)}
```

The Transformer handles from `SelectionLayer` will serve as the selection indicator.

**Problem 2 — Double text:** When `editingObjectId === object.id`, the Konva `<Text>` node and the HTML `<textarea>` overlay both render the same text, causing a doubling effect.

**Fix:** In `TextObject.tsx`, conditionally hide the Konva text when this object is being edited:

```tsx
// Add this selector at the top of TextObject:
const editingObjectId = useCanvasStore((s) => s.editingObjectId);
const isEditing = editingObjectId === object.id;

// Then in the render, conditionally show the Text node:
<Text
  text={object.text ?? ''}
  width={object.width}
  fontSize={fontSize}
  fontFamily={fontFamily}
  fill={object.textColor ?? object.color}
  align={object.textAlign ?? 'left'}
  wrap="word"
  listening={false}
  visible={!isEditing}  // ← ADD THIS: hide during edit to prevent double-text
/>
```

---

### 2c — Sticky Note Lines Adapt to Font Size

**Problem:** The notepad horizontal lines are hardcoded at `lineSpacing = 22` (StickyNote.tsx:103). When the user increases the font size past 14px, text lines overflow the fixed notepad lines, making them misaligned.

**Fix:** Make `lineSpacing` match the `lineHeight` used by the Konva Text node.

**File:** `src/components/canvas/StickyNote.tsx` — replace line 103:

```ts
// OLD
const lineSpacing = 22;

// NEW — match the lineHeight used in the Text node (lineHeight ratio × fontSize)
const effectiveFontSize = object.fontSize ?? 14;
const lineSpacing = Math.max(22, effectiveFontSize * 1.57); // 1.57 ≈ 22/14 baseline
```

The `lineStartY = 30` and `lineMarginX = 8` remain unchanged.

**Why `max(22, ...)`:** Below 14px font size, keep 22px minimum line spacing so the notepad lines don't get too cramped.

---

## Area 3 — Properties Panel & Style Polish

### 3a — Remove Stroke/Outline Controls from ShapeModule

**Problem:** The user wants all shape-outline controls removed from the Properties Sidebar for all object types.

**Audit:** `ShapeModule.tsx` renders stroke color (`strokeColor`) and border type (`borderType`) controls.

**File:** `src/components/properties/modules/ShapeModule.tsx`

Remove the `ColorRow` block that renders `strokeColor` and the `DropdownRow` / segmented control for `borderType`. Keep only fill color (`color`) and corner radius controls.

**Also audit:** `FrameModule.tsx` — if it contains a `strokeColor` row, remove it. The frame's border color should not be user-configurable to keep the UI minimal.

**Do NOT remove** stroke from the `LineModule` — line thickness and style (solid/dashed/dotted) are primary properties for line/connector objects.

---

### 3b — Add Black Preset; White Text for Dark Objects

**File:** `src/lib/types.ts` — `STYLE_PRESETS` array

Prepend a **Jet Black** preset at the start of `STYLE_PRESETS`:

```ts
{ id: 'jet-black', label: 'Jet Black', color: '#111827', strokeColor: '#000000', textColor: '#FFFFFF', previewBg: '#111827', previewBorder: '#000000' },
```

**White text rule for black-filled objects:** The `CanvasPresetsPanel` and the object modules already use `preset.textColor` for rendering the `Aa` swatch label. The black preset's `textColor: '#FFFFFF'` will automatically render white text in the swatch.

For objects on the canvas: `StickyNote.tsx` uses `object.textColor ?? '#1a1a1a'` as the fill. When the user applies the Black preset via `PresetsSection`, it should set both `color: '#111827'` AND `textColor: '#FFFFFF'`. This is already handled by `PresetsSection` — it calls `onChange({ color, strokeColor, textColor })` with all preset fields.

---

### 3c — Add Dimensions to Sticky Note Module

**Problem:** The `getModuleSet` for `stickyNote` returns `['stickyNote', 'text']` — no `DimensionModule`. Sticky notes have no W/H inputs in the sidebar.

**File:** `src/components/properties/PropertiesSidebar.tsx` — `getModuleSet()` at line 51

Change the `stickyNote` case:

```ts
// OLD
case 'stickyNote':
  return ['stickyNote', 'text'];

// NEW — add dimension module as the first entry
case 'stickyNote':
  return ['dimension', 'stickyNote', 'text'];
```

The `DimensionModule` already handles `stickyNote` type correctly since it just reads `object.width` and `object.height`.

---

### 3d — Fix Line Dash Rendering in LineModule Wiring

**Problem statement:** The TODO says "Line dash type and shape outline need to be fixed so that it actually changes to dashed." The `getStrokeDash` utility is correct. The issue is likely that `LineModule` is patching a different field than what `LineObject` reads.

**Audit:**
- `LineObject.tsx:125`: `const dash = getStrokeDash(object.borderType ?? object.metadata?.connectorStyle);`
- The module needs to write `borderType: 'dashed' | 'dotted' | 'solid'`

**File:** `src/components/properties/modules/LineModule.tsx`

Verify the "Style" dropdown calls `onChange({ borderType: selectedValue })` — **not** `onChange({ metadata: { connectorStyle: ... } })`. The legacy `connectorStyle` path on `metadata` is only a fallback (see line 125: `object.borderType ?? object.metadata?.connectorStyle`).

If the module is writing to `metadata.connectorStyle`, change it to write to `borderType` directly so the canonical path is used.

**Default line thickness:** The user wants lines to be bigger by default. Update `LINE_DEFAULTS.thickness` in `src/lib/types.ts`:

```ts
// OLD
export const LINE_DEFAULTS = {
  thickness: 2,
  ...
};

// NEW
export const LINE_DEFAULTS = {
  thickness: 3,  // increase default from 2 to 3
  ...
};
```

---

### 3e — Properties Sidebar: Move Toggle to Side Tab

**Problem:** The collapse/expand chevron button is at `absolute right-1 top-2` — top-right corner of the sidebar header. The user wants it accessible from the **side** (visible even when the panel is collapsed to `w-10`).

**Current behavior:** The chevron is inside the aside. When the panel is `w-10` (collapsed), the chevron button is still at `right-1 top-2` but the panel is only 40px wide — it stays visible. However, it is partially obscured by the narrow strip.

**Fix:** Move the toggle button outside the `<aside>` element so it appears as a floating tab on the right edge of the sidebar, accessible regardless of collapsed state.

**File:** `src/components/properties/PropertiesSidebar.tsx`

Restructure the wrapper to be a `relative` positioned container:

```tsx
return (
  <div className="relative flex h-full shrink-0">
    {/* The sidebar panel itself */}
    <aside
      className={`flex h-full flex-col overflow-hidden border-r border-gray-200 bg-[#F8F9FA] transition-all duration-200 ${
        isPropertiesOpen ? 'w-72' : 'w-0'
      }`}
      aria-label="Properties"
    >
      {/* Expanded content */}
      {isPropertiesOpen && (
        <div className="flex h-full w-72 flex-col overflow-y-auto">
          {/* ... existing content ... */}
        </div>
      )}
    </aside>

    {/* Side toggle tab — always visible, positioned at the panel's right edge */}
    <button
      type="button"
      onClick={() => setIsPropertiesOpen(!isPropertiesOpen)}
      title={isPropertiesOpen ? 'Collapse properties panel' : 'Expand properties panel'}
      className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full z-10 flex h-12 w-5 items-center justify-center rounded-r-md border border-l-0 border-gray-200 bg-white text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      aria-label={isPropertiesOpen ? 'Collapse' : 'Expand'}
    >
      {isPropertiesOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </button>
  </div>
);
```

Change `w-10` collapsed state to `w-0` to fully collapse the sidebar (no strip), making the side tab the only affordance. Update the `board/[boardId]/page.tsx` flex sibling accordingly so `w-0` doesn't cause layout issues.

**Note:** Remove the `{!isPropertiesOpen && ...}` vertical "Properties" label block since the sidebar will now be `w-0` when collapsed.

---

## Area 4 — Icons & Asset Updates

### 4a — Chat Header: Bubble Icon + "Chat" Label

**Problem:** The chat toggle button in the top header bar (`page.tsx:154-174`) uses a custom robot SVG. The user wants a **chat bubble icon** and the word **"Chat"** next to it.

**File:** `src/app/board/[boardId]/page.tsx`

Replace the `<svg>` robot inside the chat toggle button with a chat bubble SVG and add a "Chat" text label:

```tsx
<button
  onClick={toggleSidebar}
  title="Toggle chat (press /)"
  className="relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
>
  {/* Chat bubble icon */}
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M2 3a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H6l-4 4V3z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
  <span>Chat</span>
  {unreadCount > 0 && (
    <span className="absolute -top-0.5 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
      {unreadCount > 9 ? '9+' : unreadCount}
    </span>
  )}
</button>
```

---

### 4b — AI Chat Agent: Robot Icon Replaces Sparkle

**Problem:** AI messages in the chat use ✨ (sparkle emoji) as the agent avatar. The user wants a **robot icon SVG**.

Define a reusable inline `RobotIcon` SVG component (no external package needed):

```tsx
function RobotIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="5" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="8" cy="11.5" r="1" fill="currentColor" />
      <circle cx="12" cy="11.5" r="1" fill="currentColor" />
      <line x1="10" y1="8" x2="10" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10" cy="4" r="1.2" fill="currentColor" />
      <line x1="3" y1="11" x2="5" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="15" y1="11" x2="17" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
```

**Files to update:**

| File | Current | Change |
|------|---------|--------|
| `src/components/chat/ChatMessage.tsx:113` | `✨` emoji in `div` | Replace with `<RobotIcon size={14} />` (define at file top) |
| `src/components/chat/AIStreamMessage.tsx:66` | `✨` emoji in `div` | Replace with `<RobotIcon size={14} />` |
| `src/components/chat/MessagePreview.tsx:62` | `✨` in ternary | Replace `'✨'` with `<RobotIcon size={10} />` (adjust container to flex) |
| `src/components/chat/ChatInput.tsx:156` | `✨` mode toggle | Keep as-is (this is a **send-target toggle**, not an AI avatar) |
| `src/components/chat/ChatTimeline.tsx:130` | `✨` in hint text | Keep as-is (text in empty-state copy, cosmetic) |

**The `ChatInput.tsx` toggle and `ChatTimeline.tsx` hint text** use ✨ as a UI affordance label, not an avatar — leave those unchanged to avoid breaking the mode toggle UX.

---

### 4c — Toolbar Shortcut Numbers (1–6)

**Problem:** After separating Rect/Circle and having all tools as standalone buttons, the shortcut numbers should be 1–6 displayed inline, matching the keyboard shortcut assignments.

**New shortcut table:**

| # | Tool | Keyboard | ToolButton shortcut prop |
|---|------|----------|--------------------------|
| 1 | Select | `1` | `"1"` |
| 2 | Sticky | `2` | `"2"` |
| 3 | Rect | `3` | `"3"` |
| 4 | Circle | `4` | `"4"` |
| 5 | Text | `5` | `"5"` |
| 6 | Frame | `6` | `"6"` |
| — | Line | `L` | `"L"` |
| — | Connector | `C` | `"C"` |

**File:** `src/hooks/useKeyboardShortcuts.ts` — update the `switch` block:

```ts
case '2': canvasState.enterCreateMode('stickyNote'); return;
case '3': canvasState.enterCreateMode('rectangle'); return;
case '4': canvasState.enterCreateMode('circle'); return;
case '5': canvasState.enterCreateMode('text'); return;    // was '8'
case '6': canvasState.enterCreateMode('frame'); return;   // was '6' (same)
// Remove '7' (connector — use 'C' letter) and '8' (text — now '5')
```

**File:** `src/components/ui/SubHeaderToolbar.tsx` — update shortcut props on all ToolButton instances:

- `Select`: `shortcut="1"` (unchanged)
- `Line`: `shortcut="L"` (unchanged)
- `Connector`: `shortcut="C"` (unchanged)
- `Rect`: `shortcut="3"` (new standalone button)
- `Circle`: `shortcut="4"` (new standalone button)
- `Text`: `shortcut="5"` (was `"T"`)
- `Sticky`: `shortcut="2"` (unchanged)
- `Frame`: `shortcut="6"` (was `"F"`)

Keep letter shortcuts (`L`, `C`) displayed as-is — they remain valid keyboard shortcuts for those two tools.

---

## File Change Summary

| File | Type | Areas | Changes |
|------|------|-------|---------|
| `src/lib/store/objectStore.ts` | Modify | 1a | Add `deframeOrExpandChild` action |
| `src/lib/types.ts` | Modify | 3b, 3d | Add `jet-black` preset; increase `LINE_DEFAULTS.thickness` to 3 |
| `src/components/canvas/ShapeObject.tsx` | Modify | 1a | Replace `expandFrameToContainChild` call with `deframeOrExpandChild` |
| `src/components/canvas/StickyNote.tsx` | Modify | 1a, 2c | Replace expand call; dynamic `lineSpacing` |
| `src/components/canvas/TextObject.tsx` | Modify | 1a, 2b | Replace expand call; remove `isSelected` Rect; hide Konva Text when editing |
| `src/components/canvas/TextEditor.tsx` | Modify | 2a | Add rotation to textarea transform |
| `src/components/ui/SubHeaderToolbar.tsx` | Modify | 1b, 4c | Remove `ShapesDropdown`; add Rect+Circle standalone buttons; update shortcut numbers |
| `src/components/properties/PropertiesSidebar.tsx` | Modify | 3c, 3e | Add `'dimension'` to stickyNote; restructure sidebar with side toggle tab |
| `src/components/properties/modules/ShapeModule.tsx` | Modify | 3a | Remove `strokeColor` and `borderType` rows |
| `src/components/properties/modules/FrameModule.tsx` | Modify (verify) | 3a | Remove `strokeColor` row if present |
| `src/components/properties/modules/LineModule.tsx` | Modify (verify) | 3d | Ensure writes to `borderType` not `metadata.connectorStyle` |
| `src/app/board/[boardId]/page.tsx` | Modify | 4a | Replace robot SVG with chat bubble SVG + "Chat" text |
| `src/components/chat/ChatMessage.tsx` | Modify | 4b | Replace `✨` with inline `RobotIcon` SVG |
| `src/components/chat/AIStreamMessage.tsx` | Modify | 4b | Replace `✨` with inline `RobotIcon` SVG |
| `src/components/chat/MessagePreview.tsx` | Modify | 4b | Replace `✨` string with `RobotIcon` element |
| `src/hooks/useKeyboardShortcuts.ts` | Modify | 4c | Renumber keyboard shortcuts (3–6 for rect/circle/text/frame) |

---

## Open Questions / Risks

### Risk 1 — Deframe vs. Expand: Data Race
If a framed child is dragged quickly in and out of the frame boundary before `handleDragEnd` fires, the glow highlight may briefly show the wrong state. This is cosmetic only — the actual deframe/expand decision happens on `dragEnd`. No mitigation needed for MVP.

### Risk 2 — TextEditor Rotation: Sticky Notes
The rotation fix (Area 2a) adds `transform: rotate(...)` to the textarea. Sticky notes can be rotated. The fix correctly handles this since `object.rotation` is available for all types. Verify that the textarea rotates correctly around the `top left` origin — this matches Konva's rotation origin for Groups.

### Risk 3 — Collapsed Sidebar w-0 and Canvas Resize
Changing the collapsed width from `w-10` to `w-0` means the `ResizeObserver` in `Canvas.tsx` will trigger a canvas width expansion. Verify that the canvas `containerRef` ResizeObserver correctly picks up the `w-0` → `w-72` transition and resizes the Konva Stage accordingly. This should work already since the observer watches the container's `clientWidth`.

### Risk 4 — Shortcut Renumbering Breaks Muscle Memory
Changing `T` → `5` and `F` → `6` may break existing users' muscle memory. However, both letter shortcuts (`T`, `F`) remain valid — only the *displayed number badge* changes. The keyboard shortcuts are additive, not replacements. No regression risk.

### Risk 5 — Removing strokeColor from ShapeModule
Objects that already have `strokeColor` stored in Firestore will still render with that color (the rendering code in `ShapeObject.tsx` still reads `object.strokeColor`). The change only removes the UI control to set it. Existing strokes remain visible. Users cannot remove a stroke they previously added via the sidebar — they can work around this by selecting no border type. Acceptable for MVP.

### Risk 6 — Double-text Fix and editingObjectId Hook
Adding `const editingObjectId = useCanvasStore((s) => s.editingObjectId)` to `TextObject.tsx` adds a new reactive subscription. This will cause a re-render of `TextObject` whenever the editing state changes. Since `TextObject` uses `memo()` with a custom comparison, and the comparison doesn't check `editingObjectId`, the re-render will always happen when the prop object hasn't changed. Fix: add `editingObjectId` check to the custom comparator, or accept the additional (single) re-render per edit session — acceptable overhead.
