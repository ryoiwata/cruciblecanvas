/**
 * playwright.config.ts
 *
 * Root Playwright configuration for CrucibleCanvas performance and E2E tests.
 * Performance tests require --headed mode (or the `gpu` project) so that
 * Chrome activates GPU compositing and reports accurate FPS metrics.
 *
 * Prerequisites:
 *   1. Start dev server: npm run dev
 *   2. For capacity/seeding tests: set FIREBASE_ADMIN_SERVICE_ACCOUNT env var
 *   3. For sync latency tests: same service account credential is used
 *   4. For FPS tests only: set NEXT_PUBLIC_PERF_BYPASS=true in .env.local
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PERF_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
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
});
