import { useEffect } from "react";
import { onPresenceChange } from "@/lib/firebase/rtdb";
import { usePresenceStore } from "@/lib/store/presenceStore";

/**
 * Subscribes to RTDB presence changes for a board and syncs to presenceStore.
 *
 * - Converts null snapshot (no presence data) to empty object.
 * - Cleans up listener on unmount.
 */
export function usePresenceSync(boardId: string | undefined): void {
  useEffect(() => {
    if (!boardId) return;

    const unsubscribe = onPresenceChange(boardId, (presence) => {
      usePresenceStore.getState().setPresence(presence ?? {});
    });

    return () => {
      unsubscribe();
    };
  }, [boardId]);
}
