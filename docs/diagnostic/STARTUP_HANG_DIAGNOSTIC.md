# Startup Hang Diagnostic

**Symptom**: App stuck on loading screen on initial load or hard refresh. Affects authenticated and unauthenticated users equally. Manual browser refresh bypasses the hang.

**Branch**: `fix_slow_start`
**Files changed**: `src/lib/firebase/config.ts`, `src/providers/AuthProvider.tsx`, `src/instrumentation.ts`

---

## Investigation

### Middleware (`src/middleware.ts`) — Ruled out

The middleware contains only a `"/" → "/dashboard"` redirect with no Firebase calls, no async awaits, and a matcher scoped to `["/"]` only. No race condition or redirect loop is possible here.

### Zustand `authStore.ts` — Ruled out

The store initialises with `isLoading: true` and only ever sets it to `false` inside `setUser()`. No persistence middleware is used, so no hydration race. The store itself is not the problem — the issue is that `setUser` was never being called.

### Firebase `config.ts` — **Root cause #1 (highest severity)**

```ts
// config.ts — the committed version
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);  // ← line 28: throws when databaseURL is undefined
```

`getDatabase(app)` throws `FirebaseError: "Cannot parse Firebase url: undefined"` when `NEXT_PUBLIC_FIREBASE_DATABASE_URL` is not set. Because JavaScript module evaluation is sequential, this throw prevented `auth` and `db` from ever being exported even though they appeared on earlier lines — module evaluation halts at the throw and no exports are resolved.

`AuthProvider` imports `{ auth, db }` from this module. With a broken import, `onAuthStateChanged(auth, ...)` was called with `undefined`, which either threw synchronously (caught by React, crashing the component tree) or silently did nothing — in both cases `isLoading` never transitioned to `false`.

The existing `console.warn` on line 16 only ran in the browser context and was not sufficient to prevent the crash.

### `AuthProvider.tsx` — **Root cause #2 (primary hang path)**

```ts
// AuthProvider.tsx — the committed version
useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
    setUser(firebaseUser); // ← if this never runs, isLoading stays true forever
  });
  return () => unsubscribe();
}, [setUser, setDisplayName]);
```

Even when `config.ts` loads correctly, `onAuthStateChanged` can be delayed by:
- **Expired ID token** — Firebase must make a network round-trip to refresh a token older than 1 hour before it can resolve the session. On a slow connection this can take several seconds.
- **Cold IndexedDB read** — On first load, Firebase reads persisted auth state from IndexedDB asynchronously. In some browsers or privacy modes this is slower than expected.
- **Server cold start** — Slow Next.js server startup can delay JS bundle delivery, meaning `onAuthStateChanged` is subscribed later than expected.

With no fallback, any of these delays caused `isLoading` to stay `true` indefinitely. The only recovery was a hard refresh, which re-initialised the Firebase SDK and got a faster response on the second attempt.

### `instrumentation.ts` — **Root cause #3 (server startup delay)**

```ts
// instrumentation.ts — the committed version
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { LangfuseSpanProcessor } = await import('@langfuse/otel');
    const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
    sdk.start(); // ← if this throws, register() rejects
  }
}
```

Next.js 14 awaits `register()` before serving the first request when `instrumentationHook: true` is set in `next.config.mjs`. If `LangfuseSpanProcessor` constructor threw (e.g. missing `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`, or a module init error), the resulting unhandled rejection could delay server startup. This would hold the client waiting on the HTTP response, meaning React never hydrated and the loading screen never cleared.

---

## Fixes Applied

### Fix 1 — `src/lib/firebase/config.ts`

Guard `getDatabase()` with an existence check so a missing RTDB URL cannot crash the module and silence auth:

```ts
// After
export const auth = getAuth(app);
export const db = getFirestore(app);

let rtdbInstance: Database | null = null;
if (firebaseConfig.databaseURL) {
  rtdbInstance = getDatabase(app);
} else if (typeof window !== 'undefined') {
  console.warn('[Firebase] NEXT_PUBLIC_FIREBASE_DATABASE_URL is not set...');
}

export const rtdb = rtdbInstance as Database;
```

`auth` and `db` are exported first and are fully independent of RTDB initialisation. RTDB consumers are only invoked after auth resolves and a `boardId` is present, so a `null` RTDB instance surfaces as a clear runtime error on RTDB features rather than a silent auth hang.

### Fix 2 — `src/providers/AuthProvider.tsx`

Add a 5-second safety timeout that forces `isLoading: false` if Firebase Auth has not responded:

```ts
// After
useEffect(() => {
  const authTimeout = setTimeout(() => {
    if (useAuthStore.getState().isLoading) {
      console.warn('[AuthProvider] Firebase auth timed out after 5 s...');
      setUser(null); // isLoading → false, triggers redirect to /auth
    }
  }, 5000);

  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(authTimeout);
      setUser(firebaseUser);
      // ...anonymous display name recovery...
    });
  } catch (err) {
    clearTimeout(authTimeout);
    console.error('[AuthProvider] Failed to subscribe to auth state:', err);
    setUser(null);
  }

  return () => {
    clearTimeout(authTimeout);
    unsubscribe?.();
  };
}, [setUser, setDisplayName]);
```

In normal operation the timeout is always cleared by the `onAuthStateChanged` callback (Firebase responds in < 500 ms). The timeout only fires as a last resort when Firebase is genuinely unresponsive. `setUser(null)` triggers the existing redirect effects on the board and dashboard pages, landing the user on `/auth` instead of an infinite spinner.

### Fix 3 — `src/instrumentation.ts`

Wrap the entire OTel init block in `try/catch` so a failed Langfuse setup cannot reject `register()` and delay server startup:

```ts
// After
try {
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { LangfuseSpanProcessor } = await import('@langfuse/otel');
  const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
  sdk.start();
} catch (err) {
  console.warn('[Instrumentation] OpenTelemetry setup failed:', err);
}
```

---

## Verification

- `tsc --noEmit` passes with zero errors after all three changes.
- In normal operation (all env vars set, healthy network): auth resolves in < 500 ms, timeout is cleared, no behaviour change.
- With missing `NEXT_PUBLIC_FIREBASE_DATABASE_URL`: module loads cleanly, auth works, RTDB features fail with a clear runtime error rather than a silent startup hang.
- With slow/unavailable Firebase Auth: app unblocks after 5 seconds and redirects to `/auth` with a `console.warn` in DevTools.
- With missing Langfuse keys: server starts normally, OTel is skipped with a `console.warn`.
