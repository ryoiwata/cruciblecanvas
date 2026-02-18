/**
 * /api/ai-command — AI board agent endpoint.
 * Accepts @ai commands from authenticated users, streams Claude's response
 * with tool calling for board manipulation.
 *
 * Runs on the Vercel Edge runtime for low-latency streaming. Authentication
 * uses jose (lightweight JWT verification against Google's public JWKS) instead
 * of firebase-admin, which requires Node.js APIs unavailable in Edge.
 *
 * LangSmith tracing is applied via wrapAISDK so every streamText invocation
 * (including multi-step tool calls) is recorded as a run in LangSmith.
 *
 * NOTE: The `after()` hook for post-response trace flushing requires Next.js 15+.
 * On Next.js 14.x, pending traces are flushed asynchronously in the background.
 * Upgrade to Next.js 15 and import `after` from `next/server` to use the proper
 * post-response callback (add `experimental: { after: true }` to next.config.mjs).
 *
 * Request: POST with Authorization: Bearer <Firebase ID Token>
 * Body: { message, boardId, boardState, selectedObjectIds, persona, aiCommandId }
 * Response: SSE stream (text/event-stream via Vercel AI SDK)
 */

export const runtime = 'edge';

import {
  streamText as baseStreamText,
  generateText,
  wrapLanguageModel,
  stepCountIs,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Client } from 'langsmith';
import { wrapAISDK } from 'langsmith/experimental/vercel';

// Explicitly target Anthropic's API, bypassing the ANTHROPIC_BASE_URL env var
// which may be set to Vercel's AI Gateway (requires separate AI_GATEWAY_API_KEY).
const anthropic = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

import { buildSystemPrompt } from '@/lib/ai/prompts';
import { createAITools } from '@/lib/ai/tools';
import type { AIBoardContext } from '@/lib/ai/context';
import type { AiPersona } from '@/lib/types';

// ---------------------------------------------------------------------------
// LangSmith setup — module-level client and wrapped streamText
// ---------------------------------------------------------------------------
// Reads LANGSMITH_API_KEY automatically from environment variables.
// Set LANGSMITH_TRACING=true and LANGSMITH_API_KEY in .env.local to enable.
const langsmithClient = new Client();

// wrapAISDK returns drop-in replacements for the AI SDK functions that
// record each call (including streamed tool-use steps) as a LangSmith run.
// All required SDK functions must be provided so wrapAISDK can patch them.
const { streamText } = wrapAISDK(
  { streamText: baseStreamText, generateText, wrapLanguageModel },
  { client: langsmithClient }
);

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

  const { message, boardId, boardState, selectedObjectIds, persona, aiCommandId } = body;

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
    },
    persona ?? 'neutral'
  );

  // ---------------------------------------------------------------------------
  // 4. Stream Claude response with tool calling
  // Tools authenticate with the user's ID token (BaaS pattern: user writes
  // through Security Rules rather than bypassing them with admin credentials).
  // ---------------------------------------------------------------------------
  const tools = createAITools({ boardId, userId, aiCommandId, userToken: idToken });

  try {
    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      tools,
      stopWhen: stepCountIs(15),
      onError: ({ error }: { error: unknown }) => {
        // Client-side useAICommand handles rollback via deleteObjectsByAiCommand
        console.error('[AI] streamText error:', error);
      },
    });

    // Flush buffered LangSmith trace events after this invocation.
    // Fire-and-forget so it does not delay the response stream.
    // On Next.js 15+, use the `after()` hook from `next/server` instead
    // so the flush runs after the edge function response is fully sent.
    void langsmithClient.awaitPendingTraceBatches();

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
