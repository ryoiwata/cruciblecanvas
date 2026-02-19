import { useEffect } from "react";
import { onLockChildEvents } from "@/lib/firebase/rtdb";
import { useObjectStore } from "@/lib/store/objectStore";

/**
 * Subscribes to RTDB lock child events for a board and syncs to objectStore.
 *
 * Uses granular onChildAdded/Changed/Removed listeners instead of onValue
 * so only the specific lock entry is updated in the store per event. This
 * prevents all components subscribed to `locks` from re-rendering whenever
 * any single user acquires or releases a lock.
 */
export function useLockSync(boardId: string | undefined): void {
  useEffect(() => {
    if (!boardId) return;

    const unsubscribe = onLockChildEvents(boardId, {
      onAdd: (objectId, lock) => {
        useObjectStore.getState().upsertLock(objectId, lock);
      },
      onChange: (objectId, lock) => {
        useObjectStore.getState().upsertLock(objectId, lock);
      },
      onRemove: (objectId) => {
        useObjectStore.getState().removeLock(objectId);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [boardId]);
}
