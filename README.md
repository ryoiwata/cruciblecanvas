# CrucibleCanvas

**An AI-native whiteboard platform for high-stakes strategic planning.**

CrucibleCanvas combines an infinite canvas with real-time multiplayer collaboration and an embedded AI agent — **The Mason** — that builds structured diagrams, flowcharts, and content directly on the board from plain-language commands.

**Live app:** [cruciblecanvas.vercel.app](https://cruciblecanvas.vercel.app)

### Demo

[![CrucibleCanvas Demo](https://img.youtube.com/vi/30iQ_kqWpqo/maxresdefault.jpg)](https://www.youtube.com/watch?v=30iQ_kqWpqo)

---

## Features

### Infinite Multiplayer Canvas
- Real-time presence with synchronized cursors, name labels, and user-selectable avatar colors
- Soft object locking via Firebase RTDB with automatic `onDisconnect` cleanup
- Automatic heartbeat and reconnection handling

### Two-Tier Header Layout
- **Top header:** board title (inline editable), presence avatars, privacy toggle, share, AI chat, dashboard
- **Sub-header toolbar:** Undo/Redo, tool picker (Pointer, Lines, Shapes, Text, Sticky), Align, Arrange, Marquee mode, Multi-select mode

### Visual Elements
- **Sticky Notes** — lined texture, multiple font families, 6 preset colors; primary container for text content
- **Shapes** — Rectangle, Circle (geometric/decorative), Diamond (decision node), RoundedRect (process step)
- **Frames** — grouping containers with title bars, auto-nesting on drag, "move-with-frame" children
- **Connectors** — dynamic arrows between objects (directed/undirected, solid/dashed/dotted)
- **Lines** — free-form straight lines with optional arrowheads
- **Text** — standalone transparent text objects
- **Color Legends** — shared color-to-meaning overlays, AI-referenceable

### Properties Sidebar
- Context-sensitive controls for every object type (fill, stroke, font, opacity, line effects)
- 18-swatch color preset palette with "See more" expansion
- Recent colors history

### AI Agent — The Mason
- Type `@` in the chat sidebar (or press `/`) to send commands
- Builds sticky notes, shapes, frames, connectors, flowcharts, and batch element grids
- Automatic spatial planning: finds clear space before placing objects, never overlaps existing content
- Frame parentage: items created inside a frame are bound to it and move with it
- Text-body guard: shapes with substantial text are auto-promoted to sticky notes
- Clarification flow: asks follow-up questions when a command is ambiguous
- Full rollback on error — board state stays clean

### Privacy & Access Control
- Creator-only Public/Private toggle (👀 / 🥸)
- Email-based board invitations
- Firebase Security Rules enforcing per-board access

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js App Router                   │
│       /auth  →  /dashboard  →  /board/[boardId]         │
├─────────────────────────────────────────────────────────┤
│                   React 18 + Konva.js                   │
│  Canvas │ BoardObjects │ SelectionLayer │ CursorLayer   │
│  PropertiesSidebar │ ChatSidebar (AI + Group)           │
├─────────────────────────────────────────────────────────┤
│                  Zustand State Stores                   │
│  canvasStore │ objectStore │ authStore │ chatStore       │
├──────────────────────┬──────────────────────────────────┤
│   Firestore (CRUD)   │  Realtime Database (Ephemeral)   │
│  Objects, Metadata,  │  Cursors, Presence, Locks,       │
│  User Profiles       │  AI Stream text                  │
├──────────────────────┴──────────────────────────────────┤
│              Firebase Auth (Anon + Google)               │
├─────────────────────────────────────────────────────────┤
│         Vercel API Route — /api/ai-command              │
│   Claude Sonnet 4.6 · Vercel AI SDK v6 · Langfuse OTel  │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 14](https://nextjs.org/) (App Router) |
| UI | [React 18](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/) |
| Canvas | [Konva.js](https://konvajs.org/) + [React-Konva](https://konvajs.org/docs/react/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) v5 |
| Auth | [Firebase Auth](https://firebase.google.com/docs/auth) (Anonymous, Google OAuth) |
| Database | [Cloud Firestore](https://firebase.google.com/docs/firestore) + [Firebase RTDB](https://firebase.google.com/docs/database) |
| AI Model | [Anthropic Claude Sonnet 4.6](https://www.anthropic.com/) |
| AI SDK | [Vercel AI SDK](https://sdk.vercel.ai/) v6 (`ai` + `@ai-sdk/anthropic`) |
| Observability | [Langfuse](https://langfuse.com/) via OpenTelemetry |
| Language | TypeScript (strict mode) |

---

## Installation

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- A [Firebase project](https://console.firebase.google.com/) with Firestore, Realtime Database, and Authentication enabled
- An [Anthropic API key](https://console.anthropic.com/)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/<your-org>/cruciblecanvas.git
   cd cruciblecanvas
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create a `.env.local` file in the project root:

   ```env
   # Firebase client config (public)
   NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
   NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com

   # AI (server-only)
   ANTHROPIC_API_KEY=your-anthropic-key

   # Firebase Admin — pick one pattern:
   FIREBASE_ADMIN_SERVICE_ACCOUNT={"type":"service_account",...}  # full JSON string
   # OR:
   FIREBASE_ADMIN_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
   FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

   # Observability (optional)
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   ```

4. **Authenticate with Firebase CLI**

   ```bash
   firebase login
   firebase use your-project-id
   ```

5. **Deploy security rules**

   ```bash
   firebase deploy --only firestore:rules,database
   ```

6. **Start the development server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to the Dashboard.

---

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Open AI chat and focus input |
| `1` | Pointer mode |
| `S` | Sticky Note tool |
| `T` | Text tool |
| `Escape` | Return to pointer / deselect |
| `Space + Drag` | Pan canvas |
| `Scroll Wheel` | Zoom in/out |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `Ctrl+C` / `Ctrl+V` | Copy / Paste (cascading +20px offset) |
| `Ctrl+D` | Duplicate selected |
| `Delete` / `Backspace` | Delete selected (with confirmation) |
| `Ctrl+Delete` | Delete selected (bypass confirmation) |
| `Ctrl+A` | Select all |
| `Ctrl+]` / `Ctrl+[` | Bring forward / Send backward |

### Creating Objects

Pick a tool from the sub-header toolbar and click on the canvas to place an object. All objects snap to a 20px grid; hold **Cmd/Ctrl** to bypass snapping.

**Right-click** any object for context options: copy, duplicate, deframe, layer order, delete.

### The Mason AI Agent

Press `/` or click the 💬 Chat button to open the AI sidebar. Type any plain-English command:

```
Create a SWOT analysis for our new product launch
Build a flowchart for the user onboarding process
Add three sticky notes summarizing the key risks
Put a decision diamond inside the "Planning" frame
```

The Mason places objects on the board directly — no copy-pasting required. If the command is ambiguous it will ask a follow-up question before acting.

### Multiplayer

Share your board URL. All participants see live cursors and real-time object updates. The presence stack in the top header shows who's online; click your avatar to pick a cursor color.

### Board Management

The Dashboard at `/dashboard` lists all your boards. Create new boards, set titles inline, and toggle visibility between public (👀) and private (🥸).

---

## Deployment

### Vercel (Recommended)

```bash
npm install -g vercel
vercel
```

Add all `.env.local` keys in **Vercel Dashboard → Settings → Environment Variables**.

> The AI route uses `runtime = 'nodejs'` (not Edge) — required for the OpenTelemetry NodeSDK.

### Firebase Security Rules

After changing `firestore.rules` or `database.rules.json`:

```bash
firebase deploy --only firestore:rules,database
```

---

## Project Structure

```
src/
├── app/
│   ├── auth/               # Authentication (Guest, Google)
│   ├── dashboard/          # Board listing and creation
│   ├── board/[boardId]/    # Canvas workspace
│   └── api/
│       ├── boards/new/     # Board creation endpoint
│       └── ai-command/     # AI streaming endpoint (Node.js runtime)
├── components/
│   ├── canvas/             # Konva stage, objects, selection, cursors
│   ├── chat/               # AI + group chat sidebar, MasonBadge, AIRefPopover
│   ├── properties/         # Properties sidebar + per-type modules
│   └── ui/                 # SubHeaderToolbar, menus, dialogs
├── hooks/                  # useFirestoreSync, useAICommand, useMultiplayer, ...
├── lib/
│   ├── ai/                 # tools.ts, prompts.ts, spatialPlanning.ts, layoutAlgorithms.ts
│   ├── firebase/           # config, auth, firestore, rtdb, admin, firestoreRest
│   └── store/              # canvasStore, objectStore, authStore, chatStore
└── instrumentation.ts      # OpenTelemetry init (Langfuse)
```

---

## Data Model

### Object Types

```typescript
type ObjectType =
  | 'stickyNote'   // Primary text container
  | 'rectangle'    // Geometric/decorative shape
  | 'circle'       // Geometric/decorative shape
  | 'diamond'      // Flowchart decision node
  | 'roundedRect'  // Flowchart process step
  | 'frame'        // Grouping container
  | 'connector'    // Arrow between objects
  | 'line'         // Free-form line
  | 'text'         // Standalone text
  | 'colorLegend'; // Shared color key
```

### Real-time Channels

| Channel | Database | Purpose |
|---------|----------|---------|
| `boards/{id}/objects/{objectId}` | Firestore | Persistent board objects |
| `boards/{id}/metadata/config` | Firestore | Title, visibility, AI persona |
| `boards/{id}/cursors/{userId}` | RTDB | Live cursor positions |
| `boards/{id}/presence/{userId}` | RTDB | User online status |
| `boards/{id}/locks/{objectId}` | RTDB | Soft edit locks |
| `boards/{id}/aiStreams/{commandId}` | RTDB | Live AI response text |

---

## Performance

- **R-tree spatial index** (`rbush`) — O(log N + k) viewport culling for 500+ objects
- **LOD rendering** — simplified shapes below 15% zoom
- **RAF-throttled viewport** — culling runs at most once per animation frame
- **Debounced RTDB writes** — AI stream updates batched at 100ms

---

## License

See [LICENSE](./LICENSE) for details.
