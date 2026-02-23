# CrucibleCanvas — AI Agent System Blueprint

> **Purpose:** Technical reference for the Mason AI board agent. Written for LLM-assisted optimization and as an AI-first development log entry. Every section reflects the live production codebase.

---

## Table of Contents

1. [Model & Architecture](#1-model--architecture)
2. [Core Logic — Think-then-Act Flow](#2-core-logic--think-then-act-flow)
3. [Tool Schema](#3-tool-schema)
4. [Prompt Library](#4-prompt-library)
5. [Spatial Logic](#5-spatial-logic)
6. [Context Window Management](#6-context-window-management)
7. [State Synchronization — Real-time Relay](#7-state-synchronization--real-time-relay)
8. [Coordinate System](#8-coordinate-system)
9. [Error Handling & Rollback](#9-error-handling--rollback)
10. [Rate Limiting](#10-rate-limiting)
11. [Observability](#11-observability)
12. [Supported Use Cases](#12-supported-use-cases)
13. [Optimization Gaps & Targets](#13-optimization-gaps--targets)

---

## 1. Model & Architecture

### LLM
| Property | Value |
|---|---|
| Provider | Anthropic |
| Model | `claude-sonnet-4-6` |
| SDK | Vercel AI SDK v6 (`ai` package) |
| Client | `@ai-sdk/anthropic` → `createAnthropic({ baseURL: 'https://api.anthropic.com/v1' })` |
| Integration style | **Native function/tool calling** via `streamText` + `tools` map |
| Max tool steps | `stopWhen: stepCountIs(15)` |

### Runtime
- **Server runtime:** Next.js 14 App Router, **Node.js** (not Edge — required for the OpenTelemetry `NodeSDK`)
- **API entry point:** `POST /api/ai-command` (`src/app/api/ai-command/route.ts`)
- **Authentication:** Firebase ID token verified server-side with Google's JWKS endpoint via `jose` (no firebase-admin dependency — keeps the route deployable to serverless environments without service-account secrets)

### Integration Diagram

```
User types command
      │
      ▼
[ChatInput.tsx]
  • Rate-limit pre-check (Firestore count query)
  • Strip @ai prefix
  • Append referenced-object context
      │
      ▼
[useAICommand.ts]
  • Serialize board state  (context.ts → serializeBoardState)
  • Compute spatial hints  (spatialPlanning.ts → computeSuggestedPositions)
  • Write optimistic messages to local Zustand store
  • Initialize RTDB stream node
  • POST /api/ai-command  (Authorization: Bearer <Firebase ID token>)
      │
      ▼
[route.ts — Node.js server]
  • Verify Firebase ID token (jose + Google JWKS)
  • Build Mason system prompt (prompts.ts → buildSystemPrompt)
  • Create tool set (tools.ts → createAITools)
  • Call streamText(model, system, messages, tools)
  • Return toTextStreamResponse()  → SSE stream
      │
      ▼
[Back in useAICommand.ts — streaming reader]
  • Accumulate text chunks
  • Update Zustand message content per-chunk
  • Relay chunks to RTDB (updateAIStream) for other users
  • On done: confirmAIPendingObjects, write final Firestore message
  • On error: deleteObjectsByAiCommand (full rollback)
```

---

## 2. Core Logic — Think-then-Act Flow

### The Mason's Decision Loop

Mason follows a strict **Think → Plan → Execute → Summarize** loop enforced at the prompt level:

```
1. THINK   — Call getBoardState to see all existing objects and their positions.
2. PLAN    — Use suggestedPositions hints + board state to decide placement.
3. EXECUTE — Fire tool calls (createStickyNote, createShape, createConnector, etc.)
             Each tool write is immediately visible to all users at 50% opacity
             (isAIPending: true).
4. SUMMARIZE — Output exactly ONE line: "Created N type(s) for <summary>."
             No explanations, suggestions, or follow-up.
```

If a command is ambiguous, Mason short-circuits to `askClarification` and outputs the sentinel string `"Clarification needed: {question}"`. No objects are created in a clarification turn.

### Complex Command Example: SWOT Analysis

```
User: "Create a SWOT analysis for our product"

Mason thinks:
1. getBoardState → sees viewport is mostly empty, gets suggestedPositions
2. createFrame("Strengths", x=100, y=100, w=400, h=300)
3. createFrame("Weaknesses", x=520, y=100, w=400, h=300)
4. createFrame("Opportunities", x=100, y=420, w=400, h=300)
5. createFrame("Threats", x=520, y=420, w=400, h=300)
6–N. createStickyNote for each item inside each frame
Output: "Created 4 frames and 12 sticky notes for SWOT analysis."
```

Each step (2–N) fires an independent Firestore REST write. Objects appear on all users' boards incrementally as each tool call resolves.

### Clarification Flow

```
User: "Add a flowchart"
Mason → askClarification("What process should the flowchart map?")
       → sentinel: "Clarification needed: What process should the flowchart map?"
Client → detects /^clarification needed:/i regex
       → sets clarificationPending: true in chatStore
       → shows amber pulsing dot in chat header
User responds → clarificationMessages (last 6 turns) appended to POST body
             → Mason resumes with full context of its own question + user's answer
```

### Multi-turn Context

Turn history is **only included on clarification replies** (not every command). The client sends the last 6 `ai_command` / `ai_response` messages interleaved as `role: 'user' | 'assistant'`, with the current command appended. Regular commands are single-turn.

---

## 3. Tool Schema

Mason has access to **13 tools** at runtime (16 total minus 3 analytical tools filtered server-side).

### Creation Tools

| Tool | Parameters | Purpose |
|---|---|---|
| `createStickyNote` | `text: string`, `x: number`, `y: number`, `color: string` | Create a sticky note. Coordinates snapped to 20px grid. |
| `createShape` | `type: 'rectangle'\|'circle'`, `x`, `y`, `width?` (100), `height?` (100), `color` | Create a geometric shape. Dimensions clamped and snapped. |
| `createFrame` | `title: string`, `x`, `y`, `width?` (400), `height?` (300) | Create a labeled container/frame. Renders below all other objects. |
| `createConnector` | `fromObjectId: string`, `toObjectId: string`, `style?: 'solid'\|'dashed'\|'dotted'`, `color?`, `label?` | Draw a connector line between two objects. Connector position computed by renderer from the two referenced objects. |

### Manipulation Tools

| Tool | Parameters | Purpose |
|---|---|---|
| `moveObject` | `objectId: string`, `x: number`, `y: number` | Relocate any object. Snapped to grid. |
| `resizeObject` | `objectId: string`, `width: number`, `height: number` | Resize any object. Snapped, clamped 1–4000px. |
| `updateText` | `objectId: string`, `newText: string` | Change text on any object. |
| `changeColor` | `objectId: string`, `color: string` | Change fill/background color. |
| `deleteObject` | `objectId: string` | Remove a single object. |

### Layout Tool

| Tool | Parameters | Purpose |
|---|---|---|
| `arrangeInLayout` | `objectIds: string[]`, `layout: 'grid'\|'horizontal'\|'vertical'`, `columns?`, `spacing?` (20), `originX?`, `originY?` | Batch-move objects into a named layout. Fetches current object dimensions from Firestore, computes positions, then batch-writes. |

### Context Tools

| Tool | Parameters | Purpose |
|---|---|---|
| `getBoardState` | _(none)_ | Fetch all board objects and return a compact AI context summary. Uses a wide viewport (-2000,-2000 to 10000×10000) to capture everything. Always called first per Mason's rules. |
| `getObjectsByFrame` | `frameId: string` | Return all child objects of a specific frame. Useful for targeted manipulation. |

### Clarification Tool (Mason-exclusive)

| Tool | Parameters | Purpose |
|---|---|---|
| `askClarification` | `question: string` | Ask the user a single clarifying question. Terminal action — no objects created in the same turn. Returns `{ clarificationSent: true, question }` for sentinel detection. |

### Analytical Tools (filtered — not available to Mason)

These tools exist in the codebase but are stripped at the route level via `MASON_EXCLUDED_TOOLS`:

| Tool | Filtered Reason |
|---|---|
| `redTeamThis` | Analytical persona tool — creates critique sticky notes for a skeptical investor/counsel persona |
| `mapDecision` | Generates decision frameworks (pros/cons, options matrix) |
| `findGaps` | Scans board for missing topics, unanswered questions, unresolved dependencies |

### Tool Execution Pattern

Every creation tool follows this pattern:

```typescript
// 1. Snap coordinates to 20px grid
const coords = validateCoordinates(snapToGrid(x), snapToGrid(y));
// 2. Generate UUID for the new object
const id = uuidv4();
// 3. Write to Firestore REST API with isAIPending: true (50% opacity)
await restCreateObject(boardId, {
  id,
  type: 'stickyNote',
  isAIGenerated: true,
  isAIPending: true,     // ← renders at 50% opacity until confirmed
  aiCommandId,           // ← links object to this command for rollback
  createdBy: userId,
  ...fields,
}, userToken);
// 4. Return objectId to the model (can be used in subsequent tool calls)
return { success: true, objectId: id };
```

The `aiCommandId` is the key for **rollback** and **reference chips** — every object created in a command shares the same UUID.

---

## 4. Prompt Library

### Active System Prompt: `MASON_SYSTEM_PROMPT`

**File:** `src/lib/ai/prompts.ts`

```
You are The Mason — a silent, fast AI board operator for CrucibleCanvas.
Your mission: help users build complex, well-organized logic flows, diagrams, and
structured boards with precise 20px grid alignment and clean connector topology.

Rules:
- ALWAYS call getBoardState first before any creation or manipulation.
- Place new objects using the SUGGESTED OPEN POSITIONS below as your layout anchor.
  Offset subsequent objects from there using consistent 20–40px spacing.
- NEVER place objects inside an existing frame's boundaries unless the user explicitly
  says "add to frame" or "inside [frame name]". Frames are exclusive zones.
- NEVER overlap new objects with existing non-frame objects.
- Snap ALL coordinates to the 20px grid.
- After all tool calls complete, respond with exactly ONE line:
  "Created <N> <type(s)> for <brief command summary>."
  No explanations. No follow-up. No suggestions.
- If the command is too ambiguous to execute safely, call askClarification with your
  question. After calling askClarification, your ONLY text output must be exactly:
  "Clarification needed: {the exact question you asked}"
  No other text before or after.

Default colors: yellow=#FEFF9C, pink=#FF7EB9, green=#98FF98, cyan=#7AFCFF
SWOT colors: Strengths=green, Weaknesses=pink, Opportunities=cyan, Threats=coral (#FFAB91)

Template labels:
- SWOT: "Strengths", "Weaknesses", "Opportunities", "Threats"
- Retrospective: "What Went Well", "What Didn't Go Well", "Action Items"
- Pros/Cons: "Pros", "Cons"
- User Journey: "Awareness", "Consideration", "Decision", "Onboarding", "Retention"
```

### Dynamic Context Appended per Request

`buildSystemPrompt(context)` appends to the base prompt:

```
SUGGESTED OPEN POSITIONS:
  1. (220, 140) — open area in viewport
  2. (440, 140) — open area in viewport
  3. (220, 320) — open area in viewport
  4. (440, 320) — open area in viewport
  5. (220, 500) — below existing content [below viewport]

Selected objects: abc123 stickyNote at (100,80); def456 frame at (200,100)
```

Reflow positions are flagged `[below viewport]` so Mason knows they are below the current view.

### No Persona Routing

`AiPersona` is a single-literal type (`"mason"` only). There is no conditional prompt-building, model routing, or persona switching. `MASON_SYSTEM_PROMPT` is the only system prompt in the codebase.

---

## 5. Spatial Logic

### Client-Side: Suggested Positions (`spatialPlanning.ts`)

**Called before every POST request** to precompute open areas for Mason's placement hints.

**Algorithm: Two-pass scan**

```
Constants:
  CLEARANCE_W = 200px   (sticky note footprint)
  CLEARANCE_H = 160px
  SCAN_STEP   = 40px    (raster scan step)
  GRID_GAP    = 20px    (between cluster items)
  GRID_SNAP   = 20px    (coordinate snapping)

Pass 1 — Viewport anchor scan:
  1. Build exclusion rects from all frames (opaque blocks) + non-frame objects
  2. Raster-scan viewport top-left → bottom-right at SCAN_STEP intervals
  3. First clear (cx, cy) becomes the anchor
  4. Generate sqrt(maxCount)-column grid from anchor:
       x = anchor.x + (col * (CLEARANCE_W + GRID_GAP))
       y = anchor.y + (row * (CLEARANCE_H + GRID_GAP))
  5. Skip any grid cell whose clearance rect overlaps a frame (exclusive zone rule)
  6. Tag as source: 'viewport'

Pass 2 — Reflow fallback (when viewport is too full):
  1. lowestY = max(rect.y + rect.h) across all rects
  2. reflowY = snapToGrid(lowestY + GRID_GAP * 2)
  3. Generate grid from (viewport.x, reflowY)
  4. Tag as source: 'reflow'  → appended as "[below viewport]" in prompt
```

**Key constraint:** Frames are always **opaque exclusive zones** — no suggested position is ever placed inside a frame's AABB, even if visually it might look empty.

### Server-Side: `arrangeInLayout` Tool

For explicit layout requests, Mason calls `arrangeInLayout`. The tool:
1. Fetches current object dimensions from Firestore REST (`restGetObjects`)
2. Dispatches to one of three layout helpers from `validation.ts`:
   - `calculateUniformGrid(objects, { columns, spacing, originX, originY })`
   - `calculateHorizontalLayout(objects, { spacing, originX, originY })`
   - `calculateVerticalLayout(objects, { spacing, originX, originY })`
3. Batch-writes updated positions via `restBatchUpdateObjects`

Grid layout uses `columns = ceil(sqrt(N))` by default, producing a square-ish arrangement.

### Coordinate System

The CrucibleCanvas coordinate space is an **infinite 2D plane** in canvas units. Key properties:

| Property | Value |
|---|---|
| Origin | (0, 0) at canvas center; negative coordinates valid |
| Grid size | 20px (all AI-placed objects snap to this) |
| Pan state | `stageX`, `stageY` (Konva stage offset, in screen px) |
| Zoom state | `stageScale` (Konva stage scale; zoom range 0.05–5.0) |
| Viewport → Canvas | `canvasX = (screenX - stageX) / stageScale` |
| Canvas → Screen | `screenX = canvasX * stageScale + stageX` |
| Viewport bounds | `{ x: -stageX/scale, y: -stageY/scale, width: windowW/scale, height: windowH/scale }` |

Viewport bounds are computed at command time and included in the POST body. `getBoardState` uses a deliberately wide viewport (`-2000,-2000` to `10000×10000`) to capture the entire board for full context.

---

## 6. Context Window Management

### Board State Serialization (`context.ts → serializeBoardState`)

Only a **viewport-scoped subset** of objects is sent to the model per command. This keeps the context compact on large boards.

**Inclusion rules:**
1. All objects within the viewport (200px buffer on all sides)
2. All currently selected objects (even if off-screen)
3. All children of visible frames (automatically included when parent is visible)
4. Connectors between any included objects

**Excluded from context:**
- Color legend objects (reported separately as `colorLegend[]`)
- Connectors with no endpoint in the visible set
- `isAIPending` flag (not serialized — reduces noise)

**Compact output structure:**
```typescript
{
  totalObjects: number,      // total on board (not just visible)
  visibleObjects: AIObjectSummary[],
  frames: AIFrameSummary[],  // frames with nested children
  orphanObjects: AIObjectSummary[],
  connectors: AIObjectSummary[],
  colorLegend: { color, meaning }[],
  selectedObjectIds: string[],
}
```

Coordinates are `Math.round()`-ed to remove floating point noise. Optional fields (`text`, `aiCommandId`, `parentFrame`, `connectedTo`) are only included when set.

### Conversation History

| Scenario | History sent |
|---|---|
| Normal command | Single-turn: `[{ role: 'user', content: message }]` |
| Clarification reply | Last 6 ai_command/ai_response messages (3 turns) + current message |

No rolling conversation history is maintained for normal commands. Each command is self-contained with the board state as context.

### Token Budget Considerations

- `stopWhen: stepCountIs(15)` caps tool call depth — important for Claude Sonnet which can recurse deeply on complex tasks
- `getBoardState` always returns the full board snapshot (not just viewport) — the wide `-2000,-2000 to 10000×10000` viewport means all objects are included in `visibleObjects`; this is intentional for accuracy but expensive on dense boards
- `suggestedPositions` sends max 5 pre-computed positions — adds minimal token overhead (~100 tokens)

---

## 7. State Synchronization — Real-time Relay

### Architecture

CrucibleCanvas uses a **dual-write pattern** for AI responses:

| Layer | Technology | Purpose | Lifetime |
|---|---|---|---|
| RTDB stream node | Firebase Realtime Database | Per-token streaming to other users | Ephemeral — deleted on completion |
| Firestore message | Firestore `boards/{boardId}/messages` | Permanent chat history | Persistent |
| Firestore objects | Firestore `boards/{boardId}/objects` | Board content | Persistent |
| Zustand store | In-memory | Local instant update (no round-trip) | Session |

### RTDB Stream Path

```
boards/{boardId}/aiStreams/{commandId}
  ├── requesterId: string
  ├── requesterName: string
  ├── content: string        ← accumulated text, updated per chunk
  ├── status: 'streaming' | 'completed' | 'failed'
  └── timestamp: number
```

### Per-Chunk Write Flow

```
ReadableStream chunk arrives
  → accumulatedContent += chunk
  → updateMessage(responseMsgId, { content }) [Zustand — local only]
  → updateAIStream(boardId, aiCommandId, { content, status: 'streaming', timestamp })
     [RTDB — broadcasts to other users]
```

Other users subscribe via `onAIStreamChildEvents` (child added/changed/removed) which fires on each RTDB write. This means **each chunk triggers one RTDB write**, giving near-real-time streaming to all collaborators.

### Object Visibility During Streaming

AI-created objects use a **soft-commit pattern**:

```
Tool execute() → write isAIPending: true → renders at 50% opacity on all clients
                                                                          │
Stream completes → confirmAIPendingObjects() → sets isAIPending: false  ←┘
                   (batch Firestore write)    → snaps to full opacity
```

All clients see objects appear and solidify simultaneously via Firestore's real-time listener.

### Object Reference Chips

After stream completion, the client collects all objects in the local store with `aiCommandId === currentCommandId` and attaches them as `objectReferences[]` to the AI response message. These render as clickable chips in the chat timeline that teleport the viewport to the object on click.

---

## 8. Coordinate System

### Canvas Space vs. Screen Space

```
Canvas space: infinite 2D plane, origin (0,0), canvas units
Screen space: browser viewport pixels

Conversions:
  screen → canvas:  canvasX = (screenX - stageX) / stageScale
  canvas → screen:  screenX = canvasX * stageScale + stageX

Pan:   stageX, stageY ∈ (-∞, +∞) [screen px offset of canvas origin]
Zoom:  stageScale ∈ [0.05, 5.0]  [ZOOM_MIN, ZOOM_MAX from types.ts]
```

### Grid

- `GRID_SIZE = 20` (canvas units)
- All AI tool coordinates are snapped: `snapToGrid(v) = Math.round(v / 20) * 20`
- `validateCoordinates` clamps coordinates to a safe range (prevents extreme placements)

### Frame Boundaries

Frames are **exclusive zones** — the spatial planner's AABB check prevents any suggested position from landing inside a frame's bounding box:

```
frame.x ≤ cx < frame.x + frame.width   (+ CLEARANCE_W)
frame.y ≤ cy < frame.y + frame.height  (+ CLEARANCE_H)
```

This is enforced both in `computeSuggestedPositions` (hint generation) and in the Mason system prompt (`NEVER place objects inside an existing frame's boundaries`).

### Z-Index Layering

Objects render in tier order (lowest to highest):

| Tier | Types | zIndex range |
|---|---|---|
| 0 — Frames | `frame` | 0–1000 (`FRAME_ZINDEX_MAX`) |
| 1 — Shapes | `rectangle`, `circle` | 1001+ (`OBJECT_ZINDEX_MIN`) |
| 2 — Text & Sticky | `text`, `stickyNote`, `colorLegend` | above shapes |
| 3 — Connectors | `connector`, `line` | always topmost |

AI tools do not set `zIndex` — the renderer applies tier sorting automatically.

---

## 9. Error Handling & Rollback

### Failure Scenarios and Responses

| Scenario | Detection | Response |
|---|---|---|
| Invalid/expired token | `jose` `jwtVerify` throws | HTTP 401; client shows auth error |
| Malformed request body | `req.json()` throws | HTTP 400 |
| Message too long | `message.length > 2000` | HTTP 400 |
| Tool execute() failure | `streamText` `onError` callback | Logged; stream continues (other tools may still succeed) |
| Full stream failure (network, model error) | `fetch` throws or `response.ok === false` | Full rollback (see below) |
| `AbortError` (user navigated away) | `err.name === 'AbortError'` | Silent exit — no rollback needed |
| Stream completes with 0 objects | No special handling | Normal completion |

### Full Rollback Sequence

```
catch(err) in useAICommand:
  1. deleteObjectsByAiCommand(boardId, aiCommandId)
       → Firestore query: where('aiCommandId', '==', aiCommandId)
       → Batch delete all matching objects
  2. updateMessage(responseMsgId, { aiStatus: 'failed', aiError: message })
  3. sendChatMessage (persist failure to Firestore for other users)
  4. updateAIStream → status: 'failed' → removeAIStream (RTDB cleanup)
```

The `aiCommandId` UUID is the **rollback key** — every object created in a turn shares it, making batch rollback a single Firestore indexed query.

### Mid-Stream Object Visibility

Objects created before a failure remain at `isAIPending: true` (50% opacity) until `confirmAIPendingObjects` runs (on success) or `deleteObjectsByAiCommand` runs (on failure). Users see them disappear atomically on rollback.

### Clarification Non-Rollback

When Mason calls `askClarification`, no objects are created (`aiCreatedRefs` is set to `[]`). `confirmAIPendingObjects` still runs but is a no-op. There is nothing to roll back.

---

## 10. Rate Limiting

### Limits

| User type | Per-user hourly limit |
|---|---|
| Authenticated (Google) | 20 commands / hour |
| Anonymous (guest) | 5 commands / hour |

### Enforcement

Rate limiting is enforced **on the client** only (in `ChatInput.tsx` via `checkRateLimit`). The API route does not independently enforce rate limits — it relies on the client check.

```typescript
// checkRateLimit uses a Firestore count query (not a full read):
const userHourQuery = query(messagesRef,
  where('senderId', '==', userId),
  where('type', '==', 'ai_command'),
  where('createdAt', '>=', hourAgoTimestamp)
);
const count = (await getCountFromServer(userHourQuery)).data().count;
```

If the limit is reached, the client shows an inline error and blocks the send. The check adds ~100–200ms to the first command each session.

> ⚠️ **Security gap:** The API route does not independently verify rate limits. A client bypassing the UI could call `/api/ai-command` directly with a valid token without hitting the limit.

---

## 11. Observability

### Langfuse via OpenTelemetry

Every `streamText` call emits OpenTelemetry spans, forwarded to Langfuse:

```typescript
// src/instrumentation.ts — runs once at Node.js server startup
const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});
sdk.start();

// src/app/api/ai-command/route.ts
streamText({
  ...
  experimental_telemetry: { isEnabled: true },  // ← emits OTel spans
});
```

Spans include: model, prompt, tool calls, token counts, latency.

**Required env vars:** `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, optionally `LANGFUSE_BASEURL`.

Missing keys are handled gracefully — `instrumentation.ts` returns early and the server starts without OTel.

---

## 12. Supported Use Cases

### Creation

| Command pattern | Tools called | Result |
|---|---|---|
| "Create a sticky note about X" | `getBoardState`, `createStickyNote` | 1 sticky note at first open position |
| "Create a SWOT analysis" | `getBoardState`, 4× `createFrame`, N× `createStickyNote` | 4 labeled frames + sticky notes |
| "Create a flowchart for [process]" | `getBoardState`, `createShape`×N, `createConnector`×N | Shapes connected by directed connectors |
| "Create a retrospective board" | `getBoardState`, 3× `createFrame`, sticky notes | 3 labeled columns |
| "Add a frame titled X" | `getBoardState`, `createFrame` | 1 frame |
| "Connect [A] to [B]" | `createConnector` | 1 connector (requires object IDs) |

### Manipulation

| Command pattern | Tools called |
|---|---|
| "Move [object] to the right" | `moveObject` |
| "Change the color of [object] to blue" | `changeColor` |
| "Rename [frame] to X" | `updateText` |
| "Delete [object]" | `deleteObject` |
| "Make [object] wider" | `resizeObject` |

### Layout

| Command pattern | Tools called |
|---|---|
| "Arrange these in a grid" | `getBoardState`, `arrangeInLayout(grid)` |
| "Line them up horizontally" | `arrangeInLayout(horizontal)` |
| "Stack them vertically" | `arrangeInLayout(vertical)` |

### Clarification

| Trigger | Response |
|---|---|
| Ambiguous target ("move the blue thing") | `askClarification("Which blue object?")` |
| Underspecified template ("make a chart") | `askClarification("What type of chart?")` |
| Conflicting instructions | `askClarification("...")` |

---

## 13. Optimization Gaps & Targets

### Performance Target
**Goal: ≤2s to first visible object** (measured from user pressing Enter to first Firestore write visible on canvas).

Current bottleneck chain:
```
Rate limit check (~150ms Firestore count)
+ Token fetch (~100ms)
+ POST + network RTT (~50ms)
+ Token verification JWKS (~100ms, cached after first)
+ getBoardState tool call (mandatory ~200-400ms Firestore REST GET)
+ First tool execute (object creation ~150-300ms Firestore REST POST)
= ~750ms – 1.1s before first object appears
```

This is within target. The risk grows with board complexity.

---

### Gap 1: Mandatory `getBoardState` Latency

**Problem:** Mason is instructed to always call `getBoardState` first. This is an extra Firestore REST round-trip before any creation can happen, adding ~200–400ms of latency to every command.

**Impact:** On a board with 200+ objects, `getBoardState` serializes and returns a large JSON payload to the model, consuming context tokens and adding model processing time.

**Potential fix:** Pre-serialize the board state on the client (already done via `serializeBoardState`) and inject it into the system prompt directly — eliminating the mandatory tool call. The client already sends `boardState` and `suggestedPositions` in the POST body; the route currently passes these only to `buildSystemPrompt` but could also append them as an assistant message or system context block that Mason reads instead of calling the tool.

---

### Gap 2: No Tool Call Batching (N+1 Pattern)

**Problem:** Each `createStickyNote`, `createShape`, and `createConnector` call is a separate HTTP request to Firestore REST API. A 16-node flowchart with connectors = 16 + 15 = 31 sequential REST calls.

**Impact:** At ~150–300ms each (including network RTT), 31 calls = 5–10 seconds of streaming. `stopWhen: stepCountIs(15)` truncates commands requiring more than 15 tool steps — a moderate SWOT with 4 frames + 12 sticky notes + potential connectors = 16+ steps and may be cut off.

**Potential fix:** Add a `batchCreateObjects` tool that accepts an array of object definitions and writes them in a single Firestore batch (max 499 items). Parallel execution inside `execute()` using `Promise.all` on the REST calls would also help.

---

### Gap 3: `stopWhen: stepCountIs(15)` Is Too Conservative for Complex Diagrams

**Problem:** Complex templates (user journey map, detailed flowchart, decision matrix with many options) may require 20–40+ tool steps. At 15 steps, Mason silently stops without completing the layout.

**Current value:** `stepCountIs(15)` (previously raised from 10)

**Impact:** User sees partial output with no indication that the command was truncated. Mason's "Created N..." summary line may not fire.

**Potential fix:** Raise to `stepCountIs(25)` or `stepCountIs(40)` for complex commands. Add a final `askClarification` rule: "If you cannot complete the full layout in the remaining steps, output: 'Partial: completed N of M items. Continue?'"

---

### Gap 4: Per-Chunk RTDB Writes Under Fast Streaming

**Problem:** Every decoded chunk from the SSE stream triggers `updateAIStream(boardId, aiCommandId, { content })`. Claude Sonnet can emit 60–100 tokens/sec, meaning 60–100 RTDB writes/sec during active streaming.

**Impact:** At scale with multiple simultaneous AI commands across many boards, RTDB write load spikes. Firebase Realtime Database free tier has a 1MB/s write limit.

**Potential fix:** Debounce RTDB writes to a minimum 100ms interval (coalesce chunks, only write when content has grown by ≥ 50 chars or 100ms have elapsed). Local Zustand updates (instant, no cost) can continue per-chunk.

---

### Gap 5: Client-Side-Only Rate Limiting

**Problem:** The API route (`route.ts`) does not independently verify rate limits. The `checkRateLimit` check in `ChatInput.tsx` is bypassable by any client with a valid Firebase ID token calling `/api/ai-command` directly.

**Impact:** A malicious or misconfigured client can exhaust AI budget without UI-level gating.

**Potential fix:** Mirror the `checkRateLimit` logic in the API route using Firebase Admin SDK to query Firestore server-side, or implement a Firestore Security Rule that tracks and enforces the limit.

---

### Gap 6: `getBoardState` Context Explosion on Dense Boards

**Problem:** `getBoardState` uses viewport bounds of `-2000,-2000` to `10000×10000` — effectively the entire board. On a board with 500 objects, this serializes all 500 into the tool response, consuming potentially 5,000–15,000 tokens of Claude's context window.

**Impact:** Increased latency, higher cost, potential context window exhaustion on very large boards (>1000 objects).

**Potential fix:** Scope `getBoardState` to the actual viewport + a configurable radius buffer (e.g., 500px). Return a `totalObjects` count so Mason knows whether the board has off-screen content. Add a separate `getBoardStateGlobal()` tool for explicit full-board queries.

---

### Gap 7: No Streaming Partial Tool Results to Users

**Problem:** Object creation tool calls return to Claude synchronously before streaming the next chunk. From the user's perspective, there is no visual indication that tool calls are happening between Mason's text chunks.

**Impact:** UX gap — users see blank streaming text while tool calls execute in the background (can take 2–5 seconds for multi-step commands before the first object appears).

**Potential fix:** The Vercel AI SDK `streamText` result has an `onStepFinish` callback that fires after each tool call completes. Emit a progress notification (e.g., RTDB write `{ toolCallsCompleted: N }`) to show a real-time counter in the chat UI: "⚙ Creating objects... (3/8)".

---

### Gap 8: Coordinate Inference Without Visual Context

**Problem:** Mason has coordinates in text form (JSON numbers) but no spatial image of the board. For commands like "put the new frame next to the existing one", Mason must compute adjacency from raw (x, y, width, height) numbers, which it can do reliably for simple cases but struggles with for complex multi-frame layouts where "next to" is ambiguous.

**Impact:** Occasional overlapping or poorly spaced placements requiring user correction.

**Potential fix:** Extend `getBoardState` output to include a 2D ASCII grid summary of occupied regions (e.g., a 20×20 character map of the visible area where `X` = occupied, `.` = empty). This gives Mason a spatial heuristic beyond raw coordinates.

---

*Document generated from live codebase scan — `src/lib/ai/`, `src/app/api/ai-command/`, `src/hooks/useAICommand.ts`, `src/components/chat/`, `src/lib/firebase/`, `src/instrumentation.ts`.*

*Last updated: 2026-02-22*
