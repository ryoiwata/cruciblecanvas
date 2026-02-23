/**
 * tierClassifier.ts — fast Haiku-based command tier classifier.
 * A single non-streaming generateObject call determines whether the user's
 * command needs Tier 1 (direct, ≤3 simple objects) or Tier 2 (complex, 4+
 * objects / diagrams). For Tier 1, the extraction is done in the same call.
 *
 * Keeping this prompt short (≤300 tokens) ensures Haiku returns in <200ms.
 */

import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

// Directly target Anthropic's API (same override as route.ts)
const anthropic = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SimpleObjectSpecSchema = z.object({
  type: z.enum(['stickyNote', 'rectangle', 'circle', 'text']).describe('Object type'),
  text: z.string().optional().describe('Text content'),
  color: z.string().optional().describe('Hex color, e.g. #FEFF9C'),
});

const ClassificationSchema = z.discriminatedUnion('tier', [
  z.object({
    tier: z.literal('simple'),
    objects: z.array(SimpleObjectSpecSchema).max(3).describe('Up to 3 objects to create'),
    summaryText: z.string().describe('One-line confirmation, e.g. "Created 1 yellow sticky note."'),
  }),
  z.object({
    tier: z.literal('complex'),
    estimatedCount: z.number().int().describe('Approximate number of objects needed'),
    layoutHint: z
      .enum(['flowchart', 'grid', 'list', 'freeform'])
      .optional()
      .describe('Best layout for the content'),
  }),
]);

export type ClassificationResult = z.infer<typeof ClassificationSchema>;
export type SimpleObjectSpec = z.infer<typeof SimpleObjectSpecSchema>;

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

const CLASSIFIER_SYSTEM_PROMPT = `You classify whiteboard commands as "simple" or "complex".

SIMPLE: 1–3 individual objects with no connections between them (single sticky note, a few shapes, one text label).
COMPLEX: 4+ objects, or any flowchart/diagram, or objects that need connectors/arrows between them.

For SIMPLE commands, also extract the object list with type, text, and color.
Default colors: yellow=#FEFF9C, pink=#FF7EB9, green=#98FF98, cyan=#7AFCFF, white=#FFFFFF.
Use "rectangle" for generic boxes/cards. Use "stickyNote" for notes/ideas.`;

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

  return object;
}
