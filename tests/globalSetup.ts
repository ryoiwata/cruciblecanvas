/**
 * globalSetup.ts
 *
 * Playwright global setup — runs once before the full test suite.
 *
 * Strategy: navigate to /auth and sign in as guest via the UI. This approach
 * works regardless of whether NEXT_PUBLIC_PERF_BYPASS is set on the dev server,
 * so npm run test:perf is self-contained — no env-var changes and no server
 * restarts required before running tests.
 *
 * Flow:
 *   1. Optionally ensures the baseline board exists in Firestore (Admin SDK).
 *   2. Navigates to /auth?redirect=/board/{BASELINE_BOARD_ID}.
 *   3. Fills the Display Name field and clicks "Continue as Guest" — this
 *      triggers anonymous Firebase sign-in without any manual login step.
 *   4. Waits for the redirect back to the board and for canvas-ready.
 *   5. Saves the browser storage state (cookies + localStorage + IndexedDB,
 *      including the Firebase auth token) to tests/.auth/state.json.
 *
 * Subsequent tests and manually-launched contexts reference that file via
 * storageState, so Firebase auth is already present on page load — no redirect
 * to /auth, no per-page sign-in latency.
 */

import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  hasAdminEnv,
  ensureTestBoardMetadata,
} from './performance/performance-utils';

const BASE_URL = process.env.PERF_BASE_URL ?? 'http://localhost:3000';
const BASELINE_BOARD_ID =
  process.env.PERF_BYPASS_BOARD_ID ?? 'perf-test-board-001';

/** The display name written to Firestore for the anonymous perf-test user. */
const PERF_DISPLAY_NAME = 'Perf Test Runner';

/** Absolute path where the browser auth state is persisted between setup and tests. */
export const AUTH_STATE_PATH = path.join(__dirname, '.auth', 'state.json');

export default async function globalSetup(): Promise<void> {
  // Ensure the .auth directory exists before Playwright tries to write to it.
  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });

  // If Firebase Admin credentials are available, ensure the baseline board
  // exists in Firestore (isPublic: true) so the anonymous user can read it.
  if (hasAdminEnv()) {
    console.log('[GlobalSetup] Ensuring baseline board metadata exists…');
    await ensureTestBoardMetadata(BASELINE_BOARD_ID);
    console.log('[GlobalSetup] Board metadata ready.');
  } else {
    console.warn(
      '[GlobalSetup] FIREBASE_ADMIN_SERVICE_ACCOUNT not set — ' +
        `baseline board "${BASELINE_BOARD_ID}" should exist in Firestore ` +
        'with isPublic: true for FPS tests to load board objects. ' +
        'Run "npm run seed-perf" once to create it.'
    );
  }

  // Launch a temporary headless browser to establish the Firebase session via
  // the app's own auth UI — no dependency on NEXT_PUBLIC_PERF_BYPASS.
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Navigate to the auth page with the board as the post-login destination.
  // Using the ?redirect param ensures the auth page routes back to the board
  // after sign-in instead of creating a new board.
  const authUrl = `${BASE_URL}/auth?redirect=/board/${BASELINE_BOARD_ID}`;
  console.log(`[GlobalSetup] Navigating to auth page: ${authUrl}`);

  await page.goto(authUrl, { waitUntil: 'domcontentloaded' });

  // Verify the auth page loaded (not some other error page).
  await page
    .waitForURL((url) => url.href.includes('/auth'), { timeout: 15_000 })
    .catch(() => {
      // If the URL settled elsewhere (e.g. already auth'd and redirected),
      // fall through to the canvas-ready check below.
    });

  // If already on a board page (stored state had valid auth), skip sign-in.
  if (!page.url().includes('/auth')) {
    console.log('[GlobalSetup] Already authenticated — skipping sign-in UI.');
  } else {
    // Fill the required Display Name field (handleGuest returns early if empty).
    await page.fill('#displayName', PERF_DISPLAY_NAME);

    // Click "Continue as Guest" — triggers signInAnonymously + Firestore profile
    // write + redirect to the board URL from the ?redirect param.
    console.log('[GlobalSetup] Signing in as guest…');
    await page.click('button:has-text("Continue as Guest")');

    // Wait for the auth page to redirect to the board after sign-in.
    await page.waitForURL(
      (url) => url.href.includes(`/board/${BASELINE_BOARD_ID}`),
      { timeout: 30_000 }
    );
  }

  console.log(`[GlobalSetup] On board page — waiting for canvas-ready…`);

  // Wait for the Konva canvas to finish mounting. Without bypass, this requires
  // useFirestoreSync to complete (succeeds or errors: the error handler still
  // sets isObjectsLoaded = true so the loading spinner clears). With bypass,
  // the canvas renders immediately.
  await page
    .waitForSelector('[data-testid="canvas-ready"]', {
      timeout: 60_000,
      state: 'visible',
    })
    .catch(async (err: Error) => {
      // Capture a screenshot to help diagnose what blocked canvas-ready.
      const screenshotPath = path.join(__dirname, '.auth', 'setup-failure.png');
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
      await browser.close();
      throw new Error(
        `[GlobalSetup] canvas-ready not found after 60 s. ` +
          `Current URL: ${page.url()}. ` +
          `Screenshot saved to ${screenshotPath}. ` +
          `Original error: ${err.message}`
      );
    });

  // Brief pause to allow Firebase to flush the auth session token to IndexedDB
  // before we snapshot the storage state.
  await page.waitForTimeout(500);

  // Persist the full browser storage state — includes IndexedDB where the
  // Firebase JS SDK stores auth tokens. Tests and manually-launched contexts
  // that load this file start with a valid anonymous session immediately.
  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`[GlobalSetup] Auth state saved → ${AUTH_STATE_PATH}`);

  await browser.close();
}
