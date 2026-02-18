# PLAN.md — CrucibleCanvas Development Plan

## Phase 1: Foundation (Hours 0–4)

**Gate:** Two users see each other's cursors in real-time.

---

### Directory Structure

After scaffolding with `npx create-next-app@14`, the project tree should look like this:

```
cruciblecanvas/
├── public/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout — wraps AuthProvider
│   │   ├── page.tsx                # Root `/` — redirected by middleware, never rendered
│   │   ├── auth/
│   │   │   └── page.tsx            # Auth screen (guest + social login)
│   │   ├── dashboard/
│   │   │   └── page.tsx            # Board listing (stub for Phase 1)
│   │   └── board/
│   │       └── [boardId]/
│   │           └── page.tsx        # Canvas workspace (cursor layer in Phase 1)
│   ├── components/
│   │   ├── canvas/
│   │   │   ├── Canvas.tsx          # Konva Stage + Layer wrapper
│   │   │   └── CursorLayer.tsx     # Renders remote cursors from RTDB
│   │   ├── auth/
│   │   │   └── AuthCard.tsx        # Centered login card UI
│   │   └── ui/
│   │       └── PresenceBadges.tsx  # Avatar stack (top-right)
│   ├── lib/
│   │   ├── firebase/
│   │   │   ├── config.ts           # Firebase app init (client SDK)
│   │   │   ├── auth.ts             # signInAnonymously, signInWithGoogle, signInWithGithub, linkAccount
│   │   │   └── rtdb.ts            # Realtime DB helpers: cursor writes, presence on/off, locks
│   │   └── store/
│   │       ├── authStore.ts        # Zustand — user session, displayName, isAnonymous
│   │       └── cursorStore.ts      # Zustand — remote cursor positions keyed by userId
│   ├── providers/
│   │   └── AuthProvider.tsx        # onAuthStateChanged listener → authStore hydration
│   └── middleware.ts               # Next.js Middleware (root redirect, route protection)
├── .env.local                      # Firebase + Anthropic keys
├── tailwind.config.ts
├── tsconfig.json
├── next.config.js
└── package.json
```

---

### Key Files — Detailed Specs

#### `src/middleware.ts` — Next.js Middleware

The middleware runs on the Edge Runtime before every request. It handles route-level redirects and protection. Because Firebase Auth state lives on the client (no server cookie in Phase 1), the middleware only handles the root redirect. Route protection for `/dashboard` is enforced client-side by `AuthProvider`.

```
Rules:
1. GET /           → 302 redirect to /dashboard
2. All other paths → next()
```

The middleware matcher should include `["/"]` to keep it lightweight.

> **Note:** Server-side auth checks for private boards (checking Firebase token + `invitedEmails`) are deferred to Phase 4 when the API route is introduced. In Phase 1 all boards are public.

---

#### `src/lib/firebase/config.ts` — Firebase Client Init

- Initialize `FirebaseApp` with env vars (`NEXT_PUBLIC_FIREBASE_*`)
- Export singleton instances of `Auth`, `Firestore`, and `Database` (Realtime DB)
- Use `getAuth()`, `getFirestore()`, `getDatabase()`
- Guard against re-initialization in hot-reload (`getApps().length === 0`)

---

#### `src/lib/firebase/auth.ts` — Authentication Functions

Exports:

| Function | Description |
|---|---|
| `signInAsGuest()` | `signInAnonymously(auth)` → returns `UserCredential` |
| `signInWithGoogle()` | `signInWithPopup(auth, new GoogleAuthProvider())` |
| `signInWithGithub()` | `signInWithPopup(auth, new GithubAuthProvider())` |
| `linkAnonymousAccount(provider)` | `linkWithPopup(auth.currentUser, provider)` — merges anonymous UID data |
| `signOutUser()` | `signOut(auth)` |

After any sign-in, also write/update the user profile doc at `users/{uid}/profile` in Firestore (displayName, email, photoURL, isAnonymous, createdAt).

---

#### `src/lib/firebase/rtdb.ts` — Realtime Database Helpers

This file is the heart of Phase 1. It manages three RTDB paths per board:

**Cursor sync:**
```
/boards/{boardId}/cursors/{userId}
  { x, y, name, color, timestamp }
```
- `setCursor(boardId, userId, data)` — `set(ref(db, path), data)`
- `onCursorsChange(boardId, callback)` — `onValue(ref(db, cursorsPath), snap => callback(snap.val()))`
- `removeCursor(boardId, userId)` — `remove(ref(db, path))`
- On connect: register `onDisconnect().remove()` for this user's cursor node

**Presence:**
```
/boards/{boardId}/presence/{userId}
  { name, email?, photoURL?, color, online: true, lastSeen, isAnonymous }
```
- `setPresence(boardId, userId, data)` — writes presence node
- `onPresenceChange(boardId, callback)` — listens to entire presence path
- On connect: set `online: true` + register `onDisconnect().update({ online: false, lastSeen: serverTimestamp })`

**Locks (stub for Phase 1, implemented fully in Phase 2):**
```
/boards/{boardId}/locks/{objectId}
  { userId, userName, timestamp }
```
- `acquireLock(boardId, objectId, userId, userName)` — `set()` + `onDisconnect().remove()`
- `releaseLock(boardId, objectId)` — `remove()`
- `onLocksChange(boardId, callback)` — `onValue()` listener

**User color generation:**
- Deterministic color from userId hash (e.g., HSL with fixed saturation/lightness, hue = hash % 360)
- Exported as `getUserColor(userId: string): string`

---

#### `src/lib/store/authStore.ts` — Zustand Auth Store

```typescript
interface AuthState {
  user: User | null           // Firebase Auth User object
  displayName: string | null
  isAnonymous: boolean
  isLoading: boolean          // true until onAuthStateChanged fires
  setUser: (user: User | null) => void
  setDisplayName: (name: string) => void
}
```

---

#### `src/lib/store/cursorStore.ts` — Zustand Cursor Store

```typescript
interface CursorData {
  x: number
  y: number
  name: string
  color: string
  timestamp: number
}

interface CursorState {
  cursors: Record<string, CursorData>   // keyed by userId
  setCursors: (cursors: Record<string, CursorData>) => void
}
```

Updated via RTDB `onValue` listener in `CursorLayer` or a parent board component.

---

#### `src/providers/AuthProvider.tsx` — Auth Context

- Wraps `children` in the root layout
- On mount: subscribes to `onAuthStateChanged(auth, user => authStore.setUser(user))`
- If `user` is null and current route is `/dashboard`, redirect to `/auth`
- Cleans up listener on unmount

---

#### `src/components/canvas/Canvas.tsx` — Konva Stage (Phase 1 Skeleton)

Phase 1 renders a minimal Konva Stage to host the cursor layer:

- `<Stage>` fills the board page viewport
- `<Layer>` for the dot grid background (static, no event listeners)
- `<Layer>` for remote cursors (rendered from cursorStore)
- Stage is `draggable` for basic panning
- Mouse wheel listener for zoom (zoom centered on cursor position, clamped 0.05–5.0)
- On `mousemove`: throttle to 30 Hz, compute canvas-space coordinates, call `setCursor()` in RTDB

---

#### `src/components/canvas/CursorLayer.tsx` — Remote Cursor Rendering

- Subscribes to `onCursorsChange(boardId, ...)` on mount
- Filters out the local user's own cursor
- Renders each remote cursor as:
  - A `<Circle>` (12px radius, user color)
  - A `<Text>` label below with the user's display name
- Stale cursor cleanup: ignore cursors with `timestamp` older than 10 seconds

---

#### `src/app/auth/page.tsx` — Auth Screen

- Centered card on a clean background (brand purple `#6366f1`)
- Display name text input (required for guests)
- "Continue as Guest" button (primary) — calls `signInAsGuest()`, then sets displayName in Firestore profile, navigates to `/dashboard`
- "Sign in with Google" button — calls `signInWithGoogle()`
- "Sign in with GitHub" button — calls `signInWithGithub()`
- On successful auth, navigate to `/dashboard`

---

#### `src/app/board/[boardId]/page.tsx` — Board Page

- Reads `boardId` from URL params
- Renders `<Canvas boardId={boardId} />`
- On mount: calls `setPresence(boardId, userId, ...)` with `onDisconnect` cleanup
- On unmount: removes presence + cursor

---

### Implementation Steps (Ordered)

| # | Task | Output | Est. |
|---|------|--------|------|
| 1 | **Scaffold Next.js project** | `npx create-next-app@14 . --typescript --tailwind --eslint --app --src-dir` inside the repo root. Verify `npm run dev` works. | 10 min |
| 2 | **Install dependencies** | `npm install firebase zustand react-konva konva` | 5 min |
| 3 | **Create `src/lib/firebase/config.ts`** | Firebase app + Auth + Firestore + RTDB singletons. Validate with a console log on dev server. | 10 min |
| 4 | **Create `src/lib/firebase/auth.ts`** | Guest sign-in, Google, GitHub, link account, sign-out functions. Write user profile to Firestore on sign-in. | 20 min |
| 5 | **Create `src/lib/store/authStore.ts`** | Zustand store for auth state. | 10 min |
| 6 | **Create `src/providers/AuthProvider.tsx`** | `onAuthStateChanged` → authStore. Wire into `src/app/layout.tsx`. | 15 min |
| 7 | **Create `src/middleware.ts`** | Root `/` → `/dashboard` redirect. | 5 min |
| 8 | **Create `src/app/auth/page.tsx` + `AuthCard.tsx`** | Auth UI with guest + social buttons. Navigate to `/dashboard` on success. | 30 min |
| 9 | **Create `src/app/dashboard/page.tsx`** | Stub page showing user info + "New Board" button that generates a random ID and navigates to `/board/[id]`. Client-side auth guard redirects to `/auth` if not logged in. | 20 min |
| 10 | **Create `src/lib/firebase/rtdb.ts`** | Cursor, presence, and lock RTDB helpers with `onDisconnect` cleanup. `getUserColor()` hash function. | 30 min |
| 11 | **Create `src/lib/store/cursorStore.ts`** | Zustand store for remote cursor state. | 10 min |
| 12 | **Create `src/components/canvas/Canvas.tsx`** | Konva Stage with pan/zoom, dot grid layer, mousemove → RTDB cursor write (30 Hz throttle). | 40 min |
| 13 | **Create `src/components/canvas/CursorLayer.tsx`** | RTDB cursor listener → render remote cursors as colored circles + name labels. | 20 min |
| 14 | **Create `src/app/board/[boardId]/page.tsx`** | Board page wiring: Canvas + presence setup/teardown. | 15 min |
| 15 | **Gate test** | Open two browser windows, sign in as two different guests, navigate to the same board URL. Verify both cursors are visible in real-time. | 15 min |

**Total estimated: ~4 hours**

---

## Phase 2–5: Summary Roadmap

### Phase 2: Core Objects (Hours 4–12)
- Firestore schema for `boards/{boardId}/objects/{objectId}` and `boards/{boardId}/metadata`
- Konva canvas with dot grid background (static layer)
- Mode system: Pan (default), Select, Create — stored in a Zustand `canvasStore`
- Sticky note creation: click in Create mode → default 200×150 yellow note, snapped to 20px grid
- Firestore listeners (`onSnapshot`) for real-time object sync → Zustand `objectStore`
- Optimistic updates: Zustand first, then async Firestore write, then listener reconciles
- Drag-and-drop with soft locking (RTDB `/locks/{objectId}` via `rtdb.ts`)
- Grid snapping: round to nearest 20px, Cmd/Ctrl to bypass
- **Gate:** Two users create and move sticky notes simultaneously with soft locking

### Phase 3: Board Features (Hours 12–18)
- Rectangle and circle shapes with Transformer resize handles
- Text editing: double-click → scale-aware HTML textarea overlay, auto-resize height
- Selection system: Select mode click, Ctrl+Click multi-select, drag-rectangle AABB hit-test
- Color picker: legend palette + power mode hex input
- Delete with confirmation dialog (Ctrl+Delete bypass)
- Copy/paste/duplicate (Ctrl+C/V/D with +20px offset)
- Frames: auto-nest on 50% overlap, context menu Deframe All / Add to Frame
- Connectors: edge-to-edge nearest point, drag from edge anchor handles, auto-delete on orphan
- Color Legend canvas object
- Top-centered floating toolbar
- **Gate:** Full CRUD for all object types, multi-select functional

### Phase 4: AI Integration (Hours 18–24)
- Vercel AI SDK + Claude Sonnet 4.5 setup in `src/app/api/ai/route.ts`
- Server-side Firebase token validation on the API route
- AI context serializer: viewport-only objects → nested JSON with `rel_pos`
- Base manipulation tools: create, move, delete objects
- Progressive skeleton: empty frame + spinner while AI fills in objects
- AI Thinking Avatar (draggable placement indicator)
- Red Team Analysis, Decision Mapping, Find Gaps tools
- Collapsible AI sidebar with chat-style messages and persona toggle
- AI rate limiting (20/user/hour, 50/board/day)
- AI rollback on error + single-level AI undo
- AI attribution sparkle badges
- **Gate:** AI executes 6+ command types including all 3 analytical modes

### Phase 5: Polish & Deployment (Hours 24–30)
- Dashboard with card grid, search, join field
- Board creation modal + inline title editing
- Share modal: public/private toggle, invite by email, contacts quick-invite
- Contacts list (auto-persist collaborators)
- Board deletion with confirmation
- Presence avatar stack with +N overflow
- Zoom controls (bottom-left), offline banner, mobile blocking message
- 5-step interactive tutorial
- Guest session banner with account linking
- AI-augmented board summaries (Summarize Board button)
- Loading states and error handling
- Deploy to Vercel
- End-to-end testing with 5 concurrent users
