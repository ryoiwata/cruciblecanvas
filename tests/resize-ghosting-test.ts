/**
 * Resize Ghosting Detection Test
 *
 * Simulates a high-speed resize drag on a canvas shape and uses
 * requestAnimationFrame + performance.now() to detect "stale" bounding
 * box states during the animation.
 *
 * A stale frame is defined as: a frame where the rendered bounding box
 * does NOT monotonically change in the direction of the drag. For example,
 * if we drag the SE corner right-and-down, width and height should only
 * increase between frames — never snap back to a previous value.
 *
 * Usage (requires Puppeteer MCP or standalone Puppeteer):
 *   npx tsx tests/resize-ghosting-test.ts [--url http://localhost:3000/board/BOARD_ID]
 *
 * The script can also be driven by the MCP Puppeteer tools from Claude Code.
 */

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_URL = "http://localhost:3000";
const DRAG_STEPS = 60; // Number of mousemove steps in the simulated drag
const DRAG_DURATION_MS = 500; // Total drag duration
const STALE_THRESHOLD = 2; // px tolerance for rounding jitter

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface FrameSample {
  timestamp: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StaleDetection {
  frameIndex: number;
  timestamp: number;
  issue: string;
  expected: Partial<FrameSample>;
  actual: Partial<FrameSample>;
}

/* ------------------------------------------------------------------ */
/* In-page instrumentation (injected via page.evaluate)                */
/* ------------------------------------------------------------------ */

/**
 * This function runs INSIDE the browser. It:
 *   1. Finds the target Konva Group by ID
 *   2. Samples its bounding box on every requestAnimationFrame
 *   3. Returns all samples after the specified duration
 */
const instrumentResizeFrames = `
  (objectId, durationMs) => {
    return new Promise((resolve) => {
      const samples = [];
      const stage = document.querySelector('.konvajs-content')
        ?.__konvaNode;
      if (!stage) {
        resolve({ error: 'No Konva stage found' });
        return;
      }

      const group = stage.findOne('#' + objectId);
      if (!group) {
        resolve({ error: 'Object ' + objectId + ' not found' });
        return;
      }

      const start = performance.now();

      function sample() {
        const now = performance.now();
        samples.push({
          timestamp: now - start,
          x: Math.round(group.x()),
          y: Math.round(group.y()),
          width: Math.round(group.width()),
          height: Math.round(group.height()),
        });

        if (now - start < durationMs) {
          requestAnimationFrame(sample);
        } else {
          resolve({ samples });
        }
      }

      requestAnimationFrame(sample);
    });
  }
`;

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

function analyzeForStaleness(
  samples: FrameSample[],
  dragDirection: { dx: number; dy: number }
): { staleFrames: StaleDetection[]; maxJitter: number } {
  const staleFrames: StaleDetection[] = [];
  let maxJitter = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];

    // Width should monotonically increase when dragging right (dx > 0)
    if (dragDirection.dx > 0) {
      const widthDelta = curr.width - prev.width;
      if (widthDelta < -STALE_THRESHOLD) {
        staleFrames.push({
          frameIndex: i,
          timestamp: curr.timestamp,
          issue: `Width decreased by ${-widthDelta}px (expected monotonic increase)`,
          expected: { width: prev.width },
          actual: { width: curr.width },
        });
        maxJitter = Math.max(maxJitter, -widthDelta);
      }
    }

    // Height should monotonically increase when dragging down (dy > 0)
    if (dragDirection.dy > 0) {
      const heightDelta = curr.height - prev.height;
      if (heightDelta < -STALE_THRESHOLD) {
        staleFrames.push({
          frameIndex: i,
          timestamp: curr.timestamp,
          issue: `Height decreased by ${-heightDelta}px (expected monotonic increase)`,
          expected: { height: prev.height },
          actual: { height: curr.height },
        });
        maxJitter = Math.max(maxJitter, -heightDelta);
      }
    }

    // Anchor check: for SE drag, top-left corner (x, y) should not move
    if (dragDirection.dx > 0 && dragDirection.dy > 0) {
      const xDrift = Math.abs(curr.x - samples[0].x);
      const yDrift = Math.abs(curr.y - samples[0].y);

      if (xDrift > STALE_THRESHOLD) {
        staleFrames.push({
          frameIndex: i,
          timestamp: curr.timestamp,
          issue: `Anchor X drifted by ${xDrift}px (should be locked)`,
          expected: { x: samples[0].x },
          actual: { x: curr.x },
        });
      }

      if (yDrift > STALE_THRESHOLD) {
        staleFrames.push({
          frameIndex: i,
          timestamp: curr.timestamp,
          issue: `Anchor Y drifted by ${yDrift}px (should be locked)`,
          expected: { y: samples[0].y },
          actual: { y: curr.y },
        });
      }
    }
  }

  return { staleFrames, maxJitter };
}

/* ------------------------------------------------------------------ */
/* Standalone runner (npx tsx tests/resize-ghosting-test.ts)           */
/* ------------------------------------------------------------------ */

async function runStandalone() {
  // Dynamic import so the file doesn't fail at parse time without puppeteer
  const puppeteer = await import("puppeteer");

  const url = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1] ?? DEFAULT_URL;

  console.log(`\n🔬 Resize Ghosting Detection Test`);
  console.log(`   URL: ${url}`);
  console.log(`   Drag steps: ${DRAG_STEPS}`);
  console.log(`   Duration: ${DRAG_DURATION_MS}ms\n`);

  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });

  // Wait for Konva stage to be ready
  await page.waitForSelector(".konvajs-content", { timeout: 10000 });

  // Find the first shape object on the board
  const objectId = await page.evaluate(() => {
    const stage = (document.querySelector(".konvajs-content") as HTMLElement & { __konvaNode?: { find: (s: string) => { id: () => string }[] } })?.__konvaNode;
    if (!stage) return null;
    const groups = stage.find("Group");
    for (const g of groups) {
      if (g.id() && g.id().length > 5) return g.id();
    }
    return null;
  });

  if (!objectId) {
    console.log("⚠️  No shape objects found on the board. Create a shape first.");
    await browser.close();
    process.exit(1);
  }

  console.log(`   Target object: ${objectId}`);

  // Get the object's current screen position
  const objBounds = await page.evaluate((id: string) => {
    const stage = (document.querySelector(".konvajs-content") as HTMLElement & { __konvaNode?: { findOne: (s: string) => { getClientRect: () => { x: number; y: number; width: number; height: number } } | null; x: () => number; y: () => number; scaleX: () => number } })?.__konvaNode;
    if (!stage) return null;
    const group = stage.findOne("#" + id);
    if (!group) return null;
    const rect = group.getClientRect();
    const stageX = stage.x();
    const stageY = stage.y();
    const scale = stage.scaleX();
    return {
      screenX: rect.x * scale + stageX,
      screenY: rect.y * scale + stageY,
      screenW: rect.width * scale,
      screenH: rect.height * scale,
    };
  }, objectId);

  if (!objBounds) {
    console.log("⚠️  Could not get object bounds.");
    await browser.close();
    process.exit(1);
  }

  // Start frame sampling
  const samplePromise = page.evaluate(
    instrumentResizeFrames as unknown as string,
    objectId,
    DRAG_DURATION_MS + 200
  ) as Promise<{ samples?: FrameSample[]; error?: string }>;

  // Small delay to let sampling start
  await new Promise((r) => setTimeout(r, 50));

  // Simulate a high-speed SE resize drag
  const startX = objBounds.screenX + objBounds.screenW - 4; // Near SE corner
  const startY = objBounds.screenY + objBounds.screenH - 4;
  const endX = startX + 200;
  const endY = startY + 150;

  console.log(`   Drag: (${Math.round(startX)}, ${Math.round(startY)}) → (${Math.round(endX)}, ${Math.round(endY)})`);

  // Mouse down on the resize handle
  await page.mouse.move(startX, startY);
  await page.mouse.down();

  // Rapid drag
  const stepDelay = DRAG_DURATION_MS / DRAG_STEPS;
  for (let i = 1; i <= DRAG_STEPS; i++) {
    const t = i / DRAG_STEPS;
    const x = startX + (endX - startX) * t;
    const y = startY + (endY - startY) * t;
    await page.mouse.move(x, y);
    await new Promise((r) => setTimeout(r, stepDelay));
  }

  await page.mouse.up();

  // Wait for sampling to complete
  const result = await samplePromise;

  if (result.error) {
    console.log(`⚠️  Instrumentation error: ${result.error}`);
    await browser.close();
    process.exit(1);
  }

  const samples = result.samples!;
  console.log(`\n   Captured ${samples.length} frames over ${Math.round(samples[samples.length - 1].timestamp)}ms`);

  // Analyze
  const { staleFrames, maxJitter } = analyzeForStaleness(samples, { dx: 1, dy: 1 });

  if (staleFrames.length === 0) {
    console.log("\n✅ PASS: No ghosting detected. Bounding box updated monotonically.");
    console.log("   All frames consistent with zero-latency resize.\n");
  } else {
    console.log(`\n❌ FAIL: ${staleFrames.length} stale frame(s) detected (max jitter: ${maxJitter}px)`);
    for (const sf of staleFrames.slice(0, 10)) {
      console.log(`   Frame ${sf.frameIndex} @ ${Math.round(sf.timestamp)}ms: ${sf.issue}`);
    }
    if (staleFrames.length > 10) {
      console.log(`   ... and ${staleFrames.length - 10} more`);
    }
    console.log();
  }

  // Print frame timeline summary
  console.log("   Frame timeline (first 10):");
  for (const s of samples.slice(0, 10)) {
    console.log(
      `   ${String(Math.round(s.timestamp)).padStart(6)}ms  pos=(${s.x}, ${s.y})  size=${s.width}×${s.height}`
    );
  }
  if (samples.length > 10) {
    console.log(`   ... (${samples.length - 10} more frames)`);
  }

  await browser.close();
  process.exit(staleFrames.length > 0 ? 1 : 0);
}

// Run if executed directly
runStandalone().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

export { analyzeForStaleness, instrumentResizeFrames, type FrameSample, type StaleDetection };
