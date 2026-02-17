import { useCallback } from "react";
import { useObjectStore } from "@/lib/store/objectStore";
import { updateObject } from "@/lib/firebase/firestore";
import { overlapFraction } from "@/lib/utils";
import type { BoardObject } from "@/lib/types";

/**
 * Hook that provides auto-nesting logic for frames.
 * Call `checkNesting` after an object's drag ends to auto-assign/clear parentFrame.
 */
export function useFrameNesting(boardId: string) {
  const objects = useObjectStore((s) => s.objects);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);

  const checkNesting = useCallback(
    (objectId: string) => {
      const obj = objects[objectId];
      if (!obj) return;
      // Frames and connectors don't nest into frames
      if (obj.type === "frame" || obj.type === "connector") return;

      const frames = Object.values(objects).filter(
        (o) => o.type === "frame" && o.id !== objectId
      );

      let bestFrame: BoardObject | null = null;
      let bestOverlap = 0;

      for (const frame of frames) {
        const frac = overlapFraction(obj, frame);
        if (frac > 0.5 && frac > bestOverlap) {
          bestOverlap = frac;
          bestFrame = frame;
        }
      }

      const currentParent = obj.parentFrame || "";
      const newParent = bestFrame ? bestFrame.id : "";

      if (currentParent !== newParent) {
        updateObjectLocal(objectId, { parentFrame: newParent || undefined });
        updateObject(boardId, objectId, {
          parentFrame: newParent || undefined,
        }).catch(console.error);
      }
    },
    [objects, boardId, updateObjectLocal]
  );

  return { checkNesting };
}
