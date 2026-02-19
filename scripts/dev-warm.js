#!/usr/bin/env node
/**
 * dev-warm.js — Development server pre-compiler.
 *
 * Starts `next dev` and immediately begins polling the server in the background.
 * The first request to each warmup path triggers Next.js on-demand compilation.
 * By the time a real user opens their browser, all key pages are already compiled
 * so their first navigation is instant instead of waiting 2-4 s for webpack/turbopack.
 *
 * Usage (via package.json scripts):
 *   "dev": "node scripts/dev-warm.js"
 *   "dev": "node scripts/dev-warm.js --turbo"   ← also enables Turbopack
 */

'use strict';

const { spawn } = require('child_process');
const http = require('http');

// Pages to pre-compile. Order matters:
// '/' compiles the middleware (/ → /dashboard redirect); '/dashboard' and '/auth'
// compile the page bundles. All three are hit so the real user request is instant.
const WARMUP_PATHS = ['/', '/dashboard', '/auth'];

// Respect the PORT env var so the warmup targets the same port as next dev.
const DEV_PORT = process.env.PORT || '3000';
const DEV_BASE = `http://localhost:${DEV_PORT}`;

const POLL_INTERVAL_MS = 300;
const WARMUP_TIMEOUT_MS = 120_000; // 2 min max; avoids infinite loops in CI

// ---------------------------------------------------------------------------
// Spawn `next dev`, forwarding any extra CLI flags (e.g. --turbo)
// ---------------------------------------------------------------------------

const extraArgs = process.argv.slice(2);
const nextBin = require.resolve('next/dist/bin/next');

const nextDev = spawn(process.execPath, [nextBin, 'dev', ...extraArgs], {
  stdio: 'inherit',
  detached: false,
});

nextDev.on('error', (err) => {
  process.stderr.write(`[dev-warm] Failed to start next dev: ${err.message}\n`);
  process.exit(1);
});

nextDev.on('exit', (code) => process.exit(code ?? 0));

// Propagate kill signals so Ctrl+C cleanly stops next dev.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => nextDev.kill(sig));
}

// ---------------------------------------------------------------------------
// Warmup logic
// ---------------------------------------------------------------------------

/**
 * Fetches a path from the local dev server. Drains the body so the connection
 * closes cleanly without buffering the full response in memory.
 */
function fetchPath(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${DEV_BASE}${urlPath}`, (res) => {
      res.resume(); // discard body; we only care that compilation was triggered
      resolve(res.statusCode);
    });
    req.on('error', reject);
    // Individual request timeout — avoids hanging if the server stalls mid-response.
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error('request timeout'));
    });
  });
}

async function warmup() {
  const deadline = Date.now() + WARMUP_TIMEOUT_MS;

  // Poll until the server accepts the first connection.
  // This naturally triggers compilation for the first path (usually /dashboard).
  while (Date.now() < deadline) {
    try {
      await fetchPath(WARMUP_PATHS[0]);
      break; // server responded — first page is compiled
    } catch {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  // Compile remaining paths sequentially so Next.js can share the layout work.
  for (const path of WARMUP_PATHS.slice(1)) {
    try {
      await fetchPath(path);
    } catch {
      // Non-fatal: user can still navigate there; they'll just wait for that compile.
    }
  }

  process.stdout.write(
    '\n \u25b2 [dev-warm] Pre-compilation complete \u2014 first browser request will be instant.\n\n'
  );
}

warmup().catch((err) => {
  process.stderr.write(`[dev-warm] Warmup error: ${err.message}\n`);
});
