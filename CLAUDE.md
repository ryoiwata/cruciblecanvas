# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CrucibleCanvas is a collaborative strategic thinking whiteboard with AI-powered critical analysis. Users collaborate on an infinite canvas with sticky notes, shapes, frames, and connectors, while an AI agent (Claude) challenges ideas and generates decision frameworks.

**Status**: Pre-implementation. The `spec.MD` file (1659 lines) is the authoritative source for all requirements, data models, UI layouts, and architecture decisions.

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

Project has not been initialized yet. After scaffolding with Next.js:

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint
```

No automated test suite is planned for MVP — testing is manual multi-browser (Chrome DevTools).

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

## Planned Source Structure (App Router)

```
app/
  (auth)/login/          # Auth pages
  dashboard/             # Board listing with AI summaries
  board/[boardId]/       # Main canvas workspace
  api/ai/               # Vercel Edge Function for Claude calls
components/
  canvas/               # Konva canvas, objects (sticky, shape, frame, connector)
  ui/                   # Toolbar, panels, dialogs
  collaboration/        # Cursors, presence indicators
lib/
  firebase.ts           # Firebase client init
  firestore.ts          # Firestore CRUD helpers
  realtime.ts           # RTDB presence/cursor/lock helpers
  ai/                   # Claude prompt templates, tool schemas, context serializer
  store/                # Zustand stores (canvas, auth, collaboration)
```

## Firebase Schema

**Firestore**: `boards/{boardId}/objects/{objectId}` (spatial properties, content), `boards/{boardId}/metadata`, `users/{userId}/profile`

**Realtime Database**: `boards/{boardId}/cursors/{userId}`, `boards/{boardId}/locks/{objectId}`, `presence/{userId}`

## Performance Targets

- 60 FPS during pan/zoom
- <100ms object sync latency
- <50ms cursor sync latency
- Support 500+ objects per board
- Support 5+ concurrent users
