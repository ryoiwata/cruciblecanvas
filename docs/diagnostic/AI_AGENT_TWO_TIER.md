# AI Agent Two-Tier Architecture

**Date:** 2026-02-22
**Branch:** perf/render-sync-optimization

---

## Overview

The Mason AI agent now uses a two-tier execution model to reduce wall-clock latency for simple commands while retaining full spatial planning capability for complex ones.

| Metric | Before | Tier 1 | Tier 2 |
|--------|--------|--------|--------|
| Latency (simple) | ~2–3s | ~500ms | — |
| Latency (complex) | ~3–5s | — | ~3–5s |
| LLM calls | 1 (Sonnet) | 1 (Haiku) | 1 (Haiku) + 1 (Sonnet) |
| Spatial avoidance | Suggested hints only | Hard `findClearRect` | Hard zones + `findAvailableSpace` tool |
| `isAIPending` | true | **false** | true |

---

## Request Flow

```
POST /api/ai-command
        │
        ▼
  verifyFirebaseToken()
        │
        ▼
  classifyAndExtract(message)   ← Haiku generateObject, ~150–200ms
        │
        ├── tier: 'simple' ──────────────────────────────────────────────┐
        │                                                                  │
        │   buildBoardObjectsFromContext(boardState)                       │
        │   computeOccupiedZones(boardObjects)                            │
        │   for each object:                                              │
        │     findClearRect(occupied, w, h, origin) → pos                 │
        │   Promise.all(restCreateObject(..., isAIPending: false))        │
        │   return ReadableStream(summaryText)                            │
        │                                                                  │
        └── tier: 'complex' (or classifier threw) ────────────────────────┤
                                                                           │
            buildBoardObjectsFromContext(boardState)                       │
            computeOccupiedZones(boardObjects)                            │
            buildTier2SystemPrompt({ ..., occupiedZones, viewportBounds })│
            createAITools({ boardObjects, viewportBounds })               │
            streamText(Sonnet, stopWhen: stepCountIs(30))                 │
            return result.toTextStreamResponse()                          │
                                                                          ▼
                                                                     Response
```

---

## Classifier (`src/lib/ai/tierClassifier.ts`)

Uses Haiku `generateObject` with a Zod discriminated union schema:

```typescript
// Simple branch — also extracts creation spec in the same call
{ tier: 'simple', objects: SimpleObjectSpec[], summaryText: string }

// Complex branch — Sonnet takes over
{ tier: 'complex', estimatedCount: number, layoutHint?: 'flowchart'|'grid'|'list'|'freeform' }
```

**Rules the classifier applies:**
- Simple: 1–3 objects with no connections between them
- Complex: 4+ objects, any diagram/flowchart, any connected structure

**Fallback:** If `classifyAndExtract` throws for any reason (network, schema error), the route falls through to Tier 2 silently. No silent creation failures.

---

## Tier 1 — Direct Write

Objects are written with `isAIPending: false` — they appear at full opacity immediately. No rollback mechanism is needed because the Firestore writes complete before the response is sent. If writes fail, HTTP 500 is returned instead.

Positions are computed server-side:
1. `computeOccupiedZones` clusters existing objects into compact AABB rectangles (frames are opaque; non-frame objects within 100px are merged)
2. `findClearRect` does an unbounded row-major scan from the viewport origin, step size `max(40, dim/4)`, up to 100,000px radius
3. Each placed object is immediately added to the occupied list before the next object's position is computed (sequential avoidance)

**Response headers:**
- `X-Tier: 1`
- `X-Created-Ids: <comma-separated Firestore IDs>`
- `X-Is-Anonymous: 0|1`

The client's `useAIStream` reader handles this unchanged — it reads `response.body` as a plain text stream regardless of content type.

---

## Tier 2 — Plan-then-Batch

### System Prompt Changes

`buildTier2SystemPrompt` appends two sections to the base Mason prompt:

```
Viewport: (x, y) W×H

OCCUPIED ZONES — hard no-go areas (call findAvailableSpace to get a safe starting position):
  1. "frame:Auth Flow" at (100, 200), 840×640
  2. "cluster:sticky note" at (1180, 380), 440×340
  ...
```

Capped at 20 zones to keep token count low. The AI is instructed to call `findAvailableSpace` rather than guessing coordinates from the zone list.

### New Tools

| Tool | When to use |
|------|-------------|
| `findAvailableSpace(neededW, neededH, preferX?, preferY?)` | Before any batch creation — returns a guaranteed clear `{x, y}` |
| `createElementsBatch(elements[])` | 4+ independent objects (no connectors) |
| `createFlowchart(nodes[], edges[], startX, startY, ...)` | Flowcharts, process diagrams, any connected graph |

### `createFlowchart` internals

1. Calls `computeFlowchartLayout` (BFS rank-based, pure computation)
2. `Promise.all` creates all shapes — builds `Map<localNodeId, firestoreObjectId>`
3. `Promise.all` creates all connectors — resolves `from/to` via the map (no extra reads)
4. Optionally creates a frame sized to `totalWidth + 80, totalHeight + 80`
5. Returns `{ frameId?, nodeIds[], edgeIds[], totalWidth, totalHeight }`

### `computeFlowchartLayout` algorithm

```
1. Build in-degree map from edges
2. BFS from root nodes (in-degree === 0) → assign rank (layer index)
   - If no roots exist (cycle), all nodes start at rank 0
3. Group nodes by rank; sort by BFS discovery order (left-to-right stability)
4. Per rank: total width = Σ(nodeW) + (n-1)×hGap
5. Center each rank: startX = origin + (maxRankWidth - rankWidth) / 2
6. Y per rank: origin + rank × (nodeH + vGap)
7. Diamond nodes: height × 1.5 (taller decision diamonds)
8. Snap all to 20px grid
```

---

## Updated Types

### `ObjectType` (`src/lib/types.ts`)

Added `'diamond'` and `'roundedRect'` to the union. These are rendered by `ShapeObject.tsx`.

### `ToolContext` (`src/lib/ai/tools.ts`)

```typescript
interface ToolContext {
  boardId: string;
  userId: string;
  aiCommandId: string;
  userToken: string;
  boardObjects?: Record<string, BoardObject>;   // NEW — for spatial tools
  viewportBounds?: { x: number; y: number; width: number; height: number }; // NEW
}
```

### `createConnector` tool

Added `directed?: boolean` parameter (defaults `true`). Writes `endEffect: 'arrow'` or `'none'` explicitly — avoids relying on component defaults.

---

## Spatial Planning Additions (`src/lib/ai/spatialPlanning.ts`)

```typescript
// Server-side: convert objects to compact zone list
computeOccupiedZones(objects: Record<string, BoardObject>): OccupiedZone[]

// Server-side: find clear rectangle, unbounded scan
findClearRect(
  occupied: OccupiedZone[],
  neededW: number,
  neededH: number,
  searchOrigin: { x: number; y: number }
): { x: number; y: number }
```

`computeOccupiedZones` strategy:
- **Frames** → exact AABB + 20px padding on all sides
- **Non-frame/non-connector objects** → greedy proximity clustering (100px threshold) → cluster AABB + 20px padding
- **Connectors / lines** → skipped (no spatial footprint)

`findClearRect` strategy:
- Adaptive step: `max(40, neededW/4)` horizontal, `max(40, neededH/4)` vertical
- Row-major scan expanding downward from `searchOrigin`
- First candidate with no AABB overlap against any zone is returned
- Max scan radius: 100,000px (effectively unlimited)
- Result snapped to 20px grid

---

## Client Compatibility

No client-side changes were required. The client's `useAICommand.ts`:

- Already reads `response.body` as a `ReadableStream` — works for both plain text (Tier 1) and AI SDK text stream (Tier 2)
- Already collects `aiCreatedRefs` by matching `aiCommandId` on objects — works for Tier 1 since `aiCommandId` is still written on all objects
- Rollback (`deleteObjectsByAiCommand`) is only triggered on stream error — Tier 1 writes complete before the stream starts, so rollback won't fire for successful Tier 1 commands

The `viewportBounds` field in the POST body was already derivable from existing client state but is now explicitly included in the request.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/ai/tierClassifier.ts` | **New** — Haiku `generateObject` classifier |
| `src/lib/ai/layoutAlgorithms.ts` | **New** — BFS flowchart + grid layout (pure computation) |
| `src/lib/ai/spatialPlanning.ts` | Added `computeOccupiedZones`, `findClearRect`, `OccupiedZone` |
| `src/lib/ai/tools.ts` | Updated `ToolContext`; new tools: `findAvailableSpace`, `createElementsBatch`, `createFlowchart`; `createShape` adds `diamond`/`roundedRect`; `createConnector` adds `directed` |
| `src/lib/ai/prompts.ts` | Removed "ALWAYS getBoardState first"; added `buildTier2SystemPrompt`; updated `buildSystemPrompt` fallback text |
| `src/app/api/ai-command/route.ts` | Full two-tier branching with fallback |
| `src/lib/types.ts` | Added `'diamond'`, `'roundedRect'` to `ObjectType` |

---

## Verification Checklist

- [ ] **Tier 1 speed**: "add a yellow sticky note" completes in <800ms
- [ ] **Tier 1 spatial**: note appears in clear space on a crowded board
- [ ] **Tier 2 flowchart**: "create a user login flowchart with 5 steps" → BFS layout, correct connectors, no overlap
- [ ] **Crowded board**: fill viewport, send "add 3 stickies" → placement below viewport, no overlap
- [ ] **Classifier accuracy**: verify ~10 sample commands land in correct tier
- [ ] **Fallback**: break `classifyAndExtract` (bad API key) → Tier 2 runs as fallback
- [ ] **`tsc --noEmit`**: passes clean
- [ ] **`next lint`**: no new warnings
