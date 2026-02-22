/**
 * playwright.config.ts
 *
 * Root Playwright configuration for CrucibleCanvas performance and E2E tests.
 * Performance tests require --headed mode (or the `gpu` project) so that
 * Chrome activates GPU compositing and reports accurate FPS metrics.
 *
 * Login-free setup — no manual steps required:
 *   • globalSetup navigates to /auth, fills the display name, and clicks
 *     "Continue as Guest" to establish an anonymous Firebase session. This
 *     works regardless of whether NEXT_PUBLIC_PERF_BYPASS is set on the server.
 *   • The resulting browser storage state (cookies + localStorage + IndexedDB,
 *     including the Firebase auth token) is saved to tests/.auth/state.json.
 *   • Every subsequent test context loads that file via storageState, so
 *     Firebase auth is already present on page load — no redirect to /auth,
 *     no per-page sign-in latency.
 *   • webServer starts the dev server with NEXT_PUBLIC_PERF_BYPASS=true (a
 *     performance optimisation: makes the board page skip auth loading states
 *     and render the canvas immediately). Tests still work without it.
 *
 * Optional env vars (tests skip gracefully when absent):
 *   FIREBASE_ADMIN_SERVICE_ACCOUNT  — enables capacity seeding & sync latency
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL — required for RTDB latency tests
 *   PERF_BASE_URL                   — override the app URL (default localhost:3000)
 *   PERF_BYPASS_BOARD_ID            — override the baseline board ID
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PERF_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',

  // Runs once before the suite: establishes the anonymous auth session and
  // saves it to tests/.auth/state.json for reuse by all test contexts.
  globalSetup: './tests/globalSetup.ts',

  // Allow individual spec files to set their own timeout
  timeout: 120_000,
  // Fail fast on CI, allow retries locally for transient network issues
  retries: process.env.CI ? 1 : 0,
  // Run test files in parallel; tests within a file run serially by default
  fullyParallel: false,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'tests/reports/html' }],
    ['json', { outputFile: 'tests/reports/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    // Capture trace on first retry to aid debugging
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // Performance tests: headed Chrome with GPU flags for accurate FPS.
      // Run via: npx playwright test tests/performance/ --project=perf-chrome
      name: 'perf-chrome',
      testMatch: '**/performance/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Restore the Firebase anonymous auth session saved by globalSetup so
        // Firestore sync starts immediately without any login round-trip.
        storageState: 'tests/.auth/state.json',
        // Hardware-accelerated rendering is required for reliable FPS numbers.
        // --disable-gpu would suppress compositing and skew frame metrics.
        launchOptions: {
          args: [
            '--enable-gpu-rasterization',
            '--enable-zero-copy',
            '--ignore-gpu-blocklist',
          ],
          // Show browser window so GPU compositing is active (headless Chrome
          // throttles rendering in some environments)
          headless: false,
        },
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      // General E2E tests: headless Chromium (CI-friendly)
      name: 'chromium',
      testMatch: '**/e2e/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the dev server automatically with the bypass flag set.
  // NEXT_PUBLIC_PERF_BYPASS=true makes the board page skip the Firebase auth
  // guard and auto-sign-in as a guest, so no manual login is ever required.
  //
  // reuseExistingServer: locally we reuse a running dev server if one is
  // already on port 3000. If that server was started without the bypass flag
  // the tests will surface a clear error from globalSetup pointing to the fix.
  // On CI a fresh server is always started with the correct flag.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_PERF_BYPASS: 'true',
    },
  },
});
