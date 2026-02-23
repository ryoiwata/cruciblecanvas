/**
 * /api/ai-command — AI board agent endpoint.
 * Accepts @ai commands from authenticated users. Implements a two-tier strategy:
 *
 * Tier 1 (simple, ≤3 objects): Single Haiku generateObject call classifies +
 * extracts the creation spec. Server computes clear positions via findClearRect.
 * Objects are written immediately (isAIPending: false). ~500ms wall-clock.
 *
 * Tier 2 (complex, diagrams, 4+ objects): Sonnet streamText with tool calling.
 * Compact occupied-zones block injected into prompt. Enhanced tools:
 * findAvailableSpace, createFlowchart, createElementsBatch.
 *
 * Runs on the Node.js runtime so that the OpenTelemetry NodeSDK (initialised in
 * src/instrumentation.ts) is available. Authentication uses jose (lightweight JWT
 * verification against Google's public JWKS) — no firebase-admin dependency needed.
 *
 * Request: POST with Authorization: Bearer <Firebase ID Token>
 * Body: { message, boardId, boardState, selectedObjectIds, aiCommandId, suggestedPositions?, viewportBounds? }
 * Response: SSE stream (text/event-stream via Vercel AI SDK) or plain text for Tier 1
 */

export const runtime = 'nodejs';

import { streamText, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { v4 as uuidv4 } from 'uuid';

// Explicitly target Anthropic's API, bypassing the ANTHROPIC_BASE_URL env var
// which may be set to Vercel's AI Gateway (requires separate AI_GATEWAY_API_KEY).
const anthropic = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

import { buildTier2SystemPrompt } from '@/lib/ai/prompts';
import { createAITools } from '@/lib/ai/tools';
import { classifyAndExtract } from '@/lib/ai/tierClassifier';
import {
  computeOccupiedZones,
  findClearRect,
  findContainingFrame,
} from '@/lib/ai/spatialPlanning';
import { restCreateObject } from '@/lib/firebase/firestoreRest';
import type { AIBoardContext } from '@/lib/ai/context';
import type { SuggestedPosition } from '@/lib/ai/spatialPlanning';
import type { BoardObject, ObjectType } from '@/lib/types';
import { STICKY_NOTE_DEFAULT } from '@/lib/types';

// Firebase publishes its token-signing keys at this JWKS endpoint.
// jose caches the key set and re-fetches when keys rotate.
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com'
  )
);

interface FirebaseTokenPayload {
  sub: string;
  firebase?: { sign_in_provider?: string };
  [key: string]: unknown;
}

/**
 * Verifies a Firebase ID token using Google's public JWKS.
 * Works in Edge runtime without firebase-admin.
 */
async function verifyFirebaseToken(token: string): Promise<FirebaseTokenPayload> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not configured');
  }

  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  return payload as FirebaseTokenPayload;
}

/** A single message in a multi-turn conversation history. */
interface TurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AICommandRequestBody {
  message: string;
  /**
   * Optional turn history for clarification replies (last 3–5 turns).
   * When present, the final element must be the current user message.
   * When absent, the route constructs a single-turn request from `message`.
   */
  messages?: TurnMessage[];
  boardId: string;
  boardState: AIBoardContext;
  selectedObjectIds: string[];
  aiCommandId: string;
  suggestedPositions?: SuggestedPosition[];
  viewportBounds?: { x: number; y: number; width: number; height: number };
}

/**
 * Reconstructs a minimal BoardObject map from AIBoardContext for server-side spatial computation.
 * AIObjectSummary has all spatial fields needed (x, y, width, height, type, id).
 */
function buildBoardObjectsFromContext(boardState: AIBoardContext): Record<string, BoardObject> {
  const result: Record<string, BoardObject> = {};

  for (const obj of boardState.visibleObjects) {
    result[obj.id] = {
      id: obj.id,
      type: obj.type as ObjectType,
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      color: obj.color,
      createdBy: '',
      createdAt: 0,
      updatedAt: 0,
      ...(obj.parentFrame ? { parentFrame: obj.parentFrame } : {}),
    };
  }

  return result;
}

const GRID_SNAP = 20;
function snapToGrid(value: number): number {
  return Math.round(value / GRID_SNAP) * GRID_SNAP;
}

export async function POST(req: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // 1. Authenticate the request
  // ---------------------------------------------------------------------------
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing authorization token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const idToken = authHeader.slice(7);
  let decodedToken: FirebaseTokenPayload;
  try {
    decodedToken = await verifyFirebaseToken(idToken);
  } catch (err) {
    console.error('[AI] Token verification failed:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Invalid authorization token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = decodedToken.sub;
  const isAnonymous = decodedToken.firebase?.sign_in_provider === 'anonymous';

  // ---------------------------------------------------------------------------
  // 2. Parse and validate request body
  // ---------------------------------------------------------------------------
  let body: AICommandRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    message,
    messages: turnHistory,
    boardId,
    boardState,
    selectedObjectIds,
    aiCommandId,
    suggestedPositions,
    viewportBounds,
  } = body;

  if (!message || !boardId || !aiCommandId) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: message, boardId, aiCommandId' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (message.length > 2000) {
    return new Response(
      JSON.stringify({ error: 'Message too long (max 2000 characters)' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Classify the command (Haiku, fast, non-streaming)
  // ---------------------------------------------------------------------------
  let classification: Awaited<ReturnType<typeof classifyAndExtract>> | null = null;
  try {
    classification = await classifyAndExtract(message);
  } catch (err) {
    // Non-fatal: fall through to Tier 2 (Sonnet) as a safe fallback
    console.warn('[AI] Classifier failed, falling back to Tier 2:', err instanceof Error ? err.message : err);
  }

  // ---------------------------------------------------------------------------
  // 4a. Tier 1 — Direct structured write (simple commands, ≤3 objects)
  // ---------------------------------------------------------------------------
  if (classification?.tier === 'simple') {
    const boardObjects = buildBoardObjectsFromContext(boardState);
    const occupied = computeOccupiedZones(boardObjects);
    const searchOrigin = {
      x: viewportBounds?.x ?? 0,
      y: viewportBounds?.y ?? 0,
    };

    // Default dimensions by type for clear-rect sizing
    const createdIds: string[] = [];

    try {
      // Compute positions sequentially so each placed object is considered for the next
      const placedZones = [...occupied];

      await Promise.all(
        classification.objects.map(async (spec, idx) => {
          // Convert rectangle/circle with text to stickyNote — shapes cannot display text
          const rawType = spec.type;
          const effectiveType: ObjectType =
            (rawType === 'rectangle' || rawType === 'circle') && spec.text?.trim()
              ? 'stickyNote'
              : (rawType as ObjectType);

          const isSticky = effectiveType === 'stickyNote';
          const objW = isSticky ? STICKY_NOTE_DEFAULT.width : 160;
          const objH = isSticky ? STICKY_NOTE_DEFAULT.height : 80;

          // Offset origin slightly for each object to avoid re-scanning from the same point
          const origin = {
            x: searchOrigin.x + idx * 20,
            y: searchOrigin.y,
          };

          const pos = findClearRect(placedZones, objW, objH, origin);
          const snappedX = snapToGrid(pos.x);
          const snappedY = snapToGrid(pos.y);
          const snappedW = snapToGrid(objW);
          const snappedH = snapToGrid(objH);

          // Add the placed object as an occupied zone so subsequent placements avoid it
          placedZones.push({
            x: snappedX - 20,
            y: snappedY - 20,
            width: snappedW + 40,
            height: snappedH + 40,
            label: `tier1:${effectiveType}`,
          });

          const id = uuidv4();
          createdIds.push(id);

          const defaultColor =
            effectiveType === 'stickyNote'
              ? '#FEFF9C'
              : effectiveType === 'circle'
              ? '#7AFCFF'
              : '#F3F4F6';

          // Auto-frame: if the object's center falls inside a frame, set parentFrame
          const parentFrame = findContainingFrame(boardObjects, snappedX, snappedY, snappedW, snappedH);

          await restCreateObject(
            boardId,
            {
              id,
              type: effectiveType,
              text: spec.text ?? '',
              x: snappedX,
              y: snappedY,
              width: snappedW,
              height: snappedH,
              color: spec.color ?? defaultColor,
              createdBy: userId,
              isAIGenerated: true,
              isAIPending: false, // Tier 1: confirmed immediately (no streaming rollback)
              aiCommandId,
              ...(parentFrame ? { parentFrame } : {}),
            },
            idToken
          );
        })
      );
    } catch (err) {
      console.error('[AI] Tier 1 write failed:', err);
      return new Response(
        JSON.stringify({ error: 'Failed to create objects. Please try again.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Stream the summary text so the client's useAIStream reader works unchanged
    const summaryText = classification.summaryText;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(summaryText));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Is-Anonymous': isAnonymous ? '1' : '0',
        'X-Tier': '1',
        'X-Created-Ids': createdIds.join(','),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 4b. Tier 2 — Plan-then-batch (Sonnet with spatial tools)
  // ---------------------------------------------------------------------------
  const boardObjects = buildBoardObjectsFromContext(boardState);
  const occupiedZones = computeOccupiedZones(boardObjects);

  const selectedObjects =
    boardState?.visibleObjects?.filter((o) => selectedObjectIds?.includes(o.id)) ?? [];

  const systemPrompt = buildTier2SystemPrompt({
    objectCount: boardState?.totalObjects ?? 0,
    visibleCount: boardState?.visibleObjects?.length ?? 0,
    selectedCount: selectedObjectIds?.length ?? 0,
    frameCount: boardState?.frames?.length ?? 0,
    topics: [],
    colorLegend: boardState?.colorLegend ?? [],
    selectedObjects: selectedObjects.map((o) => ({
      id: o.id,
      type: o.type,
      text: o.text,
      x: o.x,
      y: o.y,
    })),
    suggestedPositions: suggestedPositions ?? [],
    occupiedZones,
    viewportBounds,
  });

  // Provide boardObjects and viewportBounds to spatial tools so they can call
  // findClearRect without additional Firestore reads.
  const allTools = createAITools({
    boardId,
    userId,
    aiCommandId,
    userToken: idToken,
    boardObjects,
    viewportBounds,
  });

  // Mason is the only persona — strip analytical tools (operational-only).
  const MASON_EXCLUDED_TOOLS = new Set(['redTeamThis', 'mapDecision', 'findGaps']);
  const tools = Object.fromEntries(
    Object.entries(allTools).filter(([name]) => !MASON_EXCLUDED_TOOLS.has(name))
  ) as typeof allTools;

  // When the client supplies turn history (clarification reply), use the full
  // conversation so Mason can see its own question and the user's answer.
  // Otherwise fall back to single-turn for regular commands.
  const chatMessages: TurnMessage[] =
    turnHistory && turnHistory.length > 0
      ? turnHistory
      : [{ role: 'user', content: message }];

  try {
    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: systemPrompt,
      messages: chatMessages,
      tools,
      stopWhen: stepCountIs(30),
      // OTel spans are emitted by the AI SDK and captured by LangfuseSpanProcessor
      // (initialised in src/instrumentation.ts) for Langfuse observability.
      experimental_telemetry: { isEnabled: true },
      onError: ({ error }: { error: unknown }) => {
        // Client-side useAICommand handles rollback via deleteObjectsByAiCommand
        console.error('[AI] streamText error:', error);
      },
    });

    return result.toTextStreamResponse({
      headers: {
        // Inform the client whether this is an anonymous session (affects rate-limit UI)
        'X-Is-Anonymous': isAnonymous ? '1' : '0',
        'X-Tier': '2',
      },
    });
  } catch (err) {
    console.error('[AI] Failed to start streaming:', err);
    return new Response(
      JSON.stringify({ error: 'AI service error. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
