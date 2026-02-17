# CrucibleCanvas Technical Specification

## Project Overview

**Project Name:** CrucibleCanvas
**Tagline:** Strategic Thinking Canvas - A collaborative whiteboard that challenges your ideas
**Timeline:** 7-day sprint with 24-hour MVP gate
**Primary Goal:** Build production-scale collaborative whiteboard with AI-powered critical analysis capabilities

---

## 1. Product Vision

### Core Value Proposition
CrucibleCanvas is not a passive whiteboard—it's an AI-powered strategic thinking partner. While users collaborate visually, the AI agent actively challenges assumptions, identifies logical gaps, and structures complex decisions. The board doesn't just store ideas; it argues back.

### Target Use Cases
1. **Strategic Planning:** Teams mapping product roadmaps, go-to-market strategies, or business pivots
2. **Decision Making:** Evaluating options with structured frameworks (options matrices, tradeoff analysis)
3. **Risk Assessment:** Red-teaming plans to surface unstated assumptions and contradictions
4. **Workshop Facilitation:** Real-time collaborative sessions with AI as a critical thinking facilitator

### Differentiation
- **Miro/Figma:** Passive collaboration tools that store content
- **ChatGPT Canvas:** Single-user AI workspace without multiplayer or visual relationships
- **CrucibleCanvas:** Multiplayer whiteboard where AI reads board state and generates interconnected critical analysis

---

## 2. Technical Architecture

### 2.1 Technology Stack

**Frontend**
- Framework: Next.js 14+ (App Router)
- UI Library: React 18
- Canvas: Konva.js with react-konva wrapper
- State: Zustand (lightweight global state)
- Styling: TailwindCSS
- Language: TypeScript

**Backend**
- Database (Persistent): Firebase Firestore
- Database (Ephemeral): Firebase Realtime Database
- Auth: Firebase Auth (Anonymous + Google + GitHub OAuth)
- Deployment: Vercel
- Functions: Vercel Edge Functions (API routes)

**AI Layer**
- LLM: Anthropic Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- SDK: Vercel AI SDK
- Pattern: Function calling with tool schema

**Development Tools**
- AI Assistants: Claude Code, Cursor
- Version Control: Git + GitHub
- Testing: Manual multi-browser testing (Chrome DevTools)

### 2.2 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         USER LAYER                          │
│  Authenticated users, anonymous guests, multiple devices    │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                    FRONTEND (Next.js)                        │
│  ├─ Next.js Middleware (/ → /dashboard redirect)            │
│  ├─ Canvas Renderer (Konva.js)                              │
│  ├─ State Management (Zustand)                              │
│  ├─ Auth Context (Firebase Auth: Anon + Google + GitHub)    │
│  └─ Real-time Listeners (Firestore + RTDB)                  │
└──────────────────┬──────────────────────────────────────────┘
                   │
      ┌────────────┼────────────┐
      │            │            │
      ▼            ▼            ▼
┌─────────┐  ┌─────────┐  ┌──────────────┐
│Firestore│  │Realtime │  │ Vercel Edge  │
│ (Board  │  │   DB    │  │  Functions   │
│ Objects)│  │(Cursors │  │  (AI Route)  │
│         │  │ +Locks) │  │ +Token Auth  │
└─────────┘  └─────────┘  └──────┬───────┘
                                  │
                                  ▼
                          ┌──────────────┐
                          │   Anthropic  │
                          │Claude Sonnet │
                          │     4.5      │
                          └──────────────┘
```

---

## 3. Authentication & Access Control

### 3.1 Authentication Methods

**Anonymous Auth (Guest Session)**
- Firebase Anonymous Auth generates a persistent UID
- User is prompted for a display name (multiplayer alias) before entering a board
- Contributions (objects, edits) are tied to the anonymous UID and persist in Firestore across page refreshes
- A persistent slim banner sits at the top of the canvas: "Guest Session — Save to Account" with a one-click account linking option
- Account linking merges anonymous UID data with the authenticated account

**Social OAuth**
- Google Sign-In
- GitHub Sign-In
- Standard Firebase Auth flow with redirect

### 3.2 Next.js Middleware & Routing

```typescript
// middleware.ts
// Redirects root route (/) → /dashboard
// Route protection:
//   /dashboard → requires auth (redirect to /auth if not authenticated)
//   /board/[id] → public boards: allow all; private boards: auth + whitelist check
//   /auth → public (login/signup page)
```

**Route Structure:**
- `/` → redirects to `/dashboard`
- `/auth` → authentication screen
- `/dashboard` → board management (requires auth)
- `/board/[id]` → board workspace (access depends on board visibility)

### 3.3 Board Visibility Model

**Default: Public (isPublic: true)**
- All new boards are created as public by default
- Anyone with the board URL can view and edit
- Anonymous users are prompted for a display name before participating
- Board URL never changes — toggling visibility uses the same URL

**Private Mode (isPublic: false)**
- Only the board owner or users in the `invitedEmails` array can access
- Access is verified by matching the authenticated user's email against the whitelist
- No automated email notifications — owner shares the URL manually
- Guests must sign in with the exact invited email to gain access
- Toggle via the Share modal (confirmation dialog when changing visibility)

### 3.4 Contacts List

- Auto-persists profiles of authenticated users who have collaborated on the same board
- Available in two locations: dashboard sidebar AND the Share modal (for quick invite)
- Authenticated users only — anonymous guests are not tracked as contacts
- Stored per-user in Firestore: `users/{userId}/contacts/{contactId}`
- Contains: display name, email, photo URL, last collaboration timestamp

### 3.5 Auth Screen UI

- Centered card on a clean background
- Display name input field (for anonymous/guest entry)
- Prominent "Continue as Guest" button (primary action, brand purple)
- "Sign in with Google" button (secondary action)
- "Sign in with GitHub" button (secondary action)
- Brand color: `#6366f1` (vibrant purple)

---

## 4. Data Models

### 4.1 Firestore Schema

**Collection: `boards/{boardId}/objects/{objectId}`**

```typescript
interface BoardObject {
  // Core identification
  id: string                    // Auto-generated Firestore doc ID
  type: ObjectType              // 'stickyNote' | 'rectangle' | 'circle' | 'frame' | 'connector' | 'colorLegend'

  // Spatial properties
  x: number                    // X coordinate in canvas space
  y: number                    // Y coordinate in canvas space
  width: number                // Width in pixels
  height: number               // Height in pixels
  rotation?: number            // Rotation in degrees (optional)

  // Visual properties
  color: string                // Hex color or named color
  text?: string                // Text content (sticky notes, frames)

  // Ownership & timestamps
  createdBy: string            // User ID from Firebase Auth (includes anonymous UIDs)
  createdAt: Timestamp         // Server timestamp (also used as z-index)
  updatedAt: Timestamp         // Server timestamp

  // AI attribution
  isAIGenerated?: boolean      // true if created by AI agent
  aiCommandId?: string         // Groups objects from same AI command (for rollback)

  // Relationships
  parentFrame?: string         // ID of containing frame (if nested)
  connectedTo?: string[]       // IDs of related objects (for connectors)

  // AI-specific metadata
  role?: AnalyticalRole        // 'critique' | 'assumption' | 'gap_flag' | 'criterion' | 'option' | 'evaluation'
  metadata?: {
    analysisType?: 'red_team' | 'decision_map' | 'gap_analysis'
    critiqueTarget?: string    // ID of object being critiqued
    severity?: 'low' | 'medium' | 'high'
    decisionContext?: string   // Associated decision statement
    score?: number             // Evaluation score (1-10)
    persona?: 'skeptic' | 'investor' | 'counsel'
  }

  // Color Legend specific (type: 'colorLegend')
  legendEntries?: {
    color: string              // Hex color
    meaning: string            // Strategic meaning (e.g., "Validated", "Critical Risk")
  }[]
}

type ObjectType = 'stickyNote' | 'rectangle' | 'circle' | 'frame' | 'connector' | 'colorLegend'
type AnalyticalRole = 'critique' | 'assumption' | 'gap_flag' | 'criterion' | 'option' | 'evaluation'
```

**Collection: `boards/{boardId}/metadata`**

```typescript
interface BoardMetadata {
  title: string
  createdAt: Timestamp
  createdBy: string            // User ID (owner)

  // Visibility & access
  isPublic: boolean            // Default: true
  invitedEmails: string[]      // Email whitelist for private boards

  // AI configuration
  aiPersona: 'neutral' | 'skeptical_investor' | 'opposing_counsel'

  // Rate limiting
  aiCommandsToday: number      // Board-level daily counter
  aiCommandsResetAt: Timestamp // Daily reset timestamp

  // Analysis history
  analysisHistory: AnalysisRecord[]

  // Board context / AI Lore (sidecar pattern)
  boardContext?: {
    mainTopics: string[]       // AI-extracted themes (displayed as tag chips)
    openQuestions: string[]    // Unanswered questions identified
    keyDecisions: string[]     // Major choices on board
    executiveSummary: string   // 2-3 sentence narrative overview
    lastAnalyzed: Timestamp
  }
}

interface AnalysisRecord {
  timestamp: number
  type: 'red_team' | 'decision_map' | 'gap_analysis'
  objectCount: number
  summary: string
}
```

**Collection: `users/{userId}/profile`**

```typescript
interface UserProfile {
  displayName: string
  email?: string               // null for anonymous users
  photoURL?: string
  isAnonymous: boolean
  createdAt: Timestamp
  aiCommandsThisHour: number   // Per-user hourly counter
  aiCommandsResetAt: Timestamp // Hourly reset timestamp
}
```

**Collection: `users/{userId}/contacts/{contactId}`**

```typescript
interface Contact {
  displayName: string
  email: string
  photoURL?: string
  lastCollaborated: Timestamp
  sharedBoards: string[]       // Board IDs collaborated on
}
```

### 4.2 Realtime Database Schema

**Path: `/boards/{boardId}/cursors/{userId}`**

```typescript
interface Cursor {
  x: number                    // Cursor X position in canvas space
  y: number                    // Cursor Y position in canvas space
  name: string                 // User display name
  color: string                // Unique color per user
  timestamp: number            // Last update timestamp (ms)
}
```

**Path: `/boards/{boardId}/presence/{userId}`**

```typescript
interface Presence {
  name: string
  email?: string
  photoURL?: string
  color: string                // Consistent with cursor color
  online: boolean
  lastSeen: number             // Unix timestamp (ms)
  isAnonymous: boolean
}
```

**Path: `/boards/{boardId}/locks/{objectId}`**

```typescript
interface ObjectLock {
  userId: string               // User who holds the lock
  userName: string             // Display name for visual indicator
  timestamp: number            // Lock acquisition time (ms)
  // onDisconnect() automatically removes this entry
}
```

---

## 5. Core Features

### 5.1 Infinite Canvas

**Requirements:**
- Pan: Default interaction mode — click and drag to move viewport (stage.x / stage.y)
- Zoom: Mouse wheel (center on cursor position)
- Dot grid background: Infinite repeating dots at 20px intervals
- Viewport culling: Only render objects in visible area

**Technical Implementation:**
- Konva Stage with `draggable` prop (enabled only in Pan Mode)
- Zoom calculation maintains cursor position as zoom center
- Zoom range: 5% (0.05x) to 500% (5.0x)
- Dot grid rendered on static layer (no event listeners)
- Viewport bounds calculated from Stage transform

**Performance Targets:**
- 60 FPS during pan/zoom
- Smooth interactions with 200+ objects
- No jitter or lag during transforms

### 5.2 Mode-Based Interaction System

The canvas operates in three mutually exclusive modes:

#### Pan Mode (Default)
- **Activation:** Escape key, or clicking the pan tool, or after any mode completes
- **Behavior:** Click-and-drag moves the viewport (stage.x/stage.y). No object interaction.
- **Cursor:** Grab/hand icon
- **Toolbar:** Pan tool highlighted

#### Select Mode
- **Activation:** Click the Select tool in the toolbar (or press `1`)
- **Behavior:** Click to select objects. Ctrl+Click to multi-select. Click-and-drag draws a semi-transparent selection rectangle performing AABB hit-test on release. Selected objects show Transformer handles.
- **Cursor:** Crosshair or default arrow
- **Toolbar:** Select tool highlighted
- **Exit:** Press Escape or re-click the Select tool → returns to Pan Mode

#### Create Mode
- **Activation:** Click a creation tool (Sticky Note, Rectangle, Circle, Frame, Connector)
- **Behavior:** Click on canvas to place object at default size. Tool stays active — click again to place another. Object is placed snapped to the 20px grid.
- **Cursor:** Crosshair with small icon of the object type being created
- **Toolbar:** Active creation tool highlighted
- **Exit:** Press Escape → returns to Pan Mode

### 5.3 Board Objects

#### Sticky Notes
- Default dimensions: 200×150px
- Size limits: 80×60px (min) to 600×600px (max)
- Editable text: Double-click to edit via scale-aware HTML textarea overlay (rotation ignored — note snaps to 0° during editing)
- Text overflow: Auto-resize height to fit content (width stays fixed)
- Colors: Yellow (#FEFF9C), Pink (#FF7EB9), Cyan (#7AFCFF), Mint (#98FF98), Plum (#DDA0DD), Coral (#FFAB91)
- Font: Sans-serif, 14px
- Padding: 10px
- AI badge: Small sparkle icon in corner if `isAIGenerated: true`

#### Shapes
- **Rectangle:** Solid fill, rounded corners (4px)
- **Circle:** Solid fill, perfect circle
- Default dimensions: 100×100px
- Size limits: 20×20px (min) to 800×800px (max)
- Resizable with Transformer handles when selected

#### Frames
- Visual container for grouping objects
- Title bar: 40px height, bold text
- Semi-transparent background: 10% opacity
- Border: 2px solid
- Size limits: 150×100px (min) to 4000×4000px (max)
- **Auto-nesting:** Objects with >50% overlap automatically set `parentFrame`. Children are spatially locked — moving the frame moves all children.
- **Deframe All:** Right-click frame → "Deframe All" severs all parent-child relationships in a batch, keeping objects in place.
- **Manual assignment:** Right-click an object near a frame → "Add to Frame: [title]"

#### Connectors
- Start/end object IDs stored in `connectedTo` array
- **Anchor points:** Edge-to-edge (nearest point). Connector endpoints snap to the nearest edge point between source and target objects. Endpoints update in real-time when objects are dragged.
- **Creation:** Hover an object → small anchor dots appear on edges → drag from one anchor to another object
- Styles: solid, dashed, dotted
- Colors: Used for semantic meaning (red = critique, blue = dependency)
- Label: Optional text at midpoint
- **Orphan behavior:** If either endpoint object is deleted, the connector is automatically deleted

#### Color Legend (Special Canvas Object)
- A special board object (type: `colorLegend`) rendered on the canvas
- Displays the shared color-to-meaning mapping (e.g., Green = "Validated", Red = "Critical Risk")
- Positionable and resizable like any other object
- Editable by any user — syncs in real-time
- AI can reference the legend when generating objects
- Users create/edit via a dedicated "Legend" tool or right-click context menu

### 5.4 Grid Snapping

- Objects magnetically snap to a 20px grid intersection by default during drag and creation
- Ensures all AI and human content is perfectly aligned
- Hold **Cmd/Ctrl** (or **Alt**) to temporarily bypass the grid for free-form organic positioning
- Grid snap applies to both position and creation placement

### 5.5 Selection & Manipulation

**Selection:**
- Single-click: Select object (show Transformer handles) — requires Select Mode
- Ctrl + Click: Add/remove objects from multi-selection
- Drag rectangle: Draw selection box in Select Mode → AABB hit-test selects all objects within bounds

**Operations:**
- **Move:** Click + drag selected objects (in Select Mode)
- **Resize:** Transformer handles when selected
- **Delete:** Select + Delete key → confirmation dialog. Ctrl+Delete bypasses confirmation for instant removal.
- **Duplicate:** Ctrl+D → duplicate selected objects with +20px offset
- **Copy/Paste:** Ctrl+C to copy, Ctrl+V to paste with +20px offset. Works with multi-select.
- **Deframe All:** Right-click selected frame → context menu action

**Visual Feedback:**
- Selection border: 2px solid blue (#2196F3)
- Transformer handles: 8 resize anchors + rotation handle
- Hover state: Cursor changes to pointer (in Select Mode)

### 5.6 Real-Time Collaboration

#### Multiplayer Cursors
- **Update Rate:** 30 Hz (33ms throttle)
- **Display:** Circle (12px radius) + name label below
- **Color:** Generated from user ID hash (consistent per user)
- **Optimization:** Only send updates if cursor moved >5px
- **Cleanup:** Automatic removal via onDisconnect() when user leaves

#### Object Synchronization
- **Pattern:** Optimistic updates + Firestore listeners
- **Flow:**
  1. User action → Immediate Zustand update (optimistic)
  2. Write to Firestore asynchronously
  3. Firestore listener triggers → Update Zustand (reconcile)
  4. React re-renders Konva canvas

- **Conflict Resolution:** Last-write-wins (Firestore server timestamp)
- **Latency Target:** <100ms from action to remote render

#### Soft Locking (Drag Conflict Prevention)
- When a user starts dragging an object, a lock is acquired in Realtime Database at `/boards/{boardId}/locks/{objectId}`
- Other users see a visual lock indicator on the object and cannot drag it
- Lock is stored with `onDisconnect()` cleanup — automatically released if user disconnects/crashes
- Lock released when drag ends (dragend event)
- Lock includes userId and userName for the visual indicator

#### Presence System
- **Online Indicator:** User avatar stack in top-right corner (overlapping circles, first 3-4 shown, "+N" for overflow). Click to expand full list.
- **Detection:** onValue listener on `/presence/{userId}`
- **Offline Threshold:** 30 seconds of inactivity
- **Cleanup:** onDisconnect() removes presence record
- **Anonymous users:** Shown with display name and generated avatar color

### 5.7 Offline State Handling

- **Detection:** Monitor Firebase connection state
- **Visual indicator:** Yellow banner at top of canvas: "You are offline. Changes will sync when reconnected." Dismissible. Reappears on each disconnect.
- **Behavior:** Firestore offline persistence (IndexedDB cache) handles queued writes
- **Reconnection:** Brief "Syncing..." state during reconnection, then banner disappears

---

## 6. UI Design System

### 6.1 Design Language

- **Theme:** Light mode only. Clean, modern SaaS-style.
- **Brand Color:** `#6366f1` (vibrant purple) for primary actions and accents
- **Aesthetic:** Minimalism, high-contrast primary actions, generous whitespace
- **Border Radius:** `0.5rem` (8px) on all floating panels, cards, and modals
- **Shadows:** Subtle drop shadows on floating elements (`shadow-md` equivalent)
- **Typography:** System sans-serif font stack
- **Canvas Background:** Light gray/white with dot grid pattern (20px intervals)

### 6.2 Workspace Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Guest Session Banner - slim, top, with "Save to Account" link]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│              ┌─────────────────────────────┐                        │
│              │ 🔘 Select │ 📝 Sticky │ ◻ Shape │ ▣ Frame │        │
│              └─────────────────────────────┘                        │
│                    (Top-centered floating toolbar)                   │
│                                                                     │
│  ┌──────────┐                               ┌────────────────────┐ │
│  │ Board    │                               │ Online • 👤👤👤+2 │ │
│  │ Title    │                               │ (Presence stack)   │ │
│  │ (editable│    ┌────────────────────┐     └────────────────────┘ │
│  │  inline) │    │                    │                             │
│  └──────────┘    │   INFINITE CANVAS  │     ┌────────────────────┐ │
│                  │   (Dot Grid)       │     │ AI Sidebar         │ │
│                  │                    │     │ ┌────────────────┐ │ │
│                  │                    │     │ │ Persona: [▼]   │ │ │
│                  │                    │     │ ├────────────────┤ │ │
│                  │                    │     │ │ Chat messages  │ │ │
│                  │                    │     │ │ ...            │ │ │
│                  │                    │     │ ├────────────────┤ │ │
│                  │                    │     │ │ [Input field]  │ │ │
│                  └────────────────────┘     │ │ /r /d /g       │ │ │
│                                             │ └────────────────┘ │ │
│  ┌──────────┐                               └────────────────────┘ │
│  │ 100% 🔍 │                                                       │
│  │ (Zoom +  │                                                       │
│  │  Help)   │                                                       │
│  └──────────┘                                                       │
│  (Bottom-left)                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 Top-Centered Floating Toolbar

- Horizontal bar centered at top of canvas, floating over the dot grid
- Rounded corners (`border-radius: 0.5rem`), subtle drop shadow
- Semi-transparent white background with backdrop blur
- **Tools (left to right):**
  - Pan (hand icon) — default active
  - Select (arrow/crosshair icon)
  - Sticky Note (sticky note icon)
  - Shapes dropdown (rectangle, circle)
  - Frame (frame icon)
  - Connector (line icon)
- **Active tool:** Highlighted background (brand purple tint) + cursor changes
- **Behavior:** Clicking a tool activates its mode. Escape returns to Pan.

### 6.4 Color Picker

**Dual-mode picker accessible from object toolbar (appears when object is selected):**

1. **Quick-Access Grid:** Shows the Color Legend's palette with each color's assigned strategic meaning. One-click to apply.
2. **Power Mode (expandable):** Full hex input field + color wheel for custom colors. For power users needing full creative control.

**Recommended Colors (with legend meanings):**
- Synced board-level Color Legend maps specific colors to strategic meanings (e.g., Green = "Validated", Red = "Critical Risk")
- Legend is a canvas object that all users see and can edit

### 6.5 AI Sidebar

- **Position:** Right side, collapsible
- **Width:** ~25% of screen when open
- **Layout behavior:** Pushes canvas (Konva Stage resizes) when opened. Smooth transition.
- **Components (top to bottom):**
  1. **Persona toggle:** Segmented control or dropdown — always visible at top. Options: Neutral Critic, Skeptical Investor, Opposing Counsel.
  2. **Rate limit display:** Subtle counter showing remaining AI commands (e.g., "18/20 commands this hour")
  3. **Chat messages:** Scrollable area. User messages right-aligned, AI responses left-aligned. Chat-style with timestamps.
  4. **Input field:** Text input at bottom with send button. Supports slash commands: `/r` (red team), `/d` (decision map), `/g` (find gaps).
- **History:** Rolling window of last 5 command/response pairs maintained in context. Lost on page refresh.

### 6.6 Share Modal

- Triggered by "Share" button in the top bar
- **Contents:**
  - Public/Private toggle switch (confirmation dialog when switching to public)
  - Board URL display with "Copy Link" button
  - **Invite section (private boards):** Email input + "Add" button. List of invited emails with remove option.
  - **Contacts quick-invite:** List of past collaborators from contacts. One-click to add their email to the whitelist.
- Board URL format: `/board/[random-id]` (e.g., `/board/abc123xyz`)

### 6.7 Presence Indicators

- **Location:** Top-right corner of workspace
- **Format:** Overlapping avatar circles (first 3-4 visible) with "+N" overflow count
- **Click to expand:** Full list of online users with names and cursor colors
- **"Online" status label** next to the avatar stack
- **Anonymous users:** Show display name with colored circle (no photo)

### 6.8 Zoom & Help Controls

- **Location:** Bottom-left corner
- **Zoom display:** Current zoom percentage (e.g., "100%"). Click to reset to 100%.
- **Help trigger:** Small "?" icon. Opens a help overlay or links to keyboard shortcuts reference.

---

## 7. Board Management (Dashboard)

### 7.1 Dashboard Layout

- **URL:** `/dashboard`
- **Requires:** Authentication (middleware redirects unauthenticated users to `/auth`)
- **Layout:** Responsive card grid (3-4 cards per row on desktop, 1-2 on smaller screens)
- **Top bar:** Search bar (filters boards by title/tags) + "Join Board" field + "New Board" button

### 7.2 Board Cards

**Progressive Disclosure Model:**
- **Default view:** Board title, last modified date, public/private indicator
- **Tag chips:** 3-5 AI-generated tags shown on the card (e.g., "Logic Gap Found", "Q4 Roadmap") — generated by the "Summarize Board" action
- **Hover/expand:** 2-3 sentence executive summary fades in, providing narrative overview of strategic progress and AI's latest critique
- **Actions:** Open, Delete (with confirmation), Summarize Board

### 7.3 Board Creation

- **Trigger:** "New Board" button in dashboard header opens a focused modal
- **Modal contents:** Title input field (required), "Create" button
- **Defaults:** Board is public (`isPublic: true`), empty canvas
- **Result:** Navigates to `/board/[new-random-id]`

### 7.4 Board Title

- Set during creation via the modal
- Editable inline by clicking the title text in the board's top bar (contentEditable or input swap)
- Changes sync to Firestore metadata immediately

### 7.5 Board Join Field

- Text input on the dashboard that accepts:
  - Full board URL (e.g., `https://cruciblecanvas.app/board/abc123`)
  - Just the board ID (e.g., `abc123`)
- Auto-parses the ID from pasted URLs
- Navigates to the board on submit

### 7.6 Board Deletion

- Hard delete with confirmation dialog ("This will permanently delete the board and all its objects. This cannot be undone.")
- Only the board creator can delete
- Deletes all sub-collections: objects, metadata, RTDB cursors/presence/locks
- No archive or recovery functionality

### 7.7 AI-Augmented Board Summaries (Sidecar Pattern)

- **Trigger:** Explicit "Summarize Board" button on dashboard card
- **Process:** Sends board state to Claude, which extracts topics, questions, decisions, and writes a summary
- **Storage:** Written to `boardContext` field in board metadata (separate from core board state)
- **Output:** Tag chips + executive summary displayed on the dashboard card
- **Cost management:** Only generated on explicit user request — never automatic

---

## 8. AI Agent Capabilities

### 8.1 Operating Modes

#### Execution Mode (Base MVP)
**Purpose:** Direct board manipulation via natural language
**Input:** User command text
**Output:** Firestore writes (create/move/delete objects)

**Example Commands:**
- "Create a yellow sticky note that says 'User Research'"
- "Move all pink sticky notes to the right"
- "Delete the rectangle in the top-left corner"
- "Change the sticky note color to green"

#### Analysis Mode (Red Team / Find Gaps)
**Purpose:** Critical analysis of board content
**Input:** Board state snapshot (viewport-only) + analytical directive
**Output:** Critique frame with flagged notes + connectors

**Capabilities:**
1. **Red Team This:** Identify assumptions, contradictions, missing data, edge cases
2. **Find the Gaps:** Scan for unexplored topics, unanswered questions, missing dependencies

**Output Structure:**
- Empty frame with loading spinner appears immediately (progressive skeleton)
- Objects fill in as tool calls resolve
- Critique sticky notes (pink for high severity, coral for medium/low)
- Dashed connectors linking critique → original object
- Severity emojis: 🔴 Critical, 🟡 Important, 🟢 Minor
- Sparkle icon badge on all AI-generated objects

#### Synthesis Mode (Decision Mapping)
**Purpose:** Generate structured decision frameworks
**Input:** Decision statement + framework type
**Output:** Organized layout with criteria, options, evaluations

**Framework Types:**
1. **Options Matrix:** Rows = options, Columns = criteria, Cells = scores
2. **Tradeoff Analysis:** Two columns (Gains vs Losses)
3. **Pros/Cons Grid:** Classic argument structure

**Output Structure:**
- Main decision frame (cyan background)
- Criterion headers (green sticky notes, top row)
- Option labels (yellow sticky notes, left column)
- Evaluation cells (color-coded by score: red <4, yellow 4-7, green >7)

### 8.2 AI Object Placement

**Default position:** Below the current selection. If no selection, below the viewport center.

**Draggable AI Thinking Avatar:**
1. When an AI command is triggered, an "AI Thinking Avatar" icon appears at the default position
2. While the LLM streams, the user can drag this icon to any location on the canvas
3. The final output "grows" from the avatar's final resting position
4. If the user doesn't interact with the avatar, output renders at the default position

**Completion notification:**
- Toast notification: "Analysis complete — 12 objects created" with a "Jump to analysis" button
- Clicking the button pans the canvas to center on the generated output
- No auto-pan — user controls when to navigate to results

### 8.3 AI Error Handling & Rollback

- If the Anthropic API fails (rate limit, timeout, network error) during a multi-step analysis:
  - **All objects created by that command are rolled back** (deleted from Firestore)
  - Objects are grouped by `aiCommandId` for batch deletion
  - Error toast: "Analysis failed — no changes made. Try again?"
  - The progressive skeleton frame is also removed
- Clean board state guaranteed — no partial outputs

### 8.4 AI Undo (MVP)

- **Scope:** AI-action undo only. Single level.
- **Trigger:** "Undo AI Analysis" button appears in the sidebar after an AI command completes. Also triggered by Ctrl+Z.
- **Behavior:** Bulk deletes all objects with the most recent `aiCommandId`
- **Multiplayer:** No consensus mechanism for MVP. Undo applies immediately for all users.
- **Limitation:** Only undoes the last AI command. User-created objects are not undoable.

### 8.5 AI Rate Limiting

**Per-User Limit:** 20 commands per hour
- Tracked in `users/{userId}/profile.aiCommandsThisHour`
- Counter resets hourly (tracked by `aiCommandsResetAt`)
- Shown in sidebar: "18/20 commands this hour"

**Per-Board Limit:** 50 commands per day
- Tracked in `boards/{boardId}/metadata.aiCommandsToday`
- Counter resets daily (tracked by `aiCommandsResetAt`)
- Prevents abuse on popular public boards

**Enforcement:** Server-side validation in the Vercel Edge Function before calling Claude

### 8.6 AI Context Serialization

**Viewport-only context:** Only objects currently visible in the user's viewport are sent to the AI.

**Serialization format:** Nested JSON with frame grouping

```typescript
interface AIBoardContext {
  viewportBounds: { x: number, y: number, width: number, height: number }
  frames: {
    id: string
    title: string
    x: number           // Integer (rounded to save tokens)
    y: number
    children: {
      id: string
      type: ObjectType
      text?: string
      color: string
      rel_pos: { x: number, y: number }  // Position relative to frame top-left
    }[]
  }[]
  orphanObjects: {       // Objects not in any frame
    id: string
    type: ObjectType
    text?: string
    color: string
    x: number
    y: number
    spatialRegion: string // 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
  }[]
  connectors: {
    id: string
    from: string         // Object ID
    to: string           // Object ID
    style: string
    label?: string
  }[]
  colorLegend?: {
    color: string
    meaning: string
  }[]
  metadata: {
    totalObjectCount: number
    visibleObjectCount: number
    persona: string
    recentAnalyses: string[]
  }
}
```

### 8.7 AI Tool Schema

**Base Manipulation Tools:**
```typescript
createStickyNote(text: string, x: number, y: number, color: string)
createShape(type: 'rectangle' | 'circle', x: number, y: number, width: number, height: number, color: string)
createFrame(title: string, x: number, y: number, width: number, height: number)
createConnector(startObjectId: string, endObjectId: string, style: 'solid' | 'dashed' | 'dotted', color: string, label?: string)
moveObject(objectId: string, x: number, y: number)
updateText(objectId: string, text: string)
changeColor(objectId: string, color: string)
deleteObject(objectId: string)
arrangeObjects(objectIds: string[], layout: 'grid' | 'horizontal' | 'vertical', spacing: number)
```

**Analytical Tools:**
```typescript
redTeamThis(
  targetObjectIds: string[],
  focusAreas: ('assumptions' | 'contradictions' | 'missing_data' | 'edge_cases')[],
  persona: 'skeptic' | 'investor' | 'counsel'
)

mapDecision(
  decisionStatement: string,
  frameworkType: 'options_matrix' | 'tradeoff_analysis' | 'pros_cons',
  options?: string[],
  criteria?: string[]
)

findGaps(
  scope: 'entire_board' | 'selected_frame' | 'selected_objects',
  targetIds?: string[],
  gapTypes: ('unexplored_topics' | 'unanswered_questions' | 'missing_dependencies')[]
)
```

**Context Tools:**
```typescript
getBoardState() → AIBoardContext
getObjectsByFrame(frameId: string) → BoardObject[]
analyzeBoardSemantics() → { topics: string[], openQuestions: string[], themes: string[] }
```

### 8.8 System Prompts

**Base Context (Always Included):**
```
You are an AI assistant for CrucibleCanvas, a strategic thinking whiteboard.

Current board state:
- Total objects: ${objectCount}
- Visible objects: ${visibleCount}
- Frames: ${frameCount}
- Key topics: ${topics.join(', ')}
- Recent analyses: ${analysisHistory.map(a => a.type).join(', ')}
- Color Legend: ${colorLegend.map(e => `${e.color}=${e.meaning}`).join(', ')}

Your capabilities:
1. Create and manipulate visual objects (sticky notes, shapes, frames, connectors)
2. Analyze board content for logical consistency and gaps
3. Generate structured decision frameworks
4. Provide critical counter-arguments and identify assumptions

All objects you create will be marked with an AI badge for attribution.
```

**Execution Mode:**
```
MODE: Direct Board Manipulation

Execute user commands literally and efficiently.
- Place new objects in visible viewport area, snapped to 20px grid
- Use color semantics from the board's Color Legend when available
- Default color semantics: yellow=ideas, pink=critiques, green=approved, cyan=frameworks
- Create connectors to show relationships
- Keep sticky note text concise (2-3 sentences max)
```

**Analysis Mode:**
```
MODE: Critical Analysis (Red Team / Gap Finding)

Your role: Challenge the user's thinking systematically.

Critical thinking framework:
1. ASSUMPTIONS: What's taken for granted without evidence?
2. CONTRADICTIONS: Where do statements conflict?
3. MISSING DATA: What evidence is absent but necessary?
4. EDGE CASES: What scenarios break this logic?

Output structure:
- Create analysis frame (pink background for Red Team, cyan for Gap Analysis)
- Each critique = separate sticky note with severity indicator
- Link critiques to original claims via dashed red connectors
- Be specific and actionable (not generic doubts)

Severity levels:
🔴 Critical flaw (invalidates core assumption)
🟡 Important gap (weakens argument)
🟢 Minor consideration (for completeness)
```

**Synthesis Mode:**
```
MODE: Decision Framework Generation

Your role: Structure complex decisions visually.

Framework types available:
1. OPTIONS MATRIX: Grid layout (rows=options, cols=criteria, cells=scored evaluations)
2. TRADEOFF ANALYSIS: Two-column layout (Gains vs Losses)
3. PROS/CONS GRID: Classic structured argument map

Layout principles:
- Use frames to group related elements
- Color code consistently using the board's Color Legend
- Create visual hierarchy (headers larger than cells)
- Limit frameworks to 4-8 core elements for clarity
- Include rationale with every evaluation score
- Snap all objects to 20px grid for alignment
```

**Persona Variations:**
```typescript
const personas = {
  skeptical_investor: `
  You are a venture capitalist who has reviewed 1,000+ pitches.
  Focus: market validation, unit economics, competitive moats, scaling risks, burn rate.
  Tone: Direct, numbers-focused, skeptical of hand-waving and unvalidated assumptions.
  `,

  opposing_counsel: `
  You are a lawyer representing the opposing side in litigation.
  Focus: legal exposure, contractual gaps, liability, regulatory compliance, precedent.
  Tone: Adversarial but professional, evidence-focused, precedent-driven.
  `,

  neutral_critic: `
  You are a strategic advisor with no agenda or bias.
  Focus: logical consistency, evidence quality, alternative perspectives, blind spots.
  Tone: Balanced, constructive, intellectually honest, Socratic.
  `
}
```

### 8.9 AI Cost Projections

**Development Phase:**
- Estimated API calls: 200-400 commands during testing
- Token consumption: ~10K-20K tokens per command (varies by board size)
- Projected cost: $10-20

**Production Estimates:**

| User Scale | Commands/User/Month | Monthly Cost | Assumptions |
|------------|---------------------|--------------|-------------|
| 100 users  | 5                   | $2.50        | 500 commands × $0.005 avg |
| 1,000 users| 5                   | $25          | 5K commands × $0.005 avg |
| 10,000 users| 5                  | $250         | 50K commands × $0.005 avg (need context pruning) |
| 100,000 users| 5                 | $2,500       | 500K commands × $0.005 avg (need caching layer) |

**Cost Optimization Strategies:**
1. **Viewport-Only Context:** Only send visible objects (already implemented)
2. **Integer Coordinates:** Round x/y to integers to save tokens
3. **Relative Positions:** Use rel_pos within frames to compress spatial data
4. **Rate Limiting:** Per-user (20/hr) and per-board (50/day) limits
5. **Caching:** Cache analysis results for repeated queries on unchanged board state
6. **Batch Operations:** Single tool call for "create 10 sticky notes" instead of 10 separate calls

---

## 9. Voice-to-Visual Feature (Optional)

### 9.1 Architecture

**Browser Speech API Integration:**
- Use `SpeechRecognition` API (Chrome/Edge only)
- No backend changes required
- Voice → text → existing AI pipeline

**Implementation Flow:**
1. User clicks mic button in toolbar
2. `SpeechRecognition` starts listening
3. On utterance end, transcribed text sent to `/api/ai-command`
4. Claude processes as normal text command
5. Tool calls execute → Firestore writes → real-time sync

### 9.2 UI Components

**Mic Button:**
- Icon: 🎤 (microphone)
- States: inactive (gray), listening (red pulse animation), processing (blue)
- Position: Toolbar (next to AI chat button)

**Transcription Display:**
- Live text display above canvas
- Shows: "You said: [transcribed text]"
- Fades out after 3 seconds

**Error Handling:**
- No microphone access: Hide mic button
- Unsupported browser: Show tooltip "Voice input requires Chrome/Edge"
- Recognition error: Show "Couldn't hear you. Try again?"

### 9.3 Graceful Degradation

- Feature hidden in unsupported browsers (Firefox, Safari)
- No impact on core functionality if disabled
- Optional enhancement, not MVP requirement

---

## 10. Onboarding & Tutorial

### 10.1 Interactive Tutorial (First Board Creation)

Triggered when a user creates their first board. 5-step guided overlay with "Skip Tour" button.

**Step 1: Create a Sticky Note**
- Highlight the Sticky Note tool in the toolbar
- Prompt: "Click the sticky note tool, then click on the canvas to place one"
- Advance on: sticky note created

**Step 2: Edit Text**
- Highlight the created sticky note
- Prompt: "Double-click the sticky note to edit its text"
- Advance on: text edited and confirmed

**Step 3: Drag to Move**
- Prompt: "Switch to Select mode, then drag your sticky note to a new position"
- Advance on: object moved

**Step 4: Open AI Sidebar**
- Highlight the AI sidebar toggle
- Prompt: "Click to open the AI assistant"
- Advance on: sidebar opened

**Step 5: Run an Analysis**
- Prompt: "Type 'Red team this' and press Enter to see the AI challenge your idea"
- Advance on: AI command executed

**Completion:** "You're ready! Invite collaborators with the Share button." Dismisses overlay.

---

## 11. Keyboard Shortcuts

### 11.1 Tool Switching
| Shortcut | Action |
|----------|--------|
| `1` | Pan Mode (default) |
| `2` | Select Mode |
| `3` | Sticky Note tool |
| `4` | Shape tool (Rectangle) |
| `5` | Frame tool |
| `Escape` | Return to Pan Mode / Deselect all |

### 11.2 Object Operations
| Shortcut | Action |
|----------|--------|
| `Delete` | Delete selected (with confirmation dialog) |
| `Ctrl+Delete` | Delete selected (bypass confirmation) |
| `Ctrl+C` | Copy selected objects |
| `Ctrl+V` | Paste with +20px offset |
| `Ctrl+D` | Duplicate selected with +20px offset |
| `Ctrl+Z` | Undo last AI command |

### 11.3 AI Shortcuts (in sidebar input)
| Shortcut | Action |
|----------|--------|
| `/r` | Red Team Analysis |
| `/d` | Decision Map |
| `/g` | Find Gaps |

### 11.4 Navigation
| Shortcut | Action |
|----------|--------|
| `Space + Drag` | Pan (from any mode) |
| `Mouse Wheel` | Zoom (centered on cursor) |
| `Cmd/Ctrl + Drag` | Bypass grid snapping |

---

## 12. Performance Requirements

### 12.1 Targets

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Canvas FPS | 60 FPS | Chrome DevTools Performance profiler |
| Object Sync Latency | <100ms | Timestamp diff (write → remote render) |
| Cursor Sync Latency | <50ms | Timestamp diff (mousemove → remote cursor) |
| Initial Load Time | <2s | Lighthouse Performance score |
| AI Command Execution | <3s | Streaming response time to first token |
| Object Capacity | 500+ | Manual testing with object creation loop |
| Concurrent Users | 5+ | Manual testing with multiple browser windows |

### 12.2 Optimization Strategies

**Viewport Culling:**
```typescript
const isInViewport = (obj: BoardObject, viewport: Viewport): boolean => {
  const vpLeft = -viewport.x / viewport.scale
  const vpTop = -viewport.y / viewport.scale
  const vpRight = vpLeft + window.innerWidth / viewport.scale
  const vpBottom = vpTop + window.innerHeight / viewport.scale

  const padding = 200 // Buffer for smooth entry/exit

  return !(
    obj.x + obj.width < vpLeft - padding ||
    obj.x > vpRight + padding ||
    obj.y + obj.height < vpTop - padding ||
    obj.y > vpBottom + padding
  )
}
```

**Layer Splitting:**
- Layer 1 (Static): Dot grid background, no event listeners
- Layer 2 (Dynamic): Board objects, draggable
- Layer 3 (Cursors): Remote cursors, always on top
- Layer 4 (Selection UI): Transformer handles, selection rectangle

**Debounced Sync:**
- Only write to Firestore on drag **end**, not during drag
- Local optimistic updates for instant feedback
- Rollback on Firestore write failure

**Throttled Cursor Updates:**
- Update rate: 30 Hz (33ms intervals)
- Distance threshold: Only send if cursor moved >5px
- Reduces Realtime DB bandwidth significantly

**Board Loading:**
- All objects loaded at once from Firestore on initial board open
- Loading spinner shown until complete
- Firestore real-time listeners activated after initial load

---

## 13. Security

### 13.1 API Route Protection

- **Server-side token validation:** Every request to `/api/ai-command` must include a Firebase ID token
- Token verified against Firebase Admin SDK on each request (~50ms latency)
- Unauthenticated requests rejected with 401
- Rate limit checks performed server-side after token validation

### 13.2 Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner(boardId) {
      return get(/databases/$(database)/documents/boards/$(boardId)/metadata/config).data.createdBy == request.auth.uid;
    }

    function isBoardPublic(boardId) {
      return get(/databases/$(database)/documents/boards/$(boardId)/metadata/config).data.isPublic == true;
    }

    function isInvited(boardId) {
      return request.auth.token.email in get(/databases/$(database)/documents/boards/$(boardId)/metadata/config).data.invitedEmails;
    }

    function canAccessBoard(boardId) {
      return isOwner(boardId) || isBoardPublic(boardId) || isInvited(boardId);
    }

    match /boards/{boardId}/metadata/{document=**} {
      allow read: if isAuthenticated() && canAccessBoard(boardId);
      allow create: if isAuthenticated();
      allow update: if isAuthenticated() && canAccessBoard(boardId);
      allow delete: if isAuthenticated() && isOwner(boardId);
    }

    match /boards/{boardId}/objects/{objectId} {
      allow read: if canAccessBoard(boardId);  // Allow unauthenticated read for public boards (read-only preview)
      allow create: if isAuthenticated() && canAccessBoard(boardId);
      allow update: if isAuthenticated() && canAccessBoard(boardId);
      allow delete: if isAuthenticated() && canAccessBoard(boardId);
    }

    match /users/{userId}/profile {
      allow read, write: if request.auth.uid == userId;
    }

    match /users/{userId}/contacts/{contactId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

### 13.3 Realtime Database Security Rules

```json
{
  "rules": {
    "boards": {
      "$boardId": {
        "cursors": {
          "$userId": {
            ".read": "auth != null",
            ".write": "auth.uid == $userId"
          }
        },
        "presence": {
          "$userId": {
            ".read": "auth != null",
            ".write": "auth.uid == $userId"
          }
        },
        "locks": {
          "$objectId": {
            ".read": "auth != null",
            ".write": "auth != null && (!data.exists() || data.child('userId').val() == auth.uid)"
          }
        }
      }
    }
  }
}
```

---

## 14. Browser Support

### 14.1 Supported Browsers

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 90+ | Full support including SpeechRecognition |
| Firefox | 90+ | Full support except SpeechRecognition (voice feature hidden) |
| Safari | 15+ | Full support except SpeechRecognition (voice feature hidden) |
| Edge | 90+ | Full support including SpeechRecognition (Chromium-based) |

### 14.2 Mobile Handling

- **Desktop-only application.** Mobile browsers are not supported.
- When a mobile viewport is detected (`window.innerWidth < 768px` or touch-only device), display a blocking message: "CrucibleCanvas requires a desktop browser for the best experience."
- No attempt to render the canvas or toolbar on mobile

---

## 15. Deployment

### 15.1 Hosting

**Platform:** Vercel
**Domain:** Custom domain (cruciblecanvas.app) or Vercel subdomain
**Environment:** Production + Preview (automatic PR deployments)

**Configuration:**
```bash
# vercel.json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install"
}
```

**Environment Variables (Vercel Dashboard):**
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_DATABASE_URL=...
ANTHROPIC_API_KEY=...
FIREBASE_ADMIN_PROJECT_ID=...
FIREBASE_ADMIN_CLIENT_EMAIL=...
FIREBASE_ADMIN_PRIVATE_KEY=...
```

### 15.2 Firebase Configuration

**Firestore:**
- Database: `(default)` in `us-central1`
- Security rules deployed via Firebase CLI

**Realtime Database:**
- Database: `cruciblecanvas-default-rtdb` in `us-central1`
- Security rules deployed via Firebase CLI

**Authentication:**
- Providers: Anonymous, Google, GitHub OAuth
- Authorized domains: `cruciblecanvas.app`, `*.vercel.app`
- Account linking enabled (anonymous → social)

---

## 16. Testing Plan

### 16.1 Multiplayer Sync Tests

**Test 1: Simultaneous Object Creation**
- Setup: 2 users, different browsers
- Action: Both users create sticky notes rapidly (10 each)
- Expected: All 20 notes appear for both users within 100ms
- Pass Criteria: No missing objects, no duplicates

**Test 2: Simultaneous Editing**
- Setup: 2 users editing same sticky note text
- Action: User A types "Strategy", User B types "Plan"
- Expected: Last-write-wins (either "Strategy" or "Plan")
- Pass Criteria: No merge conflicts, consistent state across users

**Test 3: Network Disconnection**
- Setup: 1 user, stable connection
- Action: Create 5 objects → disable network → create 5 more → re-enable network
- Expected: Firestore offline cache persists all 10 objects, syncs on reconnect. Yellow banner shown during offline.
- Pass Criteria: All objects appear after reconnect

**Test 4: Rapid Drag Operations**
- Setup: 2 users dragging different objects simultaneously
- Action: Each user drags 10 objects in quick succession
- Expected: Smooth dragging, no jitter, positions sync correctly
- Pass Criteria: 60 FPS maintained, <100ms sync latency

**Test 5: Cursor Sync Performance**
- Setup: 2 users moving cursors rapidly
- Action: Move cursor in circles/figure-8 patterns
- Expected: Remote cursor follows smoothly, no lag
- Pass Criteria: <50ms latency, 30 Hz update rate

**Test 6: Soft Locking**
- Setup: 2 users, same board
- Action: User A starts dragging an object. User B attempts to drag the same object.
- Expected: User B sees lock indicator. Object does not respond to User B's drag.
- Pass Criteria: Lock acquired/released cleanly. Lock auto-releases on disconnect.

### 16.2 AI Agent Tests

**Test 7: Basic Creation Commands**
- Input: "Create a yellow sticky note that says 'User Research'"
- Expected: Sticky note created with exact text and color, sparkle badge visible
- Pass Criteria: Correct object type, position in viewport, accurate text

**Test 8: Multi-Step Layout Commands**
- Input: "Create a 2x3 grid of sticky notes for a SWOT analysis"
- Expected: 6 sticky notes arranged in grid (snapped to 20px grid)
- Pass Criteria: Correct layout, consistent spacing, appropriate labels

**Test 9: Red Team Analysis**
- Setup: Board with 3-4 sticky notes describing a product strategy
- Input: "Red team this strategy"
- Expected: Empty frame with spinner → critique notes fill in → connectors link to originals
- Pass Criteria: Specific critiques, correct connector targets, severity indicators, AI badges

**Test 10: Decision Mapping**
- Input: "Map the decision: should we expand to Europe?"
- Expected: Options matrix with 3-4 options, 4-5 criteria, scored evaluations
- Pass Criteria: Correct framework structure, scores with rationales, color-coded cells

**Test 11: Find Gaps**
- Setup: Board with incomplete strategy (mentions "pricing" but no details)
- Input: "Find gaps in this board"
- Expected: Gap flags identifying missing content
- Pass Criteria: Accurate gap identification, flags positioned near related content

**Test 12: AI Rollback on Error**
- Setup: Simulate API failure mid-analysis (e.g., network timeout after 3 objects created)
- Expected: All partially created objects are deleted. Error toast shown.
- Pass Criteria: Board state is clean — no orphaned AI objects

**Test 13: AI Undo**
- Setup: Run a Red Team analysis that creates 8 objects
- Action: Click "Undo AI Analysis" or press Ctrl+Z
- Expected: All 8 objects removed. Board returns to pre-analysis state.
- Pass Criteria: Clean removal, no orphan connectors

**Test 14: AI Rate Limiting**
- Action: Send 21 AI commands within one hour
- Expected: 21st command rejected with message: "Rate limit reached. Try again later."
- Pass Criteria: Server-side enforcement, friendly error message

### 16.3 Access Control Tests

**Test 15: Public Board Guest Access**
- Setup: Public board, unauthenticated user opens URL
- Expected: Board visible in read-only mode. Ghost button for auth. Contextual tooltip on restricted actions.
- Pass Criteria: Board renders, no editing possible, auth flow works

**Test 16: Private Board Access Denied**
- Setup: Private board, authenticated user NOT in invitedEmails
- Expected: Access denied page/message
- Pass Criteria: No board data leaked

**Test 17: Anonymous Account Linking**
- Setup: Anonymous user creates objects, then clicks "Save to Account" and signs in with Google
- Expected: All anonymous objects retain ownership under the new authenticated account
- Pass Criteria: Seamless transition, no data loss

### 16.4 Performance Tests

**Test 18: Object Capacity**
- Action: Create 500 sticky notes using AI batch command
- Expected: 60 FPS during pan/zoom
- Pass Criteria: No frame drops, smooth interactions

**Test 19: Concurrent Users**
- Setup: 5 users on same board
- Action: All users create/move objects simultaneously
- Expected: No degradation in sync latency or FPS
- Pass Criteria: <100ms sync, 60 FPS maintained

**Test 20: Network Throttling**
- Setup: Chrome DevTools → Network tab → Fast 3G
- Action: Create objects, move cursor, issue AI commands
- Expected: Sync still works, graceful degradation
- Pass Criteria: No crashes, eventual consistency

---

## 17. Implementation Phases

### Phase 1: Foundation (Hours 0-4)
- [ ] Next.js 14 + Firebase project setup
- [ ] Next.js Middleware (/ → /dashboard redirect)
- [ ] Firebase Auth with Anonymous + Google + GitHub providers
- [ ] Auth screen UI (centered card, guest + social login)
- [ ] Realtime DB schema for cursors and presence
- [ ] Cursor sync working between 2 browsers
- **Gate:** Two users see each other's cursors in real-time

### Phase 2: Core Objects (Hours 4-12)
- [ ] Firestore schema for board objects and metadata
- [ ] Konva.js canvas with dot grid background
- [ ] Mode-based interaction system (Pan, Select, Create)
- [ ] Sticky note creation with Zustand store
- [ ] Firestore listeners for real-time sync
- [ ] Drag-and-drop with optimistic updates + soft locking
- [ ] Grid snapping (20px default, modifier key bypass)
- [ ] Test simultaneous sticky note creation
- **Gate:** Two users can create and move sticky notes simultaneously with soft locking

### Phase 3: Board Features (Hours 12-18)
- [ ] Rectangle and circle shapes
- [ ] Text editing (double-click → scale-aware textarea overlay, auto-resize height)
- [ ] Selection system (Select mode, Ctrl+Click multi-select, drag rectangle)
- [ ] Color picker (dual-mode: legend palette + power mode)
- [ ] Delete with confirmation dialog (Ctrl+Delete bypass)
- [ ] Copy/paste (Ctrl+C/V/D)
- [ ] Frames (auto-nest, deframe all, context menu actions)
- [ ] Connectors (edge-to-edge, drag from edge handles, auto-delete on orphan)
- [ ] Color Legend canvas object
- [ ] Top-centered floating toolbar
- **Gate:** Full CRUD operations work for all object types, multi-select functional

### Phase 4: AI Integration (Hours 18-24)
- [ ] Vercel AI SDK + Claude Sonnet 4.5 setup
- [ ] Server-side Firebase token validation on API route
- [ ] AI context serialization (viewport-only, nested JSON with rel_pos)
- [ ] Base manipulation tools (create, move, delete)
- [ ] Progressive skeleton (empty frame + spinner) for analysis output
- [ ] AI Thinking Avatar (draggable placement)
- [ ] Red Team Analysis tool
- [ ] Decision Mapping tool
- [ ] Find Gaps tool
- [ ] Collapsible AI sidebar with chat-style messages
- [ ] Persona toggle in sidebar
- [ ] AI rate limiting (per-user + per-board)
- [ ] AI rollback on error
- [ ] AI undo (single level)
- [ ] AI attribution badges (sparkle icon)
- **Gate:** AI executes 6+ command types including all 3 analytical modes

### Phase 5: Polish & Deployment (Hours 24-30)
- [ ] Dashboard with card grid layout
- [ ] Board creation modal + title editing
- [ ] Board join field (URL or ID)
- [ ] Share modal (public/private toggle, invite by email, contacts quick-invite)
- [ ] Contacts list (auto-persist collaborators)
- [ ] Board deletion (hard delete with confirmation)
- [ ] Presence indicators (avatar stack with overflow)
- [ ] Zoom controls (bottom-left)
- [ ] Offline banner notification
- [ ] Mobile blocking message
- [ ] 5-step interactive tutorial
- [ ] Guest session banner with account linking
- [ ] AI-augmented board summaries (Summarize Board button)
- [ ] Loading states and error handling
- [ ] Deploy to Vercel
- [ ] End-to-end testing with 5 concurrent users
- [ ] Voice-to-Visual integration (optional)

---

## 18. Success Criteria

### MVP Requirements (24-Hour Gate)
- [ ] Infinite board with pan/zoom (60 FPS) and dot grid
- [ ] Mode-based interaction (Pan, Select, Create)
- [ ] Sticky notes with editable text (auto-resize height)
- [ ] At least one shape type (rectangle)
- [ ] Create, move, edit, and delete objects
- [ ] Grid snapping (20px default)
- [ ] Real-time sync between 2+ users (<100ms)
- [ ] Soft locking for drag conflicts
- [ ] Multiplayer cursors with name labels (<50ms)
- [ ] Presence awareness (who's online)
- [ ] User authentication (Anonymous + Google OAuth)
- [ ] Board visibility (public by default)
- [ ] Deployed and publicly accessible

### Full Feature Set (Day 4-7)
- [ ] All MVP requirements passed
- [ ] Multi-select (Ctrl+Click + drag rectangle)
- [ ] Copy/paste/duplicate
- [ ] Frames with auto-nest and deframe
- [ ] Connectors (edge-to-edge, drag from handles)
- [ ] Color Legend canvas object
- [ ] AI agent executes 6+ command types
- [ ] Red Team Analysis (progressive skeleton, critique frames with connectors)
- [ ] Decision Mapping (options matrix or tradeoff analysis)
- [ ] Find the Gaps (logical consistency checking)
- [ ] AI sidebar with chat messages and persona toggle
- [ ] AI rate limiting (20/user/hr, 50/board/day)
- [ ] AI rollback on error + AI undo
- [ ] Dashboard with board cards, search, join field
- [ ] Share modal with public/private toggle + invite by email
- [ ] Contacts list
- [ ] 5-step interactive tutorial
- [ ] Guest session with account linking
- [ ] Voice-to-Visual (optional)
- [ ] Performance targets met (500+ objects, 5+ users)

### Demo Quality
- [ ] 3-5 minute demo video recorded
- [ ] Real-time collaboration demonstrated
- [ ] All 3 AI analytical modes shown
- [ ] Architecture explanation included
- [ ] Social post published (X or LinkedIn)

---

## 19. Known Limitations & Trade-offs

### Accepted Trade-offs
1. **Last-Write-Wins Conflict Resolution:** Simultaneous edits to the same object's text result in one winning. Soft locking prevents drag conflicts but not text edit conflicts. No operational transforms or CRDTs (out of MVP scope).

2. **Firestore Vendor Lock-In:** Heavily dependent on Firebase. Migration would require significant refactoring. Accepted for speed-to-MVP.

3. **Cursor Sync Costs:** Realtime DB bandwidth scales linearly with users. Mitigated by 30 Hz throttling + distance threshold, but still expensive at scale.

4. **AI Token Costs:** Grows with board complexity. Viewport-only context helps, but large viewports still expensive. Rate limiting provides a cost ceiling.

5. **Viewport-Only AI Context:** AI cannot reason about off-screen objects. May miss connections between visible and non-visible content. Accepted for token cost control.

6. **Single-Level AI Undo:** Only undoes the last AI command. Cannot undo user actions or earlier AI commands. Full undo/redo is post-MVP.

7. **No Minimap:** Users on large boards must manually pan to find content. Mitigated by the AI "Jump to analysis" toast notification.

8. **Light Mode Only:** No dark mode. Reduces design/testing scope.

### Not Implemented (Out of Scope)
- Full undo/redo (beyond AI undo)
- Multiplayer consensus undo
- Export to PDF/PNG
- Commenting system
- Granular permissions (editor vs viewer roles)
- Real-time text editing with field-level merge
- Mobile touch gestures
- Offline mode (beyond Firestore cache)
- Minimap
- Dark mode
- Board archiving
- Workspace/folder hierarchy
- Automated email notifications for invites

---

## 20. Decision Log (Interview Results)

This section documents all design decisions made during the specification interview.

| # | Topic | Decision | Rationale |
|---|-------|----------|-----------|
| 1 | Board access model | Hybrid link-sharing (public default, toggleable private) | Satisfies "publicly accessible" rubric requirement while providing AI cost control foundation |
| 2 | AI object rendering | Progressive skeleton (empty frame + spinner, objects fill in) | Provides perceived responsiveness without partial layout flicker |
| 3 | Board entry point | Dashboard with card grid | Standard SaaS pattern, board management hub |
| 4 | Drag conflicts | Soft locking via RTDB with onDisconnect cleanup | Prevents jarring teleportation, auto-recovers from crashes |
| 5 | Share mechanics | Same URL, toggle visibility | Simpler implementation, less user confusion about which URL to share |
| 6 | Lock lifecycle | RTDB with onDisconnect | Leverages existing RTDB infra, handles crash recovery automatically |
| 7 | Dashboard cards | AI-augmented metadata (tag chips + executive summary on hover) | Progressive disclosure keeps dashboard clean while surfacing AI "lore" |
| 8 | Connectors | Edge-to-edge (nearest point) | Most natural visual, requires intersection math but avoids lines through objects |
| 9 | Text editing | Scale-aware HTML overlay (rotation ignored) | Handles 90% of cases, avoids complex CSS transform math |
| 10 | AI chat UI | Collapsible right sidebar with chat messages | Supports conversation history, persona toggle always visible |
| 11 | AI attribution | Subtle sparkle icon badge | Non-intrusive, always visible, builds trust |
| 12 | Frame nesting | Auto-nest on 50% overlap + Deframe All (context menu) | Intuitive drag behavior with escape hatch |
| 13 | AI context pruning | Viewport-only objects | Token-efficient, user sees what AI analyzes |
| 14 | Undo/redo | AI-undo only for MVP (single level) | Pragmatic scope control; full undo is post-MVP |
| 15 | AI placement | Below selection + draggable AI Avatar + toast notification | Maximum user control without auto-panning disruption |
| 16 | Z-index | Timestamp-based (createdAt ms) | Collision-resistant, simple, leverages existing data |
| 17 | Color system | Shared Color Legend (canvas object) + dual-mode picker | Strategic color semantics visible to all; power mode for advanced users |
| 18 | AI lore updates | Manual "Summarize Board" trigger | Controls AI costs, user-initiated only |
| 19 | Keyboard shortcuts | Minimal tool switching (1-5) + AI slash commands (/r, /d, /g) | Low learning curve with power-user AI shortcuts |
| 20 | Board lifecycle | Hard delete, title editable inline | Simple, no archive complexity |
| 21 | Guest access | Read-only preview → auth → full refresh with viewport encoding in URL | Frictionless preview with secure auth transition |
| 22 | Delete confirmation | Always confirm by default; Ctrl+Delete bypasses | Protects group content while enabling power-user speed |
| 23 | URL structure | /board/[random-id] | No information leakage, simple routing |
| 24 | AI rate limits | 20/user/hour + 50/board/day | Generous for serious work, prevents abuse on public boards |
| 25 | AI chat history | Rolling window (last 5 pairs) | Enables follow-ups without persistent storage costs |
| 26 | Board loading | All objects at once | Simple implementation, acceptable for target board sizes |
| 27 | Theme | Light mode only | Reduces design scope for 7-day sprint |
| 28 | Presence UI | Avatar stack with +N overflow | Scalable, standard pattern |
| 29 | Minimap | No minimap | Simplicity; "Jump to" toast covers main navigation need |
| 30 | AI serialization | Nested JSON with frame grouping + rel_pos | Both global and local context for AI; integer coords save tokens |
| 31 | Object size limits | Moderate type-specific (Sticky: 80-600, Shape: 20-800, Frame: 150-4000) | Prevents extremes while allowing large strategic layouts |
| 32 | Zoom bounds | 5% to 500% | Wide range for massive boards and detail work |
| 33 | Privacy toggle | Share button + modal | Groups all sharing controls; intentional action required |
| 34 | Tutorial | 5-step interactive tour (create, edit, drag, AI sidebar, run analysis) | Covers core loop, skippable |
| 35 | AI response format | Chat-style messages in sidebar | Explains what AI did, supports follow-up conversation |
| 36 | Mobile | Desktop-only, block with message | No mobile optimization for 7-day sprint |
| 37 | Multi-select | Ctrl+Click + drag rectangle (MVP) | Dependency for bulk AI tools and spatial transforms |
| 38 | Orphan connectors | Auto-delete when endpoint deleted | Clean board, no broken visuals |
| 39 | Color legend storage | Canvas object (special board object) | Visible, positionable, AI-referenceable |
| 40 | Dashboard layout | Responsive card grid | Standard, effective, scales with board count |
| 41 | Object creation | Click tool → click canvas (sticky tool mode, Escape to exit) | Fast repeated placement, clear mode indicator |
| 42 | Copy/paste | In MVP (Ctrl+C/V/D) | Multi-select makes this natural to include |
| 43 | Sidebar layout | Push canvas (resize) | No content hidden, clean separation |
| 44 | Toolbar position | Top-centered floating bar | Modern, minimal, doesn't compete with content |
| 45 | Board join | Full URL or ID accepted | Forgiving input, auto-parses URLs |
| 46 | Offline indicator | Yellow banner notification | Clear, non-alarming, dismissible |
| 47 | Grid style | Dot grid (20px intervals) | Clean, minimal, modern |
| 48 | Grid snapping | 20px default, Cmd/Ctrl to bypass | Ensures alignment while allowing organic positioning |
| 49 | Browser support | All modern (Chrome, Firefox, Safari, Edge) | Widest reach with graceful degradation for voice feature |
| 50 | API auth | Server-side Firebase token validation | Secure against direct API exploitation |
| 51 | Anonymous auth | Firebase Anonymous + display name entry + account linking | Low-friction guest access with upgrade path |
| 52 | Board default | Always public (isPublic: true) | Matches collaboration-first vision |
| 53 | Invite system | Email whitelist, no automated notifications, manual URL sharing | Bulletproof access control tied to verified identity |
| 54 | Contacts | Auto-persist authenticated collaborators, dashboard + Share modal | Quick re-invite for returning collaborators |
| 55 | Frame actions | Right-click context menu (Deframe All, Add to Frame) | Standard discoverable pattern |
| 56 | Board title | Set on creation modal, edit inline in top bar | Clear creation flow with easy renaming |
| 57 | Mode system | Three modes (Pan default, Select, Create) with Escape reset | Clear interaction model, prevents accidental actions |
| 58 | Cursor feedback | Cursor changes per mode + toolbar highlight | Double visual feedback for mode awareness |
| 59 | AI error handling | Full rollback of partial objects | Clean board state guaranteed on failure |