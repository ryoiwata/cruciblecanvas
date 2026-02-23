/**
 * prompts.ts — system prompt builder for the Mason AI board agent.
 * Composes the base operational context, board state summary, and spatial
 * hints into the system prompt sent to Claude with each @ai command.
 */

import type { SuggestedPosition, OccupiedZone } from '@/lib/ai/spatialPlanning';

interface BoardStateContext {
  objectCount: number;
  visibleCount: number;
  selectedCount: number;
  frameCount: number;
  topics: string[];
  colorLegend: { color: string; meaning: string }[];
  selectedObjects?: { id: string; type: string; text?: string; x: number; y: number }[];
  suggestedPositions?: SuggestedPosition[];
}

interface Tier2Context extends BoardStateContext {
  /** Pre-computed occupied zones injected as a compact hard no-go list. */
  occupiedZones?: OccupiedZone[];
  viewportBounds?: { x: number; y: number; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Mason system prompt
// ---------------------------------------------------------------------------

const MASON_SYSTEM_PROMPT = `You are The Mason — a silent, fast AI board operator for CrucibleCanvas.
Your mission: help users build complex, well-organized logic flows, diagrams, and structured boards
with precise 20px grid alignment and clean connector topology.

Rules:
- For 4+ objects or any connected diagram: call findAvailableSpace(neededWidth, neededHeight) FIRST,
  then use createFlowchart or createElementsBatch with the returned position as startX/startY.
- For flowcharts/process diagrams: always use createFlowchart — it handles layout and connectors automatically.
- For simple independent objects (≤3): use createStickyNote/createShape directly at the SUGGESTED OPEN POSITIONS.
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

Use stickyNote (not rectangle) for any element that must display text. rectangle is for decorative/structural
shapes only. For flowchart nodes without an explicit shape override, use stickyNote.

Default colors: yellow=#FEFF9C, pink=#FF7EB9, green=#98FF98, cyan=#7AFCFF
SWOT colors: Strengths=green, Weaknesses=pink, Opportunities=cyan, Threats=coral (#FFAB91)

Template labels:
- SWOT: "Strengths", "Weaknesses", "Opportunities", "Threats"
- Retrospective: "What Went Well", "What Didn't Go Well", "Action Items"
- Pros/Cons: "Pros", "Cons"
- User Journey: "Awareness", "Consideration", "Decision", "Onboarding", "Retention"`;

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the Mason system prompt with spatial hints and current selection context.
 * Used by Tier 2 (Sonnet streamText path) and as the legacy fallback.
 */
export function buildSystemPrompt(context: BoardStateContext): string {
  const posStr = context.suggestedPositions?.length
    ? context.suggestedPositions
        .map((p, i) => `  ${i + 1}. (${p.x}, ${p.y}) — ${p.label}${p.source === 'reflow' ? ' [below viewport]' : ''}`)
        .join('\n')
    : '  (No open positions found — call findAvailableSpace to locate clear space)';

  const selStr =
    context.selectedObjects?.length
      ? `\nSelected objects: ${context.selectedObjects
          .map((o) => `${o.id} ${o.type} at (${o.x},${o.y})`)
          .join('; ')}`
      : '';

  return `${MASON_SYSTEM_PROMPT}\n\nSUGGESTED OPEN POSITIONS:\n${posStr}${selStr}`;
}

/**
 * Builds the Tier 2 system prompt with compact occupied zones for hard spatial avoidance.
 * Occupied zones replace the verbose suggested-positions list — the AI calls
 * findAvailableSpace(W, H) to get a concrete clear anchor rather than guessing.
 */
export function buildTier2SystemPrompt(context: Tier2Context): string {
  const base = buildSystemPrompt(context);

  if (!context.occupiedZones?.length) {
    return base;
  }

  // Emit a compact blocked-zones section so the AI can reason about existing content
  // without needing the full object list. Each entry is a rectangular no-go area.
  const zoneLines = context.occupiedZones
    .slice(0, 20) // cap at 20 to keep prompt short
    .map(
      (z, i) =>
        `  ${i + 1}. "${z.label}" at (${Math.round(z.x)}, ${Math.round(z.y)}), ${Math.round(z.width)}×${Math.round(z.height)}`
    )
    .join('\n');

  const viewportStr = context.viewportBounds
    ? `\nViewport: (${Math.round(context.viewportBounds.x)}, ${Math.round(context.viewportBounds.y)}) ${Math.round(context.viewportBounds.width)}×${Math.round(context.viewportBounds.height)}`
    : '';

  return `${base}${viewportStr}\n\nOCCUPIED ZONES — hard no-go areas (call findAvailableSpace to get a safe starting position):\n${zoneLines}`;
}
