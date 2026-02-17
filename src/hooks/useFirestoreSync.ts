import { useEffect, useRef } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useObjectStore } from "@/lib/store/objectStore";
import type { BoardObject } from "@/lib/types";

/**
 * Subscribes to Firestore onSnapshot for all objects in a board.
 *
 * - First snapshot: bulk-loads all objects via setObjects + marks isLoaded.
 * - Subsequent snapshots: applies docChanges individually (added/modified/removed).
 * - Handles React StrictMode double-mount: unsubscribes on unmount, resubscribes on remount.
 */
export function useFirestoreSync(boardId: string | undefined): void {
  const isFirstSnapshot = useRef(true);

  useEffect(() => {
    if (!boardId) return;

    // Reset on mount (handles StrictMode remount)
    isFirstSnapshot.current = true;
    useObjectStore.getState().setIsLoaded(false);

    const colRef = collection(db, "boards", boardId, "objects");

    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const { setObjects, upsertObject, removeObject, setIsLoaded } =
          useObjectStore.getState();

        if (isFirstSnapshot.current) {
          // First snapshot: bulk-load all documents as a single map
          const objects: Record<string, BoardObject> = {};
          snapshot.docs.forEach((doc) => {
            const data = doc.data();
            objects[doc.id] = { ...data, id: doc.id } as BoardObject;
          });
          setObjects(objects);
          setIsLoaded(true);
          isFirstSnapshot.current = false;
          return;
        }

        // Subsequent snapshots: apply incremental changes
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          const obj = { ...data, id: change.doc.id } as BoardObject;

          switch (change.type) {
            case "added":
            case "modified":
              upsertObject(obj);
              break;
            case "removed":
              removeObject(change.doc.id);
              break;
          }
        });
      },
      (error) => {
        console.error("Firestore onSnapshot error:", error);
        // Still mark as loaded so the UI doesn't spin forever
        useObjectStore.getState().setIsLoaded(true);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [boardId]);
}
