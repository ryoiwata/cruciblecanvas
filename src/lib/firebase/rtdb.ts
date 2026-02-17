import {
  ref,
  set,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/database";
import { rtdb } from "./config";
import type { CursorData, PresenceData, ObjectLock } from "../types";

// ---------------------------------------------------------------------------
// Cursors — /boards/{boardId}/cursors/{userId}
// ---------------------------------------------------------------------------

export function setCursor(
  boardId: string,
  userId: string,
  data: CursorData
): void {
  const cursorRef = ref(rtdb, `boards/${boardId}/cursors/${userId}`);
  set(cursorRef, data);
}

export function onCursorsChange(
  boardId: string,
  callback: (cursors: Record<string, CursorData> | null) => void
): Unsubscribe {
  const cursorsRef = ref(rtdb, `boards/${boardId}/cursors`);
  return onValue(cursorsRef, (snapshot) => {
    callback(snapshot.val());
  });
}

export function removeCursor(boardId: string, userId: string): void {
  const cursorRef = ref(rtdb, `boards/${boardId}/cursors/${userId}`);
  remove(cursorRef);
}

/**
 * Registers onDisconnect cleanup for this user's cursor.
 * Call once when entering a board — RTDB server will auto-remove
 * the cursor node if the client disconnects or crashes.
 */
export function setupCursorDisconnect(
  boardId: string,
  userId: string
): void {
  const cursorRef = ref(rtdb, `boards/${boardId}/cursors/${userId}`);
  onDisconnect(cursorRef).remove();
}

// ---------------------------------------------------------------------------
// Presence — /boards/{boardId}/presence/{userId}
// ---------------------------------------------------------------------------

/**
 * Sets this user's presence as online and registers onDisconnect cleanup.
 * On disconnect, RTDB server sets online=false and updates lastSeen.
 */
export function setPresence(
  boardId: string,
  userId: string,
  data: Omit<PresenceData, "online" | "lastSeen">
): void {
  const presenceRef = ref(rtdb, `boards/${boardId}/presence/${userId}`);

  // Strip undefined values — RTDB rejects them (e.g. email for guest users)
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  set(presenceRef, {
    ...cleaned,
    online: true,
    lastSeen: Date.now(),
  });
  onDisconnect(presenceRef).update({
    online: false,
    lastSeen: serverTimestamp(),
  });
}

export function onPresenceChange(
  boardId: string,
  callback: (presence: Record<string, PresenceData> | null) => void
): Unsubscribe {
  const presenceRef = ref(rtdb, `boards/${boardId}/presence`);
  return onValue(presenceRef, (snapshot) => {
    callback(snapshot.val());
  });
}

export function removePresence(boardId: string, userId: string): void {
  const presenceRef = ref(rtdb, `boards/${boardId}/presence/${userId}`);
  remove(presenceRef);
}

// ---------------------------------------------------------------------------
// Locks — /boards/{boardId}/locks/{objectId}
// ---------------------------------------------------------------------------

/**
 * Acquires a soft lock on an object for drag conflict prevention.
 * Registers onDisconnect to auto-release if the client crashes.
 */
export function acquireLock(
  boardId: string,
  objectId: string,
  userId: string,
  userName: string
): void {
  const lockRef = ref(rtdb, `boards/${boardId}/locks/${objectId}`);
  const lock: ObjectLock = {
    userId,
    userName,
    timestamp: Date.now(),
  };
  set(lockRef, lock);
  onDisconnect(lockRef).remove();
}

export function releaseLock(boardId: string, objectId: string): void {
  const lockRef = ref(rtdb, `boards/${boardId}/locks/${objectId}`);
  remove(lockRef);
}

export function onLocksChange(
  boardId: string,
  callback: (locks: Record<string, ObjectLock> | null) => void
): Unsubscribe {
  const locksRef = ref(rtdb, `boards/${boardId}/locks`);
  return onValue(locksRef, (snapshot) => {
    callback(snapshot.val());
  });
}
