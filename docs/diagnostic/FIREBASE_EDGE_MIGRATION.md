# Firebase Edge Migration: Admin SDK → REST API

## Why the shift was needed

The AI command route (`/api/ai-command`) was originally a **Node.js** API route using `firebase-admin` for two purposes:

1. **Token verification** — `verifyIdToken()` validated the user's Firebase ID token
2. **Board writes** — AI tools (`createStickyNote`, `moveObject`, etc.) wrote board objects directly via the Admin SDK, bypassing Firestore Security Rules

`firebase-admin` requires Node.js-specific APIs (`crypto`, `http`, `stream`). This blocked the route from running as a **Vercel Edge Function**, which provides lower-latency streaming but has no Node.js runtime.

---

## What changed

### 1. Token verification → `jose` (JWKS)

Replaced `firebase-admin/auth` with lightweight JWT verification using [`jose`](https://github.com/panva/jose):

```ts
// Before (Node.js only)
import { verifyIdToken } from '@/lib/firebase/admin';
const decoded = await verifyIdToken(idToken);

// After (Edge-compatible)
import { createRemoteJWKSet, jwtVerify } from 'jose';
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com')
);
const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
  issuer: `https://securetoken.google.com/${projectId}`,
  audience: projectId,
});
```

Firebase ID tokens are standard JWTs signed with RS256. Google publishes its signing keys at the JWKS endpoint above. `jose` caches the key set and re-fetches on rotation — no firebase-admin required.

### 2. AI tool writes → Firestore REST API

Replaced `adminCreateObject` / `adminUpdateObject` / etc. with a new module `src/lib/firebase/firestoreRest.ts` that calls the [Firestore REST API](https://firebase.google.com/docs/firestore/reference/rest) authenticated with the **user's own ID token**:

```ts
// Before (Node.js only, bypasses Security Rules)
await adminCreateObject(boardId, { id, type: 'stickyNote', ... });

// After (Edge-compatible, goes through Security Rules)
await restCreateObject(boardId, { id, type: 'stickyNote', ... }, userToken);
```

The user's token is passed through from the request into every tool's `execute()` handler via a new `userToken` field on `ToolContext`. Firestore Security Rules already allow board members to write objects, so no rules changes were needed for this.

**Trade-offs of REST vs Admin SDK:**

| Concern | Admin SDK | REST API |
|---|---|---|
| Auth | Service account (bypasses rules) | User token (goes through rules) |
| Timestamps | `FieldValue.serverTimestamp()` | `new Date().toISOString()` (process time, not Firestore server time) |
| Batch writes | Atomic `db.batch()` | Parallel `Promise.all()` — not atomic |
| Edge runtime | ❌ Node.js only | ✅ Works anywhere |

The timestamp difference is acceptable for AI-generated objects (`createdAt`/`updatedAt`). The non-atomic batch for `arrangeInLayout` is acceptable for layout operations (partial application is recoverable).

### 3. Route runtime → Edge

```ts
// Before
export const runtime = 'nodejs';

// After
export const runtime = 'edge';
```

The route now starts streaming with lower cold-start latency on Vercel.

### 4. Anthropic provider — explicit base URL

`@ai-sdk/anthropic` reads `ANTHROPIC_BASE_URL` from the environment. If that env var is set to Vercel's AI Gateway (`https://ai-gateway.vercel.sh`), all requests fail with 405 because the gateway requires a separate `AI_GATEWAY_API_KEY`.

Fixed by constructing the provider with a hardcoded base URL:

```ts
// Before
import { anthropic } from '@ai-sdk/anthropic'; // reads ANTHROPIC_BASE_URL from env

// After
import { createAnthropic } from '@ai-sdk/anthropic';
const anthropic = createAnthropic({ baseURL: 'https://api.anthropic.com/v1' });
```

### 5. AI message `senderId` — user uid instead of `'ai'`

AI response messages are written client-side (in `useAICommand.ts`) after the stream completes. The Firestore rule was tightened to `senderId == request.auth.uid` (removing the `|| senderId == 'ai'` exception). To comply, the three `sendChatMessage` calls for AI responses now use `user.uid` instead of `'ai'`. The `type: 'ai_response'` field distinguishes them from group messages in the UI.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/firebase/firestoreRest.ts` | **New** — Edge-compatible Firestore REST helpers |
| `src/app/api/ai-command/route.ts` | Edge runtime, jose auth, explicit Anthropic baseURL |
| `src/lib/ai/tools.ts` | REST helpers replace Admin SDK; `userToken` added to `ToolContext` |
| `firestore.rules` | `senderId == request.auth.uid` only (removed `'ai'` exception) |
| `src/hooks/useAICommand.ts` | AI message `senderId` → `user.uid` |
| `src/components/chat/ChatMessage.tsx` | `formatTimestamp` explicitly handles `null` (pending serverTimestamp) |
| `src/lib/types.ts` | `ChatMessage.createdAt` type includes `| null` |

---

## What was NOT changed

- `src/lib/firebase/admin.ts` — still present; used by any future Node.js routes
- `src/lib/firebase/firestore.ts` — human-to-human messages still use the Firestore Client SDK directly (BaaS pattern; no API route involved)
- AI tool logic and schemas — unchanged
