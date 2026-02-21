# Plan: The Mason — High-Performance Operational AI Agent

**Branch:** `ai_agent` (current)
**Depends on:** All Phase 1–5 of PLAN_AI_INTEGRATION.md (completed)

---

## Overview

"The Mason" is a speed-first AI persona for CrucibleCanvas that routes to
`claude-haiku-4-5-20251001` to hit the <2 s latency target. It uses a
JSON-only response contract — every Claude turn is a tool call; conversational
prose is prohibited. Each tool call carries an optional `response` parameter
that surfaces a one-line status message in the chat bubble, replacing free-text
output.

This plan retrofits the existing AI integration without rewriting it. All
17 existing files from PLAN_AI_INTEGRATION.md remain intact; we update 6 of
them and add 1 new component.

---

## What Already Exists (do not rebuild)

| Already built | Location |
|---|---|
| Tool definitions (all 8+ operations) | `src/lib/ai/tools.ts` |
| System prompt builder | `src/lib/ai/prompts.ts` |
| Streaming API route | `src/app/api/ai-command/route.ts` |
| PersonaSelector dropdown | `src/components/chat/PersonaSelector.tsx` |
| RobotIcon + AIStreamMessage bubble | `src/components/chat/AIStreamMessage.tsx` |
| Client-side `checkRateLimit` | `src/lib/firebase/firestore.ts` |
| `deleteObjectsByAiCommand` rollback | `src/lib/firebase/firestore.ts` |
| `AiPersona` type union | `src/lib/types.ts` |

**Gaps to close:**
1. `"mason"` persona missing from the type union and all downstream maps
2. Model selection is hardcoded to `claude-sonnet-4-6` for all personas
3. Tools have no `response` field; Mason cannot emit status without prose
4. API route does not enforce rate limits — failures do not count
5. No failure toast in the UI ("Analysis failed — no changes made")

---

## Phase 1: Type System — Add Mason to AiPersona

**File:** `src/lib/types.ts`

Change the `AiPersona` union to include `"mason"`:

```typescript
// Before
export type AiPersona = "neutral" | "skeptical_investor" | "opposing_counsel";

// After
export type AiPersona = "mason" | "neutral" | "skeptical_investor" | "opposing_counsel";
```

`"mason"` is placed first so it becomes the default ordering in dropdowns. No
other type changes are needed — `ChatMessage.aiPersona` is already `AiPersona`.

**Gate:** TypeScript compiles with zero new errors.

---

## Phase 2: Backend — Mason System Prompt

**File:** `src/lib/ai/prompts.ts`

### 2.1  Add Mason entry to `PERSONA_PROMPTS`

Insert the Mason persona at the top of `PERSONA_PROMPTS` (before `neutral`).
This is the verbatim system prompt the task specifies:

```typescript
const PERSONA_PROMPTS: Record<AiPersona, string> = {
  mason: `# Role
You are "The Mason," the high-efficiency operational core of CrucibleCanvas. You are an invisible executor.

# Objective
Transform natural language commands into direct board manipulations using the provided tool schema. Your priority is speed, precision, and zero conversational prose.

# Operating Rules
1. JSON-ONLY OUTPUT: Every response must be a tool call.
2. SILENT EXECUTION: Never use conversational prose.
3. INTEGRATED STATUS: Use the \`response\` parameter within your tool calls to provide brief status updates (e.g., "Created grid").
4. SCOPE ENFORCEMENT: If a command is analytical (e.g., "Red team this"), use the \`response\` parameter to state: "Analytical request; please switch to the Neutral Critic persona."
5. GRID SNAPPING: All x/y coordinates must be rounded to the nearest 20px grid intersection.
6. ERROR HANDLING: If you cannot handle a request, return a tool call with the \`response\` field explaining why (e.g., "Command not recognized").`,

  neutral: `...`, // unchanged
  skeptical_investor: `...`, // unchanged
  opposing_counsel: `...`, // unchanged
};
```

### 2.2  Omit analytical persona block for Mason

In `buildSystemPrompt`, the function currently appends a persona section
unconditionally. For `mason`, the entire prompt IS the persona, so the base
context block should be suppressed:

```typescript
export function buildSystemPrompt(context: BoardStateContext, persona: AiPersona): string {
  // Mason is self-contained — skip the generic base context and just return
  // the Mason operating rules plus the minimal selection context.
  if (persona === 'mason') {
    const selectionCtx = buildSelectionContext(context);
    return `${PERSONA_PROMPTS.mason}${selectionCtx}\n${TEMPLATE_STANDARDS}`;
  }

  // All other personas: existing logic unchanged
  const baseContext = `...`;
  // ...rest of existing function
}
```

Extract the selection-context snippet into a private helper
`buildSelectionContext(context)` so both branches can reuse it.

**Gate:** `buildSystemPrompt('mason context stub', 'mason')` returns a string
containing "The Mason" and "JSON-ONLY OUTPUT" and no generic base context text.

---

## Phase 3: Backend — Model Routing & Rate-Limit Enforcement

**File:** `src/app/api/ai-command/route.ts`

### 3.1  Per-persona model selection

Replace the hardcoded `anthropic('claude-sonnet-4-6')` with a selector:

```typescript
/** Maps persona to Claude model ID. Haiku for speed; Sonnet for analysis depth. */
const PERSONA_MODELS: Record<AiPersona, string> = {
  mason:              'claude-haiku-4-5-20251001',   // <2 s latency target
  neutral:            'claude-sonnet-4-6',
  skeptical_investor: 'claude-sonnet-4-6',
  opposing_counsel:   'claude-sonnet-4-6',
};

// In the POST handler, after parsing persona from the body:
const selectedPersona: AiPersona = persona ?? 'neutral';
const modelId = PERSONA_MODELS[selectedPersona];

const result = streamText({
  model: anthropic(modelId),
  system: buildSystemPrompt(contextPayload, selectedPersona),
  // ...rest unchanged
});
```

### 3.2  Server-side rate limit enforcement (count ALL commands, including failures)

The route currently performs no rate limiting; the client is the only guard.
This means a malicious client can bypass limits by skipping `checkRateLimit`.
The requirement also mandates that **failures count** — so optimistic counting
before the stream starts is correct.

Add a lightweight rate-limit check at the top of the POST handler using
`firestoreRest` (already available in the route context):

```typescript
// After token verification, before building the system prompt:
const rateLimitResult = await checkRateLimitRest(boardId, userId, isAnonymous, userToken);
if (!rateLimitResult.allowed) {
  return new Response(
    JSON.stringify({ error: `Rate limit exceeded. Limit resets in ${rateLimitResult.retryAfterMinutes} minutes.` }),
    { status: 429, headers: { 'Content-Type': 'application/json' } }
  );
}
// Increment BEFORE streaming so failures are counted too (pessimistic counting)
await incrementRateLimitRest(boardId, userId, userToken);
```

**New helpers needed in `src/lib/firebase/firestoreRest.ts`:**

```typescript
/**
 * Server-side rate limit check using Firestore REST (no client SDK).
 * Reads boards/{boardId}/metadata/config for aiCommandsToday/aiCommandsResetAt.
 * Per-user limit: 20/hr authenticated, 5/hr anonymous.
 * Board-wide limit: 50/day.
 */
export async function checkRateLimitRest(
  boardId: string,
  userId: string,
  isAnonymous: boolean,
  userToken: string
): Promise<{ allowed: boolean; retryAfterMinutes: number }>

/**
 * Increments aiCommandsToday on board metadata, resetting if the day has rolled over.
 * Called BEFORE streaming begins so failures count against the limit.
 */
export async function incrementRateLimitRest(
  boardId: string,
  userId: string,
  userToken: string
): Promise<void>
```

**Implementation notes:**
- Use the existing Firestore REST `baseUrl` pattern from `firestoreRest.ts`
- Read `boards/{boardId}/metadata/config` doc; check `aiCommandsToday` vs limits
- Per-user counts live on `users/{userId}/profile/info` as `aiCommandsThisHour`
  and `aiCommandsHourResetAt` (add these fields — Firestore creates them on
  first write, no schema migration needed)
- Board-wide count: `aiCommandsToday` on `boards/{boardId}/metadata/config`
- Anonymous users: 5/hr (check `isAnonymous` flag from the decoded Firebase token)

**Gate:** Send 21 `@ai` commands as the same user within an hour; the 21st
returns HTTP 429. The count increments even when Claude returns an error.

---

## Phase 4: Tool Schema — Add `response` Field

**File:** `src/lib/ai/tools.ts`

Every tool's input schema gains an optional `response` field. This is the
mechanism Mason uses to communicate status without prose. The execute handler
returns the `response` value so it surfaces in the stream.

### 4.1  Shared schema extension

Define a reusable Zod shape at the top of the file:

```typescript
/** Shared field added to every Mason-compatible tool. */
const responseField = z.string().optional().describe(
  'Brief status message for the chat UI (e.g., "Created SWOT grid"). ' +
  'Required when the Mason persona is active. Omit for silent execution.'
);
```

### 4.2  Apply to each tool

For every tool, add `response: responseField` to the schema object and thread
it through the execute return value:

```typescript
createStickyNote: tool({
  description: '...',
  inputSchema: zodSchema(
    z.object({
      text: z.string().describe('...'),
      x: z.number().describe('...'),
      y: z.number().describe('...'),
      color: z.string().describe('...'),
      response: responseField,          // ← new
    })
  ),
  execute: async ({ text, x, y, color, response }: { ...; response?: string }) => {
    // ...existing write logic unchanged...
    return { success: true, objectId: id, response };   // ← pass through
  },
}),
```

Apply the same pattern to: `createShape`, `createFrame`, `createConnector`,
`moveObject`, `resizeObject`, `updateText`, `changeColor`, `deleteObject`,
`arrangeInLayout`, `getBoardState`, `getObjectsByFrame`, `redTeamThis`,
`mapDecision`, `findGaps`.

### 4.3  Surface `response` in the stream

In `src/hooks/useAICommand.ts`, when consuming tool result objects from the
stream, check for `response` and append it to the displayed content:

```typescript
// Inside the stream processing loop, on each tool result:
if (toolResult?.response) {
  // Append status line to the running message content in chatStore
  chatStore.updateMessage(localMessageId, {
    content: (prev.content ?? '') + '\n' + toolResult.response,
  });
}
```

**Gate:** Sending `@ai create a SWOT analysis` with Mason persona shows terse
status lines in the chat bubble (e.g., "Created Strengths quadrant") instead
of a long prose explanation.

---

## Phase 5: Atomic Rollback on Multi-Step Failure

The rollback mechanism (`deleteObjectsByAiCommand`) already exists. This phase
formalises when and how it is triggered for Mason's multi-step operations.

**File:** `src/hooks/useAICommand.ts`

### 5.1  Track created object IDs during streaming

During streaming, accumulate object IDs from successful tool results:

```typescript
const createdObjectIds: string[] = [];

// In the stream processing loop, on each createX tool result:
if (toolResult?.objectId) {
  createdObjectIds.push(toolResult.objectId);
}
```

### 5.2  Rollback on error

In the `catch` block of `useAICommand`:

```typescript
} catch (err) {
  // Roll back all objects created in this command (aiCommandId groups them)
  await deleteObjectsByAiCommand(boardId, aiCommandId);

  // Update the chat message with failure state
  await updateChatMessage(boardId, localMessageId, {
    aiStatus: 'failed',
    aiError: 'Analysis failed — no changes made',
  });

  // Trigger the failure toast (see Phase 6)
  chatStore.setLastFailedCommandId(aiCommandId);
}
```

`deleteObjectsByAiCommand` uses the `aiCommandId` field on Firestore objects to
find and batch-delete everything created in this command — works correctly
because every tool's `execute` writes `{ aiCommandId }` on the object.

**Gate:** Simulate an API error mid-SWOT-creation; all partially created
quadrant frames are deleted and the failure toast appears.

---

## Phase 6: UI Updates

### 6.1  PersonaSelector — Add Mason option

**File:** `src/components/chat/PersonaSelector.tsx`

Add `mason` to both label and description maps. The Mason entry is placed first
(matching the type ordering):

```typescript
const PERSONA_LABELS: Record<AiPersona, string> = {
  mason:              '⚙ The Mason',
  neutral:            'Neutral Critic',
  skeptical_investor: 'Skeptical Investor',
  opposing_counsel:   'Opposing Counsel',
};

const PERSONA_DESCRIPTIONS: Record<AiPersona, string> = {
  mason:              'Speed-first executor. Tool calls only, no prose.',
  neutral:            'Balanced, constructive, Socratic',
  skeptical_investor: 'Numbers-focused, skeptical',
  opposing_counsel:   'Adversarial, evidence-focused',
};
```

The `⚙` prefix on "The Mason" gives it visual distinction in the dropdown
without requiring an icon component. Alternatively use the existing `RobotIcon`
SVG inline if that's cleaner.

### 6.2  AIStreamMessage — Mason persona label

**File:** `src/components/chat/AIStreamMessage.tsx`

When `message.aiPersona === 'mason'`, display "The Mason" instead of
"AI Assistant" in the sender label:

```typescript
const senderLabel = message.aiPersona === 'mason' ? 'The Mason' : 'AI Assistant';

// In JSX:
<span className="text-xs text-gray-500">{senderLabel}</span>
```

The existing `RobotIcon` is already correct for Mason. No icon change needed.

### 6.3  Header chat button — Chat Bubble icon + "Chat" label

**File:** `src/app/board/[boardId]/page.tsx` (or wherever the chat toggle
button lives in the TopHeader)

Replace the current chat toggle with a chat bubble SVG + "Chat" text label:

```tsx
{/* Chat toggle button in TopHeader */}
<button
  onClick={toggleSidebar}
  className="flex items-center gap-1.5 px-2 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors relative"
  title="Toggle chat (shortcut: /)"
>
  {/* Chat bubble SVG */}
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V5z"
      stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"
    />
  </svg>
  <span>Chat</span>
  {unreadCount > 0 && (
    <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-xs w-4 h-4 flex items-center justify-center leading-none">
      {unreadCount}
    </span>
  )}
</button>
```

### 6.4  Failure toast — "Analysis failed — no changes made"

**New file:** `src/components/ui/AIFailureToast.tsx`

```tsx
/**
 * AIFailureToast — appears when an AI command fails mid-execution.
 * Auto-dismisses after 5 seconds. "Try again?" resubmits the last command.
 */
'use client';

import { useEffect } from 'react';
import { useChatStore } from '@/lib/store/chatStore';

interface AIFailureToastProps {
  onRetry: () => void;
}

export default function AIFailureToast({ onRetry }: AIFailureToastProps) {
  const lastFailedCommandId = useChatStore((s) => s.lastFailedCommandId);
  const clearFailedCommandId = useChatStore((s) => s.clearFailedCommandId);

  useEffect(() => {
    if (!lastFailedCommandId) return;
    const timer = setTimeout(clearFailedCommandId, 5000);
    return () => clearTimeout(timer);
  }, [lastFailedCommandId, clearFailedCommandId]);

  if (!lastFailedCommandId) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3
                 bg-red-600 text-white text-sm px-4 py-2.5 rounded-full shadow-lg
                 animate-in slide-in-from-bottom-2 duration-200"
    >
      <span>Analysis failed — no changes made</span>
      <button
        onClick={() => { onRetry(); clearFailedCommandId(); }}
        className="underline font-medium hover:no-underline"
      >
        Try again?
      </button>
      <button onClick={clearFailedCommandId} className="opacity-70 hover:opacity-100 ml-1" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
```

**chatStore additions needed** (`src/lib/store/chatStore.ts`):

```typescript
// Add to ChatState interface:
lastFailedCommandId: string | null;
setLastFailedCommandId: (id: string) => void;
clearFailedCommandId: () => void;
```

**Wire into board page** (`src/app/board/[boardId]/page.tsx`):

```tsx
// Pass the last AI command text for retry:
<AIFailureToast onRetry={() => handleRetryLastCommand()} />
```

`handleRetryLastCommand` reads `chatStore.lastSentCommand` (a new 1-field
store value) and re-submits it via `sendAICommand`.

---

## Modified Files Summary

| File | What changes |
|---|---|
| `src/lib/types.ts` | Add `"mason"` to `AiPersona` union (first position) |
| `src/lib/ai/prompts.ts` | Add Mason system prompt to `PERSONA_PROMPTS`; extract `buildSelectionContext`; skip base context for Mason persona |
| `src/app/api/ai-command/route.ts` | Add `PERSONA_MODELS` map; select model per persona; add `checkRateLimitRest` + `incrementRateLimitRest` calls |
| `src/lib/firebase/firestoreRest.ts` | Add `checkRateLimitRest` and `incrementRateLimitRest` helpers |
| `src/lib/ai/tools.ts` | Add `response?: string` field to every tool input schema; thread through execute return value |
| `src/hooks/useAICommand.ts` | Accumulate `createdObjectIds`; trigger rollback + toast on failure; append `toolResult.response` to chat content |
| `src/lib/store/chatStore.ts` | Add `lastFailedCommandId`, `setLastFailedCommandId`, `clearFailedCommandId`, `lastSentCommand`, `setLastSentCommand` |
| `src/components/chat/PersonaSelector.tsx` | Add `mason` label/description; place first in options list |
| `src/components/chat/AIStreamMessage.tsx` | Show "The Mason" label when `aiPersona === 'mason'` |
| `src/app/board/[boardId]/page.tsx` | Replace chat toggle with Chat Bubble SVG + "Chat" label; mount `AIFailureToast` |

## New Files

| File | Purpose |
|---|---|
| `src/components/ui/AIFailureToast.tsx` | Failure toast with "Try again?" button |

---

## Implementation Order

Each step is independently testable. Build in this sequence to keep the branch
always green:

```
Phase 1  →  Phase 2  →  Phase 3
                              ↓
                         Phase 4 (tools)
                              ↓
                         Phase 5 (rollback)
                              ↓
                         Phase 6 (UI)
```

Phases 4 and 5 can be parallelised since tools.ts and useAICommand.ts are
independent files with no import cycle.

---

## Test Matrix

| Command | Persona | Expected |
|---|---|---|
| `create a SWOT analysis` | Mason | 4 frames in 2×2 grid; chat shows terse status lines (no prose) |
| `build a user journey map with 5 stages` | Mason | 5 horizontal frames + connectors; completed in <2 s |
| `red team this idea` | Mason | Response: "Analytical request; please switch to the Neutral Critic persona." No objects created |
| `create a yellow sticky note "User Research"` | Mason | Single sticky; chat shows "Created sticky note" (from `response` field) |
| `red team this idea` | Neutral Critic | Critique sticky notes created; Sonnet model used |
| Send 21 AI commands in 1 hour | Any | 21st returns 429 with retry-after |
| Simulate stream error mid-SWOT | Mason | All partial objects deleted; failure toast shown |
| Click "Try again?" on toast | Mason | Last command resubmitted |

---

## Non-Goals (out of scope for this plan)

- Mobile support (desktop-only per spec)
- Custom Mason personas per board (single shared Mason prompt)
- Mason memory across commands (stateless per call)
- Streaming tool results before all steps complete (Vercel AI SDK limitation —
  tool results only surface after `execute()` resolves)

---

## Key Risks

| Risk | Mitigation |
|---|---|
| Haiku model hallucinates coordinates or ignores grid snapping | `snapToGrid()` is enforced server-side in every tool's `execute()`, not by the model |
| Mason ignores JSON-only rule and returns prose | `response` field gives it a legal outlet; monitor Langfuse traces for text-only turns |
| Pessimistic rate-limit counting frustrates users on transient errors | Return retry-after header with reset time; display in toast |
| `checkRateLimitRest` adds latency before streaming starts | Read from metadata config doc only (1 Firestore REST GET); target <100 ms |
