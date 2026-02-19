# Dev First-Request Hang Diagnostic

**Symptom**: App stuck on blank/loading screen for 3–4 seconds after `rm -rf .next && npm run dev`. Navigating to `http://localhost:3000` in a browser shows nothing until the page finally loads. A manual refresh is instant.

**Branch**: `fix_slow_start`
**Files changed**: `scripts/dev-warm.js` (new), `package.json`, `next.config.mjs`

---

## Investigation

### Reproduction

```bash
rm -rf .next && npm run dev
# open http://localhost:3000 immediately — stuck for ~3.7 s
# refresh — instant
```

Confirmed with `curl` timing:

```
# First request
time curl -s -L http://localhost:3000 -o /dev/null
real  0m3.736s   ← 3.7 s blank screen

# Second request (same session, compiled output cached)
time curl -s -L http://localhost:3000 -o /dev/null
real  0m0.045s   ← instant
```

### Next.js server logs (before fix)

```
✓ Ready in 1127ms
✓ Compiled /src/middleware in 304ms (117 modules)
○ Compiling /dashboard ...
✓ Compiled /dashboard in 3.1s (772 modules)
GET /dashboard 200 in 3347ms          ← user sees blank screen during this
GET /dashboard 200 in 16ms            ← second request: cache hit
```

### Root cause — Next.js on-demand compilation

Next.js dev mode compiles routes **lazily**: nothing is compiled at server startup. The first HTTP request to a route triggers webpack to parse and bundle that route and all transitive dependencies. For `/dashboard`, this is 772 modules (Firebase client SDK, Zustand, React/Next.js internals), taking ~3.1 s.

During compilation the HTTP connection is held open but no bytes are sent, so the browser shows a blank page. Once compilation finishes the full HTML is flushed in one go. This is why the page appears "stuck" and then loads instantly — it was never rendering; it was waiting for the server's first byte.

The middleware (`/` → `/dashboard` redirect) compiles separately: 117 modules, ~300 ms. So the full user-visible delay on first load is:

```
middleware compile (~300 ms) + dashboard compile (~3.1 s) = ~3.4 s blank screen
```

A refresh is instant because webpack caches compiled output in `.next/` and reuses it on subsequent requests.

### Why previous fixes did not address this

The `STARTUP_HANG_DIAGNOSTIC.md` fix (Firebase RTDB guard, `AuthProvider` timeout, OTel `try/catch`) solved issues where `isLoading` stayed `true` forever after the page loaded. This is a different, earlier problem: the page never reaches the browser at all during the webpack compile window. Even with a perfectly functioning `AuthProvider`, a 3-second HTTP delay before first byte is unavoidable if pages are compiled on-demand.

---

## Fix

### Fix 1 — `scripts/dev-warm.js` (new file)

A Node.js startup wrapper that:

1. Spawns `next dev` as a child process with inherited stdio (all Next.js output visible in terminal as normal).
2. Immediately begins polling `localhost:PORT` every 300 ms.
3. Once the server responds, sequentially fetches `/`, `/dashboard`, and `/auth` — triggering webpack compilation for each route before any real user connects.
4. Logs `▲ [dev-warm] Pre-compilation complete — first browser request will be instant.` when done.
5. Forwards `SIGINT`/`SIGTERM` to the child process so `Ctrl+C` cleanly stops `next dev`.

Key design decisions:

- Uses `http.get()` with `res.resume()` to drain the response without buffering it in memory.
- Respects `process.env.PORT` so it targets the same port as `next dev`.
- Forwards extra CLI args, so `npm run dev -- --turbo` passes `--turbo` to `next dev`.
- 120-second overall timeout prevents infinite loops in CI environments.
- Non-fatal per-path errors: if `/auth` fails to compile during warmup, the user will just compile it on their first visit rather than the warmup blocking.

Warmup path order matters:
- `/` → compiles the middleware bundle (117 modules)
- `/dashboard` → compiles the main page bundle (772 modules, shares layout with `/auth`)
- `/auth` → compiles the auth page (748 modules, benefits from shared layout already built)

### Fix 2 — `package.json`

```diff
- "dev": "next dev",
+ "dev": "node scripts/dev-warm.js",
```

### Fix 3 — `next.config.mjs`

Added `serverComponentsExternalPackages` for heavy server-only packages:

```js
serverComponentsExternalPackages: [
  'firebase-admin',
  '@opentelemetry/sdk-node',
  '@langfuse/otel',
  '@langfuse/tracing',
],
```

These packages are only used in API routes (`/api/ai-command`) and `instrumentation.ts`. Externalizing them prevents webpack from compiling them into the server bundle, reducing first-compile time for those routes.

---

## Verification

### After fix — server logs

```
✓ Ready in 1193ms
✓ Compiled /src/middleware in 344ms (117 modules)     ← warmup triggers this
○ Compiling /dashboard ...
✓ Compiled /dashboard in 3.7s (772 modules)           ← warmup, not user
GET /dashboard 200 in 4060ms                          ← warmup request
○ Compiling /auth ...
✓ Compiled /auth in 3.3s (748 modules)                ← warmup
▲ [dev-warm] Pre-compilation complete — first browser request will be instant.
GET /auth 200 in 3007ms                               ← warmup request
GET /dashboard 200 in 23ms                            ← real user: cache hit
```

### After fix — timing

```
# First real user request (all routes pre-compiled by warmup)
time curl -s -L http://localhost:3000 -o /dev/null
real  0m0.038s   ← 38 ms
```

| Scenario | First request |
|---|---|
| Baseline (webpack, no warmup) | 3.7 s |
| Turbopack only (`--turbo`) | 2.4 s |
| **Warmup script (this fix)** | **38 ms** |

The compilation cost (~8 s total for all three routes) is paid during the server startup window — invisible to the developer because the terminal is showing Next.js compile output anyway. By the time the developer switches to their browser, the pages are ready.
