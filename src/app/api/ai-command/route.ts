/**
 * /api/ai-command — AI board agent endpoint.
 * Accepts @ai commands from authenticated users, streams Claude's response
 * with tool calling for board manipulation.
 *
 * Runs on the Node.js runtime so that the OpenTelemetry NodeSDK (initialised in
 * src/instrumentation.ts) is available. Authentication uses jose (lightweight JWT
 * verification against Google's public JWKS) — no firebase-admin dependency needed.
 *
 * Langfuse observability is provided via OpenTelemetry. The NodeSDK (with
 * LangfuseSpanProcessor) is started in src/instrumentation.ts at server startup.
 * Passing `experimental_telemetry: { isEnabled: true }` to streamText causes the
 * Vercel AI SDK to emit OTel spans that LangfuseSpanProcessor forwards to Langfuse.
 *
 * Request: POST with Authorization: Bearer <Firebase ID Token>
 * Body: { message, boardId, boardState, selectedObjectIds, persona, aiCommandId }
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

import { buildSystemPrompt } from '@/lib/ai/prompts';
import { createAITools } from '@/lib/ai/tools';
import type { AIBoardContext } from '@/lib/ai/context';
import type { SuggestedPosition } from '@/lib/ai/spatialPlanning';
import type { AiPersona } from '@/lib/types';

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

interface AICommandRequestBody {
  message: string;
  boardId: string;
  boardState: AIBoardContext;
  selectedObjectIds: string[];
  persona: AiPersona;
  aiCommandId: string;
  suggestedPositions?: SuggestedPosition[];
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

  const { message, boardId, boardState, selectedObjectIds, persona, aiCommandId, suggestedPositions } = body;

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
  // 3. Build system prompt
  // ---------------------------------------------------------------------------
  const selectedObjects =
    boardState?.visibleObjects?.filter((o) => selectedObjectIds?.includes(o.id)) ?? [];

  const systemPrompt = buildSystemPrompt(
    {
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
    },
    persona ?? 'mason'
  );

  // ---------------------------------------------------------------------------
  // 4. Stream Claude response with tool calling
  // Tools authenticate with the user's ID token (BaaS pattern: user writes
  // through Security Rules rather than bypassing them with admin credentials).
  // Mason persona only gets operational tools — analytical tools are stripped.
  // ---------------------------------------------------------------------------
  const allTools = createAITools({ boardId, userId, aiCommandId, userToken: idToken });

  // Mason persona only gets operational tools — analytical-only tools are excluded.
  const MASON_EXCLUDED_TOOLS = new Set(['redTeamThis', 'mapDecision', 'findGaps']);
  const tools = (persona ?? 'mason') === 'mason'
    ? (Object.fromEntries(
        Object.entries(allTools).filter(([name]) => !MASON_EXCLUDED_TOOLS.has(name))
      ) as typeof allTools)
    : allTools;

  try {
    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      tools,
      stopWhen: stepCountIs(15),
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
