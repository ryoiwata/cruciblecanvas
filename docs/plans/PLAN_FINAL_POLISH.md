# PLAN_FINAL_POLISH.md — Final Architecture & UI Polish

**Status:** Planning
**Date:** 2026-02-20
**Branch target:** `ui_features` → `main`

---

## Overview

This plan covers the final round of architectural hardening and UX polish for CrucibleCanvas. It is organised into four areas that mirror the spec, with a fifth cross-cutting section for the "Save to Account" persistence feature. Each section begins with a brief audit summary, then lists the exact files and changes required.

### Priority order (implement in this sequence)
1. Frame stacking & containment (core collaborative correctness)
2. Group right-click context menu (collaborative correctness)
3. Selection multi-select upgrades (Shift+Click, tool reversion)
4. Toolbar opacity pop-out + object styling (ShapeObject borderType/thickness)
5. Shortcut legend two-row layout + dynamic margin
6. Standalone text tool
7. AI sidebar Robot icon
8. Save-to-Account persistence

---

## 1. Deep Frame & Stacking Logic

### Audit findings
- `FRAME_ZINDEX_MAX = 1000` and `OBJECT_ZINDEX_MIN = 1001` already exist in `types.ts`.
- `getMaxZIndexForTool()` in `Canvas.tsx` already enforces this at creation time.
- **Gap 1:** When a frame is dragged or an existing frame object is loaded from Firestore with a stale `zIndex` above 1000, the sentinel is never re-enforced. A full `BoardObjects.tsx` sort guard is needed.
- **Gap 2:** Frame containment does not exist — a child object can be freely dragged outside the frame boundary without being deframed. The spec requires it to be visually clamped (drag is restricted to frame bounds) unless explicitly deframed.
- **Gap 3:** There is no visual indicator that an object is captured inside a frame — only the UI logic knows about `parentFrame`.
- **Gap 4:** "Deframe" single-object context menu item already exists in `ContextMenu.tsx`. No code changes needed here — just verify it fires `updateObject(id, { parentFrame: undefined })`.

### 1a. Frame Z-index hard floor in BoardObjects.tsx

**File:** `src/components/canvas/BoardObjects.tsx`

In the `zSort` comparator that drives the rendered order, add an explicit clamp: any object whose `type === "frame"` is assigned a sort key that is always below any non-frame, regardless of its stored `zIndex`.

```ts
// replace the current comparator with:
function zSort(a: BoardObject, b: BoardObject): number {
  const keyA = a.type === 'frame' ? a.zIndex ?? 0 : (a.zIndex ?? OBJECT_ZINDEX_MIN) + OBJECT_ZINDEX_MIN;
  const keyB = b.type === 'frame' ? b.zIndex ?? 0 : (b.zIndex ?? OBJECT_ZINDEX_MIN) + OBJECT_ZINDEX_MIN;
  if (keyA !== keyB) return keyA - keyB;
  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
}
```

This guarantees frames sort below non-frames even if the stored `zIndex` is corrupted.

### 1b. Frame containment — clamp drag to parent bounds

**Goal:** When an object with `parentFrame` set is dragged, constrain its Konva `dragBoundFunc` to stay within the frame's bounding box.

**File:** `src/components/canvas/objects/ShapeObject.tsx`
**File:** `src/components/canvas/objects/StickyNote.tsx`
**File:** `src/components/canvas/objects/LineObject.tsx`

Each draggable `Group` already has no `dragBoundFunc`. We add one conditionally when `object.parentFrame` is set.

```ts
// near top of each component, after reading object from store:
const parentFrame = object.parentFrame
  ? useObjectStore.getState().objects[object.parentFrame]
  : null;

// on the Konva Group:
dragBoundFunc={
  parentFrame
    ? (pos) => {
        const halfW = (object.width ?? 100) / 2;
        const halfH = (object.height ?? 100) / 2;
        return {
          x: Math.max(parentFrame.x, Math.min(pos.x, parentFrame.x + (parentFrame.width ?? 0) - halfW)),
          y: Math.max(parentFrame.y, Math.min(pos.y, parentFrame.y + (parentFrame.height ?? 0) - halfH)),
        };
      }
    : undefined
}
```

**Caveat:** `dragBoundFunc` in Konva receives stage-level coordinates. The frame's `x, y` are also stage-level (objects are not nested inside the frame's Konva Group — they are siblings). The calc above is correct for siblings.

**Note on Frame moves:** `FrameObject.handleDragMove` already moves all children by delta. The clamp only applies when children are dragged independently.

### 1c. Visual indicator for captured objects

**Goal:** Objects with a non-null `parentFrame` render with a thicker, brand-accented stroke.

**Implementation approach:** Add a `isCaptured` boolean prop derived from `!!object.parentFrame` in `ShapeObject`, `StickyNote`, and `FrameObject` (for nested frames).

For **ShapeObject** (`src/components/canvas/objects/ShapeObject.tsx`):
- Shapes currently use no default stroke (only a selection stroke). Add a second light stroke layer:
  ```ts
  const captureStroke = object.parentFrame ? '#7C3AED' : 'transparent';
  const captureStrokeWidth = object.parentFrame ? 2 : 0;
  ```
  Apply `stroke={captureStroke} strokeWidth={captureStrokeWidth}` to the `Rect`/`Circle` shape node.

For **StickyNote** (`src/components/canvas/objects/StickyNote.tsx`):
- Sticky notes render as a `Rect` with a shadow. Add `stroke={captureStroke}` and `strokeWidth={captureStrokeWidth}` to the main `Rect`.

For **FrameObject** (`src/components/canvas/objects/FrameObject.tsx`):
- Frames already render a border rect. When the frame itself has a `parentFrame`, add a `dash={[6,3]}` purple stroke to indicate a nested-frame capture state.

---

## 2. Selection & Group Interaction

### 2a. Shift+Click multi-select

**Audit:** Currently, `toggleSelection(id)` is called only for `Ctrl/Meta + click`. Shift+Click routes to `selectObject(id)` (replaces selection).

**File:** `src/components/canvas/objects/ShapeObject.tsx`, `StickyNote.tsx`, `FrameObject.tsx`, `LineObject.tsx`, `ConnectorObject.tsx`

In each object's `handleClick` (or `handlePointerClick`), extend the multi-select check:

```ts
// Before:
if (e.evt.ctrlKey || e.evt.metaKey) {
  toggleSelection(object.id);
} else {
  selectObject(object.id);
}

// After:
if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) {
  toggleSelection(object.id);
} else {
  selectObject(object.id);
}
```

Update `ShortcutLegend.tsx` multi-select label to read `Ctrl / Shift + Click`.

### 2b. Group context menu

**Audit:** `ContextMenu.tsx` receives a single `targetObjectId: string | null`. When right-clicking an object that is part of a multi-selection, the menu should target the entire group.

**Required changes:**

**`canvasStore.ts`** — Update `ContextMenuState`:
```ts
interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetObjectId: string | null;
  targetObjectIds: string[];   // ADD: group target
  nearbyFrames: { id: string; title: string }[];
}
```
Initial state: `targetObjectIds: []`

**Each object component** — Update `handleContextMenu`:
```ts
const handleContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
  e.cancelBubble = true;
  const { selectedObjectIds, setContextMenu } = useCanvasStore.getState();
  const isInGroup = selectedObjectIds.includes(object.id) && selectedObjectIds.length > 1;
  setContextMenu({
    visible: true,
    x: e.evt.clientX,
    y: e.evt.clientY,
    targetObjectId: isInGroup ? null : object.id,
    targetObjectIds: isInGroup ? selectedObjectIds : [],
    nearbyFrames: [],
  });
};
```

**`ContextMenu.tsx`** — Add group menu rendering:
```ts
const isGroupTarget = contextMenu.targetObjectIds.length > 1;

// Group menu items (shown when isGroupTarget):
// - "Delete N objects" → deletes all IDs in targetObjectIds
// - "Duplicate Group" → duplicates all with offset
// - "Add to Frame: ..." (if nearbyFrames)
// - "Deframe All Selected" (if any have parentFrame)

// Single-object items only shown when !isGroupTarget
```

The nearby frames for group context should be derived by checking which frames contain the majority of the selected objects.

**`Canvas.tsx handleContextMenu`** (empty canvas click) — clear `targetObjectIds: []` when setting the empty-canvas menu.

### 2c. Tool reversion on Ctrl/Shift key press

**Goal:** Pressing Ctrl or Shift when a creation tool is active automatically switches back to the Pointer tool.

**File:** `src/hooks/useKeyboardShortcuts.ts`

Add `keydown` listener logic:
```ts
// In the effect that registers keyboard handlers:
const handleKeyDown = (e: KeyboardEvent) => {
  // ... existing logic ...

  // Ctrl/Shift pressed while in create mode → revert to pointer
  if ((e.key === 'Control' || e.key === 'Shift') && mode === 'create') {
    setMode('pointer');
    setCreationTool(null);
  }
};
```

Also need `keyup` handler if we want "hold to temp-pointer, release to return" behaviour — but the spec says "pressing returns to pointer", not a hold, so `keydown` only is correct.

**Note:** The marquee drag (Ctrl+Drag) already resets mode correctly because it uses `pointerInteractionRef` not `mode`. This change only affects the case where a creation tool is active.

---

## 3. UI Refinement & Toolbar Polish

### 3a. Opacity slider pop-out from Toolbar

**Audit:** The opacity slider lives inline in `Toolbar.tsx` below the AlignMenu/ArrangeMenu. It conditionally renders when non-connector objects are selected and widens the toolbar.

**Goal:** Move to a pop-out panel triggered by an "Opacity" button.

**File:** `src/components/ui/Toolbar.tsx`

Replace the inline opacity slider with a new `OpacityPopup` component pattern (matching `ColorPickerPopup`):

```ts
// New file: src/components/ui/OpacityPopup.tsx
// Renders a floating panel anchored to the right of the toolbar button
// Contains: label "Opacity", range input 10–100, percentage display
// Same popover pattern as ColorPickerPopup (absolute positioned, z-50, bg-white/90 rounded shadow)
```

The trigger button shows the current average opacity as `{Math.round(avgOpacity * 100)}%` in a small label. The popout closes on outside click (same pattern as `ColorPickerPopup`).

**Remove** the inline opacity block from `Toolbar.tsx`. **Remove** the duplicate opacity slider from `ContextMenu.tsx` (keep only the Toolbar pop-out as the canonical opacity control to avoid confusion).

### 3b. Object styling — ShapeObject borderType & thickness

**Audit:** `borderType` and `thickness` fields exist on `BoardObject` and are consumed by `LineObject` and `ConnectorObject` but not by `ShapeObject`.

**Files to change:**

**`src/components/canvas/objects/ShapeObject.tsx`:**
```ts
// Add stroke width and style:
const strokeWidth = object.thickness ?? 0;  // 0 = no border (default)
const strokeColor = isSelected ? SELECTION_STROKE : (object.borderType ? '#374151' : 'transparent');
const dash = getStrokeDash(object.borderType);  // import from utils

// Apply to Rect/Circle node:
strokeWidth={isSelected ? 2 : strokeWidth}
stroke={strokeColor}
dash={isSelected ? undefined : dash}
```

**`src/components/ui/Toolbar.tsx`:**

Add a `BorderStyleMenu` pop-out (similar to AlignMenu) that appears when shapes/frames/lines are selected. Contains:
- Thickness: existing slider (already shown for lines/connectors; extend to shapes)
- Border style: three segmented buttons — Solid | Dashed | Dotted (icons: `⎯`, `- - -`, `···`)
- The toolbar should check if any non-connector, non-frame objects are selected to show this menu

**New file:** `src/components/ui/BorderStyleMenu.tsx`
```ts
// Pop-out panel with:
// - Thickness range slider (1–10)
// - Three border style toggle buttons
// Calls updateObjectLocal + updateObject for all selected objects
```

Extend `Toolbar.tsx` to render `<BorderStyleMenu />` between AlignMenu and the existing thickness slider. Replace the existing thickness-only slider with the new BorderStyleMenu for lines/connectors.

### 3c. Shortcut legend two-row layout

**File:** `src/components/ui/ShortcutLegend.tsx`

**Layout changes:**
1. Split shortcuts into two rows of ≤4 items each
2. Add dynamic right margin that accounts for the AI chat sidebar:
   ```ts
   const isChatOpen = useChatStore(s => s.isSidebarOpen);
   // apply: style={{ right: isChatOpen ? '20rem' : '1rem' }}
   // and change positioning from centered to right-anchored
   ```
3. Change from `fixed left-1/2 -translate-x-1/2 bottom-4` to `fixed bottom-4 right-4 transition-all`
4. Change from `flex flex-row` to `flex flex-col gap-1` with two inner `flex flex-row` rows

**Updated shortcut rows:**

Row 1: Select | Multi-Select | Select All | Copy/Paste
Row 2: Delete | Duplicate | Ctrl+[/] (Layers) | Chat (/)

```ts
const ROW_1 = [
  { icon: <MarqueeIcon />,   label: 'Select',      keys: 'Ctrl+Drag' },
  { icon: <MultiSelIcon />,  label: 'Multi-Select', keys: 'Ctrl / Shift+Click' },
  { icon: <SelAllIcon />,    label: 'Select All',  keys: 'Ctrl+A' },
  { icon: <CopyIcon />,      label: 'Copy / Paste', keys: 'Ctrl+C / V' },
];
const ROW_2 = [
  { icon: <DeleteIcon />,    label: 'Delete',      keys: 'Del' },
  { icon: <DupIcon />,       label: 'Duplicate',   keys: 'Ctrl+D' },
  { icon: <LayerIcon />,     label: 'Layers',      keys: 'Ctrl+[ / ]' },
  { icon: <ChatIcon />,      label: 'Chat',        keys: '/' },
];
```

---

## 4. Standalone Text Tool

### 4a. New ObjectType: "text"

**File:** `src/lib/types.ts`
- Add `"text"` to `ObjectType` union
- For text objects: `text`, `x`, `y`, `width`, `height`, `fontSize` (optional, default 16), `fontFamily`, `color`
- `height` is auto-sized based on content; store a minimum height

### 4b. TextObject renderer

**New file:** `src/components/canvas/objects/TextObject.tsx`

```tsx
/**
 * Renders a standalone text element directly on the canvas.
 * Uses Konva Text node with wrap="word" for automatic line breaks.
 * Double-click opens the HTML TextEditor overlay.
 */
```

Key behaviours:
- Renders as a transparent-background Konva `Text` node
- Selection stroke only; no fill rect
- Double-click sets `editingObjectId` (TextEditor overlay handles editing)
- After editing ends, update `width` to `textNode.width()` and `height` to `textNode.height()`
- Respects `fontSize`, `fontFamily`, `color` fields
- Draggable, rotatable, selectable (same pattern as StickyNote)

### 4c. Toolbar tool addition

**File:** `src/components/ui/Toolbar.tsx`

Add to tool list after `line`:
```ts
{ id: 'text', label: 'Text', shortcut: '8', icon: <span className="font-bold text-base">T</span> }
```

**File:** `src/hooks/useKeyboardShortcuts.ts`
- Add `'8'` shortcut to set `creationTool('text')`

**File:** `src/components/canvas/Canvas.tsx`
- In `handleClick` (pointer down in create mode with `creationTool === 'text'`): create a text object with `width: 200, height: 40, text: ''`, then immediately set `editingObjectId` to it so the user types right away.

### 4d. BoardObjects.tsx

Add `case 'text': return <TextObject ... />` in the object renderer switch.

---

## 5. AI Sidebar Robot Icon

**Audit:** The AI chat trigger button is currently in `ChatSidebar.tsx` or a trigger in `Canvas.tsx` / `Toolbar.tsx`. Need to locate the trigger element and swap the current icon for a robot SVG.

**File to check:** `src/components/chat/ChatSidebar.tsx` and any sidebar toggle button in the layout.

**Change:** Replace the current icon (likely `✨` or a sparkle emoji/SVG) with a robot SVG icon. Use an inline SVG or a Lucide-react `Bot` icon (`lucide-react` is already a dependency in Next.js projects — verify in `package.json`; if absent, use an inline SVG).

```tsx
import { Bot } from 'lucide-react';
// ...
<Bot className="w-5 h-5" />
```

---

## 6. Save-to-Account (Anonymous → Permanent)

### Audit
- `authStore.ts` holds `user: FirebaseUser | null` and `displayName: string`
- Firebase Auth supports `linkWithCredential` to link an anonymous session to a Google/email account
- Boards are stored under `boards/{boardId}` with `creatorUid` matching the anonymous UID
- After linking, the UID is preserved — so Firestore documents do not need to be migrated

### 6a. "Save to Account" UI

**File:** `src/components/ui/SaveToAccountBanner.tsx` (new)

A dismissible banner shown at the top of the board page when `user.isAnonymous === true`. Contains:
- Message: "You're working anonymously. Save your board to your account to keep it forever."
- Button: "Sign in with Google"
- Dismiss (×) button — hides for the session (localStorage flag)

**File:** `src/app/board/[boardId]/page.tsx`

Render `<SaveToAccountBanner />` above the canvas when `user?.isAnonymous`.

### 6b. Link account logic

**File:** `src/lib/auth/linkAccount.ts` (new)

```ts
/**
 * Links the current anonymous session to a Google credential.
 * Firebase preserves the UID, so all boards created anonymously remain accessible.
 */
export async function linkAnonymousToGoogle(auth: Auth): Promise<UserCredential> {
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  // If user is anonymous, link; otherwise just sign in
  if (auth.currentUser?.isAnonymous) {
    return linkWithCredential(auth.currentUser, GoogleAuthProvider.credentialFromResult(credential)!);
  }
  return credential;
}
```

**`authStore.ts`** — expose `isAnonymous: boolean` derived from `user?.isAnonymous ?? true`.

### 6c. Board ownership update post-link

After linking, the `creatorUid` in `boards/{boardId}/metadata/config` does not need to change (UID is preserved by Firebase). However, update `displayName` via `updateProfile` so the board shows a real name.

---

## File Change Summary

| File | Type | Area |
|------|------|------|
| `src/components/canvas/BoardObjects.tsx` | Modify | Frame Z-sort hard floor |
| `src/components/canvas/objects/ShapeObject.tsx` | Modify | Frame containment, capture indicator, borderType/thickness |
| `src/components/canvas/objects/StickyNote.tsx` | Modify | Frame containment, capture indicator, Shift+Click, group ctx menu |
| `src/components/canvas/objects/FrameObject.tsx` | Modify | Nested-frame capture indicator, group ctx menu |
| `src/components/canvas/objects/LineObject.tsx` | Modify | Frame containment (if parentFrame is allowed for lines) |
| `src/components/canvas/objects/ConnectorObject.tsx` | Modify | Shift+Click, group ctx menu |
| `src/components/canvas/objects/TextObject.tsx` | **New** | Standalone text renderer |
| `src/lib/store/canvasStore.ts` | Modify | `ContextMenuState.targetObjectIds`, group ctx menu dispatch |
| `src/lib/types.ts` | Modify | Add `"text"` to `ObjectType`, `"text"` object shape |
| `src/components/canvas/Canvas.tsx` | Modify | Text tool creation click handler |
| `src/components/canvas/objects/ContextMenu.tsx` | Modify | Group menu items, remove duplicate opacity slider |
| `src/components/ui/Toolbar.tsx` | Modify | OpacityPopup, BorderStyleMenu, text tool entry |
| `src/components/ui/OpacityPopup.tsx` | **New** | Opacity pop-out component |
| `src/components/ui/BorderStyleMenu.tsx` | **New** | Thickness + border style pop-out |
| `src/components/ui/ShortcutLegend.tsx` | Modify | Two-row layout, dynamic right margin |
| `src/hooks/useKeyboardShortcuts.ts` | Modify | Ctrl/Shift tool reversion, `'8'` → text tool |
| `src/components/chat/ChatSidebar.tsx` | Modify | Robot icon |
| `src/components/ui/SaveToAccountBanner.tsx` | **New** | Anonymous-to-permanent banner |
| `src/lib/auth/linkAccount.ts` | **New** | `linkAnonymousToGoogle` helper |
| `src/app/board/[boardId]/page.tsx` | Modify | Render SaveToAccountBanner |

---

## Implementation Phases

### Phase A — Core Correctness (implement first)
1. `BoardObjects.tsx` zSort hard floor
2. Frame drag containment (`dragBoundFunc`) in ShapeObject + StickyNote
3. Capture visual indicator (purple stroke for `parentFrame` objects)
4. `canvasStore` + object components: group context menu (`targetObjectIds`)
5. `ContextMenu.tsx` group menu rendering

### Phase B — Selection & Tool Handling
6. Shift+Click multi-select in all object components
7. Tool reversion on Ctrl/Shift in `useKeyboardShortcuts.ts`

### Phase C — Toolbar & Styling
8. `ShapeObject` reads `borderType` + `thickness`
9. `BorderStyleMenu.tsx` (new) + integration in `Toolbar.tsx`
10. `OpacityPopup.tsx` (new) + remove inline opacity from Toolbar + ContextMenu

### Phase D — Layout & Visual Polish
11. `ShortcutLegend.tsx` two-row layout + dynamic right margin
12. AI sidebar Robot icon

### Phase E — New Features
13. `ObjectType` + `TextObject.tsx` + Toolbar text tool
14. `SaveToAccountBanner.tsx` + `linkAccount.ts` + page integration

---

## Open Questions / Risks

1. **Frame containment for connectors:** Connectors have two endpoints. Should `dragBoundFunc` apply to connectors whose *both* endpoints are inside a frame? Suggested answer: no — connectors are not captured by frames in the current model, so skip.

2. **Opacity slider removal from ContextMenu:** The context menu currently has the *only* per-object opacity UI. Removing it before the Toolbar pop-out is working would be a regression. Build and verify the Toolbar pop-out first, then remove the ContextMenu version.

3. **Text tool text sizing:** Konva `Text` auto-height depends on font metrics. The `height` stored in Firestore should be updated whenever the text editor closes. If the text is empty and the user clicks away without typing, the object should be auto-deleted to avoid empty invisible objects.

4. **`lucide-react` availability:** If `lucide-react` is not in `package.json`, use an inline SVG for the Robot icon rather than adding a dependency. Check with `cat package.json | grep lucide` before implementing Phase D.

5. **`linkWithCredential` popup blocker:** Some browsers block the popup if not triggered directly by a user gesture. The "Sign in with Google" button click is a direct gesture, so this should be safe. Add error handling for the `auth/popup-blocked` error code.
