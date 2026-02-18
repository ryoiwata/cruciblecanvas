# CrucibleCanvas AI Integration Specification

## Overview

This document specifies the AI integration feature for CrucibleCanvas: a **group chat interface** with AI agent capabilities. The chat is a unified communication channel where users can message each other and invoke an AI board agent using the `@ai` prefix. The AI can create, manipulate, arrange, and analyze board objects via natural language commands.

**Rubric Targets:**
- 6+ distinct AI command types across Creation, Manipulation, Layout, and Complex categories
- Shared AI state: all users see AI-generated results in real-time
- Multiple simultaneous AI commands without conflict
- <2s response latency (time to first token in chat)
- Consistent, accurate execution

---

## 1. Chat Architecture

### 1.1 Unified Timeline

The chat is a **single, chronologically ordered timeline** containing both human group messages and AI interactions. There is no tab separation or mode toggle. The `@ai` prefix determines the message recipient:

- **Group message:** Any message that does NOT start with `@ai`. Written directly to Firestore from the client. All users see it in real-time.
- **AI command:** Any message that starts with `@ai `. Sent to the `/api/ai-command` Edge Function. The command, AI response, and all board changes are visible to all users in the group chat.

**Edge case:** If a user accidentally starts a message with `@ai` intending it for the group (e.g., "@ai is broken today"), it goes to the AI. This is an accepted edge case -- users learn quickly, and the AI will respond harmlessly.

### 1.2 Message Persistence

**All messages persist in Firestore.** Both group messages and AI command/response pairs are stored in a subcollection:

```
boards/{boardId}/messages/{messageId}
```

Messages are **capped at 500 per board** with equal weighting (group and AI messages count the same). When the cap is reached, the oldest messages are deleted on the next write. This bounds storage costs while preserving ~6 months of typical usage history.

### 1.3 Real-Time Delivery

**Group messages:** Firestore with optimistic UI. The sender's message renders locally immediately before server confirmation. Other users receive it via `onSnapshot` listener (~200-500ms).

**AI streaming responses:** The requesting user's browser receives a Server-Sent Events (SSE) stream from the API route. To relay the stream to all other connected users in real-time:

- The requesting client pushes stream chunks to **RTDB** at `boards/{boardId}/aiStreams/{commandId}`
- All other clients listen to this RTDB path for live streaming text
- When the stream completes, the final message is written to **Firestore** (persistent)
- The RTDB stream node is deleted after completion

This dual-write pattern gives sub-100ms streaming delivery to all users while maintaining Firestore as the persistent source of truth.

### 1.4 Chat Message Data Model

```typescript
interface ChatMessage {
  id: string                           // Auto-generated Firestore doc ID
  boardId: string                      // Parent board

  // Sender
  senderId: string                     // Firebase Auth UID
  senderName: string                   // Display name at time of sending
  senderPhotoURL?: string              // Avatar URL (null for anonymous)

  // Content
  type: 'group' | 'ai_command' | 'ai_response' | 'system'
  content: string                      // Message text (markdown supported for AI)

  // Object references (group messages)
  objectReferences?: {
    objectId: string                   // Referenced board object ID
    objectText: string                 // Snapshot of object text at reference time
    objectType: ObjectType             // Type at reference time
  }[]

  // AI-specific fields (type: 'ai_command' or 'ai_response')
  aiCommandId?: string                 // Groups command + response + created objects
  aiPersona?: AiPersona               // Persona used for this command
  aiStatus?: 'streaming' | 'completed' | 'failed'
  aiError?: string                     // Error message if failed

  // Timestamps
  createdAt: Timestamp                 // Server timestamp
}
```

### 1.5 RTDB AI Stream Schema

```typescript
// Path: /boards/{boardId}/aiStreams/{commandId}
interface AIStream {
  requesterId: string                  // Who initiated the command
  requesterName: string
  content: string                      // Accumulated streamed text (grows as tokens arrive)
  status: 'streaming' | 'completed' | 'failed'
  timestamp: number                    // Last update time
}
```

---

## 2. Chat UI

### 2.1 Sidebar Layout

- **Position:** Right side, collapsible
- **Width:** ~25% of screen when open (consistent with existing spec)
- **Layout behavior:** Pushes canvas (Konva Stage resizes) when opened. Smooth CSS transition.
- **Toggle button:** Fixed position on the right edge of the canvas. Shows **unread badge count** when sidebar is closed.

### 2.2 Sidebar Components (Top to Bottom)

1. **Header bar:** "Chat" title + collapse button + persona selector dropdown (per-user preference)
2. **Message timeline:** Scrollable area. Loads last 20 messages eagerly on board load (for badge count and preview). Full history loads lazily on first sidebar open. Scroll up to load older messages (Firestore pagination by timestamp).
3. **Input area:** Text input at bottom with send button.

### 2.3 Message Rendering

**Group messages (type: 'group'):**
- Sender avatar + name + timestamp
- Message text with object references rendered as clickable chips
- Current user's messages right-aligned (blue background)
- Other users' messages left-aligned (gray background)

**AI command messages (type: 'ai_command'):**
- Rendered as a user message with an `@ai` badge/prefix
- Shows the user who issued the command

**AI response messages (type: 'ai_response'):**
- Left-aligned with a distinct AI avatar (sparkle/bot icon) and "AI" name label
- Purple/indigo background to visually distinguish from human messages
- Markdown rendering for formatted responses
- **Streaming state:** Text appears token-by-token as it streams
- **Undo button:** Each completed AI response has an inline "Undo" button. Any user can click it to rollback all objects with that `aiCommandId`.
- **Failed state:** If the AI command fails mid-stream, the partial content remains visible with an error banner appended: "Command failed mid-execution. All changes rolled back."

**System messages (type: 'system'):**
- Centered, smaller text, muted color
- Used for: user join/leave, board events

### 2.4 Object References

Users can reference board objects in group messages by **clicking an object on the canvas while the chat input is focused**:

1. User focuses the chat input field (clicks into it or presses `/`)
2. User clicks a board object on the canvas
3. A reference chip is inserted into the message input: `@[Sticky: User Research]`
4. On send, the reference is stored with a snapshot of the object's text and type
5. In the rendered message, the reference appears as a clickable chip
6. Clicking the chip pans the canvas to center on the referenced object

**Dead references:** If the referenced object has been deleted, the chip renders with **strikethrough text** and a tooltip: "This object was deleted." Non-clickable.

### 2.5 Notifications (Sidebar Closed)

When the sidebar is closed and new messages arrive:

- **Badge count:** Red badge on the sidebar toggle button showing unread count
- **Brief preview:** A small floating preview of the latest message slides in from the right edge, near the sidebar toggle area. Auto-dismisses after 3 seconds. Shows sender name + first line of message.

### 2.6 Chat Focus Shortcut

Pressing `/` when not editing text on the canvas:
- Opens the sidebar if closed
- Focuses the chat input field
- Does NOT insert `/` into the input

This replaces the previous `/r`, `/d`, `/g` AI slash commands from the original spec (those are now handled via natural language with the `@ai` prefix).

### 2.7 Chat Loading Strategy

- **On board load:** Subscribe to the last 20 messages (eager). This enables badge count and preview notifications even before the sidebar is opened.
- **On first sidebar open:** Query full recent history (last 50-100 messages). The Firestore `onSnapshot` listener stays active after first open.
- **Scroll up:** Paginate older messages on demand (load 50 more per scroll).

---

## 3. AI Agent

### 3.1 SDK & API Route

**SDK:** Vercel AI SDK (`@ai-sdk/anthropic` provider) with `streamText()` and tool definitions.

**Frontend:** Uses the `useChat()` hook from `ai/react` for streaming state management, adapted to write to the unified chat timeline.

**API Route:** `/api/ai-command` (Vercel Edge Function)

```typescript
// POST /api/ai-command
// Headers: Authorization: Bearer <Firebase ID Token>
// Body: {
//   message: string,          // The user's command (without @ai prefix)
//   boardId: string,
//   boardState: AIBoardContext, // Serialized viewport + selected objects
//   selectedObjectIds: string[],
//   persona: AiPersona,
//   aiCommandId: string        // Generated client-side for tracking
// }
// Response: SSE stream (text/event-stream)
```

**Authentication:** Server-side Firebase ID token validation on every request. Unauthenticated requests rejected with 401.

**Rate limiting:** Validated server-side after token verification:
- Authenticated users: 20 AI commands/hour
- Anonymous/guest users: 5 AI commands/hour
- Per-board: 50 AI commands/day
- Group messages (non-AI): Unlimited, no rate limiting

### 3.2 AI Context Serialization

The AI receives the **requester's viewport objects plus any explicitly selected objects** (even if partially off-screen). This is serialized using the existing `AIBoardContext` format from the main spec (Section 8.6).

```typescript
interface AICommandContext {
  boardState: AIBoardContext           // Viewport objects, frames, connectors, legend
  selectedObjectIds: string[]          // User's current selection (prioritized context)
  persona: AiPersona                   // Per-user persona preference
  messageHistory: {                    // Last 5 messages for conversational context
    role: 'user' | 'assistant'
    content: string
  }[]
}
```

**Selection binding:** If the user has objects selected when sending an `@ai` command, those IDs are included as `selectedObjectIds`. The system prompt instructs the AI to prioritize these as "the objects the user is referring to." If nothing is selected, the AI infers targets from the message text and board state.

### 3.3 AI Persona (Per-User)

Each user can set their own AI persona preference. The persona is stored locally (Zustand store / localStorage) and sent with each `@ai` command. Different users on the same board can talk to different personas.

**Personas:**
- **Neutral Critic** (default): Balanced, constructive, Socratic
- **Skeptical Investor**: Direct, numbers-focused, skeptical
- **Opposing Counsel**: Adversarial but professional, evidence-focused

The persona selector is a dropdown in the sidebar header. Changes apply to the user's next `@ai` command.

### 3.4 Tool Schema

#### Base Manipulation Tools

```typescript
createStickyNote(text: string, x: number, y: number, color: string)
// Creates a sticky note. Default size 200x150. Color is hex or named color.

createShape(type: 'rectangle' | 'circle', x: number, y: number, width: number, height: number, color: string)
// Creates a shape. Server clamps to min 20x20, max 800x800.

createFrame(title: string, x: number, y: number, width: number, height: number)
// Creates a frame. Server clamps to min 150x100, max 4000x4000.

createConnector(fromObjectId: string, toObjectId: string, style: 'solid' | 'dashed' | 'dotted', color: string, label?: string)
// Creates a connector. Client computes edge-to-edge anchor points at render time. AI only specifies IDs.

moveObject(objectId: string, x: number, y: number)
// Moves an object to new coordinates. Snapped to 20px grid.

resizeObject(objectId: string, width: number, height: number)
// Resizes an object. Server applies type-specific min/max clamping:
//   Sticky notes: 80-600px
//   Shapes: 20-800px
//   Frames: 150-4000px

updateText(objectId: string, newText: string)
// Updates the text content of a sticky note or frame title.

changeColor(objectId: string, color: string)
// Changes the color of any object.

deleteObject(objectId: string)
// Deletes a single object.
```

#### Layout Tools

```typescript
arrangeInLayout(
  objectIds: string[],
  layout: 'grid' | 'horizontal' | 'vertical',
  options?: {
    columns?: number,        // For grid layout
    spacing?: number,        // Gap between objects (default 20px)
    originX?: number,        // Starting X coordinate
    originY?: number         // Starting Y coordinate
  }
)
// Server-side layout calculation.
// Grid algorithm: UNIFORM CELL SIZE.
//   - Cell width = max object width + spacing
//   - Cell height = max object height + spacing
//   - Objects centered within their cell
//   - Snapped to 20px grid
```

#### Context Tools

```typescript
getBoardState()
// Returns the current board state (AIBoardContext).
// Callable mid-response for fresh snapshot.
// The AI receives an initial snapshot with the command, but can call this
// to verify state after making changes.

getObjectsByFrame(frameId: string)
// Returns all objects with parentFrame === frameId.
```

#### Analytical Tools (from existing spec)

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

### 3.5 Tool Execution: Streaming with Soft-Commit

When the AI generates tool calls as part of its streaming response:

1. **Execute immediately** as each tool call arrives (don't wait for full response)
2. **Mark objects as pending:** Created objects are written to Firestore with `isAIPending: true`
3. **Visual state:** Pending objects render at **lower opacity** (e.g., 50%) with a subtle loading shimmer for **all users** -- signaling the AI is actively modifying the board
4. **On stream completion:** Batch-update all pending objects: set `isAIPending: false`. Objects transition to full opacity.
5. **On stream failure:** Batch-delete all objects with the command's `aiCommandId`. Error message appended to the partial AI response in chat.

This soft-commit pattern provides progressive rendering while guaranteeing clean rollback on failure.

### 3.6 Server-Side Validation

The API route applies server-side clamping for all tool calls:

```typescript
const SIZE_LIMITS: Record<string, { min: [number, number], max: [number, number] }> = {
  stickyNote: { min: [80, 60], max: [600, 600] },
  rectangle:  { min: [20, 20], max: [800, 800] },
  circle:     { min: [20, 20], max: [800, 800] },
  frame:      { min: [150, 100], max: [4000, 4000] },
}

function clampSize(type: ObjectType, width: number, height: number) {
  const limits = SIZE_LIMITS[type]
  return {
    width: Math.max(limits.min[0], Math.min(limits.max[0], width)),
    height: Math.max(limits.min[1], Math.min(limits.max[1], height)),
  }
}
```

All coordinates are snapped to the 20px grid server-side.

### 3.7 Concurrent AI Commands

Multiple users can issue `@ai` commands simultaneously. Each command:

- Gets its own **board state snapshot** at request time (requester's viewport + selection)
- Gets a unique `aiCommandId` (generated client-side, UUID)
- Executes **independently** on the API route
- Writes to Firestore independently

**Conflict resolution:** Last-write-wins at the object level (consistent with existing sync strategy). If two AI commands attempt to modify the same object, the later write wins. This is acceptable because:
- Creation commands never conflict (new objects have unique IDs)
- Layout/move commands operating on the same objects are rare
- Users see all AI activity in the group chat and can coordinate

**Chat rendering:** Multiple AI responses can stream simultaneously. Each gets its own chat bubble, stacked at the bottom of the timeline in request order. New messages always append at the bottom. Older active streams continue updating in-place.

### 3.8 AI Undo

Each AI response message in the chat includes an **inline "Undo" button**. Any user can click it.

**Behavior:**
- Queries all objects where `aiCommandId === message.aiCommandId`
- Batch-deletes them from Firestore
- Updates the AI message status to show "Undone by [username]"
- The undo button is replaced with "(Undone)" text
- Connectors with orphaned endpoints are also cleaned up

**No Ctrl+Z for AI undo.** Undo is explicit via the per-message button. This eliminates ambiguity about which command is being undone in a multi-user context.

### 3.9 AI Object Attribution

All objects created by AI have:
- `isAIGenerated: true`
- `aiCommandId: string` (links to the chat message)
- `createdBy: string` (the UID of the user who issued the `@ai` command)

Visual: Sparkle icon badge (existing implementation in `StickyNote.tsx`).

### 3.10 Offline Behavior

When the user is offline (Firebase connection lost):
- **Group messages:** Queue via Firestore offline persistence. Send on reconnect.
- **@ai commands:** **Blocked.** The `@ai` prefix is disabled with a tooltip: "AI commands require a connection." The message is not sent. Input field shows a subtle warning icon.

---

## 4. System Prompts

### 4.1 Base Context (Always Included)

```
You are an AI assistant for CrucibleCanvas, a collaborative strategic thinking whiteboard.
Multiple users may be on this board simultaneously. Your actions are visible to everyone.

Current board state:
- Total objects: ${objectCount}
- Visible objects (in requester's viewport): ${visibleCount}
- Selected objects: ${selectedCount}
- Frames: ${frameCount}
- Key topics: ${topics.join(', ')}
- Color Legend: ${colorLegend.map(e => `${e.color}=${e.meaning}`).join(', ')}

Your capabilities:
1. Create and manipulate visual objects (sticky notes, shapes, frames, connectors)
2. Arrange objects into structured layouts (grid, horizontal, vertical)
3. Analyze board content for logical consistency and gaps
4. Generate structured decision frameworks (SWOT, retrospective, pros/cons)
5. Provide critical counter-arguments and identify assumptions

Rules:
- All objects you create will be marked with an AI badge for attribution
- Snap all coordinates to 20px grid
- Keep sticky note text concise (2-3 sentences max)
- Use color semantics from the board's Color Legend when available
- Default colors: yellow=ideas, pink=critiques, green=approved, cyan=frameworks
- When the user has selected objects, prioritize those as the context for "these," "this," etc.
- If no objects are selected, infer targets from the message text and board state
```

### 4.2 Template Standards

For complex commands, use **standard labels always**:

- **SWOT Analysis:** Always use "Strengths," "Weaknesses," "Opportunities," "Threats"
- **Retrospective:** Always use "What Went Well," "What Didn't Go Well," "Action Items"
- **Pros/Cons:** Always use "Pros," "Cons"
- **User Journey Map:** Always use "Awareness," "Consideration," "Decision," "Onboarding," "Retention" (or as specified by user)

### 4.3 Persona Prompts

(Unchanged from main spec Section 8.8)

```typescript
const personas = {
  neutral: `You are a strategic advisor with no agenda or bias.
    Focus: logical consistency, evidence quality, alternative perspectives, blind spots.
    Tone: Balanced, constructive, intellectually honest, Socratic.`,

  skeptical_investor: `You are a venture capitalist who has reviewed 1,000+ pitches.
    Focus: market validation, unit economics, competitive moats, scaling risks, burn rate.
    Tone: Direct, numbers-focused, skeptical of hand-waving and unvalidated assumptions.`,

  opposing_counsel: `You are a lawyer representing the opposing side in litigation.
    Focus: legal exposure, contractual gaps, liability, regulatory compliance, precedent.
    Tone: Adversarial but professional, evidence-focused, precedent-driven.`
}
```

---

## 5. Firestore Schema Additions

### 5.1 Chat Messages Collection

```
boards/{boardId}/messages/{messageId}
```

See Section 1.4 for the `ChatMessage` interface.

**Indexes required:**
- `boardId` + `createdAt` (descending) -- for paginated message loading
- `boardId` + `aiCommandId` -- for linking AI responses to objects

### 5.2 BoardObject Additions

```typescript
// New field on BoardObject:
isAIPending?: boolean  // true while AI command is streaming. Objects render at 50% opacity.
```

### 5.3 RTDB Additions

```
boards/{boardId}/aiStreams/{commandId}  -- Live AI stream relay (deleted after completion)
```

### 5.4 Message Cap Enforcement

On each new message write, if the total message count for the board exceeds 500:
- Query the oldest message(s) beyond the cap
- Delete them in the same write batch
- This can be done client-side (query count before write) or via a Firestore Cloud Function trigger

---

## 6. Security Rules Additions

### 6.1 Firestore Rules for Messages

```javascript
match /boards/{boardId}/messages/{messageId} {
  allow read: if isAuthenticated() && canAccessBoard(boardId);
  allow create: if isAuthenticated() && canAccessBoard(boardId)
    && request.resource.data.senderId == request.auth.uid;
  allow update: if isAuthenticated()
    && (request.auth.uid == resource.data.senderId
        || request.resource.data.keys().hasOnly(['aiStatus', 'content', 'aiError']));
  allow delete: if isAuthenticated() && isOwner(boardId);
}
```

### 6.2 RTDB Rules for AI Streams

```json
{
  "boards": {
    "$boardId": {
      "aiStreams": {
        ".read": "auth != null",
        "$commandId": {
          ".write": "auth != null"
        }
      }
    }
  }
}
```

---

## 7. Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| AI response latency | <2s to first token in chat | Time from @ai send to first streamed token visible |
| AI command breadth | 6+ command types | Count of distinct tool categories |
| Multi-step execution | Sequential tool calls complete reliably | SWOT creates all 4 quadrants correctly |
| Chat message delivery | <500ms (Firestore optimistic) | Time from send to render for other users |
| AI stream relay (RTDB) | <100ms | Time from token receipt to other users seeing it |
| Concurrent AI commands | 2+ simultaneous without conflict | Two users issue commands, both complete correctly |
| Message load time | <200ms for last 20 messages | Eager load on board open |

---

## 8. Implementation Components

### 8.1 New Files Required

```
src/
  app/
    api/
      ai-command/route.ts          # Edge Function: Claude streaming + tool execution
  components/
    chat/
      ChatSidebar.tsx              # Main sidebar container
      ChatTimeline.tsx             # Scrollable message list
      ChatMessage.tsx              # Individual message renderer
      ChatInput.tsx                # Input field with @ai detection + object ref insertion
      AIStreamMessage.tsx          # Streaming AI response bubble
      ObjectRefChip.tsx            # Clickable object reference chip
      PersonaSelector.tsx          # Per-user persona dropdown
      MessagePreview.tsx           # Floating preview for closed sidebar notifications
  hooks/
    useChatMessages.ts             # Firestore listener for chat messages
    useAIStream.ts                 # RTDB listener for live AI streams
    useAICommand.ts                # Sends @ai commands, manages SSE stream
    useChatNotifications.ts        # Badge count + preview for closed sidebar
  lib/
    store/
      chatStore.ts                 # Chat state: messages, unread count, sidebar open
    ai/
      tools.ts                     # AI tool definitions (Vercel AI SDK format)
      context.ts                   # Board state serialization for AI
      prompts.ts                   # System prompts and persona definitions
      validation.ts                # Server-side size clamping + grid snapping
```

### 8.2 Modified Files

```
src/
  app/board/[boardId]/page.tsx     # Add ChatSidebar, resize canvas on sidebar toggle
  lib/store/canvasStore.ts         # Add sidebarOpen state, object ref insertion mode
  lib/store/objectStore.ts         # Handle isAIPending rendering
  lib/types.ts                     # Add ChatMessage, AIStream types, isAIPending field
  lib/firebase/firestore.ts        # Add chat message CRUD, message cap enforcement
  lib/firebase/rtdb.ts             # Add AI stream relay helpers
  hooks/useKeyboardShortcuts.ts    # Add '/' shortcut to focus chat
  components/canvas/StickyNote.tsx  # Pending state rendering (50% opacity + shimmer)
  components/canvas/ShapeObject.tsx # Pending state rendering
  components/canvas/FrameObject.tsx # Pending state rendering
```

---

## 9. Rubric Compliance Matrix

| Rubric Requirement | Implementation | Status |
|---|---|---|
| `createStickyNote(text, x, y, color)` | AI tool via Vercel AI SDK | Planned |
| `createShape(type, x, y, w, h, color)` | AI tool with server-side clamping | Planned |
| `createFrame(title, x, y, w, h)` | AI tool with server-side clamping | Planned |
| `createConnector(fromId, toId, style)` | AI tool, client computes anchors | Planned |
| `moveObject(objectId, x, y)` | AI tool, grid-snapped | Planned |
| `resizeObject(objectId, w, h)` | AI tool with server-side clamping | Planned |
| `updateText(objectId, newText)` | AI tool | Planned |
| `changeColor(objectId, color)` | AI tool | Planned |
| `getBoardState()` | Callable tool (initial context + refresh) | Planned |
| "Create a SWOT analysis" | Primitives + arrangeInLayout, standard labels | Planned |
| "Arrange in a grid" | arrangeInLayout tool, uniform cell size | Planned |
| Multi-step commands | Streaming execution with soft-commit | Planned |
| All users see AI results real-time | Firestore sync + RTDB stream relay | Planned |
| Multiple simultaneous AI commands | Independent snapshots, last-write-wins | Planned |
| Response latency <2s | Time to first token in chat (SSE stream) | Planned |
| 6+ command types | Creation (3) + Manipulation (4) + Layout (1) + Complex (3) = 11 | Planned |
| Reliable execution | Server-side validation + rollback on failure | Planned |

---

## 10. Decision Log

| # | Topic | Decision | Rationale |
|---|-------|----------|-----------|
| 1 | Message persistence | Everything persists in Firestore | Full audit trail, users joining later see history |
| 2 | AI response visibility | AI responses appear in group chat for all users | Transparency, everyone sees what AI is doing |
| 3 | Concurrent AI handling | Independent snapshots, both execute, last-write-wins | Consistent with existing sync strategy, no artificial queuing |
| 4 | Chat layout | Unified timeline, no tabs | AI responses flow naturally into group discussion |
| 5 | AI input mode | Freeform text only, no command palette | Maximum flexibility, natural language interpretation |
| 6 | Rich messages | Text + clickable object references | Useful for "look at this" conversations, direct canvas navigation |
| 7 | Chat delivery | Firestore with optimistic UI for group; RTDB relay for AI streams | Balance of persistence and real-time performance |
| 8 | AI streaming | Token-by-token streaming in chat | Responsive, users see AI thinking in real-time |
| 9 | Dead references | Strikethrough with tooltip | Preserves context, clearly indicates deletion |
| 10 | AI context scope | Requester's viewport + selected objects | Selection-preferred with inference fallback |
| 11 | Tool execution | Execute as they stream with soft-commit (isAIPending) | Progressive rendering with rollback safety |
| 12 | AI resize validation | Server-side clamping | Prevents invalid states regardless of AI output |
| 13 | Parallel AI streams | Separate bubbles, stacked at bottom | Clear attribution, new content always visible |
| 14 | AI message-object linkage | aiCommandId on message, query objects by it | No message doc updates during streaming |
| 15 | Group/AI toggle | @ai prefix (no toggle button) | Simpler, no state to manage, familiar @-mention pattern |
| 16 | Complex templates | Hybrid: primitives + arrangeInLayout tool | AI creates content, server handles geometry |
| 17 | Selection binding | Selection preferred, inference fallback | Precise when explicit, natural language when casual |
| 18 | AI connectors | IDs only, client computes anchor positions | AI doesn't need to understand geometry |
| 19 | AI stream relay | RTDB for live stream, Firestore for persistence | Sub-100ms streaming for all users |
| 20 | Rate limits (guests) | 5 AI commands/hr for anonymous (vs 20 for authenticated) | Abuse prevention on public boards |
| 21 | Pending object visibility | Visible to all users at 50% opacity | Board-wide awareness of AI activity |
| 22 | Sidebar behavior | Push canvas (consistent with original spec) | Nothing hidden, clean separation |
| 23 | Object reference creation | Click object while chat input is focused | Intuitive, direct canvas interaction |
| 24 | Offline AI | Block with message | Honest UX, prevents stale commands |
| 25 | AI persona scope | Per-user preference (stored locally) | Different users can use different personas simultaneously |
| 26 | AI undo | Inline undo button per AI message | Explicit, no ambiguity, any user can undo any AI command |
| 27 | AI error display | Error appended to partial content | Preserves context of what AI was attempting |
| 28 | API architecture | Client-side Firestore writes for chat + /api/ai-command Edge Function | Fewer server hops for group messages |
| 29 | AI SDK | Vercel AI SDK (streamText + useChat) | Built-in streaming, tool calling, React hooks |
| 30 | Chat message cap | 500 messages per board, equal weighting | Bounded storage cost, ~6 months of typical usage |
| 31 | Chat notifications | Badge count + floating preview (3s auto-dismiss) | Non-intrusive awareness when sidebar is closed |
| 32 | @ai misfire | Accepted edge case | Users learn quickly, AI responds harmlessly |
| 33 | getBoardState() | Keep as callable tool | AI can verify state mid-response, satisfies rubric literally |
| 34 | Grid layout algorithm | Uniform cell size (largest object + spacing) | Clean, consistent alignment |
| 35 | Latency metric | Time to first token in chat | What the user "feels" as responsiveness |
| 36 | Template labels | Standard labels always | Predictable, matches rubric expectations exactly |
| 37 | Chat eager loading | Last 20 messages on board load | Badge count and preview work without sidebar open |
| 38 | Chat focus shortcut | / to focus chat (opens sidebar if closed) | Familiar pattern from Slack/Discord, replaces old slash commands |
