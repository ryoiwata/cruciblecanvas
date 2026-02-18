/**
 * /api/ai-command — AI board agent endpoint.
 * Accepts @ai commands from authenticated users, streams Claude's response
 * with tool calling for board manipulation. Uses Node.js runtime (not Edge)
 * because firebase-admin requires Node.js APIs.
 *
 * Request: POST with Authorization: Bearer <Firebase ID Token>
 * Body: { message, boardId, boardState, selectedObjectIds, persona, aiCommandId }
 * Response: SSE stream (text/event-stream via Vercel AI SDK)
 */

export const runtime = 'nodejs';

import { streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { verifyIdToken, adminRollbackPending } from '@/lib/firebase/admin';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { createAITools } from '@/lib/ai/tools';
import type { AIBoardContext } from '@/lib/ai/context';
import type { AiPersona } from '@/lib/types';

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
  let decodedToken;
  try {
    decodedToken = await verifyIdToken(idToken);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid authorization token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = decodedToken.uid;
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
    return new Response(JSON.stringify({ error: 'Missing required fields: message, boardId, aiCommandId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate the message does not contain obvious injection attempts
  if (message.length > 2000) {
    return new Response(JSON.stringify({ error: 'Message too long (max 2000 characters)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Build system prompt
  // ---------------------------------------------------------------------------
  const selectedObjects = boardState?.visibleObjects?.filter((o) =>
    selectedObjectIds?.includes(o.id)
  ) ?? [];

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
  // ---------------------------------------------------------------------------
  const tools = createAITools({ boardId, userId, aiCommandId });

  try {
    const result = streamText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      tools,
      stopWhen: stepCountIs(15),
      onError: async ({ error }) => {
        console.error('[AI] streamText error:', error);
        // Rollback any pending objects on error
        await adminRollbackPending(boardId, aiCommandId).catch(console.error);
      },
    });

    return result.toTextStreamResponse({
      headers: {
        // Include isAnonymous flag for rate limit display
        'X-Is-Anonymous': isAnonymous ? '1' : '0',
      },
    });
  } catch (err) {
    console.error('[AI] Failed to start streaming:', err);
    // Rollback any partially-created pending objects
    await adminRollbackPending(boardId, aiCommandId).catch(console.error);

    return new Response(JSON.stringify({ error: 'AI service error. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
