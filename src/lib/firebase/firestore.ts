import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./config";
import type { BoardObject } from "../types";

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
  const { id: _, createdAt: __, createdBy: ___, ...mutable } = updates;
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
