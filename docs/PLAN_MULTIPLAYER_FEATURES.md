# Multiplayer Features — Technical Implementation Plan

## Overview

This plan covers four multiplayer feature areas for CrucibleCanvas:

1. **Real-time Cursor Presence** — Track and display remote user cursors with pointer icons and name tags
2. **User Identity & Guest List** — Presence bar with avatars, inactive user fading, and identity management
3. **Privacy Toggle** — Public/Private segmented control with emoji indicators
4. **Share Functionality** — Share button with copy-link and email-invite popover

---

## Architecture Summary

### Existing Infrastructure (Already Built)

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Canvas | Konva.js + react-konva | 4-layer rendering (grid, objects, selection, cursors) |
| State | Zustand (4 stores) | `canvasStore`, `objectStore`, `authStore`, `presenceStore` |
| Persistent Data | Firebase Firestore | Board objects, board metadata (`boards/{boardId}/metadata/config`) |
| Ephemeral Data | Firebase RTDB | Cursors, presence, locks |
| Auth | Firebase Auth | Anonymous, email/password, Google OAuth |

### What's Already Implemented

- **Cursor broadcasting**: Canvas.tsx sends cursor positions at 30Hz with 5px min-distance threshold via `setCursor()` to RTDB
- **CursorLayer.tsx**: Renders remote cursors using granular `onChildAdded/Changed/Removed` listeners
- **Presence system**: Heartbeat every 15s, `onDisconnect` cleanup, visibility-aware
- **PresenceIndicator.tsx**: Avatar stack (max 4) with expandable dropdown
- **Coordinate normalization**: All cursors already stored in canvas world coordinates via `getCanvasPoint()`
- **BoardMetadata type**: Already includes `isPublic` and `invitedEmails` fields

### What Needs To Be Built

| Feature | Component | Status |
|---------|-----------|--------|
| Pointer icon + name tag | `CursorLayer.tsx` enhancement | Needs upgrade from circle to arrow |
| Inactive user fading | `PresenceIndicator.tsx` enhancement | Needs lastSeen comparison |
| Privacy toggle | New `PrivacyToggle.tsx` | New component |
| Share button + popover | New `ShareButton.tsx` | New component |
| Toast notifications | New `Toast.tsx` | New component |
| Board metadata read/write | `firestore.ts` additions | New helpers |

---

## 1. Real-time Cursor Presence

### Current State

`CursorLayer.tsx` renders each remote cursor as a `<Circle radius={6}>` with a `<Text>` name below it. Coordinates are already in world space — zoom-independent.

### Enhancement Plan

**Replace circle with SVG pointer arrow** using a Konva `<Path>` element with the standard cursor arrow shape. Each cursor group will include:

```
<Group x={cursor.x} y={cursor.y}>
  <Path data="M0,0 L0,16 L4.5,12.5 L8,20 L10.5,19 L7,11.5 L12,11.5 Z"
        fill={cursor.color} stroke="#fff" strokeWidth={1} />
  <Group y={22}>
    <Rect fill={cursor.color} cornerRadius={3} />  <!-- Name tag background -->
    <Text text={cursor.name} fill="#fff" padding={4} />
  </Group>
</Group>
```

**Performance considerations** (already handled):
- Cursor layer has `listening={false}` — no hit detection overhead
- Granular child listeners — only changed cursors trigger re-renders
- 30Hz throttle + 5px minimum distance — prevents network flooding
- Stale cursor filtering (>10s) — auto-hides disconnected users

**Coordinate normalization** (already handled):
- Canvas.tsx converts screen pointer to canvas space via `getCanvasPoint()` before broadcasting
- CursorLayer renders in the same Konva coordinate space — cursors appear correctly at any zoom level

### No Backend Changes Required

The existing RTDB cursor path (`/boards/{boardId}/cursors/{userId}`) and `CursorData` type are sufficient.

---

## 2. User Identity & Guest List

### Current State

- Anonymous users get a display name prompt on the AuthCard
- `getUserColor(userId)` generates deterministic colors via hash
- PresenceIndicator shows online users with initial-letter avatars

### Enhancement Plan

**Inactive user fading**: Compare `lastSeen` timestamp against `Date.now()`. Users with `lastSeen` older than 30 seconds get `opacity: 0.4` on their avatar. This already works with the existing heartbeat (every 15s) — a missed heartbeat means >15s staleness.

**Identity display logic**:
- Authenticated users: show actual display name
- Anonymous users: show the guest name they entered on the auth page
- Both already stored in `PresenceData.name` — no changes needed

### No Backend Changes Required

`PresenceData.lastSeen` is already populated by the heartbeat system.

---

## 3. Privacy Toggle (Emoji Switch)

### Design

A **segmented control** with two states:

| State | Emoji | Label | Meaning |
|-------|-------|-------|---------|
| Public | 👀 | Public | Board visible to anyone with the link |
| Private | 🥸 | Private | Board only accessible to invited users |

### Implementation

**New component: `PrivacyToggle.tsx`**
- Reads `BoardMetadata.isPublic` from Firestore on mount
- Writes toggle changes back to Firestore immediately
- Segmented control with pill-style active indicator
- Placed in a fixed position near the toolbar area

**Firestore integration**:
- New helper: `getBoardMetadata(boardId)` — reads `boards/{boardId}/metadata/config`
- New helper: `updateBoardMetadata(boardId, updates)` — partial update to metadata doc
- On toggle to Private: sets `isPublic: false` (access enforcement is a backend concern — this plan covers the UI toggle and Firestore flag)

### State Flow

```
User clicks toggle
  → optimistic UI update (immediate visual feedback)
  → updateBoardMetadata(boardId, { isPublic: !current })
  → Firestore write
```

---

## 4. Share Functionality

### Design

**Share button** in the top-right header area (near PresenceIndicator) that opens a **popover** with two options:

1. **Copy Link** (🔗) — copies `window.location.href` to clipboard
2. **Email Invite** (✉️) — opens `mailto:` with pre-formatted subject and body containing the board URL

### Implementation

**New component: `ShareButton.tsx`**
- Button with "Share" label and share icon
- Popover positioned below the button (absolute positioning)
- Click-outside-to-close behavior (reuses the pattern from PresenceIndicator)

**New component: `Toast.tsx`**
- Fixed-position notification at bottom-center
- Auto-dismisses after 3 seconds
- Shows "Link copied to clipboard!" after successful copy
- Uses `navigator.clipboard.writeText()` with fallback

**Copy Link flow**:
```
Click "Copy Link"
  → navigator.clipboard.writeText(window.location.href)
  → Show toast "Link copied to clipboard!"
  → Auto-dismiss toast after 3s
```

**Email Invite flow**:
```
Click "Email Invite"
  → window.open(mailto:?subject=...&body=...)
  → Close popover
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/components/ui/PrivacyToggle.tsx` | Public/Private segmented control |
| `src/components/ui/ShareButton.tsx` | Share button with popover |
| `src/components/ui/Toast.tsx` | Toast notification system |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/canvas/CursorLayer.tsx` | Replace circle with pointer arrow + styled name tag |
| `src/components/ui/PresenceIndicator.tsx` | Add inactive user fading based on lastSeen |
| `src/lib/firebase/firestore.ts` | Add `getBoardMetadata()` and `updateBoardMetadata()` |
| `src/app/board/[boardId]/page.tsx` | Wire in PrivacyToggle, ShareButton, Toast |

---

## Implementation Order

1. **Firestore helpers** — `getBoardMetadata` / `updateBoardMetadata` (dependency for privacy toggle)
2. **CursorLayer enhancement** — visual upgrade, no dependencies
3. **PresenceIndicator enhancement** — inactive fading, no dependencies
4. **Toast component** — needed by ShareButton
5. **PrivacyToggle** — depends on Firestore helpers
6. **ShareButton** — depends on Toast
7. **BoardPage wiring** — integrates everything
