import { useEffect } from "react";
import { onPresenceChildEvents } from "@/lib/firebase/rtdb";
import { usePresenceStore } from "@/lib/store/presenceStore";

/**
 * Subscribes to RTDB presence changes for a board and syncs to presenceStore.
 *
 * Uses granular child listeners (onChildAdded/Changed/Removed) so that each
 * user's heartbeat only triggers a targeted store update for that user,
 * not a full replacement of the entire presence map. This prevents unnecessary
 * re-renders of all presence subscribers when any single user's heartbeat fires.
 */
export function usePresenceSync(boardId: string | undefined): void {
  useEffect(() => {
    if (!boardId) return;

    const store = usePresenceStore.getState();

    const unsubscribe = onPresenceChildEvents(boardId, {
      onAdd: (userId, data) => store.upsertPresence(userId, data),
      onChange: (userId, data) => store.upsertPresence(userId, data),
      onRemove: (userId) => store.removePresence(userId),
    });

    return () => {
      unsubscribe();
      usePresenceStore.getState().setPresence({});
    };
  }, [boardId]);
}
