# CrucibleCanvas

**An AI-native whiteboard platform for high-stakes strategic planning.**

CrucibleCanvas combines an infinite canvas with real-time multiplayer collaboration, persistent boards, and intelligent UI affordances — built for teams that think visually and decide critically.

---

## Features

### Infinite Multiplayer Canvas
- Real-time presence with synchronized cursors and name labels
- "Online Users" presence indicator with avatar colors
- Soft object locking to prevent edit conflicts
- Automatic heartbeat and reconnection handling

### Strategic UI/UX
- Bottom-positioned floating toolbar with backdrop-blur aesthetics
- Context-aware menus for Align, Arrange, and Layer operations
- Multi-select marquee via **Ctrl + Drag** with additive **Shift + Click** selection
- Right-click context menus for move-to-frame, delete, and object management
- Grid snapping (20px) for precise object placement

### Persistence & Dashboard
- Boards save automatically to Firebase in real-time
- Personal Dashboard with recently visited boards and quick-join
- Rich board titles with inline editing
- Guest access routing with optional account linking

### Visual Elements
- **Sticky Notes** with lined texture, multiple font families (sans-serif, handwritten, monospace), and 6 preset colors
- **Shapes** — rectangles and circles with custom colors and transparency
- **Frames** — grouping containers with title bars and auto-nesting
- **Connectors** — dynamic lines linking strategic items (solid, dashed, dotted styles)
- **Color Legends** — visual key overlays for board semantics
- Custom color picker powered by `react-colorful`

### Privacy & Control
- Creator-only Public/Private toggle with emoji-based UI
- Email-based board invitations via share dialog
- Firebase Security Rules enforcing per-board access control

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Next.js App Router                 │
│  /auth  →  /dashboard  →  /board/[boardId]              │
├─────────────────────────────────────────────────────────┤
│                     React + Konva.js                    │
│  Canvas.tsx │ SelectionLayer │ BoardObjects │ CursorLayer│
├─────────────────────────────────────────────────────────┤
│                   Zustand State Stores                  │
│  canvasStore │ objectStore │ authStore │ presenceStore   │
├──────────────────────┬──────────────────────────────────┤
│   Firestore (CRUD)   │   Realtime Database (Ephemeral)  │
│  Objects, Metadata,  │   Cursors, Presence, Locks       │
│  User Profiles       │   onDisconnect Cleanup           │
├──────────────────────┴──────────────────────────────────┤
│                    Firebase Auth                        │
│         Anonymous │ Google OAuth │ Email/Password       │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 14](https://nextjs.org/) (App Router) |
| UI | [React 18](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/) |
| Canvas | [Konva.js](https://konvajs.org/) + [React-Konva](https://konvajs.org/docs/react/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Auth | [Firebase Auth](https://firebase.google.com/docs/auth) (Anonymous, Google, Email) |
| Database | [Cloud Firestore](https://firebase.google.com/docs/firestore) (persistent) + [Firebase RTDB](https://firebase.google.com/docs/database) (ephemeral) |
| Color Picker | [react-colorful](https://github.com/omgovich/react-colorful) |
| Language | TypeScript |

---

## Installation

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- A [Firebase project](https://console.firebase.google.com/) with Firestore, Realtime Database, and Authentication enabled
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
   NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
   NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
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

### Shortcut Legend

| Shortcut | Action |
|----------|--------|
| **Ctrl + Drag** | Marquee multi-select |
| **Shift + Click** | Add/remove from selection |
| **Space + Drag** | Pan the canvas |
| **Scroll Wheel** | Zoom in/out |
| **Delete / Backspace** | Delete selected objects |
| **Double-click** (sticky note) | Edit text inline |
| **Right-click** | Context menu (move to frame, delete) |

### Creating Objects

Select a tool from the bottom toolbar (Sticky Note, Rectangle, Circle, Frame, Connector) and click-drag on the canvas to place it. Use the color picker to customize colors before or after creation.

### Multiplayer

Share your board URL or use the Share button to invite collaborators by email. All participants see live cursors, name labels, and real-time object updates. The presence indicator in the toolbar shows who's currently online.

### Board Management

The Dashboard at `/dashboard` lists your created and recently visited boards. Create new boards, set titles, and toggle visibility between public and private.

---

## Deployment

### Vercel (Recommended)

The project includes a `vercel.json` configuration for seamless deployment:

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

Set the environment variables in the Vercel Dashboard under **Settings > Environment Variables** using the same keys from `.env.local`.

### Firebase Security Rules

After any changes to `firestore.rules` or `database.rules.json`, deploy them:

```bash
firebase deploy --only firestore:rules    # Firestore rules
firebase deploy --only database           # Realtime Database rules
firebase deploy --only firestore:rules,database  # Both
```

---

## Testing

### Resize Ghosting Test

A Puppeteer-based regression test simulates high-speed resize drags to detect bounding-box ghosting:

```bash
npx ts-node tests/resize-ghosting-test.ts
```

### Manual Multi-User Testing

1. Start the dev server (`npm run dev`)
2. Open the same board URL in two browser windows (or use incognito for a second user)
3. Verify cursor synchronization, presence updates, and object locking

---

## Project Structure

```
cruciblecanvas/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── auth/               # Authentication page
│   │   ├── dashboard/          # Board management
│   │   ├── board/[boardId]/    # Canvas workspace
│   │   └── api/boards/new/     # Board creation API
│   ├── components/
│   │   ├── canvas/             # Konva canvas components
│   │   └── ui/                 # Toolbar, menus, dialogs
│   ├── hooks/                  # Custom React hooks
│   ├── lib/
│   │   ├── store/              # Zustand state stores
│   │   └── firebase/           # Firebase client modules
│   └── providers/              # Auth context provider
├── docs/                       # Design specs & planning docs
├── tests/                      # Regression tests
├── firestore.rules             # Firestore security rules
├── database.rules.json         # RTDB security rules
└── vercel.json                 # Deployment config
```

---

## Data Model

### Board Objects

Each object on the canvas is a `BoardObject` with spatial, visual, and ownership properties:

```typescript
interface BoardObject {
  id: string;
  type: "stickyNote" | "rectangle" | "circle" | "frame" | "connector" | "colorLegend";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text?: string;
  zIndex: number;
  creatorId: string;
  parentFrameId?: string;
  // ...additional metadata
}
```

### Real-time Channels

| Channel | Database | Purpose |
|---------|----------|---------|
| `/boards/{id}/objects` | Firestore | Persistent board objects |
| `/boards/{id}/metadata` | Firestore | Title, visibility, config |
| `/boards/{id}/cursors` | RTDB | Live cursor positions |
| `/boards/{id}/presence` | RTDB | User online status |
| `/boards/{id}/locks` | RTDB | Object edit locks |

---

## License

See [LICENSE](./LICENSE) for details.
