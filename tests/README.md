 Files created                                                             
                                                                            
  playwright.config.ts (root)                                               

  Defines two projects: perf-chrome (headed Chrome with GPU flags — required
   for accurate FPS) and chromium (headless for future E2E). The GPU args
  (--enable-gpu-rasterization, --enable-zero-copy, --ignore-gpu-blocklist)
  prevent Chrome from throttling compositor frames in headless-like
  environments.

  ---
  tests/performance/performance-utils.ts

  All shared logic, fully typed:

  Export: CdpFpsMonitor
  What it does: Wraps a CDP session; polls Performance.getMetrics every 250
    ms and accumulates instantaneous FPS from the Frames counter delta —
    measures compositor frames, not JS rAF
  ────────────────────────────────────────
  Export: measureRafFrameDurationsMs()
  What it does: Runs inside the browser via page.evaluate; records per-frame

    delta using requestAnimationFrame
  ────────────────────────────────────────
  Export: frameTimesToFps() / analyzeLatency()
  What it does: Convert raw samples to FpsReport / LatencyReport with mean,
    min, p50, p95, p99, max
  ────────────────────────────────────────
  Export: percentile()
  What it does: Nearest-rank percentile on a sorted array
  ────────────────────────────────────────
  Export: simulatePan() / simulateZoom()
  What it does: Four-quadrant zig-zag pan and alternating scroll-wheel zoom
    at ~60 Hz
  ────────────────────────────────────────
  Export: generateCapacityObjects()
  What it does: 550 grid-distributed sticky notes + rectangles with
    deterministic IDs
  ────────────────────────────────────────
  Export: seedObjectsViaAdmin() / cleanupSeededObjects()
  What it does: Firebase Admin batch write/delete in 500-op chunks
  ────────────────────────────────────────
  Export: ensureTestBoardMetadata()
  What it does: Idempotent board creation (isPublic: true)
  ────────────────────────────────────────
  Export: measureRtdbLoopbackLatencyMs()
  What it does: Admin SDK: attaches an onValue listener, then writes —
    measures write→listener fire in ms
  ────────────────────────────────────────
  Export: measureFirestoreLoopbackLatencyMs()
  What it does: Same pattern for Firestore: onSnapshot listener + update() →

    measures propagation

  ---
  tests/performance/performance.spec.ts

  Seven test cases across five describe suites:

  Suite 1 — Frame Rate (60 FPS)
  - Combined 10 s pan+zoom: asserts CDP mean ≥ 58 FPS and rAF p95 ≤ 33.3 ms
  - Pan-only 10 s: CDP mean ≥ 58, rAF p95 ≥ 30 FPS
  - Zoom-only 10 s: same thresholds

  Suite 2 — Object Capacity (500+)
  - beforeAll seeds 550 objects via Admin SDK into perf-capacity-550;
  afterAll removes them
  - Re-runs the pan+zoom FPS test against the seeded board; asserts mean ≥
  58 FPS
  - Gracefully falls back to the pre-seeded perf-test-board-001 if no Admin
  credentials

  Suite 3 — Sync Latency
  - RTDB cursor: 20 loopback iterations, p95 < 50 ms
  - Firestore object: 15 loopback iterations, p95 < 100 ms
  - Two-browser cursor test: opens two headless contexts, exercises
  setCursor, verifies both canvases remain healthy

  Suite 4 — Jitter Analysis
  - 30 rapid RTDB samples at 16 ms intervals (mirrors the CURSOR_THROTTLE_MS
   constant in Canvas.tsx)
  - Asserts p99 < 150 ms and p95 < 100 ms

  Suite 5 — Concurrent Users
  - 5 browser contexts load the same board and pan simultaneously; checks
  zero Firebase PERMISSION_DENIED/contention errors and all canvas-ready
  still visible
  - Measures per-context FPS under 5× CPU share; asserts each ≥ 30 FPS

  New npm scripts:
  npm run test:perf              # full suite
  npm run test:perf:fps          # Frame Rate tests only
  npm run test:perf:sync         # Sync Latency + Jitter tests only
  npm run test:perf:concurrent   # Concurrent Users tests only