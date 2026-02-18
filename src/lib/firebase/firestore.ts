import {
  collection,
  collectionGroup,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getCountFromServer,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./config";
import type { BoardObject, BoardMetadata, ChatMessage } from "../types";

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

/**
 * Fetches all boards created by a given user.
 * Uses collectionGroup query on "metadata" with createdBy filter.
 * Returns boards ordered by createdAt descending, limited to 50.
 *
 * Note: requires a Firestore composite index on metadata collection
 * (createdBy ASC, createdAt DESC). Firebase will auto-prompt with a
 * link to create it on the first query error.
 */
export async function getUserBoards(
  userId: string
): Promise<(BoardMetadata & { boardId: string })[]> {
  const q = query(
    collectionGroup(db, "metadata"),
    where("createdBy", "==", userId),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  const snapshot = await getDocs(q);
  const boards: (BoardMetadata & { boardId: string })[] = [];

  for (const docSnap of snapshot.docs) {
    // Path: boards/{boardId}/metadata/config
    const pathSegments = docSnap.ref.path.split("/");
    const boardId = pathSegments[1]; // Extract boardId from path
    boards.push({ ...(docSnap.data() as BoardMetadata), boardId });
  }

  return boards;
}

// ---------------------------------------------------------------------------
// Board visit tracking (users/{userId}/visitedBoards/{boardId})
// ---------------------------------------------------------------------------

/**
 * Records that a user visited a board. Updates the lastVisited timestamp.
 */
export async function recordBoardVisit(
  userId: string,
  boardId: string
): Promise<void> {
  const docRef = doc(db, "users", userId, "visitedBoards", boardId);
  await setDoc(
    docRef,
    { boardId, lastVisited: serverTimestamp() },
    { merge: true }
  );
}

// ---------------------------------------------------------------------------
// Chat message helpers (boards/{boardId}/messages/{messageId})
// ---------------------------------------------------------------------------

/**
 * Writes a chat message to Firestore. Returns the generated message ID.
 * Automatically sets createdAt to server timestamp.
 */
export async function sendChatMessage(
  boardId: string,
  message: Omit<ChatMessage, 'id' | 'createdAt'>
): Promise<string> {
  const colRef = collection(db, 'boards', boardId, 'messages');
  const docRef = doc(colRef);

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(message)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  await setDoc(docRef, {
    ...cleaned,
    id: docRef.id,
    createdAt: serverTimestamp(),
  });

  // Enforce message cap after writing
  await enforceMessageCap(boardId, 500);

  return docRef.id;
}

/**
 * Subscribes to the most recent `messageLimit` messages for a board.
 * Fires the callback with a sorted (oldest-first) array on each change.
 */
export function onChatMessages(
  boardId: string,
  messageLimit: number,
  callback: (msgs: ChatMessage[]) => void
): Unsubscribe {
  const messagesRef = collection(db, 'boards', boardId, 'messages');
  const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(messageLimit));

  return onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs
      .map((d) => d.data() as ChatMessage)
      .reverse(); // Show oldest first in timeline
    callback(msgs);
  });
}

/**
 * Loads older messages before a given timestamp for infinite scroll pagination.
 */
export async function loadOlderMessages(
  boardId: string,
  beforeTimestamp: Timestamp,
  messageLimit: number
): Promise<ChatMessage[]> {
  const messagesRef = collection(db, 'boards', boardId, 'messages');
  const q = query(
    messagesRef,
    orderBy('createdAt', 'desc'),
    where('createdAt', '<', beforeTimestamp),
    limit(messageLimit)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as ChatMessage).reverse();
}

/**
 * Deletes a single chat message by ID.
 */
export async function deleteChatMessage(
  boardId: string,
  messageId: string
): Promise<void> {
  await deleteDoc(doc(db, 'boards', boardId, 'messages', messageId));
}

/**
 * Updates fields on an existing chat message.
 */
export async function updateChatMessage(
  boardId: string,
  messageId: string,
  updates: Partial<ChatMessage>
): Promise<void> {
  const docRef = doc(db, 'boards', boardId, 'messages', messageId);
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  await updateDoc(docRef, cleaned);
}

/**
 * Enforces a maximum message count per board by deleting the oldest messages
 * when the cap is exceeded. Called after each new message write.
 */
export async function enforceMessageCap(
  boardId: string,
  cap: number
): Promise<void> {
  const messagesRef = collection(db, 'boards', boardId, 'messages');
  const countSnap = await getCountFromServer(messagesRef);
  const count = countSnap.data().count;

  if (count <= cap) return;

  const excess = count - cap;
  const oldestQuery = query(
    messagesRef,
    orderBy('createdAt', 'asc'),
    limit(excess)
  );
  const oldestSnap = await getDocs(oldestQuery);
  const batch = writeBatch(db);
  oldestSnap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/**
 * Deletes all board objects that were created by a specific AI command.
 * Used for AI undo functionality.
 */
export async function deleteObjectsByAiCommand(
  boardId: string,
  aiCommandId: string
): Promise<void> {
  const objectsRef = collection(db, 'boards', boardId, 'objects');
  const q = query(objectsRef, where('aiCommandId', '==', aiCommandId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return;
  const batch = writeBatch(db);
  snapshot.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/**
 * Confirms all pending AI objects by setting isAIPending to false.
 * Called when an AI command stream completes successfully.
 */
export async function confirmAIPendingObjects(
  boardId: string,
  aiCommandId: string
): Promise<void> {
  const objectsRef = collection(db, 'boards', boardId, 'objects');
  const q = query(
    objectsRef,
    where('aiCommandId', '==', aiCommandId),
    where('isAIPending', '==', true)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return;
  const batch = writeBatch(db);
  snapshot.forEach((d) =>
    batch.update(d.ref, { isAIPending: false, updatedAt: serverTimestamp() })
  );
  await batch.commit();
}

/**
 * Checks if a user has exceeded the AI command rate limit.
 * Authenticated: 20 commands/hour. Anonymous: 5 commands/hour.
 * Board-wide: 50 commands/day.
 */
export async function checkRateLimit(
  boardId: string,
  userId: string,
  isAnonymous: boolean
): Promise<{ allowed: boolean; remaining: number }> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const hourAgoTimestamp = Timestamp.fromDate(hourAgo);
  const messagesRef = collection(db, 'boards', boardId, 'messages');

  // Count per-user AI commands in the last hour
  const userHourQuery = query(
    messagesRef,
    where('senderId', '==', userId),
    where('type', '==', 'ai_command'),
    where('createdAt', '>=', hourAgoTimestamp)
  );
  const userCountSnap = await getCountFromServer(userHourQuery);
  const userCount = userCountSnap.data().count;

  const userLimit = isAnonymous ? 5 : 20;
  if (userCount >= userLimit) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: userLimit - userCount };
}

/**
 * Fetches boards the user has visited (that they didn't create).
 * Returns board metadata + boardId for display on the dashboard.
 */
export async function getVisitedBoards(
  userId: string
): Promise<(BoardMetadata & { boardId: string; lastVisited?: Timestamp | number })[]> {
  const q = query(
    collection(db, "users", userId, "visitedBoards"),
    orderBy("lastVisited", "desc"),
    limit(50)
  );
  const snapshot = await getDocs(q);
  const boards: (BoardMetadata & { boardId: string; lastVisited?: Timestamp | number })[] = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const boardId = data.boardId as string;
    // Fetch the board metadata to get the title and other info
    const meta = await getBoardMetadata(boardId);
    if (meta) {
      boards.push({ ...meta, boardId, lastVisited: data.lastVisited });
    }
  }

  return boards;
}
