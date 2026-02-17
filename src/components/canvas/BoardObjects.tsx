"use client";

import { useObjectStore } from "@/lib/store/objectStore";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useAuthStore } from "@/lib/store/authStore";
import StickyNote from "./StickyNote";
import type { BoardObject } from "@/lib/types";
import type { Timestamp } from "firebase/firestore";

interface BoardObjectsProps {
  boardId: string;
  width: number;
  height: number;
}

/** Convert createdAt to milliseconds for z-index sorting. */
function getCreatedAtMs(obj: BoardObject): number {
  const ts = obj.createdAt;
  if (typeof ts === "number") return ts;
  if (ts && typeof (ts as Timestamp).toMillis === "function") {
    return (ts as Timestamp).toMillis();
  }
  return 0;
}

/**
 * Renders all board objects from the objectStore.
 *
 * Phase 2: only stickyNote type.
 * Applies viewport culling (200px padding) and sorts by createdAt for z-index.
 */
export default function BoardObjects({ boardId, width, height }: BoardObjectsProps) {
  const objects = useObjectStore((s) => s.objects);
  const locks = useObjectStore((s) => s.locks);
  const userId = useAuthStore((s) => s.user?.uid);

  const stageX = useCanvasStore((s) => s.stageX);
  const stageY = useCanvasStore((s) => s.stageY);
  const stageScale = useCanvasStore((s) => s.stageScale);

  // Viewport culling bounds in canvas-space
  const padding = 200;
  const vpLeft = -stageX / stageScale - padding;
  const vpTop = -stageY / stageScale - padding;
  const vpRight = vpLeft + width / stageScale + padding * 2;
  const vpBottom = vpTop + height / stageScale + padding * 2;

  const visibleObjects = Object.values(objects)
    .filter((obj) => {
      // Phase 2: only sticky notes
      if (obj.type !== "stickyNote") return false;

      // Viewport culling
      if (obj.x + obj.width < vpLeft) return false;
      if (obj.x > vpRight) return false;
      if (obj.y + obj.height < vpTop) return false;
      if (obj.y > vpBottom) return false;

      return true;
    })
    .sort((a, b) => getCreatedAtMs(a) - getCreatedAtMs(b));

  return (
    <>
      {visibleObjects.map((obj) => {
        const lock = locks[obj.id];
        const isLockedByOther = !!lock && lock.userId !== userId;

        return (
          <StickyNote
            key={obj.id}
            object={obj}
            boardId={boardId}
            isLocked={isLockedByOther}
            lockedByName={isLockedByOther ? lock.userName : null}
          />
        );
      })}
    </>
  );
}
