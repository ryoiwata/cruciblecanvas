#!/usr/bin/env ts-node
/**
 * seed-test-objects.ts — Populates a test board with 500+ mixed objects.
 *
 * Used to validate 60 FPS performance and viewport culling at scale.
 * Distributes objects across a 10 000 × 10 000 canvas so most are off-screen
 * at any given time, exercising the culling path in BoardObjects.tsx.
 *
 * Usage:
 *   TEST_BOARD_ID=<boardId> FIREBASE_ADMIN_SERVICE_ACCOUNT='<json>' \
 *     npx ts-node --project tsconfig.json scripts/seed-test-objects.ts
 *
 * The script auto-batches into groups of 500 (Firestore batch limit).
 * Delete existing test objects first with: DELETE_FIRST=true npx ts-node ...
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BOARD_ID = process.env.TEST_BOARD_ID;
const OBJECT_COUNT = 550; // Slightly over 500 to confirm we handle >500
const CANVAS_SIZE = 10_000; // 10k × 10k canvas
const FIRESTORE_BATCH_LIMIT = 500;

if (!BOARD_ID) {
  console.error('ERROR: Set TEST_BOARD_ID environment variable to the target board ID.');
  process.exit(1);
}

const serviceAccountEnv = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
if (!serviceAccountEnv) {
  console.error('ERROR: Set FIREBASE_ADMIN_SERVICE_ACCOUNT to a JSON string of your service account.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Firebase Admin init
// ---------------------------------------------------------------------------

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(serviceAccountEnv)),
  });
}

const db = getFirestore();

// ---------------------------------------------------------------------------
// Object generation helpers
// ---------------------------------------------------------------------------

const STICKY_COLORS = ['#FFF9C4', '#C8E6C9', '#BBDEFB', '#F8BBD9', '#FFE0B2', '#E1BEE7'];
const SHAPE_COLORS = ['#6366f1', '#22c55e', '#ef4444', '#f97316', '#3b82f6', '#a855f7'];

type ObjectType = 'stickyNote' | 'rectangle' | 'circle' | 'frame' | 'connector';

/** Seeded pseudo-random to ensure deterministic placement across runs. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10_000;
  return x - Math.floor(x);
}

function randomInt(min: number, max: number, seed: number): number {
  return Math.floor(seededRandom(seed) * (max - min + 1)) + min;
}

function pickColor(palette: string[], seed: number): string {
  return palette[Math.floor(seededRandom(seed) * palette.length)];
}

interface ObjectSpec {
  type: ObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text: string;
  zIndex: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  connectedTo?: [string, string];
  metadata?: { connectorStyle: 'solid' | 'dashed' | 'dotted' };
}

function buildObject(index: number, allIds: string[]): ObjectSpec {
  const seed = index * 7919; // Large prime for spread

  // Type distribution: 60% stickyNote, 20% rectangle, 10% circle, 5% frame, 5% connector
  const roll = seededRandom(seed) * 100;
  let type: ObjectType;
  if (roll < 60) type = 'stickyNote';
  else if (roll < 80) type = 'rectangle';
  else if (roll < 90) type = 'circle';
  else if (roll < 95) type = 'frame';
  else type = 'connector';

  const now = Date.now();

  if (type === 'connector' && allIds.length >= 2) {
    // Pick two distinct non-connector objects to connect
    const aIdx = randomInt(0, allIds.length - 1, seed + 1);
    let bIdx = randomInt(0, allIds.length - 1, seed + 2);
    if (bIdx === aIdx) bIdx = (bIdx + 1) % allIds.length;
    return {
      type: 'connector',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      color: '#94a3b8',
      text: '',
      zIndex: index,
      createdBy: 'seed-script',
      createdAt: now + index,
      updatedAt: now + index,
      connectedTo: [allIds[aIdx], allIds[bIdx]],
      metadata: { connectorStyle: 'solid' },
    };
  }

  // Non-connector: distribute across the full canvas
  const x = randomInt(0, CANVAS_SIZE - 300, seed + 3);
  const y = randomInt(0, CANVAS_SIZE - 300, seed + 4);

  let width: number;
  let height: number;
  let color: string;
  let text: string;

  switch (type) {
    case 'stickyNote':
      width = randomInt(180, 240, seed + 5);
      height = randomInt(150, 200, seed + 6);
      color = pickColor(STICKY_COLORS, seed + 7);
      text = `Note ${index + 1}`;
      break;
    case 'rectangle':
      width = randomInt(80, 200, seed + 5);
      height = randomInt(60, 150, seed + 6);
      color = pickColor(SHAPE_COLORS, seed + 7);
      text = `Rect ${index + 1}`;
      break;
    case 'circle': {
      const dim = randomInt(60, 150, seed + 5);
      width = dim;
      height = dim;
      color = pickColor(SHAPE_COLORS, seed + 7);
      text = `Circle ${index + 1}`;
      break;
    }
    case 'frame':
      width = randomInt(400, 700, seed + 5);
      height = randomInt(300, 500, seed + 6);
      color = '#e2e8f0';
      text = `Frame ${index + 1}`;
      break;
    default:
      width = 100;
      height = 100;
      color = '#E3E8EF';
      text = '';
  }

  return {
    type,
    x,
    y,
    width,
    height,
    color,
    text,
    zIndex: index,
    createdBy: 'seed-script',
    createdAt: now + index,
    updatedAt: now + index,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Seeding ${OBJECT_COUNT} objects into board: ${BOARD_ID}`);
  const objectsCol = db.collection(`boards/${BOARD_ID}/objects`);

  // Optional: delete existing seed objects first
  if (process.env.DELETE_FIRST === 'true') {
    console.log('DELETE_FIRST=true — removing existing objects...');
    const existing = await objectsCol.get();
    const deleteBatches: FirebaseFirestore.WriteBatch[] = [];
    let batch = db.batch();
    let count = 0;

    for (const doc of existing.docs) {
      batch.delete(doc.ref);
      count++;
      if (count % FIRESTORE_BATCH_LIMIT === 0) {
        deleteBatches.push(batch);
        batch = db.batch();
      }
    }
    if (count % FIRESTORE_BATCH_LIMIT !== 0) deleteBatches.push(batch);

    for (const b of deleteBatches) await b.commit();
    console.log(`Deleted ${count} existing objects.`);
  }

  // Pass 1: generate IDs + non-connector specs
  const ids: string[] = [];
  const specs: Array<{ id: string; spec: ObjectSpec }> = [];

  for (let i = 0; i < OBJECT_COUNT; i++) {
    const docRef = objectsCol.doc();
    ids.push(docRef.id);
    // Defer connector generation until all IDs exist
    const spec = buildObject(i, ids);
    specs.push({ id: docRef.id, spec });
  }

  // Write in batches of 500
  let written = 0;
  let batch = db.batch();

  for (const { id, spec } of specs) {
    const ref = objectsCol.doc(id);
    batch.set(ref, spec);
    written++;

    if (written % FIRESTORE_BATCH_LIMIT === 0) {
      await batch.commit();
      console.log(`  Committed batch (${written}/${OBJECT_COUNT})`);
      batch = db.batch();
    }
  }

  // Commit remaining
  if (written % FIRESTORE_BATCH_LIMIT !== 0) {
    await batch.commit();
    console.log(`  Committed final batch (${written}/${OBJECT_COUNT})`);
  }

  // Count by type for confirmation
  const typeCounts: Record<string, number> = {};
  for (const { spec } of specs) {
    typeCounts[spec.type] = (typeCounts[spec.type] ?? 0) + 1;
  }

  console.log('\nDone! Object breakdown:');
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`\nTotal: ${written} objects written to board "${BOARD_ID}".`);
  console.log(`\nNext steps:
  1. Open the board in 5 browser windows
  2. Chrome DevTools → Performance → record 5s of pan/zoom
  3. Confirm all frames ≤ 16.7ms (60 FPS)
  4. React Profiler → confirm BoardObjects re-renders only on viewport/object changes`);
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
