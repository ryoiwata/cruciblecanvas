/**
 * /api/ai-command — AI board agent endpoint.
 * Accepts @ai commands from authenticated users and streams the response via
 * Sonnet with full tool-calling support (findAvailableSpace, createFlowchart,
 * createElementsBatch, etc.).
 *
 * Runs on the Node.js runtime so that the OpenTelemetry NodeSDK (initialised in
 * src/instrumentation.ts) is available. Authentication uses jose (lightweight JWT
 * verification against Google's public JWKS) — no firebase-admin dependency needed.
 *
 * Request: POST with Authorization: Bearer <Firebase ID Token>
 * Body: { message, boardId, boardState, selectedObjectIds, aiCommandId, suggestedPositions?, viewportBounds? }
 * Response: SSE stream (text/event-stream via Vercel AI SDK)
 */

export const runtime = 'nodejs';

import { streamText, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// Explicitly target Anthropic's API, bypassing the ANTHROPIC_BASE_URL env var
// which may be set to Vercel's AI Gateway (requires separate AI_GATEWAY_API_KEY).
const anthropic = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

import { buildTier2SystemPrompt } from '@/lib/ai/prompts';
import { createAITools } from '@/lib/ai/tools';
import { computeOccupiedZones } from '@/lib/ai/spatialPlanning';
import type { AIBoardContext } from '@/lib/ai/context';
import type { SuggestedPosition } from '@/lib/ai/spatialPlanning';
import type { BoardObject, ObjectType } from '@/lib/types';

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
  // 3. Build spatial context and system prompt
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

  // ---------------------------------------------------------------------------
  // 4. Stream response via Sonnet with full tool-calling support
  // ---------------------------------------------------------------------------
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
        'X-Is-Anonymous': isAnonymous ? '1' : '0',
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
