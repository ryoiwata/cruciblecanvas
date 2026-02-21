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
- State: Zustand v5 (lightweight global state)
- Styling: TailwindCSS
- Language: TypeScript (strict mode)

**Backend**
- Database (Persistent): Firebase Firestore
- Database (Ephemeral): Firebase Realtime Database
- Auth: Firebase Auth (Anonymous + Google + GitHub OAuth)
- Deployment: Vercel
- Functions: Vercel API Routes (Node.js runtime — **not** Edge, required for OpenTelemetry)

**AI Layer**
- LLM: Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`)
- SDK: `ai` v6 (Vercel AI SDK v4 family) + `@ai-sdk/anthropic`
  - Tool schema: `inputSchema: zodSchema(z.object({...}))` (**not** `parameters`)
  - Step limiting: `stopWhen: stepCountIs(15)` (**not** `maxSteps`)
  - Streaming: `toTextStreamResponse()` (**not** `toDataStreamResponse()`)
- Pattern: Agentic tool-calling with multi-step execution

**Observability**
- Platform: Langfuse (traces, cost tracking)
- Protocol: OpenTelemetry — initialized in `src/instrumentation.ts` via `@langfuse/otel` + `@opentelemetry/sdk-node`
- Next.js hook: `experimental: { instrumentationHook: true }` in `next.config.mjs`
- AI route uses `experimental_telemetry: { isEnabled: true }` on `streamText` calls

**Development Tools**
- AI Assistants: Claude Code, Cursor
- Version Control: Git + GitHub
- Testing: Manual multi-browser (Chrome DevTools); Playwright for E2E; Vitest for unit

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
│  ├─ Real-time Listeners (Firestore + RTDB)                  │
│  └─ Observability (Langfuse via OpenTelemetry)              │
└──────────────────┬──────────────────────────────────────────┘
                   │
      ┌────────────┼────────────┐
      │            │            │
      ▼            ▼            ▼
┌─────────┐  ┌─────────┐  ┌──────────────┐
│Firestore│  │Realtime │  │ Vercel API   │
│ (Board  │  │   DB    │  │  Routes      │
│ Objects)│  │(Cursors │  │  (Node.js)   │
│         │  │ +Locks  │  │ +Token Auth  │
│         │  │+Streams)│  │              │
└─────────┘  └─────────┘  └──────┬───────┘
                                  │
                     ┌────────────┼────────────┐
                     ▼            ▼            ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │Anthropic │  │ Firebase │  │ Langfuse │
              │Sonnet 4.6│  │  Admin   │  │  OTel    │
              └──────────┘  └──────────┘  └──────────┘
```

---

## 3. Authentication & Access Control

### 3.1 Authentication Methods

**Anonymous Auth (Guest Session)**
- Firebase Anonymous Auth generates a persistent UID
- User is prompted for a display name (multiplayer alias) before entering a board
- A persistent slim banner at top: "Guest Session — Save to Account" with one-click account linking
- Account linking merges anonymous UID data with the authenticated account

**Social OAuth**
- Google Sign-In
- GitHub Sign-In
- Standard Firebase Auth flow with redirect

### 3.2 Next.js Middleware & Routing

**Route Structure:**
- `/` → redirects to `/dashboard`
- `/auth` → authentication screen
- `/dashboard` → board management (requires auth)
- `/board/[id]` → board workspace (access depends on board visibility)

**Performance bypass:** `NEXT_PUBLIC_PERF_BYPASS=true` skips auth guard in the board page for performance testing.

### 3.3 Board Visibility Model

**Default: Public (isPublic: true)**
- All new boards are created as public by default
- Anyone with the board URL can view and edit
- Anonymous users are prompted for a display name before participating

**Private Mode (isPublic: false)**
- Only the board owner or users in the `invitedEmails` array can access
- Access verified by matching the authenticated user's email against the whitelist
- Toggle via the Share modal

**Dual-write pattern:** When the creator toggles privacy, the component writes to both Firestore (`boards/{boardId}/metadata/config.isPublic`) and RTDB (`boards/{boardId}/privacy.isPublic`) for real-time propagation without a Firestore read.

### 3.4 Contacts List

- Auto-persists profiles of authenticated users who have collaborated on the same board
- Available in: dashboard sidebar AND the Share modal (for quick invite)
- Stored per-user in Firestore: `users/{userId}/contacts/{contactId}`

---

## 4. Data Models

### 4.1 Firestore Schema

**Collection: `boards/{boardId}/objects/{objectId}`**

```typescript
type ObjectType =
  | 'stickyNote'
  | 'rectangle'
  | 'circle'
  | 'frame'
  | 'connector'
  | 'colorLegend'
  | 'line'      // Free-form straight line (start = (x,y), direction = (width, height))
  | 'text';     // Standalone free-form text element (transparent background)

type AnalyticalRole = 'critique' | 'assumption' | 'gap_flag' | 'criterion' | 'option' | 'evaluation';
type ConnectorStyle = 'solid' | 'dashed' | 'dotted';
type StickyFontFamily = 'sans-serif' | 'handwritten' | 'monospace';
type LineEffect = 'none' | 'arrow' | 'filled-arrow' | 'open-arrow' | 'dot';
type LineType = 'straight' | 'elbow' | 'curved';
type TextAlign = 'left' | 'center' | 'right';
type TextVerticalAlign = 'top' | 'middle' | 'bottom';

interface BoardObject {
  // Core identification
  id: string;
  type: ObjectType;

  // Spatial properties
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;            // Degrees; all object Groups receive this

  // Core visual properties
  color: string;                // Fill color (hex)
  text?: string;                // Text content
  opacity?: number;             // 0–1, defaults to 1
  zIndex?: number;              // Explicit layer order; higher = in front
  fontFamily?: StickyFontFamily;
  fontSize?: number;            // Canvas units; TextObject default 16
  thickness?: number;           // Stroke width in canvas units; 1–10
  borderType?: 'solid' | 'dashed' | 'dotted';

  // Extended visual properties (Properties Sidebar)
  strokeColor?: string;         // Border/stroke color distinct from fill
  textColor?: string;           // Text fill color independent of object fill
  textAlign?: TextAlign;
  textVerticalAlign?: TextVerticalAlign;
  lineType?: LineType;          // Connector/line routing style
  startEffect?: LineEffect;     // Arrow/dot at line start
  endEffect?: LineEffect;       // Arrow/dot at line end
  startEffectSize?: number;     // Scale % (default 100)
  endEffectSize?: number;       // Scale % (default 100)

  // Ownership & timestamps
  createdBy: string;
  createdAt: Timestamp | number; // number during optimistic create
  updatedAt: Timestamp | number;

  // AI attribution
  isAIGenerated?: boolean;
  aiCommandId?: string;         // Groups objects from same command (rollback)
  isAIPending?: boolean;        // true while streaming → 50% opacity

  // Relationships
  parentFrame?: string;         // ID of containing frame
  connectedTo?: string[];       // Connector endpoint object IDs

  // AI-specific metadata
  role?: AnalyticalRole;
  metadata?: {
    analysisType?: 'red_team' | 'decision_map' | 'gap_analysis';
    critiqueTarget?: string;
    severity?: 'low' | 'medium' | 'high';
    decisionContext?: string;
    score?: number;
    persona?: 'skeptic' | 'investor' | 'counsel';
    connectorStyle?: ConnectorStyle; // legacy; prefer borderType
  };

  // Color Legend specific (type: 'colorLegend')
  legendEntries?: { color: string; meaning: string }[];
}
```

**Collection: `boards/{boardId}/metadata`**

```typescript
interface BoardMetadata {
  title: string;
  createdAt: Timestamp;
  createdBy: string;

  // Visibility & access
  isPublic: boolean;            // Default: true
  invitedEmails: string[];

  // AI configuration
  aiPersona: 'mason' | 'neutral' | 'skeptical_investor' | 'opposing_counsel';

  // Rate limiting
  aiCommandsToday: number;
  aiCommandsResetAt: Timestamp;

  // Analysis history
  analysisHistory: AnalysisRecord[];

  // AI-extracted board context (sidecar)
  boardContext?: {
    mainTopics: string[];
    openQuestions: string[];
    keyDecisions: string[];
    executiveSummary: string;
    lastAnalyzed: Timestamp;
  };
}
```

**Collection: `users/{userId}/profile`**

```typescript
interface UserProfile {
  displayName: string;
  email?: string;
  photoURL?: string;
  isAnonymous: boolean;
  createdAt: Timestamp;
}
```

### 4.2 Realtime Database Schema

**Path: `/boards/{boardId}/cursors/{userId}`** — Live cursor position, name, color

**Path: `/boards/{boardId}/presence/{userId}`** — Online status, name, lastSeen

**Path: `/boards/{boardId}/locks/{objectId}`** — Soft object locks with `onDisconnect` cleanup

**Path: `/boards/{boardId}/privacy`** — Mirrors `isPublic` from Firestore for real-time access gating

**Path: `/boards/{boardId}/aiStreams/{commandId}`** — Streaming AI response text for live chat display

---

## 5. Core Features

### 5.1 Infinite Canvas

- **Pan:** Default interaction mode — click and drag to move viewport (stage.x / stage.y)
- **Zoom:** Mouse wheel (center on cursor position); range 5% (0.05x) to 500% (5.0x)
- **Dot grid:** Infinite repeating dots at 20px intervals, static layer (no event listeners)
- **Viewport culling:** R-tree spatial index (`rbush` library) for O(log N + k) object visibility queries. Visible objects updated via RAF-throttled viewport subscriber.
- **LOD rendering:** Objects below `LOD_SIMPLE_THRESHOLD = 0.15` zoom render in simplified form (`isSimpleLod` prop) — outlines only, no text, no event handlers.
- **Canvas sizing:** `containerRef` + `ResizeObserver` — Stage auto-resizes when PropertiesSidebar or ChatSidebar opens/closes (no `window.innerWidth` reads).
- **Performance bypass:** `data-testid="canvas-ready"` on wrapper div for test targeting.

### 5.2 Mode-Based Interaction System

The canvas operates in named modes stored in `canvasStore.mode`:

#### Pointer Mode (Default)
- **Activation:** `Escape` key, tool buttons, or after create completes
- **Behavior:** Click to select objects. Ctrl/Cmd+Click to multi-select. Drag empty canvas = marquee selection rectangle (AABB hit-test on release). Drag object = move.
- **Sub-modes (pointer only):**
  - **Marquee Mode** (`isMarqueeMode`): Activated via Marquee chip in toolbar. Drag always draws selection rectangle without needing Ctrl. Clicking empty canvas exits the mode.
  - **Multi-Select Mode** (`isMultiSelectMode`): Activated via Multi-sel chip. Every object click toggles selection (no Ctrl needed). Clicking empty canvas exits. Mutually exclusive with Marquee Mode.

#### Pan Mode
- **Activation:** Hand/pan tool in toolbar
- **Behavior:** Click-and-drag moves the viewport. No object interaction.

#### Create Mode
- **Activation:** Click a creation tool (Sticky Note, Rectangle, Circle, Frame, Line, Text)
- **Behavior:** Click on canvas to place object at default size. Tool stays active for repeated placement. Objects snap to 20px grid.
- **Exit:** Escape → returns to Pointer Mode

### 5.3 Board Objects

#### Sticky Notes
- Default: 200×150px; min 80×60px; max 600×600px
- Double-click to edit via scale-aware HTML textarea overlay (hidden when not editing to prevent double-text)
- Auto-resize height to fit content
- Auto-resize when font size or family changes
- Colors: Yellow (#FEFF9C), Pink (#FF7EB9), Cyan (#7AFCFF), Mint (#98FF98), Plum (#DDA0DD), Coral (#FFAB91)
- Lines rendered inside to give notepad appearance
- Pressing a character key while a sticky note is selected enters edit mode with that character pre-filled

#### Shapes (Rectangle, Circle)
- Default: 100×100px; min 20×20px; max 800×800px
- Separate fill color and stroke color
- Border style: solid, dashed, dotted
- Resizable via Transformer handles

#### Frames
- Visual container for grouping objects; title bar (40px height)
- Semi-transparent background; border scales with zoom
- Auto-nesting: Objects with >50% overlap automatically set `parentFrame`
- Moving frame moves all children (spatially locked children)
- Children rendered above frame (zIndex bump on nesting)
- **Deframe:** Right-click child → "Deframe" removes `parentFrame`; right-click frame → "Deframe All" severs all relationships

#### Connectors
- Start/end object IDs in `connectedTo`; edge-to-edge (nearest point)
- Endpoints update in real-time when objects drag
- Connector anchor dots shown on hover, scale with zoom
- Styles: solid, dashed, dotted; start/end effects (arrows, dots)
- Orphan cleanup: Deleted when either endpoint object is deleted
- Click connector object to select and drag it

#### Lines (Free-form)
- Type `line`; start = (x, y), direction vector = (width, height) — both can be negative
- Wide invisible hit area (12px stroke) for easy clicking on thin lines
- Thickness and border style configurable

#### Text (Standalone)
- Type `text`; transparent background — text only
- Double-click to edit via TextEditor overlay
- Auto-delete if text is empty after editing
- Defaults to black, larger font than sticky notes
- Transparent hit rect for clickability

#### Color Legend (Special Canvas Object)
- Type `colorLegend`; positionable and resizable like any other object
- Displays shared color-to-meaning mapping
- Editable by any user — syncs in real-time
- AI can reference the legend when placing objects

### 5.4 Grid Snapping

- Objects snap to 20px grid intersections during drag and creation
- Hold **Cmd/Ctrl** to bypass for free-form positioning

### 5.5 Selection & Manipulation

**Selection:**
- Single-click: Select object (show Transformer handles)
- Ctrl/Cmd/Shift+Click: Add/remove from multi-selection
- Drag empty canvas: Draw AABB selection rectangle → selects all objects within bounds
- Right-click object: Auto-selects it if not already in current selection
- **Marquee Mode toggle:** Drag always draws selection rect (no modifier needed)
- **Multi-Select Mode toggle:** Every click toggles without Ctrl; click empty canvas to exit

**Operations:**
- **Move:** Drag selected objects
- **Resize:** Transformer handles (8 anchors) — group resize supported for multi-select
- **Rotate:** Rotation handle on Transformer — saved as `rotation` field; group rotation supported
- **Delete:** `Delete`/`Backspace` → confirmation dialog; `Ctrl+Delete` bypasses confirmation
- **Duplicate:** `Ctrl+D` → +20px diagonal offset; parent frame reference cleared
- **Copy:** `Ctrl+C` or right-click → "Copy" / "Copy Group" in context menu
- **Paste via `Ctrl+V`:** Cascading diagonal offset — first paste at +20px, second at +40px, etc. (`pasteCount` resets on new copy)
- **Paste via right-click:** Cursor-position paste. Top-left corner of the pasted group aligns to the canvas coordinates at the right-click cursor position. Coordinate conversion uses `getBoundingClientRect()` on the Konva canvas element to account for header heights and sidebar widths.
- **Undo/Redo:** `Ctrl+Z` / `Ctrl+Shift+Z`; implemented in objectStore snapshot history; also undoes AI commands
- **Layer ordering:** `Ctrl+]` (forward), `Ctrl+Shift+]` (front), `Ctrl+[` (back), `Ctrl+Shift+[` (back)
- **Deframe:** Right-click child object → "Deframe" in context menu

**Visual Feedback:**
- Selection border: 2px solid #2196F3
- Transformer handles: 8 resize anchors + rotation handle
- Frame capture glow: Frame glows brand-purple when dragging an object over it (`frameDragHighlightId` in canvasStore)
- Parent frame indicator: Purple stroke on framed children

### 5.6 Context Menu

Right-click on any object or empty canvas to open context menu. Menu items are context-sensitive:

**Single object selected:**
- Copy, Duplicate
- Edit (text objects)
- Deframe (objects with `parentFrame`)
- Bring to Front / Send to Back / Bring Forward / Send Backward
- Add to Frame (when object is near a frame)
- Delete

**Multiple objects selected (group):**
- Copy Group, Duplicate Group
- Align submenu (Left, Right, Top, Bottom, Center H, Center V)
- Delete Group

**Empty canvas:**
- Paste (at cursor canvas coordinates)
- Create Sticky Note (at cursor canvas coordinates)
- Create Shape (at cursor canvas coordinates)

**Coordinate conversion for canvas paste/create:**
```typescript
// clientToCanvas: converts viewport clientX/Y → canvas world coordinates
const stageEl = document.querySelector('[data-testid="canvas-ready"] canvas');
const rect = stageEl.getBoundingClientRect();
const { stageX, stageY, stageScale } = useCanvasStore.getState();
return {
  x: (clientX - rect.left - stageX) / stageScale,
  y: (clientY - rect.top - stageY) / stageScale,
};
```

### 5.7 Real-Time Collaboration

#### Multiplayer Cursors
- Update rate: 30 Hz (33ms throttle); minimum 5px movement to send
- Display: Circle + name label; color generated from user ID hash
- Cleanup: onDisconnect() removes cursor record automatically

#### Object Synchronization
- **Pattern:** Optimistic updates + Firestore listeners
- **Conflict resolution:** Last-write-wins (Firestore server timestamp)
- **Latency target:** <100ms from action to remote render

#### Soft Locking
- Lock acquired in RTDB at `/boards/{boardId}/locks/{objectId}` when drag starts
- Other users see visual lock indicator; object is non-draggable
- `onDisconnect()` auto-releases on disconnect/crash
- Released on `dragend`

#### Presence System
- Avatar stack in top-right (overlapping circles, "+N" overflow)
- Offline threshold: 30 seconds inactivity
- Anonymous users shown with display name and generated avatar color

### 5.8 Offline State Handling

- **Detection:** Firebase connection state listener
- **Visual indicator:** Yellow banner: "You are offline. Changes will sync when reconnected."
- **Behavior:** Firestore offline persistence (IndexedDB) handles queued writes

---

## 6. UI Design System

### 6.1 Design Language

- **Theme:** Light mode only
- **Brand color:** `#6366f1` (vibrant purple) for primary actions and accents
- **Border radius:** 8px on floating panels, cards, modals
- **Shadows:** Subtle drop shadows on floating elements
- **Typography:** System sans-serif font stack
- **Canvas background:** White with dot grid pattern (20px intervals)

### 6.2 Workspace Layout

The workspace uses a **two-tier header** layout (BioRender-style) with fixed heights and flex siblings for sidebars:

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Guest Session Banner — slim, conditionally shown]                 │
├──────────────────────────────────────── TopHeader h-12 ────────────┤
│ [≡] [CrucibleCanvas title (inline, editable)] │ [Presence] [👁] [Share] [Chat] [Dashboard] [Log Off] │
├─────────────────────────────────────── SubHeader h-11 ─────────────┤
│ [↩Undo] [↪Redo] │ [↖Pointer] [Lines▾] [Shapes▾] [T Text] [📝Sticky] │ [Align▾] [Arrange▾] │ [⬚Marq] [⊕Multi-sel] [⊞All] [⎘Copy] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│ ┌─PropertiesSidebar─┐  ┌──────── Infinite Canvas ──────┐  ┌─Chat──┐ │
│ │ w-72 (collapsible)│  │  (Dot Grid)                   │  │sidebar│ │
│ │ [Shape Module]    │  │  [Objects, Cursors, Selection] │  │ w-80  │ │
│ │ [Text Module]     │  │                               │  │       │ │
│ │ [Frame Module]    │  │                               │  │       │ │
│ │ [Line Module]     │  │                               │  │       │ │
│ │ [Sticky Module]   │  │                               │  │       │ │
│ └───────────────────┘  └───────────────────────────────┘  └───────┘ │
│                                                                       │
│ [Cursor coords bottom-left]    [Zoom %]                              │
└──────────────────────────────────────────────────────────────────────┘
```

**Flex layout:**
- Root: `flex flex-col h-screen`
- Headers: `h-12` (TopHeader) + `h-11` (SubHeaderToolbar)
- Work area: `flex flex-1` — PropertiesSidebar (left) + Canvas (flex-1) + ChatSidebar (right)

### 6.3 TopHeader

Located at `src/components/canvas/` (board page top-level).

**Contents (left to right):**
- Hamburger/brand icon
- `CanvasTitle` — inline editable board title (`inline={true}` prop; no fixed positioning)
- Spacer
- `PresenceIndicator` — avatar stack
- `PrivacyToggle` — emoji pill (👀 public / 🥸 private)
- `ShareButton`
- Chat toggle (💬 Chat)
- Dashboard link
- Log Off

### 6.4 SubHeaderToolbar

Located at `src/components/ui/SubHeaderToolbar.tsx`.

**Sections (left to right):**
1. **Undo / Redo** — buttons hooked to `objectStore` snapshot history
2. **Separator**
3. **Tool buttons** — each is a vertical `ToolButton` (icon + label + optional `kbd`):
   - Pointer (↖, shortcut `1`)
   - Lines dropdown (Line `\`, Connector `⌇`)
   - Shapes dropdown (Rectangle `□`, Circle `○`, Frame `⊞`)
   - Text (`T`, shortcut `T`)
   - Sticky Note (📝, shortcut `S`)
4. **Separator**
5. **AlignMenu** — pops up alignment grid
6. **ArrangeMenu** — pops up layer ordering controls
7. **Separator**
8. **Shortcut chips** — vertical layout matching ToolButton style (icon + label + `kbd`), with `isActive` state:
   - Marquee (⬚, `isActive = isMarqueeMode`) — toggles `isMarqueeMode`
   - Multi-sel (⊕, `isActive = isMultiSelectMode`) — toggles `isMultiSelectMode`
   - Select All (⊞)
   - Copy (⎘)

Container has `overflow-x-auto` for small-window scrolling.

**`ShortcutChip` component:** Vertical `flex flex-col items-center justify-center h-14 w-14 gap-0.5 rounded-md`. When `isActive`: `bg-indigo-50 text-indigo-600`.

### 6.5 Properties Sidebar

Located at `src/components/properties/`.

**Layout:** Left flex sibling in work area. `w-72` when open, `w-0` when closed. Opened/closed by a toggle button.

**Modules** (context-sensitive to selected object type):
- `ShapeModule` — fill color, stroke color, border style, border thickness, opacity
- `TextModule` — font family, font size, text color, text align, opacity
- `FrameModule` — fill color, stroke color, border style, frame title, opacity
- `StickyNoteModule` — fill color, font family, font size, text align, opacity
- `LineModule` — stroke color, line thickness, border type, start/end effects, line type

**Common controls:**
- `ColorRow` — hex color input + color picker popup
- `SliderRow` — labeled range slider
- `DropdownRow` — labeled select
- `AlignButtonGroup` — text alignment toggle

**DimensionModule:** Shows and edits `width` × `height` for the selected object.

**PresetsSection:** Color palette presets (6 pastels, expandable to 18).

**RecentColorsSection:** Up to 12 most recently used colors across all tool types.

### 6.6 Chat Sidebar (AI + Group Chat)

Located at `src/components/chat/`.

**Position:** Right flex sibling. Collapsible. Pushing canvas (Stage resizes via ResizeObserver).

**Components:**
- `ChatSidebar` — top-level container
- `PersonaSelector` — dropdown; Mason listed first as "⚙ The Mason"
- `ChatTimeline` — unified message list (no mode filtering; renders all messages)
- `ChatMessage` — individual message bubble
- `AIStreamMessage` — streaming AI response with live text
- `ChatInput` — inline toggle button (✨/👥) left of input switches send target between AI and group; send button color reflects target
- `ObjectRefChip` — clickable chips for referenced canvas objects
- `MessagePreview` — preview of pending message

**Chat modes:**
- `chatMode: 'ai' | 'group'` — stored in `useChatStore`; per-message send target (not a filter)
- Both AI responses and group chat appear in the same unified timeline

**Keyboard shortcut:** `/` opens the sidebar and focuses input (skips if editing text)

**Clarification pending state:**
- Amber pulsing dot (animate-ping) on chat toggle button when `clarificationPending`
- Sidebar header shows "Waiting for your input..." amber status text

### 6.7 Share Modal

Triggered by "Share" button in TopHeader.

**Contents:**
- Public/Private toggle (confirmation dialog on switch)
- Board URL with "Copy Link" button
- Invite section (private): email input + "Add"; list of invited emails with remove
- Contacts quick-invite: past collaborators for one-click invite

### 6.8 Presence Indicators

- **Location:** TopHeader right side
- **Format:** Overlapping avatar circles (3-4 visible) + "+N" overflow
- Anonymous users: display name with colored circle

### 6.9 Zoom & Coordinate Controls

- **Zoom display:** Bottom area of canvas; click to reset to 100%
- **Cursor coordinates:** Shown in bottom-left, updates on mouse move in canvas world space

---

## 7. Board Management (Dashboard)

### 7.1 Dashboard Layout

- **URL:** `/dashboard`
- **Layout:** Responsive card grid (3-4 cards per row desktop, 1-2 mobile)
- **Top bar:** Search bar + "Join Board" field + "New Board" button

### 7.2 Board Cards

- Board title, last modified date, public/private indicator
- AI-generated tags (3-5 chips) on explicit "Summarize Board" trigger
- Hover: 2-3 sentence executive summary
- Actions: Open, Delete (confirmation), Summarize Board

### 7.3 Board Creation

- "New Board" button → modal with title input
- Defaults: public (`isPublic: true`), empty canvas
- Navigates to `/board/[new-random-id]`

### 7.4 Board Title

- Editable inline in TopHeader (`contentEditable` or input swap)
- Changes sync to Firestore metadata immediately

### 7.5 Board Join Field

- Accepts full URL or just board ID
- Auto-parses board ID from pasted URLs
- Navigates to board on submit

### 7.6 Board Deletion

- Hard delete with confirmation
- Only board creator can delete
- Deletes all sub-collections (objects, metadata, RTDB data)

---

## 8. AI Agent Capabilities

### 8.1 Personas

The AI agent operates in one of four personas, stored in `BoardMetadata.aiPersona`:

| Persona | ID | Behavior |
|---------|-----|----------|
| The Mason | `mason` | Silent executor — tool calls only, 1-2 sentence summary response, no explanations or suggestions |
| Neutral Critic | `neutral` | Balanced strategic advisor; Socratic |
| Skeptical Investor | `skeptical_investor` | VC mindset; unit economics, market validation focus |
| Opposing Counsel | `opposing_counsel` | Adversarial lawyer; legal exposure, precedent focus |

**Mason is the default persona** (set in `chatStore.ts` persisted initial value).

**Mason-specific behavior:**
- Always calls `getBoardState` first before executing commands
- Responds with 1-2 sentence summary only; never explains or suggests
- Uses `askClarification` tool when intent is ambiguous (other personas don't have this tool)
- Output: "Clarification needed: {question}" sentinel string, parsed client-side via `/^clarification needed:/i` regex
- Tools: limited to board manipulation tools; `redTeamThis`, `mapDecision`, `findGaps` are excluded
- Non-Mason personas: analytical tools enabled; `askClarification` excluded

**Turn history for clarification:**
- When `wasPendingClarification`, last 6 AI messages are included in the `messages[]` array sent to the API route, enabling contextual follow-ups

### 8.2 AI Object Placement

**Spatial planning (`src/lib/ai/spatialPlanning.ts`) — two-pass algorithm:**

*Pass 1 — Viewport fit:*
- Scans viewport for the first clear anchor point that fits the output cluster
- Generates a sqrt(N)-column grid cluster with 200×160 cell size + 20px gap
- Frames are opaque blocks (AABB excluded from scan)
- Result: `source: 'viewport'`

*Pass 2 — Reflow (if viewport too crowded):*
- Places cluster below the lowest existing object at viewport.x left edge
- Result: `source: 'reflow'`; prompts.ts appends '[below viewport]' hint

All positions snapped to 20px grid.

### 8.3 Tool Schema

**Manipulation tools (all personas):**
```typescript
createStickyNote(text, x, y, color, fontFamily?, fontSize?)
createShape(type: 'rectangle' | 'circle', x, y, width, height, color)
createFrame(title, x, y, width, height)
createConnector(startObjectId, endObjectId, style, color, label?)
createLine(x, y, endX, endY, color, thickness?)
createTextBox(text, x, y, fontSize?, color?)
moveObject(objectId, x, y)
updateText(objectId, text)
changeColor(objectId, color)
deleteObject(objectId)
arrangeObjects(objectIds, layout: 'grid' | 'horizontal' | 'vertical', spacing)
```

**Analytical tools (non-Mason only):**
```typescript
redTeamThis(targetObjectIds, focusAreas, persona)
mapDecision(decisionStatement, frameworkType, options?, criteria?)
findGaps(scope, targetIds?, gapTypes)
```

**Context tools (all personas):**
```typescript
getBoardState() → AIBoardContext
getObjectsByFrame(frameId) → BoardObject[]
analyzeBoardSemantics() → { topics, openQuestions, themes }
```

**Mason-only tool:**
```typescript
askClarification(question: string) → { clarificationSent: true, question: string }
// Execute returns sentinel; client detects /^clarification needed:/i
```

### 8.4 AI Context Serialization

Viewport-only: only objects currently visible in the user's viewport are sent. Format: nested JSON with frame grouping, integer coordinates, `rel_pos` within frames.

### 8.5 AI Error Handling & Rollback

- If API fails mid-command: all objects from that `aiCommandId` are deleted from Firestore
- Objects tracked by `aiCommandId` field for batch rollback via `deleteObjectsByAiCommand`
- Error toast shown; board state guaranteed clean

### 8.6 AI Undo

- `Ctrl+Z` triggers objectStore snapshot rollback (not AI-specific; applies to all changes)
- AI commands also roll back via snapshot (pre-command snapshot taken before execution)

### 8.7 AI Rate Limiting

- **Per-board:** 50 commands/day tracked in `BoardMetadata.aiCommandsToday`
- Enforced server-side in the API route before calling Claude
- Rate limit check uses server timestamps, not client-supplied values

### 8.8 API Route

`src/app/api/ai-command/route.ts`

- **Runtime:** `export const runtime = 'nodejs'` (Node.js, not Edge — required for OTel NodeSDK)
- **Auth:** Firebase ID token validated via Firebase Admin SDK; 401 on missing/invalid token
- **Streaming:** `streamText` with `stopWhen: stepCountIs(15)`, `toTextStreamResponse()`
- **Telemetry:** `experimental_telemetry: { isEnabled: true }` on `streamText`
- **Tool filtering:** `MASON_EXCLUDED_TOOLS = {redTeamThis, mapDecision, findGaps}`; `NON_MASON_EXCLUDED_TOOLS = {askClarification}`

### 8.9 AI Cost Projections

| User Scale | Commands/User/Month | Monthly Cost | Assumptions |
|------------|---------------------|--------------|-------------|
| 100 users  | 5                   | ~$2.50       | 500 commands × $0.005 avg |
| 1,000 users| 5                   | ~$25         | 5K commands × $0.005 avg |
| 10,000 users| 5                  | ~$250        | viewport-only context pruning needed |
| 100,000 users| 5                 | ~$2,500      | caching layer needed |

**Cost optimization strategies:**
1. Viewport-only context (implemented)
2. Integer coordinates to save tokens (implemented)
3. Relative positions within frames (implemented)
4. Rate limiting: 50 commands/board/day (implemented, server-side)

---

## 9. Performance

### 9.1 Targets

| Metric | Target |
|--------|--------|
| Canvas FPS | 60 FPS |
| Object sync latency | <100ms |
| Cursor sync latency | <50ms |
| Initial load | <2s |
| AI first token | <3s |
| Object capacity | 500+ objects |
| Concurrent users | 5+ |

### 9.2 Implemented Optimizations

**Viewport culling (Phase 1):**
- Removed `onDragMove` handlers from ShapeObject, StickyNote, FrameObject (eliminated drag-flood re-renders)
- ConnectorObject uses narrow per-endpoint selectors (not full objects map)

**Spatial index (Phase 4):**
- `rbush` R-tree in `objectStore.ts` (`spatialIndex`, `rebuildSpatialIndex`)
- `src/types/rbush.d.ts` provides type declarations
- `BoardObjects.tsx` uses `spatialIndex.search()` for O(log N + k) culling

**LOD rendering (Phase 5):**
- `LOD_SIMPLE_THRESHOLD = 0.15` in `types.ts`
- `isSimpleLod` prop on ShapeObject, StickyNote, FrameObject, TextObject, LineObject
- LOD guard placed after all hooks but before heavy rendering

**Keyboard shortcuts (Phase 6):**
- `useKeyboardShortcuts` dep array: `[mode, editingObjectId, performDelete, boardId]`
- All reactive reads moved to `getState()` inside handlers — no re-register on selection change

**Performance testing (Phase 7):**
- `NEXT_PUBLIC_PERF_BYPASS=true` skips auth guard
- `data-testid="canvas-ready"` on Canvas wrapper for Playwright targeting
- `scripts/seed-perf-board.ts` creates 7000 objects; `npm run seed-perf`
- `tests/performance/fps-benchmark.spec.ts`; `npm run test:perf`

### 9.3 Canvas Architecture

**Layer structure:**
1. Static Layer: Dot grid background, no event listeners
2. Dynamic Layer: Board objects (draggable)
3. Cursor Layer: Remote cursors, always on top
4. Selection UI Layer: Transformer handles, selection rectangle

---

## 10. Keyboard Shortcuts

### 10.1 Tool Switching
| Shortcut | Action |
|----------|--------|
| `1` | Pointer Mode |
| `2` | Sticky Note tool |
| `3` | Rectangle tool |
| `4` | Circle tool |
| `5` | Frame tool |
| `6` | Connector tool |
| `Escape` | Return to Pointer / Deselect all |

### 10.2 Object Operations
| Shortcut | Action |
|----------|--------|
| `Delete` / `Backspace` | Delete selected (confirmation dialog) |
| `Ctrl+Delete` | Delete selected (bypass confirmation) |
| `Ctrl+C` | Copy selected objects |
| `Ctrl+V` | Paste with cascading +20px diagonal offset |
| `Ctrl+D` | Duplicate selected with +20px diagonal offset |
| `Ctrl+Z` | Undo (snapshot rollback) |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+A` | Select all objects |
| `Ctrl+]` | Bring forward one layer |
| `Ctrl+Shift+]` | Bring to front |
| `Ctrl+[` | Send backward one layer |
| `Ctrl+Shift+[` | Send to back |

### 10.3 Canvas Navigation
| Shortcut | Action |
|----------|--------|
| `Mouse Wheel` | Zoom (centered on cursor) |
| `Space + Drag` | Pan (from any mode) |
| `Cmd/Ctrl + Drag` | Bypass grid snapping |

### 10.4 AI / Chat
| Shortcut | Action |
|----------|--------|
| `/` | Open chat sidebar and focus input |

---

## 11. Source Structure

```
src/
  app/
    auth/page.tsx             # Authentication (guest, Google, GitHub)
    dashboard/page.tsx        # Board listing, creation, join
    board/[boardId]/page.tsx  # Main canvas workspace
    api/
      boards/new/route.ts     # Board creation API (auth guard)
      ai-command/route.ts     # AI streaming endpoint (Node.js runtime)
    layout.tsx                # Root layout with AuthProvider
    middleware.ts             # Routes / → /dashboard

  components/
    auth/AuthCard.tsx
    canvas/
      Canvas.tsx              # Konva Stage + all interaction handlers
      BoardObjects.tsx        # Spatial-culled object renderer
      SelectionLayer.tsx      # Transformer + selection rect
      CursorLayer.tsx         # Remote cursor rendering
      TextEditor.tsx          # HTML textarea overlay for text editing
      DotGrid.tsx             # Static dot grid background
      ShapeObject.tsx
      StickyNote.tsx
      FrameObject.tsx
      ConnectorObject.tsx
      TextObject.tsx
      ColorLegendObject.tsx
      LineObject.tsx
      AnchorPoints.tsx        # Connector drag anchor dots
      GhostPreview.tsx        # Resize ghost preview
      ResizeBorder.tsx
    chat/
      ChatSidebar.tsx
      ChatTimeline.tsx
      ChatMessage.tsx
      AIStreamMessage.tsx
      ChatInput.tsx
      PersonaSelector.tsx
      ObjectRefChip.tsx
      MessagePreview.tsx
    properties/
      PropertiesSidebar.tsx
      PresetsSection.tsx
      RecentColorsSection.tsx
      TransparencyControl.tsx
      controls/
        ColorRow.tsx
        SliderRow.tsx
        DropdownRow.tsx
        AlignButtonGroup.tsx
      modules/
        ShapeModule.tsx
        TextModule.tsx
        FrameModule.tsx
        StickyNoteModule.tsx
        LineModule.tsx
        DimensionModule.tsx
    ui/
      SubHeaderToolbar.tsx    # Two-tier header: tool buttons + shortcut chips
      AlignMenu.tsx
      ArrangeMenu.tsx
      ContextMenu.tsx         # Right-click context menu
      ColorPicker.tsx
      ColorPickerPopup.tsx
      BorderStyleMenu.tsx
      CanvasTitle.tsx         # Inline-editable board title
      PresenceIndicator.tsx
      PrivacyToggle.tsx
      ShareButton.tsx
      ShortcutLegend.tsx      # (Legacy — superseded by SubHeaderToolbar chips)
      SelectionActionBar.tsx
      SelectionCounter.tsx
      OpacityPopup.tsx
      SaveToAccountBanner.tsx
      DeleteDialog.tsx
      Toast.tsx
      Toolbar.tsx             # (Legacy floating toolbar — currently unused)

  hooks/
    useFirestoreSync.ts       # Firestore real-time object listener
    useMultiplayer.ts         # Presence init, heartbeat, reconnection
    usePresenceSync.ts        # Presence data sync (child listeners)
    useLockSync.ts            # Object lock management
    useFrameNesting.ts        # Frame auto-nesting logic
    useKeyboardShortcuts.ts   # All keyboard event handlers

  lib/
    ai/
      tools.ts                # createAITools factory (Vercel AI SDK v6)
      spatialPlanning.ts      # Two-pass viewport-fit + reflow algorithm
      prompts.ts              # MASON_SYSTEM_PROMPT, buildSystemPrompt, PERSONA_PROMPTS
    firebase/
      config.ts               # Firebase app init
      auth.ts                 # Authentication functions
      firestore.ts            # Firestore CRUD helpers
      rtdb.ts                 # RTDB presence/cursor/lock/privacy helpers
      admin.ts                # Firebase Admin SDK (server-only)
    store/
      canvasStore.ts          # UI state (mode, selection, viewport, clipboard, sub-modes)
      objectStore.ts          # Board objects, locks, spatial index, snapshot history
      authStore.ts            # User authentication state
      presenceStore.ts        # Remote user presence
      chatStore.ts            # useChatStore + usePersonaStore
    types.ts                  # All TypeScript interfaces and type aliases
    utils.ts                  # Utility functions (getStrokeDash, etc.)
    resizeState.ts            # borderResizingIds set (memo skip during resize)

  providers/
    AuthProvider.tsx          # Auth state initialization

  instrumentation.ts          # OTel init for Langfuse (Next.js hook)
  types/
    rbush.d.ts                # Type declarations for rbush v4

scripts/
  seed-perf-board.ts          # Creates 7000 objects for performance testing

tests/
  performance/
    fps-benchmark.spec.ts     # Playwright FPS benchmark
```

---

## 12. Security

### 12.1 API Route Protection

- Every request to `/api/ai-command` verified via Firebase Admin SDK ID token
- Unauthenticated requests rejected with 401
- Rate limit checks performed server-side after token validation
- AI-generated content validated for schema/length before Firestore writes

### 12.2 Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() { return request.auth != null; }
    function isOwner(boardId) {
      return get(/databases/$(database)/documents/boards/$(boardId)/metadata/config)
        .data.createdBy == request.auth.uid;
    }
    function isBoardPublic(boardId) {
      return get(/databases/$(database)/documents/boards/$(boardId)/metadata/config)
        .data.isPublic == true;
    }
    function isInvited(boardId) {
      return request.auth.token.email in
        get(/databases/$(database)/documents/boards/$(boardId)/metadata/config).data.invitedEmails;
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
      allow read: if canAccessBoard(boardId);
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

### 12.3 Realtime Database Security Rules

Collection-level `.read` for cursors/presence (allows `onChildAdded`/`onChildChanged` at collection root); per-user `.write` to prevent impersonation. RTDB includes `aiStreams` node for streaming AI responses.

---

## 13. Environment Variables

```bash
# Firebase client config (public)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=

# AI (server-only)
ANTHROPIC_API_KEY=

# Firebase Admin (server-only) — one of the two patterns:
FIREBASE_ADMIN_SERVICE_ACCOUNT=   # Full JSON string (alternative)
FIREBASE_ADMIN_CLIENT_EMAIL=      # Service account email
FIREBASE_ADMIN_PRIVATE_KEY=       # Service account private key

# Observability (server-only)
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASEURL=                 # Optional; defaults to cloud

# Development / Testing
NEXT_PUBLIC_PERF_BYPASS=true      # Skips auth guard for performance testing
```

---

## 14. Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 90+ | Full support |
| Firefox | 90+ | Full support |
| Safari | 15+ | Full support |
| Edge | 90+ | Full support (Chromium-based) |

**Mobile:** Desktop-only. `window.innerWidth < 768px` shows blocking message.

---

## 15. Deployment

**Platform:** Vercel
**Runtime note:** AI route must use `runtime = 'nodejs'` (not Edge) — OTel NodeSDK requires Node.js runtime.

**Firebase:**
- Firestore: `(default)` database, `us-central1`
- Realtime Database: `cruciblecanvas-default-rtdb`, `us-central1`
- Auth providers: Anonymous, Google, GitHub OAuth

---

## 16. Known Limitations & Trade-offs

1. **Last-Write-Wins:** Simultaneous text edits result in one winning. No OT or CRDTs.
2. **Viewport-only AI context:** AI cannot reason about off-screen objects.
3. **Light mode only:** No dark mode for MVP.
4. **Desktop-only:** No mobile touch gestures.
5. **Board-level rate limit:** 50 AI commands/day (no per-user limit currently enforced).
6. **LOD at extreme zoom-out:** Objects below 0.15× zoom render as simplified placeholders.

### Not Implemented (Out of Scope)
- Full multi-level undo/redo for all user actions (only snapshot-based, limited depth)
- Multiplayer consensus undo
- Export to PDF/PNG
- Commenting system
- Granular permissions (editor vs viewer roles)
- Mobile touch gestures
- Minimap
- Board archiving / workspace hierarchy
- Automated email notifications for invites
- Voice-to-Visual (planned optional feature)
- Interactive tutorial / onboarding overlay

---

## 17. Decision Log

| # | Topic | Decision | Rationale |
|---|-------|----------|-----------|
| 1 | Board access | Hybrid link-sharing (public default, toggleable) | Satisfies "publicly accessible" rubric + AI cost control |
| 2 | Toolbar position | **Top two-tier header** (not floating bottom) | BioRender-style; keeps tools near keyboard; canvas gets full height |
| 3 | AI SDK | `ai` v6 + `@ai-sdk/anthropic` (not legacy Vercel AI SDK) | Required for agentic multi-step tool use, `stopWhen: stepCountIs()` |
| 4 | AI model | `claude-sonnet-4-6` (not 4.5) | Best capability/cost for multi-step agentic commands |
| 5 | API runtime | Node.js (not Edge) | OTel NodeSDK requires Node.js; Edge lacks `process.env` support needed |
| 6 | Spatial index | `rbush` R-tree in objectStore | O(log N + k) culling vs O(N) linear scan; handles 1000+ objects |
| 7 | LOD threshold | 0.15 (15% zoom) | Invisible at 15% zoom; LOD removes text/interactions below this |
| 8 | Paste alignment | Top-left corner at cursor (right-click) | More intuitive than centroid placement |
| 9 | Paste offset | Cascading +20px diagonal (Ctrl+V) | Prevents stacking, shows each paste distinctly |
| 10 | Coordinate conversion | `getBoundingClientRect()` on canvas element | `stageX/Y` are pan offsets only, not screen position; headers + sidebar offset must be subtracted |
| 11 | Sub-modes | `isMarqueeMode` + `isMultiSelectMode` boolean flags | Preserves `mode === "pointer"` for drag-move logic; no new mode needed |
| 12 | Mason persona | Silent executor, first in PersonaSelector | Ops-only agent for direct board manipulation without explanation |
| 13 | Mason tools | Excludes `redTeamThis`, `mapDecision`, `findGaps` | Mason is operational only; analytical tools for human-facing personas |
| 14 | `askClarification` | Mason-only tool | Only Mason needs to confirm ambiguous intent; other personas respond verbally |
| 15 | Spatial planning | Two-pass (viewport-fit → reflow) | Maximizes visible placement; degrades gracefully to below-viewport |
| 16 | Observability | Langfuse via OTel | Traces AI calls, costs, latency without custom instrumentation |
| 17 | Drag flooding | Removed `onDragMove` from shape/sticky/frame | Prevented per-frame Zustand updates during drag; major FPS improvement |
| 18 | Sidebar layout | Flex siblings (PropertiesSidebar, Canvas, ChatSidebar) | Stage auto-resizes via ResizeObserver; no fixed positioning math |
| 19 | Turn history | Last 6 messages included when `wasPendingClarification` | Enables contextual follow-up without persistent storage |
| 20 | Dual-write privacy | Firestore + RTDB mirror | Real-time propagation without extra Firestore reads per client |
| 21 | Soft locking | RTDB with `onDisconnect` | Crash-safe; auto-releases on disconnect |
| 22 | Color semantics | Shared Color Legend canvas object | Visible to all users; AI-referenceable |
| 23 | Text editing | HTML textarea overlay (hidden Konva text while editing) | Prevents double-text render; textarea handles IME, spell-check |
| 24 | Frame nesting | Auto-nest on 50% overlap + Deframe context menu | Intuitive drag behavior with escape hatch |
| 25 | Delete confirmation | Always confirm; Ctrl+Delete bypasses | Protects group content; power-user fast path |
| 26 | Board default | Always public | Collaboration-first |
| 27 | Grid snapping | 20px default; Cmd/Ctrl to bypass | Alignment without sacrificing flexibility |
| 28 | Zoom bounds | 5%–500% | Wide range for massive boards and detail work |
| 29 | Orphan connectors | Auto-delete when endpoint deleted | Clean board; no broken visuals |
| 30 | Minimap | Not implemented | "Jump to analysis" toast covers navigation need for MVP |
