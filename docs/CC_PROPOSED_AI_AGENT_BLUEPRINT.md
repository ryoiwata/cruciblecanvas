# CrucibleCanvas — AI Agent System Blueprint v2

> **Purpose:** Technical reference for the Mason AI board agent. Written for LLM-assisted optimization and as an AI-first development log entry. Every section reflects the live production codebase + planned enhancements.
>
> **v2 changelog:** Two-tier execution model, 7 new tools, flowchart-native pipeline, batch creation, spatial intelligence upgrades.

---

## Table of Contents

1. [Model & Architecture](#1-model--architecture)
2. [Core Logic — Two-Tier Execution Model](#2-core-logic--two-tier-execution-model)
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
| Max tool steps | `stopWhen: stepCountIs(30)` ← **CHANGED from 15** |

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
  • ★ NEW: Classify command tier (simple vs complex)
  • Write optimistic messages to local Zustand store
  • Initialize RTDB stream node
  • POST /api/ai-command  (Authorization: Bearer <Firebase ID token>)
      │
      ▼
[route.ts — Node.js server]
  • Verify Firebase ID token (jose + Google JWKS)
  • ★ NEW: Inject pre-serialized board state into system prompt
         (eliminates mandatory getBoardState tool call — saves ~200-400ms)
  • Build Mason system prompt (prompts.ts → buildSystemPrompt)
  • Create tool set (tools.ts → createAITools)
  • Call streamText(model, system, messages, tools)
  • ★ NEW: onStepFinish → emit progress to RTDB ("⚙ Creating... 3/8")
  • Return toTextStreamResponse()  → SSE stream
      │
      ▼
[Back in useAICommand.ts — streaming reader]
  • Accumulate text chunks (debounced RTDB writes — 100ms coalesce)
  • Update Zustand message content per-chunk
  • Relay chunks to RTDB (updateAIStream) for other users
  • On done: confirmAIPendingObjects, write final Firestore message
  • On error: deleteObjectsByAiCommand (full rollback)
```

---

## 2. Core Logic — Two-Tier Execution Model

> **KEY CHANGE:** Replace the single Think→Plan→Execute→Summarize loop with a two-tier model that's fast for simple tasks and thorough for complex ones.

### Tier Classification

Before hitting the LLM, the client classifies the command:

```typescript
// src/lib/ai/tierClassifier.ts
function classifyCommandTier(message: string): 'direct' | 'planned' {
  // Tier 1 patterns: single-object operations
  const directPatterns = [
    /^(add|create|make)\s+(a|one|1)\s+(sticky|note|shape|rectangle|circle|frame)/i,
    /^(move|resize|delete|change\s+color|rename|update)/i,
    /^connect\s/i,
  ];
  
  if (directPatterns.some(p => p.test(message.trim()))) return 'direct';
  
  // Everything else gets the planning tier
  return 'planned';
}
```

### Tier 1: Direct Execution (< 2s)

For simple, single-object commands. Skips planning overhead entirely.

```
User: "Add a yellow sticky note that says 'User Research'"

Mason:
1. (Board state already injected in system prompt — no getBoardState call)
2. createStickyNote("User Research", x, y, "yellow")
3. Output: "Created 1 sticky note for User Research."

Total latency: ~800ms–1.2s
```

**Rules for Tier 1:**
- No `getBoardState` tool call (state pre-injected)
- Single tool call expected
- No layout calculation needed
- Suggested positions from system prompt are sufficient

### Tier 2: Plan-then-Execute (2-8s)

For complex, multi-element commands. Uses full planning pipeline.

```
User: "Build a password reset flowchart"

Mason:
1. (Board state already injected — reads existing objects from prompt)
2. findAvailableSpace(800, 1200) → gets clear area
3. createFlowchart({
     nodes: [...12 nodes...],
     edges: [...11+ edges...],
     direction: "top-to-bottom"
   }) → atomic batch creation
4. Output: "Created 12 shapes and 11 connectors for password reset flowchart."

Total latency: ~3-6s (mostly LLM reasoning time)
```

**Rules for Tier 2:**
- Uses `findAvailableSpace` before any creation
- Uses `calculateLayout` or `createFlowchart` for positioning
- Uses `createElementsBatch` for atomic creation (no flickering)
- Client shows "⚙ Planning..." indicator during LLM reasoning
- Progress updates via RTDB: "⚙ Creating objects... (3/8)"

### Decision Flow

```
Command arrives
      │
      ▼
[tierClassifier] ──── 'direct' ──→ [Tier 1: Single tool call, fast path]
      │
   'planned'
      │
      ▼
[Tier 2: findAvailableSpace → calculateLayout/createFlowchart → batch create]
```

### Complex Command Example: Password Reset Flowchart

```
User: "Create a password reset flow for an email account"

Mason thinks:
1. Reads board state from system prompt context
2. findAvailableSpace(800, 1400) → { x: 200, y: 100 }
3. createFlowchart({
     nodes: [
       { id: "start", type: "terminal", text: "User clicks 'Forgot Password'" },
       { id: "enter_email", type: "process", text: "Enter email address" },
       { id: "check_email", type: "decision", text: "Email exists in DB?" },
       { id: "show_error", type: "process", text: "Show 'email not found' error" },
       { id: "send_link", type: "process", text: "Generate token & send reset email" },
       { id: "click_link", type: "process", text: "User clicks reset link in email" },
       { id: "check_token", type: "decision", text: "Token valid & not expired?" },
       { id: "show_expired", type: "process", text: "Show 'link expired' message" },
       { id: "new_password", type: "process", text: "Enter new password" },
       { id: "validate_pw", type: "decision", text: "Meets password requirements?" },
       { id: "show_requirements", type: "process", text: "Show password requirements" },
       { id: "update_db", type: "process", text: "Hash & update password in DB" },
       { id: "invalidate", type: "process", text: "Invalidate token & old sessions" },
       { id: "confirm", type: "terminal", text: "Show success → redirect to login" }
     ],
     edges: [
       { from: "start", to: "enter_email" },
       { from: "enter_email", to: "check_email" },
       { from: "check_email", to: "send_link", label: "Yes" },
       { from: "check_email", to: "show_error", label: "No" },
       { from: "show_error", to: "enter_email", label: "Retry" },
       { from: "send_link", to: "click_link" },
       { from: "click_link", to: "check_token" },
       { from: "check_token", to: "new_password", label: "Valid" },
       { from: "check_token", to: "show_expired", label: "Invalid/Expired" },
       { from: "show_expired", to: "start", label: "Start over" },
       { from: "new_password", to: "validate_pw" },
       { from: "validate_pw", to: "update_db", label: "Pass" },
       { from: "validate_pw", to: "show_requirements", label: "Fail" },
       { from: "show_requirements", to: "new_password", label: "Re-enter" },
       { from: "update_db", to: "invalidate" },
       { from: "invalidate", to: "confirm" }
     ],
     direction: "top-to-bottom",
     originX: 200,
     originY: 100
   })
Output: "Created 14 shapes and 16 connectors for password reset flowchart."
```

### SWOT Analysis (Tier 2)

```
User: "Create a SWOT analysis for our product"

Mason:
1. findAvailableSpace(900, 700) → { x: 100, y: 100 }
2. createElementsBatch([
     { type: 'frame', title: 'Strengths', x: 100, y: 100, w: 400, h: 300 },
     { type: 'frame', title: 'Weaknesses', x: 520, y: 100, w: 400, h: 300 },
     { type: 'frame', title: 'Opportunities', x: 100, y: 420, w: 400, h: 300 },
     { type: 'frame', title: 'Threats', x: 520, y: 420, w: 400, h: 300 },
     { type: 'stickyNote', text: 'Add strengths here', x: 120, y: 140, color: '#98FF98' },
     { type: 'stickyNote', text: 'Add weaknesses here', x: 540, y: 140, color: '#FF7EB9' },
     { type: 'stickyNote', text: 'Add opportunities here', x: 120, y: 460, color: '#7AFCFF' },
     { type: 'stickyNote', text: 'Add threats here', x: 540, y: 460, color: '#FFAB91' },
   ])
3. groupElements([...all 8 IDs], "SWOT Analysis")
Output: "Created 4 frames and 4 sticky notes for SWOT analysis."
```

### Clarification Flow (unchanged)

```
User: "Add a flowchart"
Mason → askClarification("What process should the flowchart map?")
       → sentinel: "Clarification needed: What process should the flowchart map?"
Client → detects /^clarification needed:/i regex
       → sets clarificationPending: true in chatStore
       → shows amber pulsing dot in chat header
User responds → clarificationMessages (last 6 turns) appended to POST body
             → Mason resumes with full context
```

### Multi-turn Context (unchanged)

Turn history is **only included on clarification replies** (not every command). The client sends the last 6 `ai_command` / `ai_response` messages interleaved as `role: 'user' | 'assistant'`, with the current command appended. Regular commands are single-turn.

---

## 3. Tool Schema

Mason has access to **20 tools** at runtime (existing 13 + 7 new tools).

### Creation Tools (existing)

| Tool | Parameters | Purpose |
|---|---|---|
| `createStickyNote` | `text: string`, `x: number`, `y: number`, `color: string` | Create a sticky note. Coordinates snapped to 20px grid. |
| `createShape` | `type: 'rectangle'\|'circle'`, `x`, `y`, `width?` (100), `height?` (100), `color` | Create a geometric shape. Dimensions clamped and snapped. |
| `createFrame` | `title: string`, `x`, `y`, `width?` (400), `height?` (300) | Create a labeled container/frame. Renders below all other objects. |
| `createConnector` | `fromObjectId: string`, `toObjectId: string`, `style?: 'solid'\|'dashed'\|'dotted'`, `color?`, `label?` | Draw a connector line between two objects. |

### ★ NEW: Batch & Compound Creation Tools

| Tool | Parameters | Purpose |
|---|---|---|
| `createElementsBatch` | `elements: Array<{ type, ...props }>` | **Atomic multi-element creation.** Accepts an array of element definitions (sticky notes, shapes, frames). Writes all in a single Firestore batch (max 499). Returns array of created IDs. Board updates once — no flickering. |
| `createFlowchart` | `nodes: Array<{ id, type, text }>`, `edges: Array<{ from, to, label? }>`, `direction?: 'top-to-bottom'\|'left-to-right'`, `originX?`, `originY?` | **High-level flowchart builder.** Computes layout internally (Dagre/custom algorithm), maps node types to shapes (rectangle→process, diamond→decision, rounded-rect→terminal), creates all elements + connectors in one batch. Returns all created IDs. |
| `groupElements` | `elementIds: string[]`, `groupName?: string` | Group elements so they move/resize as a unit. Returns groupId. |

### Manipulation Tools (existing)

| Tool | Parameters | Purpose |
|---|---|---|
| `moveObject` | `objectId: string`, `x: number`, `y: number` | Relocate any object. Snapped to grid. |
| `resizeObject` | `objectId: string`, `width: number`, `height: number` | Resize any object. Snapped, clamped 1–4000px. |
| `updateText` | `objectId: string`, `newText: string` | Change text on any object. |
| `changeColor` | `objectId: string`, `color: string` | Change fill/background color. |
| `deleteObject` | `objectId: string` | Remove a single object. |

### Layout Tool (existing)

| Tool | Parameters | Purpose |
|---|---|---|
| `arrangeInLayout` | `objectIds: string[]`, `layout: 'grid'\|'horizontal'\|'vertical'`, `columns?`, `spacing?` (20), `originX?`, `originY?` | Batch-move objects into a named layout. |

### ★ NEW: Spatial Intelligence Tools

| Tool | Parameters | Purpose |
|---|---|---|
| `getViewport` | _(none)_ | Returns `{ x, y, width, height, zoom }` of the requesting user's current viewport. Agent uses this to place content where the user can see it. |
| `findAvailableSpace` | `requiredWidth: number`, `requiredHeight: number`, `preferredAnchor?: 'viewport-center'\|'right-of-content'\|'below-content'` | Scans board state, builds spatial index of occupied regions, and returns `{ x, y }` for a clear rectangle of the requested size. Respects frame exclusive zones. Biases toward preferred anchor. |
| `calculateLayout` | `elementSpecs: Array<{ width, height, label? }>`, `layoutType: 'grid'\|'flowchart'\|'tree'\|'horizontal'\|'vertical'\|'radial'`, `constraints?: { columns?, spacing?, direction?, originX?, originY? }` | **Pure layout calculator** — takes element dimensions and a layout type, returns computed `{ x, y }` positions for each element. Does NOT create anything. Agent calls this before `createElementsBatch` to pre-plan positions. |
| `getElementsInRegion` | `x: number`, `y: number`, `width: number`, `height: number` | Spatial query — returns all elements whose bounding boxes intersect the given region. Essential for "move everything on the left" type commands. |

### Context Tools (existing)

| Tool | Parameters | Purpose |
|---|---|---|
| `getBoardState` | _(none)_ | Fetch all board objects. **Now optional** — board state is pre-injected into system prompt. Mason only calls this for explicit refresh ("what's on the board?"). |
| `getObjectsByFrame` | `frameId: string` | Return all child objects of a specific frame. |

### Clarification Tool (unchanged)

| Tool | Parameters | Purpose |
|---|---|---|
| `askClarification` | `question: string` | Ask the user a single clarifying question. Terminal action — no objects created in the same turn. |

### Analytical Tools (filtered — not available to Mason)

| Tool | Filtered Reason |
|---|---|
| `redTeamThis` | Analytical persona tool |
| `mapDecision` | Decision frameworks |
| `findGaps` | Gap analysis |

### Tool Execution Patterns

#### Existing pattern (single-object creation):
```typescript
// 1. Snap coordinates to 20px grid
const coords = validateCoordinates(snapToGrid(x), snapToGrid(y));
// 2. Generate UUID
const id = uuidv4();
// 3. Write to Firestore REST API with isAIPending: true
await restCreateObject(boardId, {
  id, type: 'stickyNote',
  isAIGenerated: true, isAIPending: true,
  aiCommandId, createdBy: userId,
  ...fields,
}, userToken);
// 4. Return objectId
return { success: true, objectId: id };
```

#### ★ NEW: Batch creation pattern:
```typescript
// createElementsBatch execution
async function execute({ elements }) {
  const created = elements.map(el => ({
    id: uuidv4(),
    ...validateAndSnap(el),
    isAIGenerated: true,
    isAIPending: true,
    aiCommandId,
    createdBy: userId,
  }));
  
  // Single Firestore batch write (max 499 items)
  await restBatchCreateObjects(boardId, created, userToken);
  
  return {
    success: true,
    objectIds: created.map(o => o.id),
    count: created.length,
  };
}
```

#### ★ NEW: Flowchart creation pattern:
```typescript
// createFlowchart execution
async function execute({ nodes, edges, direction, originX, originY }) {
  // 1. Map node types to shape types + dimensions
  const shapeDefs = nodes.map(n => ({
    ...n,
    shapeType: NODE_TYPE_MAP[n.type], // terminal→roundedRect, decision→diamond, process→rectangle
    width: n.type === 'decision' ? 160 : 200,
    height: n.type === 'decision' ? 100 : 60,
  }));
  
  // 2. Run layout algorithm (Dagre-like or custom topological sort)
  const positions = computeFlowchartLayout(shapeDefs, edges, {
    direction: direction || 'top-to-bottom',
    nodeSpacing: 60,
    rankSpacing: 100,
    originX: originX || 0,
    originY: originY || 0,
  });
  
  // 3. Build element definitions
  const shapeElements = shapeDefs.map((def, i) => ({
    type: 'shape',
    shapeType: def.shapeType,
    text: def.text,
    x: positions[i].x,
    y: positions[i].y,
    width: def.width,
    height: def.height,
    color: NODE_COLOR_MAP[def.type], // terminal=#E3F2FD, decision=#FFF3E0, process=#FFFFFF
  }));
  
  // 4. Batch create shapes
  const createdShapes = await restBatchCreateObjects(boardId, shapeElements, userToken);
  
  // 5. Build connectors using created IDs
  const connectorElements = edges.map(e => ({
    type: 'connector',
    fromObjectId: createdShapes[nodeIndexMap[e.from]].id,
    toObjectId: createdShapes[nodeIndexMap[e.to]].id,
    label: e.label || undefined,
    style: 'solid',
  }));
  
  // 6. Batch create connectors
  await restBatchCreateObjects(boardId, connectorElements, userToken);
  
  return {
    success: true,
    shapeIds: createdShapes.map(s => s.id),
    connectorCount: connectorElements.length,
    totalElements: shapeElements.length + connectorElements.length,
  };
}
```

### Flowchart Node Type → Shape Mapping

| Node Type | Shape | Default Color | Dimensions |
|---|---|---|---|
| `terminal` | Rounded rectangle (border-radius: 20px) | `#E3F2FD` (light blue) | 200 × 60 |
| `process` | Rectangle | `#FFFFFF` (white w/ border) | 200 × 60 |
| `decision` | Diamond (rotated square) | `#FFF3E0` (light orange) | 160 × 100 |
| `data` | Parallelogram | `#E8F5E9` (light green) | 200 × 60 |
| `subroutine` | Double-bordered rectangle | `#F3E5F5` (light purple) | 200 × 60 |

### Flowchart Layout Algorithm

```
computeFlowchartLayout(nodes, edges, config):
  1. Build adjacency graph from edges
  2. Topological sort to determine rank (vertical/horizontal position)
  3. For each rank level:
     - Count nodes at this rank
     - Center nodes horizontally (or vertically for LTR)
     - Apply nodeSpacing between siblings
  4. Apply rankSpacing between levels
  5. Handle branching:
     - Decision nodes with 2+ outgoing edges spread children
     - "Yes" branch goes down/right (primary path)
     - "No" branch goes left/right (alternate path)
  6. Handle merge points:
     - Nodes with 2+ incoming edges centered between parents
  7. Offset all positions by (originX, originY)
  8. Snap all coordinates to 20px grid
  9. Return position map: { [nodeId]: { x, y } }
```

---

## 4. Prompt Library

### Active System Prompt: `MASON_SYSTEM_PROMPT` (v2)

**File:** `src/lib/ai/prompts.ts`

```
You are The Mason — a silent, fast AI board operator for CrucibleCanvas.
Your mission: help users build complex, well-organized logic flows, diagrams, and
structured boards with precise 20px grid alignment and clean connector topology.

EXECUTION TIERS:
- SIMPLE commands (single object create/move/edit): Execute immediately with one tool call.
  Use the suggested positions from context. Do NOT call getBoardState or findAvailableSpace.
- COMPLEX commands (templates, flowcharts, multi-element layouts): First call
  findAvailableSpace to find a clear area, then use createFlowchart, createElementsBatch,
  or calculateLayout to plan and execute. Take time to get the layout right.

Rules:
- Board state is already provided in the CURRENT BOARD STATE section below. Only call
  getBoardState if you need a fresh snapshot mid-command.
- For simple commands, place objects at the SUGGESTED OPEN POSITIONS below.
- For complex commands, ALWAYS call findAvailableSpace first to avoid overlapping existing content.
- NEVER place objects inside an existing frame's boundaries unless the user explicitly
  says "add to frame" or "inside [frame name]".
- NEVER overlap new objects with existing non-frame objects.
- Snap ALL coordinates to the 20px grid.
- After all tool calls complete, respond with exactly ONE line:
  "Created <N> <type(s)> for <brief command summary>."
  No explanations. No follow-up. No suggestions.
- If the command is too ambiguous to execute safely, call askClarification.

FLOWCHART RULES:
- Use createFlowchart for any flowchart, process diagram, or decision tree request.
- Map process steps to "process" nodes, yes/no decisions to "decision" nodes,
  start/end points to "terminal" nodes.
- Always include edge labels for decision branches ("Yes"/"No", "Pass"/"Fail", etc.).
- Default direction: top-to-bottom. Use left-to-right for timelines/journeys.

TEMPLATE RULES:
- SWOT: 4 frames in 2x2 grid. Colors: Strengths=green, Weaknesses=pink,
  Opportunities=cyan, Threats=coral. Use createElementsBatch for atomic creation.
- Retrospective: 3 frames in horizontal row.
- User Journey: 5 frames in horizontal row with connectors between stages.
- Pros/Cons: 2 frames side by side.

BATCH CREATION:
- When creating 3+ elements, prefer createElementsBatch over individual tool calls.
- When creating flowcharts, ALWAYS use createFlowchart (not individual shapes + connectors).
- When creating grids of elements, use calculateLayout first, then createElementsBatch.

Default colors: yellow=#FEFF9C, pink=#FF7EB9, green=#98FF98, cyan=#7AFCFF
SWOT colors: Strengths=green, Weaknesses=pink, Opportunities=cyan, Threats=coral (#FFAB91)
```

### Dynamic Context Appended per Request (v2)

`buildSystemPrompt(context)` now appends significantly more context:

```
CURRENT BOARD STATE:
  Total objects: 12
  Frames: [
    { id: "abc123", title: "Sprint Planning", x: 100, y: 100, w: 400, h: 300, children: 3 }
  ]
  Shapes: [
    { id: "def456", type: "rectangle", x: 600, y: 200, w: 100, h: 60, text: "Start" }
  ]
  Sticky notes: [
    { id: "ghi789", text: "User Research", x: 120, y: 140, color: "yellow" }
  ]
  Connectors: [
    { id: "jkl012", from: "def456", to: "mno345", label: "Yes" }
  ]
  Bounding box: { minX: 100, minY: 100, maxX: 1000, maxY: 700 }

USER VIEWPORT:
  { x: 50, y: 30, width: 1400, height: 900, zoom: 1.0 }

SUGGESTED OPEN POSITIONS:
  1. (220, 140) — open area in viewport
  2. (440, 140) — open area in viewport
  3. (220, 320) — open area in viewport
  4. (440, 320) — open area in viewport
  5. (220, 500) — below existing content [below viewport]

Selected objects: abc123 stickyNote at (100,80); def456 frame at (200,100)
```

**Key change:** Board state is now embedded directly in the system prompt, eliminating the mandatory `getBoardState` tool call that previously added 200-400ms to every command.

---

## 5. Spatial Logic

### Client-Side: Suggested Positions (`spatialPlanning.ts`) — existing, unchanged

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
  4. Generate sqrt(maxCount)-column grid from anchor
  5. Skip grid cells overlapping frames
  6. Tag as source: 'viewport'

Pass 2 — Reflow fallback (when viewport is too full):
  1. lowestY = max(rect.y + rect.h) across all rects
  2. reflowY = snapToGrid(lowestY + GRID_GAP * 2)
  3. Generate grid from (viewport.x, reflowY)
  4. Tag as source: 'reflow'  → "[below viewport]" in prompt
```

### ★ NEW: Server-Side Spatial Tools

#### `findAvailableSpace` Algorithm

```
findAvailableSpace(requiredWidth, requiredHeight, preferredAnchor):
  1. Fetch all board objects (from pre-serialized state, no Firestore call)
  2. Build spatial index: list of occupied AABBs with CLEARANCE_BUFFER (40px padding)
  3. Determine search origin based on preferredAnchor:
     - 'viewport-center': center of user's current viewport
     - 'right-of-content': rightmost edge of existing content + 80px
     - 'below-content': bottommost edge of existing content + 80px
     - default: viewport center
  4. Spiral search outward from origin in 40px steps
  5. At each candidate (cx, cy):
     - Test rect (cx, cy, requiredWidth, requiredHeight) against all occupied AABBs
     - If no intersection → return { x: snapToGrid(cx), y: snapToGrid(cy) }
  6. Fallback: place below all existing content
  
  Returns: { x: number, y: number, source: 'viewport' | 'right' | 'below' | 'fallback' }
```

#### `calculateLayout` Algorithm

```
calculateLayout(elementSpecs, layoutType, constraints):
  Switch on layoutType:
  
  'grid':
    columns = constraints.columns || ceil(sqrt(N))
    For each element i:
      col = i % columns
      row = floor(i / columns)
      x = originX + col * (maxElementWidth + spacing)
      y = originY + row * (maxElementHeight + spacing)
  
  'flowchart':
    (delegates to computeFlowchartLayout — see Tool Schema section)
  
  'tree':
    1. Build tree from parent-child relationships
    2. Assign depth (y-axis) and breadth (x-axis) positions
    3. Center parents above children
    4. Apply spacing
  
  'horizontal':
    For each element i:
      x = originX + sum(widths[0..i-1]) + i * spacing
      y = originY (vertically centered)
  
  'vertical':
    For each element i:
      x = originX (horizontally centered)
      y = originY + sum(heights[0..i-1]) + i * spacing
  
  'radial':
    center = (originX, originY)
    radius = max(totalWidth, totalHeight) / 2 + spacing
    For each element i:
      angle = (2π / N) * i - π/2  (start from top)
      x = center.x + radius * cos(angle) - element.width/2
      y = center.y + radius * sin(angle) - element.height/2
  
  Returns: Array<{ x: number, y: number }> (one per element, snapped to grid)
```

#### `getElementsInRegion` Algorithm

```
getElementsInRegion(x, y, width, height):
  queryRect = { x, y, width, height }
  results = []
  For each object in boardState:
    objectRect = { x: obj.x, y: obj.y, width: obj.width, height: obj.height }
    if (rectsIntersect(queryRect, objectRect)):
      results.push(obj)
  Returns: Array<AIObjectSummary>
```

### Server-Side: `arrangeInLayout` Tool (existing, unchanged)

For explicit layout requests, Mason calls `arrangeInLayout`. The tool:
1. Fetches current object dimensions from Firestore REST
2. Dispatches to grid/horizontal/vertical layout helpers
3. Batch-writes updated positions

### Coordinate System (unchanged)

| Property | Value |
|---|---|
| Origin | (0, 0) at canvas center; negative coordinates valid |
| Grid size | 20px (all AI-placed objects snap to this) |
| Pan state | `stageX`, `stageY` (Konva stage offset, in screen px) |
| Zoom state | `stageScale` (Konva stage scale; zoom range 0.05–5.0) |
| Viewport → Canvas | `canvasX = (screenX - stageX) / stageScale` |
| Canvas → Screen | `screenX = canvasX * stageScale + stageX` |

---

## 6. Context Window Management

### Board State Serialization (`context.ts → serializeBoardState`) — enhanced

> **KEY CHANGE:** Board state is now injected directly into the system prompt. No mandatory `getBoardState` tool call.

**Inclusion rules:**
1. All objects within the viewport (200px buffer on all sides)
2. All currently selected objects (even if off-screen)
3. All children of visible frames
4. Connectors between any included objects
5. ★ NEW: Bounding box summary of ALL objects (even off-screen) for `findAvailableSpace`

**Excluded from context:**
- Color legend objects (reported separately)
- Connectors with no endpoint in the visible set
- `isAIPending` flag (reduces noise)

**Compact output structure:**
```typescript
{
  totalObjects: number,
  visibleObjects: AIObjectSummary[],
  frames: AIFrameSummary[],
  orphanObjects: AIObjectSummary[],
  connectors: AIObjectSummary[],
  colorLegend: { color, meaning }[],
  selectedObjectIds: string[],
  boundingBox: { minX, minY, maxX, maxY },  // ★ NEW
  viewport: { x, y, width, height, zoom },   // ★ NEW
}
```

### Token Budget Considerations

- `stopWhen: stepCountIs(30)` ← **RAISED from 15** — complex flowcharts need 20+ steps
- Board state pre-injected — saves one tool call round-trip per command
- `findAvailableSpace` and `calculateLayout` return compact position data (~50 tokens each)
- `createFlowchart` and `createElementsBatch` replace 10-30 individual tool calls with 1-2 calls

### Conversation History (unchanged)

| Scenario | History sent |
|---|---|
| Normal command | Single-turn: `[{ role: 'user', content: message }]` |
| Clarification reply | Last 6 messages (3 turns) + current |

---

## 7. State Synchronization — Real-time Relay

### Architecture (unchanged)

| Layer | Technology | Purpose | Lifetime |
|---|---|---|---|
| RTDB stream node | Firebase Realtime Database | Per-token streaming to other users | Ephemeral |
| Firestore message | Firestore `boards/{boardId}/messages` | Permanent chat history | Persistent |
| Firestore objects | Firestore `boards/{boardId}/objects` | Board content | Persistent |
| Zustand store | In-memory | Local instant update | Session |

### ★ CHANGED: Debounced RTDB Writes

```
ReadableStream chunk arrives
  → accumulatedContent += chunk
  → updateMessage(responseMsgId, { content }) [Zustand — local, every chunk]
  → DEBOUNCED: updateAIStream [RTDB — max 10 writes/sec, coalesce to 100ms intervals]
```

**Rationale:** Previous per-chunk writes (60-100/sec) caused RTDB write load spikes. Now capped at ~10/sec with 100ms coalescing. Local Zustand updates remain per-chunk for instant local feedback.

### ★ NEW: Progress Notifications

```
onStepFinish callback in streamText:
  → Write to RTDB: boards/{boardId}/aiStreams/{commandId}/progress
    { toolCallsCompleted: N, totalEstimated: M, lastTool: "createShape" }
  → Client renders: "⚙ Creating objects... (3/8)"
```

### Object Visibility During Streaming (unchanged)

AI-created objects use soft-commit pattern:
- Tool execute → `isAIPending: true` → 50% opacity
- Stream completes → `confirmAIPendingObjects` → full opacity

### ★ NEW: Batch Object Visibility

For `createElementsBatch` and `createFlowchart`, all objects in the batch appear simultaneously at 50% opacity, then solidify together on stream completion. No incremental flickering.

---

## 8. Coordinate System

*(Unchanged from v1 — see original document)*

| Property | Value |
|---|---|
| Grid size | 20px |
| Zoom range | 0.05–5.0 |
| Frame boundaries | Exclusive zones — no AI placement inside frames |

### Z-Index Layering

| Tier | Types | zIndex range |
|---|---|---|
| 0 — Frames | `frame` | 0–1000 |
| 1 — Shapes | `rectangle`, `circle`, `diamond`, `roundedRect` | 1001+ |
| 2 — Text & Sticky | `text`, `stickyNote`, `colorLegend` | above shapes |
| 3 — Connectors | `connector`, `line` | always topmost |

---

## 9. Error Handling & Rollback

### Failure Scenarios (unchanged + additions)

| Scenario | Detection | Response |
|---|---|---|
| Invalid/expired token | `jose` throws | HTTP 401 |
| Tool execute() failure | `onError` callback | Logged; stream continues |
| Full stream failure | `fetch` throws | Full rollback |
| `AbortError` | `err.name` | Silent exit |
| ★ Batch write partial failure | `restBatchCreateObjects` throws | Rollback entire batch via `aiCommandId` |
| ★ `createFlowchart` layout error | Layout computation throws | Return error to model; no objects created |

### Full Rollback Sequence (unchanged)

The `aiCommandId` UUID is the rollback key — every object created in a command shares it. Batch-created objects also share the same `aiCommandId`, ensuring atomic rollback.

### ★ NEW: Partial Completion Handling

If `stopWhen: stepCountIs(30)` triggers before completion:
```
Mason detects remaining work → outputs:
  "Partial: completed N of M items. Reply 'continue' to finish."
Client → stores partial state in clarification context
User replies 'continue' → Mason resumes with full context of what was already created
```

---

## 10. Rate Limiting

### Limits (unchanged)

| User type | Per-user hourly limit |
|---|---|
| Authenticated (Google) | 20 commands / hour |
| Anonymous (guest) | 5 commands / hour |

### ★ CHANGED: Dual Enforcement

Rate limiting now enforced **both client-side and server-side**:

```typescript
// Server-side enforcement in route.ts
const hourAgo = Date.now() - 3600000;
const commandCount = await restCountDocuments(
  `boards/${boardId}/messages`,
  { senderId: userId, type: 'ai_command', createdAt_gte: hourAgo },
  userToken
);
if (commandCount >= (isAnonymous ? 5 : 20)) {
  return Response.json({ error: 'Rate limit exceeded' }, { status: 429 });
}
```

---

## 11. Observability

### Langfuse via OpenTelemetry (unchanged)

Every `streamText` call emits OTel spans forwarded to Langfuse.

### ★ NEW: Tool Call Metrics

Track per-tool execution time and success rate:
```
{
  tool: "createFlowchart",
  duration_ms: 1200,
  elements_created: 26,
  success: true,
  tier: "planned"
}
```

---

## 12. Supported Use Cases

### Creation (updated with new tools)

| Command pattern | Tools called | Result |
|---|---|---|
| "Create a sticky note about X" | `createStickyNote` | 1 sticky note (Tier 1 — direct) |
| "Create a SWOT analysis" | `findAvailableSpace`, `createElementsBatch`, `groupElements` | 4 frames + stickies, grouped (Tier 2) |
| "Create a flowchart for [process]" | `findAvailableSpace`, `createFlowchart` | N shapes + connectors, properly laid out (Tier 2) |
| "Build a password reset flow" | `findAvailableSpace`, `createFlowchart` | 12-14 shapes with decision diamonds + connectors (Tier 2) |
| "Create a retrospective board" | `findAvailableSpace`, `createElementsBatch` | 3 frames + stickies (Tier 2) |
| "Create a user journey map" | `findAvailableSpace`, `calculateLayout('horizontal')`, `createElementsBatch` | 5 connected frames (Tier 2) |
| "Add a frame titled X" | `createFrame` | 1 frame (Tier 1 — direct) |
| "Create a 2x3 grid of sticky notes" | `calculateLayout('grid')`, `createElementsBatch` | 6 stickies in grid (Tier 2) |

### Manipulation (unchanged)

| Command pattern | Tools called |
|---|---|
| "Move [object] to the right" | `moveObject` |
| "Change the color of [object] to blue" | `changeColor` |
| "Move all sticky notes on the left to the right" | `getElementsInRegion`, multiple `moveObject` |
| "Delete [object]" | `deleteObject` |

### Layout (enhanced)

| Command pattern | Tools called |
|---|---|
| "Arrange these in a grid" | `arrangeInLayout(grid)` |
| "Space these elements evenly" | `calculateLayout`, `arrangeInLayout` |
| "Arrange in a radial/mind map layout" | `calculateLayout('radial')`, batch `moveObject` |

### Flowchart-specific (★ NEW)

| Command pattern | Tools called |
|---|---|
| "Create a flowchart for password reset" | `findAvailableSpace`, `createFlowchart` |
| "Build a decision tree for..." | `findAvailableSpace`, `createFlowchart` (direction: top-to-bottom) |
| "Map the user signup process" | `findAvailableSpace`, `createFlowchart` |
| "Create an approval workflow" | `findAvailableSpace`, `createFlowchart` |

---

## 13. Optimization Gaps & Targets

### Performance Target
**Goal: ≤1.2s for Tier 1 (simple), ≤6s for Tier 2 (complex)**

### Resolved Gaps (from v1)

| Gap | Resolution |
|---|---|
| Gap 1: Mandatory `getBoardState` latency | ✅ Board state pre-injected in system prompt. Saves ~200-400ms per command. |
| Gap 2: N+1 tool call pattern | ✅ `createElementsBatch` and `createFlowchart` replace 10-30 individual calls with 1-2 calls. |
| Gap 3: `stepCountIs(15)` too conservative | ✅ Raised to `stepCountIs(30)`. Partial completion messaging added. |
| Gap 4: Per-chunk RTDB writes | ✅ Debounced to 100ms intervals (max 10 writes/sec). |
| Gap 5: Client-only rate limiting | ✅ Server-side enforcement added in route.ts. |
| Gap 6: Context explosion on dense boards | ✅ `getBoardState` now viewport-scoped by default. `boundingBox` summary for off-screen awareness. |
| Gap 7: No streaming progress | ✅ `onStepFinish` → RTDB progress notifications ("⚙ Creating... 3/8"). |
| Gap 8: Coordinate inference without visual context | Partially resolved — `findAvailableSpace` provides spatial intelligence. Full ASCII grid map deferred. |

### Remaining Gaps

#### Gap 9: Diamond Shape Rendering

**Problem:** The canvas may not natively support diamond shapes for decision nodes. `createFlowchart` maps decisions to `type: 'diamond'`, but the renderer may need a new shape type.

**Fix required:** Add diamond rendering to the Konva canvas layer — either as a rotated square or a custom `Line` polygon with 4 points.

#### Gap 10: Connector Routing for Complex Flowcharts

**Problem:** Simple straight-line connectors between shapes may overlap other shapes in complex flowcharts with branches and merge points.

**Potential fix:** Implement orthogonal connector routing (Manhattan routing) — connectors follow horizontal/vertical paths with right-angle turns, avoiding shape bounding boxes.

#### Gap 11: Group Selection & Movement

**Problem:** `groupElements` creates a logical group, but the canvas needs to support selecting and moving a group as a single unit.

**Fix required:** Implement group selection in the Konva layer — when any element in a group is selected, highlight all group members and move them together.

---

*Document generated from live codebase scan + planned architecture enhancements.*

*v1 source: `src/lib/ai/`, `src/app/api/ai-command/`, `src/hooks/useAICommand.ts`, `src/components/chat/`, `src/lib/firebase/`, `src/instrumentation.ts`.*

*Last updated: 2026-02-22 — v2*
