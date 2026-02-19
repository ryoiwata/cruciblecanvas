/**
 * seed-perf-board.ts
 *
 * Populates a Firebase board with N test objects distributed across a large canvas
 * for performance benchmarking. Uses firebase-admin for direct Firestore writes.
 *
 * Run:
 *   FIREBASE_ADMIN_SERVICE_ACCOUNT='...' npx tsx scripts/seed-perf-board.ts
 *
 * Or with ts-node:
 *   FIREBASE_ADMIN_SERVICE_ACCOUNT='...' npx ts-node --project tsconfig.json scripts/seed-perf-board.ts
 *
 * Environment variables:
 *   FIREBASE_ADMIN_SERVICE_ACCOUNT  — JSON string of service account key (required)
 *   PERF_BYPASS_BOARD_ID            — board ID to seed (default: "perf-test-board-001")
 *   PERF_OBJECT_COUNT               — number of objects to create (default: 7000)
 */

import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BOARD_ID = process.env.PERF_BYPASS_BOARD_ID ?? "perf-test-board-001";
const OBJECT_COUNT = parseInt(process.env.PERF_OBJECT_COUNT ?? "7000", 10);

/** Canvas spread in logical units (50k × 50k virtual canvas). */
const CANVAS_SPREAD = 50_000;

/** Firestore batch write limit. */
const BATCH_SIZE = 500;

/** Object type distribution (must sum to 1.0). */
const TYPE_DISTRIBUTION = {
  stickyNote: 0.55,
  rectangle: 0.20,
  circle: 0.10,
  frame: 0.10,
  connector: 0.05,
} as const;

const STICKY_COLORS = ["#FEFF9C", "#FF7EB9", "#7AFCFF", "#98FF98", "#DDA0DD", "#FFAB91"];
const SHAPE_COLORS = ["#E3E8EF", "#C7D2FE", "#FDE68A", "#BBF7D0", "#FECACA"];
const FRAME_COLOR = "#6366f1";

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  console.error("ERROR: FIREBASE_ADMIN_SERVICE_ACCOUNT env var is required.");
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rand(min: number, max: number): number {
  return Math.round(Math.random() * (max - min) + min);
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Weighted random object type from distribution. */
function randomType(): keyof typeof TYPE_DISTRIBUTION {
  const r = Math.random();
  let cumulative = 0;
  for (const [type, weight] of Object.entries(TYPE_DISTRIBUTION)) {
    cumulative += weight;
    if (r < cumulative) return type as keyof typeof TYPE_DISTRIBUTION;
  }
  return "stickyNote";
}

// ---------------------------------------------------------------------------
// Board metadata
// ---------------------------------------------------------------------------

async function ensureBoardMetadata(): Promise<void> {
  const ref = db.doc(`boards/${BOARD_ID}/metadata/config`);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      title: `Perf Test Board (${OBJECT_COUNT} objects)`,
      createdAt: Timestamp.now(),
      createdBy: "perf-seed-script",
      isPublic: true, // public so Playwright can read without user auth
      invitedEmails: [],
      aiPersona: "neutral",
      aiCommandsToday: 0,
      aiCommandsResetAt: Timestamp.now(),
      analysisHistory: [],
    });
    console.log(`Created board metadata for ${BOARD_ID}`);
  }
}

// ---------------------------------------------------------------------------
// Object generation
// ---------------------------------------------------------------------------

interface SeedObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text: string;
  zIndex: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  connectedTo?: string[];
}

function generateObjects(count: number): SeedObject[] {
  const nonConnectorCount = Math.floor(count * (1 - TYPE_DISTRIBUTION.connector));
  const connectorCount = count - nonConnectorCount;
  const objects: SeedObject[] = [];

  // Non-connector objects
  for (let i = 0; i < nonConnectorCount; i++) {
    const type = (() => {
      const r = Math.random();
      if (r < 0.55 / 0.95) return "stickyNote";
      if (r < 0.75 / 0.95) return "rectangle";
      if (r < 0.85 / 0.95) return "circle";
      return "frame";
    })();

    const width = type === "stickyNote" ? rand(140, 260)
      : type === "rectangle" ? rand(60, 200)
      : type === "circle" ? rand(60, 120)
      : rand(300, 600); // frame

    const height = type === "stickyNote" ? rand(100, 200)
      : type === "rectangle" ? rand(60, 180)
      : type === "circle" ? width // square for circle
      : rand(200, 400); // frame

    const color = type === "stickyNote" ? pick(STICKY_COLORS)
      : type === "frame" ? FRAME_COLOR
      : pick(SHAPE_COLORS);

    objects.push({
      id: `perf-obj-${i}`,
      type,
      x: rand(0, CANVAS_SPREAD - width),
      y: rand(0, CANVAS_SPREAD - height),
      width,
      height,
      color,
      text: type === "stickyNote" ? `Note ${i}` : type === "frame" ? `Frame ${i}` : "",
      zIndex: i,
      createdBy: "perf-seed-script",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  // Connector objects — connect random pairs of non-connectors
  for (let i = 0; i < connectorCount; i++) {
    const startIdx = rand(0, nonConnectorCount - 1);
    let endIdx = rand(0, nonConnectorCount - 1);
    while (endIdx === startIdx) endIdx = rand(0, nonConnectorCount - 1);

    objects.push({
      id: `perf-conn-${i}`,
      type: "connector",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      color: "#6B7280",
      text: "",
      zIndex: nonConnectorCount + i,
      createdBy: "perf-seed-script",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      connectedTo: [`perf-obj-${startIdx}`, `perf-obj-${endIdx}`],
    });
  }

  return objects;
}

// ---------------------------------------------------------------------------
// Write to Firestore in batches
// ---------------------------------------------------------------------------

async function seedObjects(objects: SeedObject[]): Promise<void> {
  let written = 0;

  for (let start = 0; start < objects.length; start += BATCH_SIZE) {
    const chunk = objects.slice(start, start + BATCH_SIZE);
    const batch = db.batch();

    for (const obj of chunk) {
      const ref = db.doc(`boards/${BOARD_ID}/objects/${obj.id}`);
      batch.set(ref, obj);
    }

    await batch.commit();
    written += chunk.length;
    process.stdout.write(`\rWritten ${written}/${objects.length} objects...`);
  }

  process.stdout.write("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Seeding board "${BOARD_ID}" with ${OBJECT_COUNT} objects...`);

  await ensureBoardMetadata();

  const objects = generateObjects(OBJECT_COUNT);
  console.log(
    `Generated ${objects.length} objects ` +
    `(${objects.filter(o => o.type !== "connector").length} shapes, ` +
    `${objects.filter(o => o.type === "connector").length} connectors)`
  );

  await seedObjects(objects);
  console.log(`Done. Board ID: ${BOARD_ID}`);
  console.log(`Canvas spread: ${CANVAS_SPREAD} × ${CANVAS_SPREAD} units`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
