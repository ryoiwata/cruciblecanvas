import {
  ref,
  get,
  set,
  update,
  remove,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/database";
import { rtdb } from "./config";
import { presenceLogger } from "../debug/presenceLogger";
import type { CursorData, PresenceData, ObjectLock } from "../types";

// ---------------------------------------------------------------------------
// Shared error handler — surfaces RTDB permission errors visibly
// ---------------------------------------------------------------------------

function handleListenerError(context: string) {
  return (error: Error) => {
    console.error(
      `[RTDB] Listener cancelled (${context}): ${error.message}.\n` +
        "Check Firebase RTDB security rules — authenticated users need read access to /boards/{boardId}/*."
    );
    presenceLogger.writeError(context, error);
  };
}

// ---------------------------------------------------------------------------
// Connection monitoring — .info/connected
// ---------------------------------------------------------------------------

/**
 * Subscribes to RTDB connection state. Callback fires with `true` when
 * the WebSocket is established and `false` when it drops.
 */
export function onConnectionStateChange(
  callback: (connected: boolean) => void
): Unsubscribe {
  const connectedRef = ref(rtdb, ".info/connected");
  return onValue(connectedRef, (snapshot) => {
    const connected = snapshot.val() === true;
    presenceLogger.connectionStateChanged(connected);
    callback(connected);
  });
}

// ---------------------------------------------------------------------------
// Cursors — /boards/{boardId}/cursors/{userId}
// ---------------------------------------------------------------------------

export function setCursor(
  boardId: string,
  userId: string,
  data: CursorData
): void {
  const cursorRef = ref(rtdb, `boards/${boardId}/cursors/${userId}`);
  set(cursorRef, data).catch((err) => {
    console.error("[RTDB] setCursor failed:", err.message);
    presenceLogger.writeError("setCursor", err);
  });
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

/**
 * Subscribes to individual cursor changes using granular child listeners.
 * More efficient than onCursorsChange — only fires for the specific cursor that changed.
 * Returns a cleanup function that unsubscribes all three listeners.
 */
export function onCursorChildEvents(
  boardId: string,
  callbacks: {
    onAdd: (userId: string, data: CursorData) => void;
    onChange: (userId: string, data: CursorData) => void;
    onRemove: (userId: string) => void;
  }
): Unsubscribe {
  const cursorsRef = ref(rtdb, `boards/${boardId}/cursors`);
  const onError = handleListenerError("onCursorChildEvents");

  const unsubAdd = onChildAdded(
    cursorsRef,
    (snapshot) => {
      if (snapshot.key && snapshot.val()) {
        presenceLogger.cursorReceived(snapshot.key, snapshot.val());
        callbacks.onAdd(snapshot.key, snapshot.val());
      }
    },
    onError
  );

  const unsubChange = onChildChanged(
    cursorsRef,
    (snapshot) => {
      if (snapshot.key && snapshot.val()) {
        presenceLogger.cursorReceived(snapshot.key, snapshot.val());
        callbacks.onChange(snapshot.key, snapshot.val());
      }
    },
    onError
  );

  const unsubRemove = onChildRemoved(
    cursorsRef,
    (snapshot) => {
      if (snapshot.key) {
        presenceLogger.cursorChildRemoved(snapshot.key);
        callbacks.onRemove(snapshot.key);
      }
    },
    onError
  );

  return () => {
    unsubAdd();
    unsubChange();
    unsubRemove();
  };
}

export function removeCursor(boardId: string, userId: string): void {
  const cursorRef = ref(rtdb, `boards/${boardId}/cursors/${userId}`);
  remove(cursorRef).catch((err) => {
    presenceLogger.writeError("removeCursor", err);
  });
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
  onDisconnect(cursorRef)
    .remove()
    .catch((err) => {
      presenceLogger.writeError("setupCursorDisconnect", err);
    });
}

/**
 * Cancels any pending onDisconnect handler for this user's cursor.
 * Call before removing the cursor node to prevent ghost re-creation.
 */
export function cancelCursorDisconnect(
  boardId: string,
  userId: string
): void {
  const cursorRef = ref(rtdb, `boards/${boardId}/cursors/${userId}`);
  onDisconnect(cursorRef).cancel().catch((err) => {
    presenceLogger.writeError("cancelCursorDisconnect", err);
  });
}

// ---------------------------------------------------------------------------
// Presence — /boards/{boardId}/presence/{userId}
// ---------------------------------------------------------------------------

/**
 * Sets this user's full presence record as online.
 * Does NOT register onDisconnect — call setupPresenceDisconnect() once instead.
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
  }).catch((err) => {
    console.error("[RTDB] setPresence failed:", err.message);
    presenceLogger.writeError("setPresence", err);
  });
}

/**
 * Registers onDisconnect cleanup for this user's presence.
 * Call once on board entry (and again after reconnect).
 * Separated from setPresence() to avoid re-registering on every heartbeat.
 */
export function setupPresenceDisconnect(
  boardId: string,
  userId: string
): void {
  const presenceRef = ref(rtdb, `boards/${boardId}/presence/${userId}`);
  onDisconnect(presenceRef)
    .update({
      online: false,
      lastSeen: serverTimestamp(),
    })
    .catch((err) => {
      presenceLogger.writeError("setupPresenceDisconnect", err);
    });
}

/**
 * Cancels any pending onDisconnect handler for this user's presence.
 * Call before removing the presence node to prevent ghost re-creation.
 */
export function cancelPresenceDisconnect(
  boardId: string,
  userId: string
): void {
  const presenceRef = ref(rtdb, `boards/${boardId}/presence/${userId}`);
  onDisconnect(presenceRef).cancel().catch((err) => {
    presenceLogger.writeError("cancelPresenceDisconnect", err);
  });
}

/**
 * Lightweight heartbeat — only updates lastSeen timestamp.
 * Much cheaper than a full setPresence() call for keeping presence alive.
 */
export function updatePresenceTimestamp(
  boardId: string,
  userId: string
): void {
  const presenceRef = ref(rtdb, `boards/${boardId}/presence/${userId}`);
  update(presenceRef, { lastSeen: Date.now() }).catch((err) => {
    presenceLogger.writeError("updatePresenceTimestamp", err);
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

/**
 * One-shot read of all current presence entries for a board.
 * Used to eagerly populate the store before child listeners are attached,
 * fixing the "Empty User List" on initial join.
 */
export async function getPresenceSnapshot(
  boardId: string
): Promise<Record<string, PresenceData> | null> {
  const presenceRef = ref(rtdb, `boards/${boardId}/presence`);
  const snapshot = await get(presenceRef);
  return snapshot.val();
}

/**
 * Subscribes to individual presence changes using granular child listeners.
 * More efficient than onPresenceChange — only fires for the specific user
 * that changed, preventing all presence subscribers from re-rendering on
 * every heartbeat write by any user.
 */
export function onPresenceChildEvents(
  boardId: string,
  callbacks: {
    onAdd: (userId: string, data: PresenceData) => void;
    onChange: (userId: string, data: PresenceData) => void;
    onRemove: (userId: string) => void;
  }
): Unsubscribe {
  const presenceRef = ref(rtdb, `boards/${boardId}/presence`);
  const onError = handleListenerError("onPresenceChildEvents");

  const unsubAdd = onChildAdded(
    presenceRef,
    (snapshot) => {
      if (snapshot.key && snapshot.val()) {
        presenceLogger.presenceAdded(snapshot.key, snapshot.val());
        callbacks.onAdd(snapshot.key, snapshot.val());
      }
    },
    onError
  );

  const unsubChange = onChildChanged(
    presenceRef,
    (snapshot) => {
      if (snapshot.key && snapshot.val()) {
        presenceLogger.presenceChanged(snapshot.key, snapshot.val());
        callbacks.onChange(snapshot.key, snapshot.val());
      }
    },
    onError
  );

  const unsubRemove = onChildRemoved(
    presenceRef,
    (snapshot) => {
      if (snapshot.key) {
        presenceLogger.presenceChildRemoved(snapshot.key);
        callbacks.onRemove(snapshot.key);
      }
    },
    onError
  );

  return () => {
    unsubAdd();
    unsubChange();
    unsubRemove();
  };
}

export function removePresence(boardId: string, userId: string): void {
  const presenceRef = ref(rtdb, `boards/${boardId}/presence/${userId}`);
  remove(presenceRef).catch((err) => {
    presenceLogger.writeError("removePresence", err);
  });
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
  set(lockRef, lock).catch((err) => {
    presenceLogger.writeError("acquireLock", err);
  });
  onDisconnect(lockRef)
    .remove()
    .catch((err) => {
      presenceLogger.writeError("acquireLock.onDisconnect", err);
    });
}

export function releaseLock(boardId: string, objectId: string): void {
  const lockRef = ref(rtdb, `boards/${boardId}/locks/${objectId}`);
  remove(lockRef).catch((err) => {
    presenceLogger.writeError("releaseLock", err);
  });
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
