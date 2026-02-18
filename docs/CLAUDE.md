# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CrucibleCanvas is a collaborative strategic thinking whiteboard with AI-powered critical analysis. Users collaborate on an infinite canvas with sticky notes, shapes, frames, and connectors, while an AI agent (Claude) challenges ideas and generates decision frameworks.

**Status**: Active development. The `spec.MD` file is the authoritative source for all requirements, data models, UI layouts, and architecture decisions.

## Tech Stack

- **Framework**: Next.js 14+ (App Router) with TypeScript
- **Canvas**: Konva.js via react-konva
- **State**: Zustand
- **Styling**: TailwindCSS
- **Database**: Firebase Firestore (persistent) + Realtime Database (ephemeral: cursors, presence, locks)
- **Auth**: Firebase Auth (Anonymous, Google OAuth, GitHub OAuth)
- **AI**: Anthropic Claude Sonnet 4.5 via Vercel AI SDK with function calling
- **Deployment**: Vercel

## Development Commands

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run start        # Start production server
```

Testing is primarily manual multi-browser (Chrome DevTools). A Puppeteer-based resize ghosting regression test exists in `tests/resize-ghosting-test.ts`.

## Environment Variables

All Firebase config plus Anthropic API key go in `.env.local` (see template in repo root). Required:
- `NEXT_PUBLIC_FIREBASE_*` — Firebase project config (7 keys)
- `ANTHROPIC_API_KEY` — For Claude API (server-side only, no NEXT_PUBLIC_ prefix)

## Key Architecture Decisions

- **Viewport-only AI context**: Only objects visible in the current viewport are serialized and sent to Claude (token optimization)
- **Soft locking**: Object locks stored in Realtime Database with `onDisconnect` cleanup — not Firestore
- **Last-write-wins**: Conflict resolution strategy for concurrent edits
- **Grid snapping**: 20px default grid, hold modifier key to bypass
- **Desktop-only**: Mobile/tablet blocked with a message; no responsive canvas
- **Light mode only**: No dark mode for MVP
- **AI rate limits**: 20 commands/user/hour, 50 commands/board/day
- **Bottom-centered toolbar**: Floating toolbar at bottom of canvas (not top) with backdrop-blur; context-aware menus (Align, Arrange) pop up above it
- **Shortcut Legend**: A secondary bar positioned directly above the toolbar displaying `Ctrl+Drag` (marquee select) and `Ctrl+Click` (multi-select) hints with inline SVG icons
- **Cascading diagonal paste**: Copy/paste uses `pasteCount * 20` offset so repeated pastes cascade diagonally (+20px, +40px, +60px, etc.); count resets on new copy

## UI Interaction Guidelines

### Shortcut Legend
The `ShortcutLegend` component (`src/components/ui/ShortcutLegend.tsx`) is a persistent UI element rendered above the toolbar. It must always be visible when the board canvas is active. It displays:
- **Select**: `Ctrl + Drag` — marquee selection
- **Multi-Select**: `Ctrl + Click` — additive selection toggle

When adding new keyboard shortcuts, evaluate whether they belong in the Shortcut Legend (frequently used, non-obvious) or only in the full shortcuts reference (Section 11 of spec.MD).

### Public/Private Toggle and Real-Time Synchronization
The `PrivacyToggle` component (`src/components/ui/PrivacyToggle.tsx`) uses an emoji-based pill toggle:
- **Public** (👀): Board is accessible to any authenticated user
- **Private** (🥸): Board is restricted to the creator and invited emails

**How it affects real-time sync:**
1. **Dual-write pattern**: When the creator toggles privacy, the component writes to **both** Firestore (`boards/{boardId}/metadata/config.isPublic`) and RTDB (`boards/{boardId}/privacy.isPublic`) via `setBoardPrivacy()`.
2. **RTDB privacy mirror**: The RTDB `/boards/{boardId}/privacy` node allows real-time listeners to gate access without a Firestore read. This enables instant privacy state propagation to all connected clients.
3. **Creator-only control**: Only the board creator (`createdBy === user.uid`) can toggle the privacy state. Non-creators see a disabled toggle with a hover tooltip.
4. **Firestore rules enforcement**: Firestore security rules check `isPublic`, `createdBy`, and `invitedEmails` to enforce access at the database level — the RTDB mirror is for real-time UX, not security enforcement.

## Source Structure (App Router)

```
src/
  app/
    auth/page.tsx             # Authentication (guest, Google, email)
    dashboard/page.tsx        # Board listing, creation, recently visited
    board/[boardId]/page.tsx  # Main canvas workspace
    api/boards/new/route.ts   # Auto-board creation API
    layout.tsx                # Root layout with AuthProvider
    middleware.ts             # Routes / → /dashboard
  components/
    auth/AuthCard.tsx         # Multi-mode auth UI
    canvas/                   # Konva canvas components (Canvas, BoardObjects,
                              #   SelectionLayer, CursorLayer, TextEditor,
                              #   StickyNote, ShapeObject, FrameObject,
                              #   ConnectorObject, ColorLegendObject, etc.)
    ui/                       # Toolbar, AlignMenu, ArrangeMenu, ColorPicker,
                              #   ContextMenu, PrivacyToggle, ShareButton,
                              #   PresenceIndicator, ShortcutLegend, etc.
  hooks/
    useFirestoreSync.ts       # Firestore real-time object listener
    useMultiplayer.ts         # Presence init, heartbeat, reconnection
    usePresenceSync.ts        # Presence data sync (child listeners)
    useLockSync.ts            # Object lock management
    useFrameNesting.ts        # Frame auto-nesting logic
    useKeyboardShortcuts.ts   # All keyboard event handlers
  lib/
    firebase/
      config.ts               # Firebase app init
      auth.ts                  # Authentication functions
      firestore.ts             # Firestore CRUD helpers
      rtdb.ts                  # RTDB presence/cursor/lock/privacy helpers
    store/
      canvasStore.ts           # UI state (mode, selection, viewport, clipboard)
      objectStore.ts           # Board objects & locks
      authStore.ts             # User authentication state
      presenceStore.ts         # Remote user presence
    types.ts                   # TypeScript interfaces
    utils.ts                   # Utility functions
  providers/
    AuthProvider.tsx           # Auth state initialization
```

## Firebase Schema

**Firestore** (persistent):
- `boards/{boardId}/objects/{objectId}` — spatial properties, content, ownership
- `boards/{boardId}/metadata/config` — title, isPublic, createdBy, invitedEmails
- `users/{userId}/profile/info` — display name, email, photo

**Realtime Database** (ephemeral):
- `boards/{boardId}/cursors/{userId}` — live cursor position, name, color
- `boards/{boardId}/presence/{userId}` — online status, name, lastSeen
- `boards/{boardId}/locks/{objectId}` — soft object locks with `onDisconnect` cleanup
- `boards/{boardId}/privacy` — mirrors `isPublic` from Firestore for real-time access gating

## Performance Targets

- 60 FPS during pan/zoom
- <100ms object sync latency
- <50ms cursor sync latency
- Support 500+ objects per board
- Support 5+ concurrent users
