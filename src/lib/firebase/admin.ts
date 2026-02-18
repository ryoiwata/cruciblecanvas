/**
 * admin.ts — Firebase Admin SDK helpers for server-side API routes.
 * Uses the Admin SDK to bypass Firestore security rules for AI tool execution.
 * These functions are ONLY used in Node.js API routes, never in client code.
 *
 * Requires FIREBASE_ADMIN_SERVICE_ACCOUNT env var (JSON string of service account key)
 * OR individual FIREBASE_ADMIN_* env vars.
 */

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { BoardObject } from '@/lib/types';

// ---------------------------------------------------------------------------
// Admin app initialization (singleton)
// ---------------------------------------------------------------------------

function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  // Support JSON service account key as env var
  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    return initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    });
  }

  // Support individual environment variables
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    });
  }

  throw new Error(
    '[Admin] Missing Firebase Admin credentials. Set FIREBASE_ADMIN_SERVICE_ACCOUNT or ' +
    'FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY environment variables.'
  );
}

function getAdminDb() {
  return getFirestore(getAdminApp());
}

// ---------------------------------------------------------------------------
// Board object CRUD (bypasses Firestore security rules)
// ---------------------------------------------------------------------------

/**
 * Creates a board object via Admin SDK. Used by AI tool execute handlers.
 * Returns the document ID.
 */
export async function adminCreateObject(
  boardId: string,
  data: Omit<BoardObject, 'createdAt' | 'updatedAt'>
): Promise<string> {
  const db = getAdminDb();
  const colRef = db.collection(`boards/${boardId}/objects`);
  const docRef = data.id ? colRef.doc(data.id) : colRef.doc();

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  await docRef.set({
    ...cleaned,
    id: docRef.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return docRef.id;
}

/**
 * Updates fields on an existing board object via Admin SDK.
 */
export async function adminUpdateObject(
  boardId: string,
  objectId: string,
  updates: Partial<BoardObject>
): Promise<void> {
  const db = getAdminDb();
  const docRef = db.doc(`boards/${boardId}/objects/${objectId}`);

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (key !== 'id' && key !== 'createdAt' && key !== 'createdBy' && value !== undefined) {
      cleaned[key] = value;
    }
  }

  await docRef.update({
    ...cleaned,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Deletes a board object via Admin SDK.
 */
export async function adminDeleteObject(
  boardId: string,
  objectId: string
): Promise<void> {
  const db = getAdminDb();
  await db.doc(`boards/${boardId}/objects/${objectId}`).delete();
}

/**
 * Batch-updates multiple objects via Admin SDK.
 */
export async function adminBatchUpdate(
  boardId: string,
  updates: { id: string; data: Partial<BoardObject> }[]
): Promise<void> {
  if (updates.length === 0) return;
  const db = getAdminDb();
  const batch = db.batch();

  for (const { id, data } of updates) {
    const docRef = db.doc(`boards/${boardId}/objects/${id}`);
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'id' && key !== 'createdAt' && key !== 'createdBy' && value !== undefined) {
        cleaned[key] = value;
      }
    }
    batch.update(docRef, { ...cleaned, updatedAt: FieldValue.serverTimestamp() });
  }

  await batch.commit();
}

/**
 * Fetches all objects for a board via Admin SDK.
 * Used by getBoardState tool to provide fresh context to Claude.
 */
export async function adminGetObjects(boardId: string): Promise<BoardObject[]> {
  const db = getAdminDb();
  const snapshot = await db.collection(`boards/${boardId}/objects`).get();
  return snapshot.docs.map((d) => d.data() as BoardObject);
}

/**
 * Confirms all pending AI objects for a command — sets isAIPending to false.
 */
export async function adminConfirmPending(
  boardId: string,
  aiCommandId: string
): Promise<void> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(`boards/${boardId}/objects`)
    .where('aiCommandId', '==', aiCommandId)
    .where('isAIPending', '==', true)
    .get();

  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.forEach((d) =>
    batch.update(d.ref, { isAIPending: false, updatedAt: FieldValue.serverTimestamp() })
  );
  await batch.commit();
}

/**
 * Rollbacks all pending AI objects for a command — deletes them.
 * Called when a streaming AI command fails mid-execution.
 */
export async function adminRollbackPending(
  boardId: string,
  aiCommandId: string
): Promise<void> {
  const db = getAdminDb();
  const snapshot = await db
    .collection(`boards/${boardId}/objects`)
    .where('aiCommandId', '==', aiCommandId)
    .get();

  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/**
 * Verifies a Firebase ID token using the Admin SDK.
 * Returns the decoded token if valid, throws if invalid.
 */
export async function verifyIdToken(idToken: string) {
  const { getAuth } = await import('firebase-admin/auth');
  return getAuth(getAdminApp()).verifyIdToken(idToken);
}
