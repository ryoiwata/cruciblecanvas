# Plan: AI Integration (Group Chat + AI Agent)

**Source:** `docs/AI_INTEGRATION_SPEC.md`, `docs/interview/ai_integration_interview.md`
**Depends on:** All Phase 1-3 features (canvas, objects, real-time sync, auth — already built)

---

## Summary

Add a group chat sidebar with an integrated AI board agent. Users communicate via a unified chat timeline. Messages starting with `@ai` are routed to Claude, which can create, manipulate, arrange, and analyze board objects. All messages persist in Firestore. AI responses stream token-by-token and relay to all users via RTDB.

---

## Phase 1: Foundation — Types, Stores, Dependencies

**Goal:** Install packages, define types, create stores. No UI yet.

### Step 1.1: Install Dependencies

```bash
npm install ai @ai-sdk/anthropic zod uuid
npm install -D @types/uuid
```

- `ai` — Vercel AI SDK (streamText, useChat, tool definitions)
- `@ai-sdk/anthropic` — Claude provider for Vercel AI SDK
- `zod` — Schema validation for API route + tool parameter validation
- `uuid` — Generate aiCommandId client-side

### Step 1.2: Add Types to `src/lib/types.ts`

Add after the existing `BoardMetadata` interface (~line 134):

```typescript
// Chat message types
type ChatMessageType = 'group' | 'ai_command' | 'ai_response' | 'system'
type AIStatus = 'streaming' | 'completed' | 'failed'

interface ObjectReference {
  objectId: string
  objectText: string        // snapshot at reference time
  objectType: ObjectType
}

interface ChatMessage {
  id: string
  boardId: string
  senderId: string
  senderName: string
  senderPhotoURL?: string
  type: ChatMessageType
  content: string
  objectReferences?: ObjectReference[]
  aiCommandId?: string
  aiPersona?: AiPersona
  aiStatus?: AIStatus
  aiError?: string
  createdAt: Timestamp | number
}

// RTDB AI stream
interface AIStream {
  requesterId: string
  requesterName: string
  content: string
  status: 'streaming' | 'completed' | 'failed'
  timestamp: number
}
```

Add `isAIPending?: boolean` to the existing `BoardObject` interface (after `aiCommandId` at ~line 78).

### Step 1.3: Create `src/lib/store/chatStore.ts`

```typescript
interface ChatState {
  // Sidebar
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  // Messages
  messages: ChatMessage[]
  setMessages: (msgs: ChatMessage[]) => void
  addMessage: (msg: ChatMessage) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void

  // Notifications
  unreadCount: number
  setUnreadCount: (n: number) => void
  incrementUnread: () => void
  resetUnread: () => void

  // AI streams (from RTDB, keyed by commandId)
  activeStreams: Record<string, AIStream>
  setStream: (commandId: string, stream: AIStream) => void
  removeStream: (commandId: string) => void

  // Persona (per-user, persisted to localStorage)
  persona: AiPersona
  setPersona: (p: AiPersona) => void

  // Object reference insertion mode
  isInsertingRef: boolean
  setIsInsertingRef: (v: boolean) => void

  // Chat input ref (for / shortcut focus)
  chatInputRef: React.RefObject<HTMLInputElement> | null
  setChatInputRef: (ref: React.RefObject<HTMLInputElement>) => void
}
```

Use `zustand/middleware` persist for `persona` field (localStorage).

### Step 1.4: Add AI-related Firestore helpers to `src/lib/firebase/firestore.ts`

New functions:

```typescript
// Chat CRUD
sendChatMessage(boardId: string, message: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<string>
onChatMessages(boardId: string, limit: number, callback: (msgs: ChatMessage[]) => void): Unsubscribe
loadOlderMessages(boardId: string, beforeTimestamp: Timestamp, limit: number): Promise<ChatMessage[]>
deleteChatMessage(boardId: string, messageId: string): Promise<void>

// Message cap enforcement
enforceMessageCap(boardId: string, cap: number): Promise<void>

// AI undo: delete objects by aiCommandId
deleteObjectsByAiCommand(boardId: string, aiCommandId: string): Promise<void>

// Confirm AI pending objects (set isAIPending: false)
confirmAIPendingObjects(boardId: string, aiCommandId: string): Promise<void>

// Rate limit helpers
checkRateLimit(boardId: string, userId: string, isAnonymous: boolean): Promise<{ allowed: boolean; remaining: number }>
incrementRateLimit(boardId: string, userId: string): Promise<void>
```

### Step 1.5: Add AI stream helpers to `src/lib/firebase/rtdb.ts`

New functions:

```typescript
// AI stream relay
setAIStream(boardId: string, commandId: string, stream: AIStream): Promise<void>
updateAIStream(boardId: string, commandId: string, updates: Partial<AIStream>): Promise<void>
removeAIStream(boardId: string, commandId: string): Promise<void>
onAIStreams(boardId: string, callback: (streams: Record<string, AIStream>) => void): Unsubscribe
onAIStreamChildEvents(boardId: string, callbacks: { onAdded, onChanged, onRemoved }): Unsubscribe
```

RTDB path: `boards/{boardId}/aiStreams/{commandId}`

### Step 1.6: Update RTDB security rules

Add to `database.rules.json` under `boards/$boardId`:

```json
"aiStreams": {
  ".read": "auth != null",
  "$commandId": {
    ".write": "auth != null"
  }
}
```

**Gate:** All types compile, stores instantiate, Firestore/RTDB helpers are callable. No UI yet.

---

## Phase 2: Chat UI (Group Messaging Only, No AI Yet)

**Goal:** Build the sidebar, chat timeline, message input, and real-time group messaging. AI comes later.

### Step 2.1: Create `src/components/chat/ChatSidebar.tsx`

- Right-side panel, width ~320px (25% of 1280px screen)
- CSS transition: `transition-all duration-300 ease-in-out`
- When open: pushes canvas left (flex layout)
- When closed: width 0, collapsed
- Structure:
  ```
  <div className="flex flex-col h-full border-l bg-white">
    <ChatHeader />        {/* title, collapse btn, persona dropdown */}
    <ChatTimeline />      {/* flex-1, scrollable */}
    <ChatInput />         {/* fixed bottom, input + send */}
  </div>
  ```

### Step 2.2: Create `src/components/chat/ChatTimeline.tsx`

- Scrollable `overflow-y-auto` container
- Maps over `chatStore.messages` to render `<ChatMessage>` components
- Auto-scrolls to bottom on new messages (unless user has scrolled up)
- Scroll-up-to-load-more: `IntersectionObserver` on a sentinel div at top, triggers `loadOlderMessages()`
- Groups consecutive messages from same sender

### Step 2.3: Create `src/components/chat/ChatMessage.tsx`

- Renders a single message based on `type`:
  - `group`: sender avatar + name + text + timestamp. Right-aligned if current user, left-aligned otherwise.
  - `system`: centered, muted, small text
  - `ai_command` and `ai_response`: handled later (Phase 4)
- Object reference chips: inline `<ObjectRefChip>` components within the text
- Dead reference detection: check if `objectId` exists in `objectStore.objects`; if not, render strikethrough with tooltip

### Step 2.4: Create `src/components/chat/ChatInput.tsx`

- Text input + send button
- On submit: detect `@ai` prefix → route to AI (Phase 4). Otherwise → `sendChatMessage()` to Firestore
- **Object reference insertion:** When `chatStore.isInsertingRef` is true and user clicks a canvas object, insert `@[Type: Text]` chip into the input
- Send on Enter, newline on Shift+Enter

### Step 2.5: Create `src/components/chat/ObjectRefChip.tsx`

- Inline chip component: colored pill with object type icon + truncated text
- On click: pan canvas to center on the referenced object (`canvasStore.stageX/Y` update)
- Dead reference: strikethrough + "This object was deleted" tooltip
- Uses `objectStore.objects[objectId]` to check existence

### Step 2.6: Create `src/hooks/useChatMessages.ts`

- On mount: subscribe to last 20 messages via `onChatMessages(boardId, 20, callback)`
- Sets `chatStore.messages`
- Handles optimistic local inserts (add message immediately, reconcile on Firestore confirmation)
- Tracks `unreadCount` when sidebar is closed

### Step 2.7: Create `src/components/chat/MessagePreview.tsx`

- Floating notification near the sidebar toggle when sidebar is closed
- Shows sender name + first line of latest message
- Auto-dismisses after 3 seconds (CSS animation + setTimeout)
- Only appears when `sidebarOpen === false` and a new message arrives

### Step 2.8: Integrate sidebar into `src/app/board/[boardId]/page.tsx`

- Wrap the existing fragment in a flex container:
  ```tsx
  <div className="flex h-screen w-screen overflow-hidden">
    <div className="flex-1 relative">
      {/* all existing content: Toolbar, Canvas, etc. */}
    </div>
    <ChatSidebar boardId={boardId} />
  </div>
  ```
- The Canvas component's width adjusts automatically via flex
- Add sidebar toggle button in the top-right controls cluster (next to PresenceIndicator)
- Initialize `useChatMessages(boardId)` hook

### Step 2.9: Add `/` keyboard shortcut

In `src/hooks/useKeyboardShortcuts.ts`, add a case in the switch block (~line 231):

```typescript
case "/":
  e.preventDefault();
  const chatStore = useChatStore.getState();
  chatStore.setSidebarOpen(true);
  // Focus the chat input after sidebar opens
  setTimeout(() => chatStore.chatInputRef?.current?.focus(), 100);
  return;
```

The existing guard (lines 204-206) already skips if target is INPUT/TEXTAREA, so `/` won't fire when typing in chat.

### Step 2.10: Object reference click-to-insert

When chat input is focused (`isInsertingRef = true` in chatStore):
- In `Canvas.tsx` or `BoardObjects.tsx`, intercept object clicks
- If `chatStore.isInsertingRef`, instead of selecting the object, insert a reference chip into the chat input
- Reset `isInsertingRef` after insertion

**Gate:** Users can open/close the sidebar with `/` shortcut. Group messages send, persist, and appear in real-time for all users. Object references work (click to pan). Badge + preview notifications work when sidebar is closed.

---

## Phase 3: AI API Route + Tool Definitions

**Goal:** Build the server-side AI endpoint with Claude integration and all tool definitions. No frontend AI UI yet — test via curl/Postman.

### Step 3.1: Create `src/lib/ai/tools.ts`

Define all AI tools using Vercel AI SDK's `tool()` function with Zod schemas:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const aiTools = {
  createStickyNote: tool({
    description: 'Create a sticky note on the board',
    parameters: z.object({
      text: z.string(),
      x: z.number(),
      y: z.number(),
      color: z.string(),
    }),
  }),
  createShape: tool({ ... }),
  createFrame: tool({ ... }),
  createConnector: tool({ ... }),
  moveObject: tool({ ... }),
  resizeObject: tool({ ... }),
  updateText: tool({ ... }),
  changeColor: tool({ ... }),
  deleteObject: tool({ ... }),
  arrangeInLayout: tool({ ... }),
  getBoardState: tool({ ... }),
  getObjectsByFrame: tool({ ... }),
  // Analytical (optional, can call primitives internally):
  redTeamThis: tool({ ... }),
  mapDecision: tool({ ... }),
  findGaps: tool({ ... }),
};
```

### Step 3.2: Create `src/lib/ai/validation.ts`

Server-side validation functions:

```typescript
// Size clamping per object type
clampSize(type: ObjectType, width: number, height: number): { width, height }

// Grid snapping
snapToGrid(value: number, gridSize: number = 20): number

// Coordinate validation
validateCoordinates(x: number, y: number): { x, y }

// arrangeInLayout: uniform cell size algorithm
calculateGridLayout(objectIds: string[], objects: Record<string, BoardObject>, options: LayoutOptions): { id: string, x: number, y: number }[]
```

### Step 3.3: Create `src/lib/ai/prompts.ts`

System prompt builder:

```typescript
function buildSystemPrompt(context: AICommandContext): string {
  // Base context (always)
  // + Persona prompt (per-user selection)
  // + Board state summary
  // + Template standards (SWOT labels, etc.)
  // + Selected objects emphasis
}

const personas = { neutral, skeptical_investor, opposing_counsel }
```

### Step 3.4: Create `src/lib/ai/context.ts`

Board state serialization:

```typescript
function serializeBoardState(
  objects: Record<string, BoardObject>,
  viewportBounds: { x, y, width, height },
  selectedObjectIds: string[],
  scale: number
): AIBoardContext {
  // Filter to viewport + selected objects
  // Group by frames (nested JSON with rel_pos)
  // Include orphan objects with spatial regions
  // Include connectors between visible objects
  // Include color legend
  // Round coordinates to integers
}
```

### Step 3.5: Create `src/app/api/ai-command/route.ts`

Edge Function:

```typescript
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

export const runtime = 'edge';

export async function POST(req: Request) {
  // 1. Extract Firebase ID token from Authorization header
  // 2. Verify token server-side (firebase-admin)
  //    NOTE: firebase-admin doesn't work in Edge Runtime.
  //    Use Node.js runtime instead, or verify token manually via Google's public keys.
  // 3. Parse request body: { message, boardId, boardState, selectedObjectIds, persona, aiCommandId }
  // 4. Check rate limits (Firestore read: user profile + board metadata)
  // 5. Build system prompt
  // 6. Call streamText() with anthropic('claude-sonnet-4-5-20250929') + tools
  // 7. Return streaming response

  const result = streamText({
    model: anthropic('claude-sonnet-4-5-20250929'),
    system: buildSystemPrompt(context),
    messages: [{ role: 'user', content: message }],
    tools: aiTools,
    maxSteps: 15,  // allow multi-step tool calling
  });

  return result.toDataStreamResponse();
}
```

**Important:** `firebase-admin` uses Node.js APIs that don't work in Edge Runtime. Two options:
- **Option A:** Use `export const runtime = 'nodejs'` instead of `'edge'`. Still supports streaming via Vercel's Node.js streaming support.
- **Option B:** Verify Firebase tokens manually in Edge Runtime by fetching Google's public keys and verifying JWT signature.

Recommend **Option A** (Node.js runtime) for simplicity since `firebase-admin` is already installed.

### Step 3.6: Implement tool execution handlers

Each tool's `execute` function writes to Firestore via `firebase-admin`:

```typescript
createStickyNote: tool({
  // ...parameters...
  execute: async ({ text, x, y, color }) => {
    const id = generateObjectId(boardId);
    const obj = {
      id, type: 'stickyNote', text,
      x: snapToGrid(x), y: snapToGrid(y),
      width: 200, height: 150, color,
      createdBy: userId,
      isAIGenerated: true,
      isAIPending: true,
      aiCommandId,
    };
    await adminCreateObject(boardId, obj);
    return { success: true, objectId: id };
  },
}),
```

The `arrangeInLayout` execute handler:
1. Fetch the specified objects from Firestore
2. Calculate uniform cell grid positions
3. Batch-update all objects with new x/y coordinates

The `getBoardState` execute handler:
1. Query all objects in the board from Firestore (admin SDK)
2. Serialize into `AIBoardContext` format
3. Return to Claude as tool result

### Step 3.7: Add server-side Firestore admin helpers

Create `src/lib/firebase/admin.ts` (or add to existing):

```typescript
import { getFirestore } from 'firebase-admin/firestore';

// Initialize admin app (if not already)
// CRUD using admin SDK (bypasses security rules):
adminCreateObject(boardId, data): Promise<string>
adminUpdateObject(boardId, objectId, updates): Promise<void>
adminDeleteObject(boardId, objectId): Promise<void>
adminBatchUpdate(boardId, updates: { id, data }[]): Promise<void>
adminGetObjects(boardId): Promise<BoardObject[]>
adminConfirmPending(boardId, aiCommandId): Promise<void>
adminRollbackPending(boardId, aiCommandId): Promise<void>
```

**Gate:** `curl -X POST /api/ai-command` with a valid Firebase token and `@ai create a yellow sticky note` returns a streaming response, and a sticky note appears in Firestore with `isAIGenerated: true`.

---

## Phase 4: AI Chat Frontend Integration

**Goal:** Wire the AI into the chat sidebar. Streaming responses, RTDB relay, pending objects, undo.

### Step 4.1: Create `src/hooks/useAICommand.ts`

Client-side hook for sending `@ai` commands:

```typescript
function useAICommand(boardId: string) {
  // 1. Serialize board state (viewport + selected)
  // 2. Generate aiCommandId (uuid)
  // 3. Write ai_command message to Firestore (optimistic)
  // 4. POST to /api/ai-command with streaming fetch
  // 5. As tokens stream:
  //    a. Update local AI response message content
  //    b. Push stream chunks to RTDB (boards/{boardId}/aiStreams/{commandId})
  // 6. On completion:
  //    a. Write final ai_response message to Firestore
  //    b. Call confirmAIPendingObjects(boardId, aiCommandId)
  //    c. Remove RTDB stream node
  //    d. Increment rate limit counter
  // 7. On error:
  //    a. Call adminRollbackPending (or client-side deleteObjectsByAiCommand)
  //    b. Update message with error status
  //    c. Remove RTDB stream node

  return { sendAICommand, isLoading }
}
```

### Step 4.2: Create `src/hooks/useAIStream.ts`

RTDB listener for AI streams from OTHER users:

```typescript
function useAIStream(boardId: string) {
  // Subscribe to /boards/{boardId}/aiStreams via onAIStreamChildEvents
  // On child added: create a local ai_response message in chatStore (streaming state)
  // On child changed: update the message content
  // On child removed: finalize message (query Firestore for the persisted version)
}
```

### Step 4.3: Update `ChatInput.tsx` for @ai detection

```typescript
function handleSend(text: string) {
  if (text.startsWith('@ai ') || text.startsWith('@ai')) {
    if (isOffline) {
      showTooltip('AI commands require a connection');
      return;
    }
    const command = text.replace(/^@ai\s*/, '');
    sendAICommand(command);
  } else {
    sendChatMessage(boardId, { type: 'group', content: text, ... });
  }
}
```

Visual: When user types `@ai`, the input background subtly shifts to indigo-50 to indicate AI mode.

### Step 4.4: Create `src/components/chat/AIStreamMessage.tsx`

Renders a streaming AI response:
- AI avatar (sparkle icon) + "AI" label
- Purple/indigo background
- Content streams in token-by-token (updated from `chatStore.activeStreams[commandId]` or local state)
- Loading shimmer while streaming
- On completion: show "Undo" button inline
- On failure: append error banner with "All changes rolled back" text

### Step 4.5: Update `ChatMessage.tsx` for AI message types

Add rendering branches for:
- `type: 'ai_command'`: User message with `@ai` badge prefix
- `type: 'ai_response'`: Delegate to `<AIStreamMessage>` if streaming, or render final content with Undo button

### Step 4.6: Implement AI Undo button

In `AIStreamMessage.tsx`:
```typescript
async function handleUndo() {
  await deleteObjectsByAiCommand(boardId, aiCommandId);
  await updateChatMessage(boardId, messageId, {
    aiStatus: 'failed',
    aiError: `Undone by ${displayName}`
  });
}
```
- Button text: "Undo" → after click: "(Undone by [name])"
- Disabled while streaming (`aiStatus === 'streaming'`)

### Step 4.7: Add pending object rendering

In `StickyNote.tsx`, `ShapeObject.tsx`, `FrameObject.tsx`:

```tsx
const isPending = object.isAIPending === true;
// Apply opacity: isPending ? 0.5 : (object.opacity ?? 1)
// Optional: add a CSS shimmer animation class
```

The existing Firestore sync will automatically deliver `isAIPending` changes to all clients. When the AI command completes, `confirmAIPendingObjects` flips them all to `false`, and the opacity transitions to full.

### Step 4.8: Create `src/components/chat/PersonaSelector.tsx`

Dropdown in the sidebar header:
- Options: "Neutral Critic", "Skeptical Investor", "Opposing Counsel"
- Selected value from `chatStore.persona`
- On change: `chatStore.setPersona(newValue)` (persists to localStorage)
- Small label: current persona name shown as a chip

### Step 4.9: Wire up `useChatMessages` and `useAIStream` in BoardPage

In `src/app/board/[boardId]/page.tsx`, add:

```typescript
useChatMessages(boardId);   // Firestore listener for chat messages
useAIStream(boardId);       // RTDB listener for live AI streams
```

**Gate:** Full AI chat loop works. Type `@ai create a yellow sticky note` → AI response streams in chat → sticky note appears on canvas at 50% opacity → solidifies on completion → Undo button works.

---

## Phase 5: Advanced Features

**Goal:** Complex commands, selection binding, notifications, message cap.

### Step 5.1: Selection binding for AI commands

In `useAICommand.ts`, when building the request body:
```typescript
const selectedObjectIds = useCanvasStore.getState().selectedObjectIds;
// Include in POST body along with board state
```

In the system prompt, if `selectedObjectIds.length > 0`:
```
The user has ${selectedCount} objects selected. When they say "these," "this," "them,"
they are referring to the following objects:
${selectedObjects.map(o => `- ${o.id}: ${o.type} "${o.text}" at (${o.x}, ${o.y})`).join('\n')}
```

### Step 5.2: `arrangeInLayout` uniform cell grid algorithm

In `src/lib/ai/validation.ts`:

```typescript
function calculateUniformGrid(
  objects: { id: string; width: number; height: number }[],
  columns: number,
  spacing: number = 20,
  originX: number = 0,
  originY: number = 0
): { id: string; x: number; y: number }[] {
  const maxW = Math.max(...objects.map(o => o.width));
  const maxH = Math.max(...objects.map(o => o.height));
  const cellW = snapToGrid(maxW + spacing);
  const cellH = snapToGrid(maxH + spacing);

  return objects.map((obj, i) => ({
    id: obj.id,
    x: snapToGrid(originX + (i % columns) * cellW + (cellW - obj.width) / 2),
    y: snapToGrid(originY + Math.floor(i / columns) * cellH + (cellH - obj.height) / 2),
  }));
}
```

### Step 5.3: Notification system

In `src/hooks/useChatNotifications.ts`:
- Track last-read message timestamp (stored in `chatStore`)
- When sidebar is closed and new message arrives: increment `unreadCount` + show `<MessagePreview>`
- When sidebar opens: reset `unreadCount`, update last-read timestamp

In `ChatSidebar.tsx` toggle button:
```tsx
<button onClick={toggleSidebar} className="relative">
  <ChatIcon />
  {unreadCount > 0 && (
    <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-xs w-5 h-5 flex items-center justify-center">
      {unreadCount}
    </span>
  )}
</button>
```

### Step 5.4: Message cap enforcement

In `sendChatMessage()`:
```typescript
// After writing the new message, check count
const snapshot = await getDocs(query(messagesRef, orderBy('createdAt', 'asc'), limit(1)));
const count = await getCountFromServer(messagesRef);
if (count.data().count > 500) {
  // Delete oldest messages in batch
  const excess = count.data().count - 500;
  const oldestDocs = await getDocs(query(messagesRef, orderBy('createdAt', 'asc'), limit(excess)));
  const batch = writeBatch(db);
  oldestDocs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}
```

### Step 5.5: Rate limit UI

In `ChatInput.tsx`, before sending @ai commands:
```typescript
const { allowed, remaining } = await checkRateLimit(boardId, userId, isAnonymous);
if (!allowed) {
  showToast('Rate limit reached. Try again later.');
  return;
}
```

Show remaining count as subtle text below the input: "18/20 AI commands this hour"

### Step 5.6: Offline detection for AI commands

In `ChatInput.tsx`:
- Subscribe to Firebase connection state via `onConnectionStateChange`
- When offline: show warning icon next to `@ai` prefix, block AI sends with tooltip
- Group messages still send (Firestore offline persistence queues them)

**Gate:** Full feature complete. SWOT analysis, grid arrangement, selection binding, notifications, rate limiting, message cap, offline handling all work.

---

## Phase 6: Polish & Testing

### Step 6.1: AI badge on all object types

Ensure `StickyNote.tsx`, `ShapeObject.tsx`, `FrameObject.tsx` all render the sparkle badge when `isAIGenerated === true`. Currently only `StickyNote.tsx` has it.

### Step 6.2: Firestore security rules

Add to `firestore.rules`:
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

Deploy: `firebase deploy --only firestore:rules,database`

### Step 6.3: Firestore indexes

Create composite index:
- Collection: `boards/{boardId}/messages`
- Fields: `createdAt` (descending)
- (Firestore auto-creates single-field indexes; the composite may be auto-prompted on first query)

### Step 6.4: Test matrix

| Test | Steps | Expected |
|---|---|---|
| Basic creation | `@ai create a yellow sticky note that says "Hello"` | Sticky note appears, correct color/text, sparkle badge |
| Shape creation | `@ai create a blue rectangle at 200, 300` | Rectangle at (200, 300), blue, grid-snapped |
| Frame creation | `@ai add a frame called "Sprint Planning"` | Frame with title, correct size |
| Move command | Select sticky → `@ai move this to 400, 400` | Object moves to (400, 400) |
| Color change | Select object → `@ai change this to green` | Color updates |
| Grid arrange | Select 6 stickies → `@ai arrange these in a grid` | Uniform grid, consistent spacing |
| SWOT analysis | `@ai create a SWOT analysis` | 4 labeled quadrants: S, W, O, T |
| Retrospective | `@ai set up a retrospective board` | 3 columns: What Went Well, What Didn't, Action Items |
| Multi-user AI | User A + User B both send @ai commands simultaneously | Both complete, objects don't conflict |
| Streaming | Send complex command | Tokens stream in chat, objects appear progressively at 50% opacity |
| Undo | Click Undo on AI message | All objects from that command deleted |
| Rollback | Simulate API failure | Pending objects removed, error appended to chat |
| Rate limit | Exceed 20 commands/hr | 21st blocked with message |
| Guest rate limit | Anonymous user, exceed 5 commands/hr | 6th blocked |
| Group chat | Send group messages between 2 users | Messages appear real-time for both |
| Object reference | Click object while typing → send → click chip | Reference inserted, pans to object |
| Dead reference | Delete referenced object | Chip shows strikethrough + tooltip |
| / shortcut | Press `/` while on canvas | Sidebar opens, input focused |
| Offline AI | Disconnect → try @ai command | Blocked with tooltip message |
| Notification | Close sidebar → other user sends message | Badge count + preview appears |

---

## File Summary

### New Files (17)

| File | Purpose |
|---|---|
| `src/lib/store/chatStore.ts` | Chat state management |
| `src/lib/ai/tools.ts` | AI tool definitions (Vercel AI SDK format) |
| `src/lib/ai/prompts.ts` | System prompts + persona definitions |
| `src/lib/ai/context.ts` | Board state serialization for AI |
| `src/lib/ai/validation.ts` | Size clamping, grid snap, layout algorithms |
| `src/lib/firebase/admin.ts` | Firebase Admin SDK helpers for API route |
| `src/app/api/ai-command/route.ts` | AI command API endpoint (Node.js runtime) |
| `src/components/chat/ChatSidebar.tsx` | Sidebar container |
| `src/components/chat/ChatTimeline.tsx` | Scrollable message list |
| `src/components/chat/ChatMessage.tsx` | Message renderer |
| `src/components/chat/ChatInput.tsx` | Input with @ai detection |
| `src/components/chat/AIStreamMessage.tsx` | Streaming AI response bubble |
| `src/components/chat/ObjectRefChip.tsx` | Clickable object reference chip |
| `src/components/chat/PersonaSelector.tsx` | Per-user persona dropdown |
| `src/components/chat/MessagePreview.tsx` | Floating notification preview |
| `src/hooks/useChatMessages.ts` | Firestore chat message listener |
| `src/hooks/useAIStream.ts` | RTDB AI stream relay listener |
| `src/hooks/useAICommand.ts` | AI command sender + stream handler |

### Modified Files (10)

| File | Changes |
|---|---|
| `src/lib/types.ts` | Add ChatMessage, AIStream, ObjectReference types; add isAIPending to BoardObject |
| `src/lib/firebase/firestore.ts` | Add chat CRUD, message cap, AI undo/confirm helpers |
| `src/lib/firebase/rtdb.ts` | Add AI stream relay helpers |
| `src/lib/store/canvasStore.ts` | No changes needed (sidebar state lives in chatStore) |
| `src/lib/store/objectStore.ts` | No changes needed (batchUpsert already exists) |
| `src/app/board/[boardId]/page.tsx` | Add flex wrapper, ChatSidebar, sidebar toggle button, new hooks |
| `src/hooks/useKeyboardShortcuts.ts` | Add `/` shortcut case |
| `src/components/canvas/StickyNote.tsx` | Add isAIPending opacity rendering |
| `src/components/canvas/ShapeObject.tsx` | Add isAIPending opacity + AI badge |
| `src/components/canvas/FrameObject.tsx` | Add isAIPending opacity + AI badge |

### Config Changes

| File | Change |
|---|---|
| `package.json` | Add `ai`, `@ai-sdk/anthropic`, `zod`, `uuid` |
| `.env.local` | Already has `ANTHROPIC_API_KEY` |
| `database.rules.json` | Add `aiStreams` node |
| `firestore.rules` | Add `messages` collection rules |

---

## Dependency Graph

```
Phase 1 (Foundation)
    │
    ├── Phase 2 (Chat UI — group only)
    │       │
    │       └── Phase 4 (AI Chat Frontend)
    │               │
    │               └── Phase 5 (Advanced: selection, layout, notifications)
    │                       │
    │                       └── Phase 6 (Polish & Testing)
    │
    └── Phase 3 (AI API Route — backend)
            │
            └── Phase 4 (AI Chat Frontend)
```

Phases 2 and 3 can be built in **parallel** since they have no code dependencies on each other. Phase 4 requires both to be complete.
