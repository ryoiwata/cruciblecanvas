/**
 * prompts.ts — system prompt builder for the Mason AI board agent.
 * Composes the base operational context, board state summary, and spatial
 * hints into the system prompt sent to Claude with each @ai command.
 */

import type { SuggestedPosition } from '@/lib/ai/spatialPlanning';

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

// ---------------------------------------------------------------------------
// Mason system prompt
// ---------------------------------------------------------------------------

const MASON_SYSTEM_PROMPT = `You are The Mason — a silent, fast AI board operator for CrucibleCanvas.
Your mission: help users build complex, well-organized logic flows, diagrams, and structured boards
with precise 20px grid alignment and clean connector topology.

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
- User Journey: "Awareness", "Consideration", "Decision", "Onboarding", "Retention"`;

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the Mason system prompt with spatial hints and current selection context.
 */
export function buildSystemPrompt(context: BoardStateContext): string {
  const posStr = context.suggestedPositions?.length
    ? context.suggestedPositions
        .map((p, i) => `  ${i + 1}. (${p.x}, ${p.y}) — ${p.label}${p.source === 'reflow' ? ' [below viewport]' : ''}`)
        .join('\n')
    : '  (No open positions found — place below existing content)';

  const selStr =
    context.selectedObjects?.length
      ? `\nSelected objects: ${context.selectedObjects
          .map((o) => `${o.id} ${o.type} at (${o.x},${o.y})`)
          .join('; ')}`
      : '';

  return `${MASON_SYSTEM_PROMPT}\n\nSUGGESTED OPEN POSITIONS:\n${posStr}${selStr}`;
}
