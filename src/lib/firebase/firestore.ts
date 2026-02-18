import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./config";
import type { BoardObject, BoardMetadata } from "../types";

/**
 * Generates a new Firestore document ID without writing anything.
 * Use this to get a stable ID for optimistic rendering before calling createObject.
 */
export function generateObjectId(boardId: string): string {
  const colRef = collection(db, "boards", boardId, "objects");
  return doc(colRef).id;
}

/**
 * Creates a board object in Firestore.
 *
 * If `objectId` is provided, it's used as the document ID (for optimistic rendering
 * where the ID was pre-generated via generateObjectId). Otherwise a new ID is generated.
 *
 * Returns the document ID.
 */
export async function createObject(
  boardId: string,
  data: Omit<BoardObject, "id" | "createdAt" | "updatedAt">,
  objectId?: string
): Promise<string> {
  const colRef = collection(db, "boards", boardId, "objects");
  const docRef = objectId ? doc(colRef, objectId) : doc(colRef);

  // Strip undefined values — Firestore rejects them
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  await setDoc(docRef, {
    ...cleaned,
    id: docRef.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return docRef.id;
}

/**
 * Updates fields on an existing board object.
 * Automatically sets updatedAt to server timestamp.
 * Strips immutable fields (id, createdAt, createdBy) from updates.
 */
export async function updateObject(
  boardId: string,
  objectId: string,
  updates: Partial<BoardObject>
): Promise<void> {
  const docRef = doc(db, "boards", boardId, "objects", objectId);

  // Strip immutable fields and undefined values
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, createdAt: _createdAt, createdBy: _createdBy, ...mutable } = updates;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mutable)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  await updateDoc(docRef, {
    ...cleaned,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Deletes a board object from Firestore.
 */
export async function deleteObject(
  boardId: string,
  objectId: string
): Promise<void> {
  const docRef = doc(db, "boards", boardId, "objects", objectId);
  await deleteDoc(docRef);
}

// ---------------------------------------------------------------------------
// Batch operations (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Batch-deletes multiple objects from Firestore.
 */
export async function deleteObjects(
  boardId: string,
  objectIds: string[]
): Promise<void> {
  if (objectIds.length === 0) return;
  const batch = writeBatch(db);
  for (const id of objectIds) {
    batch.delete(doc(db, "boards", boardId, "objects", id));
  }
  await batch.commit();
}

/**
 * Batch-creates multiple objects in Firestore.
 * Returns the generated document IDs.
 */
export async function createObjects(
  boardId: string,
  objects: Omit<BoardObject, "createdAt" | "updatedAt">[]
): Promise<string[]> {
  if (objects.length === 0) return [];
  const batch = writeBatch(db);
  const ids: string[] = [];
  const colRef = collection(db, "boards", boardId, "objects");

  for (const data of objects) {
    const docRef = data.id ? doc(colRef, data.id) : doc(colRef);
    ids.push(docRef.id);

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleaned[key] = value;
      }
    }

    batch.set(docRef, {
      ...cleaned,
      id: docRef.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return ids;
}

/**
 * Batch-updates multiple objects in Firestore.
 */
export async function updateObjects(
  boardId: string,
  updates: { id: string; changes: Partial<BoardObject> }[]
): Promise<void> {
  if (updates.length === 0) return;
  const batch = writeBatch(db);

  for (const { id, changes } of updates) {
    const docRef = doc(db, "boards", boardId, "objects", id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, createdAt: _ca, createdBy: _cb, ...mutable } = changes;
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mutable)) {
      if (value !== undefined) {
        cleaned[key] = value;
      }
    }
    batch.update(docRef, { ...cleaned, updatedAt: serverTimestamp() });
  }

  await batch.commit();
}

/**
 * Creates the metadata document for a new board.
 * Stored at boards/{boardId}/metadata/config.
 */
export async function createBoardMetadata(
  boardId: string,
  userId: string,
  title: string
): Promise<void> {
  const docRef = doc(db, "boards", boardId, "metadata", "config");
  await setDoc(docRef, {
    title,
    createdBy: userId,
    createdAt: serverTimestamp(),
    isPublic: true,
    invitedEmails: [],
    aiPersona: "neutral",
    aiCommandsToday: 0,
    aiCommandsResetAt: serverTimestamp(),
    analysisHistory: [],
  });
}

/**
 * Reads the board metadata document.
 * Returns null if the document doesn't exist.
 */
export async function getBoardMetadata(
  boardId: string
): Promise<BoardMetadata | null> {
  const docRef = doc(db, "boards", boardId, "metadata", "config");
  const snap = await getDoc(docRef);
  return snap.exists() ? (snap.data() as BoardMetadata) : null;
}

/**
 * Partial update to the board metadata document.
 */
export async function updateBoardMetadata(
  boardId: string,
  updates: Partial<BoardMetadata>
): Promise<void> {
  const docRef = doc(db, "boards", boardId, "metadata", "config");
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  await updateDoc(docRef, cleaned);
}
