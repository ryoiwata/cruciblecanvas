/**
 * tierClassifier.ts — fast Haiku-based command tier classifier.
 * A single non-streaming generateObject call determines whether the user's
 * command needs Tier 1 (direct, ≤3 simple objects) or Tier 2 (complex, 4+
 * objects / diagrams). For Tier 1, the extraction is done in the same call.
 *
 * Keeping this prompt short (≤300 tokens) ensures Haiku returns in <200ms.
 *
 * NOTE: Anthropic's structured-output API does not support `oneOf` (produced by
 * Zod discriminatedUnion). We use a single flat object schema instead and narrow
 * the tier programmatically after the call.
 */

import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

// Directly target Anthropic's API (same override as route.ts)
const anthropic = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

// ---------------------------------------------------------------------------
// Schema — flat to avoid oneOf which Anthropic does not support
// ---------------------------------------------------------------------------

const SimpleObjectSpecSchema = z.object({
  type: z.enum(['stickyNote', 'rectangle', 'circle', 'text']).describe('Object type'),
  text: z.string().optional().describe('Text content'),
  color: z.string().optional().describe('Hex color, e.g. #FEFF9C'),
});

/**
 * Flat schema — no discriminatedUnion/oneOf.
 * Simple tier: tier="simple", objects populated, summaryText populated.
 * Complex tier: tier="complex", estimatedCount populated, layoutHint optionally populated.
 */
const ClassificationSchema = z.object({
  tier: z.enum(['simple', 'complex']).describe(
    '"simple" for 1–3 individual objects with no connections. "complex" for 4+ objects, flowcharts, or anything needing connectors.'
  ),
  // --- simple tier fields ---
  objects: z
    .array(SimpleObjectSpecSchema)
    .optional()
    .describe('Objects to create. Populate only when tier="simple". Maximum 3 items.'),
  summaryText: z
    .string()
    .optional()
    .describe('One-line confirmation for tier="simple", e.g. "Created 1 yellow sticky note."'),
  // --- complex tier fields ---
  estimatedCount: z
    .number()
    .optional()
    .describe('Approximate number of objects needed. Populate only when tier="complex".'),
  layoutHint: z
    .enum(['flowchart', 'grid', 'list', 'freeform'])
    .optional()
    .describe('Best layout type. Populate only when tier="complex".'),
});

export type SimpleObjectSpec = z.infer<typeof SimpleObjectSpecSchema>;

export type SimpleResult = {
  tier: 'simple';
  objects: SimpleObjectSpec[];
  summaryText: string;
};

export type ComplexResult = {
  tier: 'complex';
  estimatedCount?: number;
  layoutHint?: 'flowchart' | 'grid' | 'list' | 'freeform';
};

export type ClassificationResult = SimpleResult | ComplexResult;

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

const CLASSIFIER_SYSTEM_PROMPT = `You classify whiteboard commands as "simple" or "complex".

SIMPLE: 1–3 individual objects with no connections between them (single sticky note, a few shapes, one text label).
COMPLEX: 4+ objects, or any flowchart/diagram, or objects that need connectors/arrows between them.

For SIMPLE commands, populate "objects" (up to 3) and "summaryText".
For COMPLEX commands, populate "estimatedCount" and optionally "layoutHint".
Default colors: yellow=#FEFF9C, pink=#FF7EB9, green=#98FF98, cyan=#7AFCFF.
Use "stickyNote" for notes/ideas, "rectangle" for generic boxes.`;

/**
 * Classifies the user's command and, for simple commands, extracts the creation spec.
 * Falls through to the complex path if this call throws.
 */
export async function classifyAndExtract(message: string): Promise<ClassificationResult> {
  const { object } = await generateObject({
    model: anthropic('claude-haiku-4-5-20251001'),
    system: CLASSIFIER_SYSTEM_PROMPT,
    prompt: message,
    schema: ClassificationSchema,
    // No telemetry here — cheap classifier call; keep it lightweight.
  });

  if (object.tier === 'simple') {
    // Clamp to 3 here since maxItems is not supported in Anthropic's JSON Schema
    const objects = (object.objects ?? []).slice(0, 3);
    return {
      tier: 'simple',
      objects,
      summaryText: object.summaryText ?? `Created ${objects.length} object(s).`,
    };
  }

  return {
    tier: 'complex',
    estimatedCount: object.estimatedCount,
    layoutHint: object.layoutHint,
  };
}
