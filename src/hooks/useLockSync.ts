import { useEffect } from "react";
import { onLocksChange } from "@/lib/firebase/rtdb";
import { useObjectStore } from "@/lib/store/objectStore";

/**
 * Subscribes to RTDB lock changes for a board and syncs to objectStore.
 *
 * - Converts null snapshot (no locks exist) to empty object.
 * - Cleans up listener on unmount.
 */
export function useLockSync(boardId: string | undefined): void {
  useEffect(() => {
    if (!boardId) return;

    const unsubscribe = onLocksChange(boardId, (locks) => {
      useObjectStore.getState().setLocks(locks ?? {});
    });

    return () => {
      unsubscribe();
    };
  }, [boardId]);
}
