# Plan: Persistent Sidebar Properties Panel

**Status:** Draft
**Date:** 2026-02-20
**Reference:** Biorender-style contextual property panel (see screenshots)

---

## 1. Problem Statement

All object property controls currently live inside the left vertical **Toolbar** as pop-out portals anchored to icon buttons. This works for quick actions but has three structural problems:

1. **Discovery friction** — users must know which toolbar icon controls which property; there is no single place to see all properties for a selected object.
2. **Property gaps** — `stroke` color (separate from fill), text color, font size for sticky notes, and `cornerRadius` have no UI at all.
3. **Context blindness** — the same toolbar renders for every object type; conditional visibility of individual buttons produces visual noise and inconsistency.

The goal is a **right-aligned (or left-aligned as a second option) persistent sidebar** that replaces and consolidates all per-object property controls into a single scrollable panel that dynamically hydrates from the selected object's state.

---

## 2. Current State Inventory

### Store slices (relevant fields)

| Store | Field | Notes |
|-------|-------|-------|
| `canvasStore` | `selectedObjectIds: string[]` | Source of truth for selection |
| `canvasStore` | `activeColor: string` | Current color picker value |
| `canvasStore` | `lastUsedColors: Record<ObjectType, string>` | Per-type color memory |
| `canvasStore` | `recentColors: string[]` | Last 8 unique applied colors |
| `objectStore` | `objects: Record<string, BoardObject>` | All object data |
| `objectStore` | `updateObjectLocal()` | Optimistic update (local only) |
| `objectStore` | `updateObject()` (Firestore) | Persistent sync |

### BoardObject fields that map to UI controls

| Field | Type | Current Control |
|-------|------|-----------------|
| `color` | `string` | ColorPickerPopup (toolbar) |
| `opacity` | `number` (0–1) | OpacityPopup (toolbar) |
| `thickness` | `number` (1–10) | BorderStyleMenu slider (toolbar) |
| `borderType` | `'solid' \| 'dashed' \| 'dotted'` | BorderStyleMenu buttons (toolbar) |
| `fontFamily` | `StickyFontFamily` | Select (toolbar, sticky only) |
| `fontSize` | `number` | **No UI — TextObject only** |
| `zIndex` | `number` | ArrangeMenu (toolbar) |
| `rotation` | `number` | Via Transformer handle only |

### Missing fields on `BoardObject` that must be added

| Field | Type | Purpose |
|-------|------|---------|
| `strokeColor` | `string \| undefined` | Separate border/stroke color for shapes |
| `textColor` | `string \| undefined` | Text color independent of fill (shapes, frames) |
| `textAlign` | `'left' \| 'center' \| 'right'` | Horizontal text alignment |
| `textVerticalAlign` | `'top' \| 'middle' \| 'bottom'` | Vertical text alignment (sticky/frame) |
| `lineType` | `'straight' \| 'elbow' \| 'curved'` | Connector/line routing type |
| `startEffect` | `LineEffect` | Arrow/dot/none at start of line |
| `endEffect` | `LineEffect` | Arrow/dot/none at end of line |
| `startEffectSize` | `number` | Start effect size % (default 100) |
| `endEffectSize` | `number` | End effect size % (default 100) |

Where `LineEffect = 'none' | 'arrow' | 'filled-arrow' | 'dot' | 'open-arrow'`.

---

## 3. Architecture Decision

### Option A: Left sidebar (pushes canvas right) ✓ Chosen
Matches the Biorender reference images. The panel occupies `w-72` on the left edge; the canvas `flex-1` region shrinks accordingly. The existing Toolbar stays inside the canvas region.

### Option B: Right sidebar (mirrors ChatSidebar pattern)
Symmetrical with ChatSidebar, but forces users to look right for both chat and properties — bad when both are open simultaneously.

### Option C: Floating panel (overlay)
Zero layout impact but covers canvas content under the selected object. Rejected.

**Decision: Option A** — persistent left sidebar, `w-72`, pushes canvas. The sidebar is hidden when nothing is selected (empty state shows board-level settings / search). The existing Toolbar remains inside the canvas region at `left-4`.

---

## 4. Type System Changes (`src/lib/types.ts`)

### 4.1 New type aliases

```typescript
// ---- Properties Sidebar types ----

export type LineEffect = 'none' | 'arrow' | 'filled-arrow' | 'open-arrow' | 'dot';

export type LineType = 'straight' | 'elbow' | 'curved';

export type TextAlign = 'left' | 'center' | 'right';

export type TextVerticalAlign = 'top' | 'middle' | 'bottom';
```

### 4.2 Extended `BoardObject` interface

Add the following optional fields to the existing `BoardObject` interface:

```typescript
// Extended visual properties (Properties Sidebar)
strokeColor?: string;           // Separate border/stroke color (shapes, frames)
textColor?: string;             // Text fill color (shapes, frames, sticky notes)
textAlign?: TextAlign;          // Horizontal text alignment
textVerticalAlign?: TextVerticalAlign; // Vertical text alignment
lineType?: LineType;            // Connector/line routing
startEffect?: LineEffect;       // Line start decoration
endEffect?: LineEffect;         // Line end decoration
startEffectSize?: number;       // Start effect scale % (default 100)
endEffectSize?: number;         // End effect scale % (default 100)
```

### 4.3 Preset type

```typescript
export interface StylePreset {
  id: string;
  label: string;
  /** Fill/background color */
  color: string;
  /** Border color */
  strokeColor?: string;
  /** Text color */
  textColor?: string;
  /** Preview background hex for the chip swatch */
  previewBg: string;
  /** Preview border hex for the chip */
  previewBorder?: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  // Neutral row
  { id: 'soft-white',   label: 'Soft White',   color: '#FFFFFF', strokeColor: '#D1D5DB', textColor: '#111827', previewBg: '#FFFFFF', previewBorder: '#D1D5DB' },
  { id: 'light-gray',   label: 'Light Gray',   color: '#F3F4F6', strokeColor: '#9CA3AF', textColor: '#111827', previewBg: '#F3F4F6', previewBorder: '#9CA3AF' },
  { id: 'charcoal',     label: 'Charcoal',     color: '#374151', strokeColor: '#1F2937', textColor: '#FFFFFF', previewBg: '#374151', previewBorder: '#1F2937' },
  // Blue row
  { id: 'sky-blue',     label: 'Sky Blue',     color: '#EFF6FF', strokeColor: '#93C5FD', textColor: '#1E40AF', previewBg: '#EFF6FF', previewBorder: '#93C5FD' },
  { id: 'brand-blue',   label: 'Brand Blue',   color: '#3B82F6', strokeColor: '#2563EB', textColor: '#FFFFFF', previewBg: '#3B82F6', previewBorder: '#2563EB' },
  { id: 'indigo',       label: 'Indigo',       color: '#4F46E5', strokeColor: '#4338CA', textColor: '#FFFFFF', previewBg: '#4F46E5', previewBorder: '#4338CA' },
  // Green row
  { id: 'mint',         label: 'Mint',         color: '#ECFDF5', strokeColor: '#6EE7B7', textColor: '#065F46', previewBg: '#ECFDF5', previewBorder: '#6EE7B7' },
  { id: 'emerald',      label: 'Emerald',      color: '#10B981', strokeColor: '#059669', textColor: '#FFFFFF', previewBg: '#10B981', previewBorder: '#059669' },
  { id: 'forest',       label: 'Forest',       color: '#065F46', strokeColor: '#064E3B', textColor: '#FFFFFF', previewBg: '#065F46', previewBorder: '#064E3B' },
  // Amber row
  { id: 'warm-yellow',  label: 'Warm Yellow',  color: '#FEF3C7', strokeColor: '#FCD34D', textColor: '#92400E', previewBg: '#FEF3C7', previewBorder: '#FCD34D' },
  { id: 'amber',        label: 'Amber',        color: '#F59E0B', strokeColor: '#D97706', textColor: '#FFFFFF', previewBg: '#F59E0B', previewBorder: '#D97706' },
  { id: 'rust',         label: 'Rust',         color: '#92400E', strokeColor: '#78350F', textColor: '#FFFFFF', previewBg: '#92400E', previewBorder: '#78350F' },
];
```

---

## 5. Zustand Store Changes

### 5.1 New `propertiesStore` slice (`src/lib/store/propertiesStore.ts`)

A new focused slice that derives and caches the "live" properties of the current selection, and provides debounced-sync actions.

```typescript
interface PropertiesSlice {
  /** Whether the sidebar is visible (true when 1+ objects are selected) */
  isSidebarOpen: boolean;

  /**
   * Computed view of the first selected object's properties,
   * merged with multi-select averages for numeric fields.
   * Null when nothing is selected.
   */
  activeProperties: ActiveProperties | null;
}

interface ActiveProperties {
  objectType: ObjectType;         // Determines which module sections to show
  ids: string[];                  // All selected IDs (for batch updates)
  // --- Shared fields ---
  opacity: number;                // 0–1
  // --- Shape fields ---
  color?: string;                 // Fill
  strokeColor?: string;           // Stroke/border
  thickness?: number;             // Border width
  borderType?: 'solid' | 'dashed' | 'dotted';
  // --- Text fields ---
  textColor?: string;
  fontFamily?: StickyFontFamily;
  fontSize?: number;
  textAlign?: TextAlign;
  textVerticalAlign?: TextVerticalAlign;
  // --- Line/Connector fields ---
  lineColor?: string;
  lineWidth?: number;
  lineDash?: number;              // Dash length (0 = solid)
  lineType?: LineType;
  startEffect?: LineEffect;
  endEffect?: LineEffect;
  startEffectSize?: number;
  endEffectSize?: number;
}
```

**Actions on `propertiesStore`:**

| Action | Signature | Description |
|--------|-----------|-------------|
| `computeActiveProperties` | `(objects: Record<string, BoardObject>, selectedIds: string[]) => void` | Recomputes `activeProperties` from store snapshot; called by a selector subscription in the sidebar |
| `applyPreset` | `(preset: StylePreset, boardId: string) => void` | Batch-applies preset color values to all selected objects |

**Where properties are actually mutated:** Updates go directly through the existing `objectStore.updateObjectLocal()` + `objectStore.updateObject()` pattern — `propertiesStore` does not own object data; it only owns the derived view and the sidebar's open/close state.

### 5.2 Changes to `canvasStore`

Add a subscription that mirrors `selectedObjectIds` changes to trigger `propertiesStore.computeActiveProperties`. This can be a `subscribe` call in `propertiesStore` initialization, or a selector in `PropertiesSidebar` that calls `computeActiveProperties` as a side-effect via `useEffect`.

**Preferred pattern**: `PropertiesSidebar` subscribes to `selectedObjectIds` and `objects` and calls a local `useMemo` to derive `activeProperties` inline — avoiding cross-store imperative calls.

---

## 6. Component Architecture

```
src/components/properties/
├── PropertiesSidebar.tsx         # Root panel: layout, scroll, empty state
├── PresetsSection.tsx            # Color/style preset chip grid + "See more"
├── TransparencyControl.tsx       # Shared opacity slider row
├── modules/
│   ├── LineModule.tsx            # Color, Width, Dash, Type, Effect (line/connector)
│   ├── ShapeModule.tsx           # Fill, Stroke, Border Width, Border Dash
│   ├── TextModule.tsx            # Font, Size, Color, Alignment suite
│   ├── FrameModule.tsx           # Border thickness, title font size
│   └── StickyNoteModule.tsx      # Color (fill), font family picker
└── controls/
    ├── ColorRow.tsx              # Swatch + hex input row (reusable)
    ├── SliderRow.tsx             # Label + number input + range slider (reusable)
    ├── DropdownRow.tsx           # Label + styled <select> row
    ├── AlignButtonGroup.tsx      # Icon button group (H/V align)
    └── EffectDropdown.tsx        # Arrow/effect visual dropdown
```

### 6.1 `PropertiesSidebar.tsx`

```
┌─────────────────────────────┐
│  [Search Icons]  input      │  ← empty state / global search placeholder
│─────────────────────────────│
│  Styles                     │  ← only when object selected
│  Presets                    │
│  [Aa][Aa][Aa][Aa][Aa][Aa]  │
│  [Aa][Aa][Aa][Aa][Aa][Aa]  │
│           See more          │
│─────────────────────────────│
│  Transparency  [0] ——●————  │
│─────────────────────────────│
│  <LineModule />             │  ← conditional on type
│  <ShapeModule />            │
│  <TextModule />             │
│  <FrameModule />            │
│  <StickyNoteModule />       │
└─────────────────────────────┘
```

**Props**: none (reads directly from stores via hooks).

**Layout behavior:**
- `w-72 flex-shrink-0 h-screen overflow-y-auto bg-[#F8F9FA] border-r border-gray-200`
- Always rendered in the DOM; when `selectedObjectIds.length === 0`, shows the empty state (search + board settings).
- Does **not** use absolute/fixed positioning — it is a flex sibling of the canvas area so the canvas `flex-1` region shrinks when the sidebar is visible.

### 6.2 `PresetsSection.tsx`

- Renders a 6-column grid of `StylePreset` chips.
- Each chip is a 40×40 `div` with `previewBg` background, `previewBorder` border, and an `Aa` text preview rendered in the preset's `textColor`.
- Clicking a chip calls `applyPreset(preset, boardId)` which batch-updates `color`, `strokeColor`, and `textColor` on all selected objects.
- "See more" expands to show all 12 presets (default shows 6).

### 6.3 `TransparencyControl.tsx`

Reusable row for every module section:
- Label "Transparency"
- Numeric input (`value = Math.round((1 - opacity) * 100)`, 0–100)
- HTML5 `range` input (`min=0 max=100 step=1`)
- On change: calls `updateObjectLocal` + debounced `updateObject` for all selected IDs

### 6.4 `controls/ColorRow.tsx`

```
Fill   [████] [#EEF4FB ________________]
```
- Accepts `label`, `value: string`, `onChange: (hex: string) => void`
- Color swatch opens a `ColorPickerPopup` (reuse existing component)
- Hex input validates on `blur` / `Enter` (debounced live preview on keystroke after 6 valid hex chars)

### 6.5 `controls/SliderRow.tsx`

```
Width  [2 ] ——●————————————————
```
- Accepts `label`, `value`, `min`, `max`, `step`, `onChange`
- Number input and range slider are bidirectionally synced
- `onChange` fires on every `input` event (for 60 fps canvas preview)
- Firestore sync is debounced 300 ms

### 6.6 Module: `LineModule.tsx` (for `line` and `connector` types)

Controls shown:

| Row | Control |
|-----|---------|
| Color | `ColorRow` (maps to `color` field) |
| Width | `SliderRow` min=0.5 max=20 step=0.5 (maps to `thickness`) |
| Dash | `SliderRow` min=0 max=30 step=1 (maps to new `lineDash` concept via `borderType`) |
| Type | `DropdownRow`: Straight / Elbow / Curved (maps to `lineType`) |
| Effect | `DropdownRow`: None / Arrow / Filled Arrow / Dot (maps to `endEffect`) |
| Arrow section | Start/End `EffectDropdown` + size sliders (maps to `startEffect`, `endEffect`, `startEffectSize`, `endEffectSize`) |

### 6.7 Module: `ShapeModule.tsx` (for `rectangle` and `circle` types)

Controls shown:

| Row | Control |
|-----|---------|
| Fill | `ColorRow` (maps to `color`) |
| Stroke | `ColorRow` (maps to `strokeColor`) |
| Border Width | `SliderRow` min=0 max=20 step=0.5 (maps to `thickness`) |
| Border Dash | `SliderRow` min=0 max=30 step=1 |

### 6.8 Module: `TextModule.tsx` (for `text` and `stickyNote` types, and as sub-section for shape/frame)

Controls shown:

| Row | Control |
|-----|---------|
| Font | `DropdownRow`: Sans-Serif / Handwritten / Monospace (maps to `fontFamily`) |
| Size | `SliderRow` min=8 max=96 step=1 with +/- buttons (maps to `fontSize`) |
| Color | `ColorRow` (maps to `textColor`) |
| Horizontal Align | `AlignButtonGroup`: Left / Center / Right (maps to `textAlign`) |
| Vertical Align | `AlignButtonGroup`: Top / Middle / Bottom (maps to `textVerticalAlign`) |

### 6.9 Module: `FrameModule.tsx` (for `frame` type)

Controls shown:

| Row | Control |
|-----|---------|
| Fill | `ColorRow` (maps to `color`) |
| Border | `ColorRow` (maps to `strokeColor`) |
| Border Width | `SliderRow` min=0 max=10 step=0.5 (maps to `thickness`) |
| Title Size | `SliderRow` min=10 max=32 step=1 (maps to `fontSize`) |

### 6.10 Module: `StickyNoteModule.tsx` (for `stickyNote` type)

Controls shown:

| Row | Control |
|-----|---------|
| Fill | `ColorRow` (maps to `color`) |
| Text Color | `ColorRow` (maps to `textColor`) |
| Font | `DropdownRow` (maps to `fontFamily`) |

---

## 7. Layout Integration

### Current layout (`src/app/board/[boardId]/page.tsx`)

```jsx
<div className="flex h-screen w-screen overflow-hidden">
  {/* main canvas region — flex-1 */}
  <div className="flex-1 relative min-w-0">
    <Toolbar />
    <Canvas />
    ...
  </div>
  {/* right chat sidebar */}
  {sidebarOpen && <ChatSidebar />}
</div>
```

### Target layout

```jsx
<div className="flex h-screen w-screen overflow-hidden">
  {/* LEFT: Properties sidebar — always rendered, w-0 when collapsed */}
  <PropertiesSidebar />

  {/* MIDDLE: Canvas region */}
  <div className="flex-1 relative min-w-0">
    <Toolbar />
    <Canvas />
    ...
  </div>

  {/* RIGHT: Chat sidebar */}
  {sidebarOpen && <ChatSidebar />}
</div>
```

`PropertiesSidebar` renders as `w-72` when an object is selected and `w-0 overflow-hidden` when nothing is selected (smooth CSS transition via `transition-all duration-200`). This ensures the canvas stage always occupies the remaining `flex-1` space without overlap.

> **Important**: `Canvas.tsx` uses `window.innerWidth / window.innerHeight` to size the Konva Stage. After integrating the sidebar, Stage dimensions must be derived from the **container element's dimensions** (`containerRef.current.offsetWidth / offsetHeight`) rather than `window.innerWidth`, otherwise the stage will render behind the sidebar. This is a **required** Canvas.tsx change as part of this plan.

---

## 8. Optimistic Update Flow

The update lifecycle for every property change in the sidebar:

```
User moves slider
      │
      ▼
onChange handler fires (every animationFrame / input event)
      │
      ▼
updateObjectLocal(id, { [field]: newValue })
 └─ Updates Zustand objectStore.objects in-memory immediately
 └─ Marks id in locallyEditingIds (suppresses Firestore echo)
      │
      ▼
Canvas re-renders (Konva node sees new prop — 60 fps smooth)
      │
      ▼
debounce(300ms) fires → updateObject(boardId, id, { [field]: newValue })
 └─ Writes to Firestore
 └─ Removes id from locallyEditingIds after write
```

This pattern already exists for drag/resize. The sidebar reuses it identically.

---

## 9. Canvas Renderer Updates

When new `BoardObject` fields are rendered, the following canvas components need updates:

### `ShapeObject.tsx`

- `<Rect>` / `<Ellipse>` stroke: change from hardcoded `#374151` to `object.strokeColor ?? '#374151'`
- `<Text>` fill: change from hardcoded `#111827` to `object.textColor ?? '#111827'`
- `<Text>` align: add `align={object.textAlign ?? 'center'}`
- `<Text>` verticalAlign: add `verticalAlign={object.textVerticalAlign ?? 'middle'}`

### `StickyNote.tsx`

- Text overlay color: use `object.textColor ?? '#111827'`

### `FrameObject.tsx`

- Border stroke: use `object.strokeColor ?? '#94A3B8'`
- Title font size: use `object.fontSize ?? 14`

### `ConnectorObject.tsx` / `LineObject.tsx`

- Stroke color: use `object.color` (no change — already uses `color` as stroke)
- Stroke width: use `object.thickness ?? 2`
- Dash pattern: derive from `object.borderType`:
  - `'solid'` → `[]`
  - `'dashed'` → `[object.thickness * 4, object.thickness * 4]`
  - `'dotted'` → `[object.thickness, object.thickness * 3]`
- Add arrow rendering based on `startEffect` / `endEffect` (Konva `Arrow` node)

### `TextObject.tsx`

- Add `align={object.textAlign ?? 'left'}`
- Add color: use `object.textColor ?? '#111827'`

---

## 10. Toolbar Cleanup

Once the `PropertiesSidebar` is integrated, the following Toolbar controls become **redundant** and should be removed from `Toolbar.tsx`:

| Control | Reason |
|---------|--------|
| `ColorPickerPopup` trigger | Replaced by ColorRow in sidebar modules |
| `BorderStyleMenu` trigger | Replaced by SliderRow + buttons in ShapeModule/LineModule |
| `OpacityPopup` trigger | Replaced by TransparencyControl in sidebar |
| `FontFamily` select | Replaced by TextModule |

Controls that **remain** in the Toolbar:
- Tool selection (Pointer, Sticky Note, Rectangle, Circle, Line, Frame, Connector, Text)
- `AlignMenu` (multi-selection layout operation — not a property of a single object)
- `ArrangeMenu` (z-index — layer operation, not a visual property)

---

## 11. Implementation Phases

### Phase 1 — Type System (no UI changes)
**Files:** `src/lib/types.ts`

1. Add `LineEffect`, `LineType`, `TextAlign`, `TextVerticalAlign` type aliases.
2. Add new optional fields to `BoardObject`: `strokeColor`, `textColor`, `textAlign`, `textVerticalAlign`, `lineType`, `startEffect`, `endEffect`, `startEffectSize`, `endEffectSize`.
3. Add `StylePreset` interface and `STYLE_PRESETS` constant array.
4. Run `tsc --noEmit` — fix any type errors from new fields.

**Exit criteria:** `tsc --noEmit` passes, no runtime changes.

---

### Phase 2 — Canvas Renderer Wiring (consume new fields)
**Files:** `ShapeObject.tsx`, `StickyNote.tsx`, `FrameObject.tsx`, `ConnectorObject.tsx`, `LineObject.tsx`, `TextObject.tsx`

For each component, swap hardcoded colors/styles for the new optional fields with fallback defaults. This phase makes new fields "live" on the canvas without any UI yet — verifiable by manually patching objects in Firestore or the store devtools.

Also: update `Canvas.tsx` to use `containerRef.current.offsetWidth` for Stage width (sidebar layout prerequisite).

**Exit criteria:** Visual regression test — existing boards look identical (defaults match old hardcoded values).

---

### Phase 3 — Reusable Controls
**Files:** `src/components/properties/controls/`

Build the four primitive controls in isolation (no store wiring):
- `ColorRow.tsx` — reuses `ColorPickerPopup` under the hood
- `SliderRow.tsx`
- `DropdownRow.tsx`
- `AlignButtonGroup.tsx`

These are pure presentational components with `value` + `onChange` props. Write Storybook stories or visual snapshots if desired.

---

### Phase 4 — Property Modules
**Files:** `src/components/properties/modules/`

Build each module using the Phase 3 controls. Wire to the update pattern:
- Receive `object: BoardObject` (or derived `activeProperties`) as prop
- Receive `onChange: (patch: Partial<BoardObject>) => void` as prop
- Call `updateObjectLocal` + debounced `updateObject` in `onChange` (or delegate upward to sidebar)

Order of implementation:
1. `ShapeModule.tsx` (most used)
2. `TextModule.tsx`
3. `LineModule.tsx`
4. `FrameModule.tsx`
5. `StickyNoteModule.tsx`

---

### Phase 5 — PropertiesSidebar Root + Layout
**Files:** `src/components/properties/PropertiesSidebar.tsx`, `PresetsSection.tsx`, `TransparencyControl.tsx`, `src/app/board/[boardId]/page.tsx`

1. Build `PropertiesSidebar.tsx`:
   - Read `selectedObjectIds` from `canvasStore`
   - Derive `activeObject` (first selected) from `objectStore.objects`
   - Render modules conditionally based on `activeObject.type`
   - Render empty state (search input placeholder) when no selection
2. Build `PresetsSection.tsx` with `STYLE_PRESETS` grid
3. Build `TransparencyControl.tsx`
4. Integrate into `board/[boardId]/page.tsx` layout (add sidebar before canvas div)
5. Add `transition-all duration-200` animation for show/hide

---

### Phase 6 — Toolbar Cleanup
**Files:** `src/components/ui/Toolbar.tsx`

Remove `ColorPickerPopup`, `BorderStyleMenu`, `OpacityPopup`, and `FontFamily` select from the Toolbar. Verify removed controls are fully covered by the sidebar. Keep `AlignMenu` and `ArrangeMenu`.

**Exit criteria:** No property controls remain in Toolbar. No regressions in multi-select align/arrange behavior.

---

### Phase 7 — Multi-Select Behavior
When multiple objects of the **same type** are selected, the sidebar should show:
- Averaged numeric values (opacity, thickness, fontSize)
- The first object's color/stroke (with a visual indicator "multiple")
- Changes apply to **all** selected IDs

When multiple objects of **mixed types** are selected:
- Show only the `TransparencyControl` (the single shared property)
- Show the `PresetsSection` (can still apply style presets to mixed selection)
- Hide type-specific modules

---

## 12. Styling Specification

| Token | Value |
|-------|-------|
| Sidebar background | `#F8F9FA` |
| Section divider | `border-t border-gray-200` |
| Section heading | `text-xs font-semibold text-gray-500 uppercase tracking-wider` |
| Control label | `text-sm text-gray-700` |
| Input border | `border border-gray-300 rounded` |
| Input focus | `focus:ring-2 focus:ring-blue-500 focus:border-transparent` |
| Slider track | `accent-blue-500` (CSS `accent-color`) |
| Preset chip size | `40px × 40px`, `rounded-md`, `border border-gray-300` |
| Preset chip active | `ring-2 ring-blue-500 ring-offset-1` |
| Empty state text | `text-sm text-gray-400 text-center` |
| Sidebar width | `w-72` (288px) |
| Z-index | Sidebar is in document flow — no z-index needed |

Icons: use `lucide-react` for all alignment and decoration icons. Specific icons:
- `AlignLeft`, `AlignCenter`, `AlignRight` — horizontal text align
- `AlignStartVertical`, `AlignCenterVertical`, `AlignEndVertical` — vertical align (or use `ArrowUp`, `Minus`, `ArrowDown` as fallback)
- `Minus` — dash style indicator
- `ChevronDown` — all dropdowns

---

## 13. Out of Scope (this plan)

- **Board-level settings** in empty sidebar state — tracked separately
- **Shadow / blur effects** — no Konva API for this without major performance hit
- **Corner radius** control — low priority, add to follow-up
- **Lock/unlock** from sidebar — already handled via Toolbar + keyboard shortcut
- **Position/size (x, y, w, h) numeric inputs** — useful but scope-creep; tracked separately
- **Connector routing engine** (actual elbow/curved path computation for `lineType`) — the field is stored but path computation is a separate feature

---

## 14. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Konva Stage sizing breaks after sidebar layout change | High | High | Update `Canvas.tsx` in Phase 2; test immediately |
| Performance regression from sidebar re-renders during rapid slider drag | Medium | Medium | Debounce Firestore writes; `React.memo` all module components; use `useCallback` on onChange handlers |
| Existing `ColorPickerPopup` not easily reusable inside `ColorRow` | Low | Low | ColorRow wraps it as a controlled component via a local `isOpen` state |
| Multi-select "multiple values" UX unclear | Medium | Low | Show placeholder text `"—"` in inputs with `title="Multiple values"` tooltip |
| New optional `BoardObject` fields break Firestore schema | Low | Low | All new fields are optional; missing = use defaults in renderers |

---

## 15. File Checklist

### New files
- [ ] `src/lib/store/propertiesStore.ts`
- [ ] `src/components/properties/PropertiesSidebar.tsx`
- [ ] `src/components/properties/PresetsSection.tsx`
- [ ] `src/components/properties/TransparencyControl.tsx`
- [ ] `src/components/properties/controls/ColorRow.tsx`
- [ ] `src/components/properties/controls/SliderRow.tsx`
- [ ] `src/components/properties/controls/DropdownRow.tsx`
- [ ] `src/components/properties/controls/AlignButtonGroup.tsx`
- [ ] `src/components/properties/controls/EffectDropdown.tsx`
- [ ] `src/components/properties/modules/LineModule.tsx`
- [ ] `src/components/properties/modules/ShapeModule.tsx`
- [ ] `src/components/properties/modules/TextModule.tsx`
- [ ] `src/components/properties/modules/FrameModule.tsx`
- [ ] `src/components/properties/modules/StickyNoteModule.tsx`

### Modified files
- [ ] `src/lib/types.ts` — add new type aliases + BoardObject fields + STYLE_PRESETS
- [ ] `src/components/canvas/ShapeObject.tsx` — use strokeColor, textColor, textAlign, textVerticalAlign
- [ ] `src/components/canvas/StickyNote.tsx` — use textColor
- [ ] `src/components/canvas/FrameObject.tsx` — use strokeColor, fontSize
- [ ] `src/components/canvas/ConnectorObject.tsx` — use lineType, effects
- [ ] `src/components/canvas/LineObject.tsx` — use lineType, effects
- [ ] `src/components/canvas/TextObject.tsx` — use textColor, textAlign
- [ ] `src/components/canvas/Canvas.tsx` — use container dimensions for Stage sizing
- [ ] `src/app/board/[boardId]/page.tsx` — add PropertiesSidebar to layout
- [ ] `src/components/ui/Toolbar.tsx` — remove redundant property controls (Phase 6)

### Possibly deleted (Phase 6)
- [ ] `src/components/ui/BorderStyleMenu.tsx` — replaced by sidebar modules
- [ ] `src/components/ui/OpacityPopup.tsx` — replaced by TransparencyControl
- [ ] `src/components/ui/ColorPicker.tsx` — already appears unused; confirm and delete
