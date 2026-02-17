"use client";

import { useEffect, useState } from "react";
import { Circle, Text, Group } from "react-konva";
import { onCursorsChange } from "@/lib/firebase/rtdb";
import { useAuthStore } from "@/lib/store/authStore";
import type { CursorData } from "@/lib/types";

interface CursorLayerProps {
  boardId: string;
}

const STALE_THRESHOLD_MS = 10_000; // Ignore cursors older than 10 seconds

/**
 * Renders remote user cursors from RTDB.
 *
 * Filters out the local user's cursor and stale cursors (>10s old).
 * Each cursor is a colored circle with name label below.
 */
export default function CursorLayer({ boardId }: CursorLayerProps) {
  const [cursors, setCursors] = useState<Record<string, CursorData>>({});
  const userId = useAuthStore((s) => s.user?.uid);

  useEffect(() => {
    const unsubscribe = onCursorsChange(boardId, (data) => {
      setCursors(data ?? {});
    });
    return () => unsubscribe();
  }, [boardId]);

  const now = Date.now();

  const remoteCursors = Object.entries(cursors).filter(([id, cursor]) => {
    // Filter out local user
    if (id === userId) return false;
    // Filter out stale cursors
    if (now - cursor.timestamp > STALE_THRESHOLD_MS) return false;
    return true;
  });

  return (
    <>
      {remoteCursors.map(([id, cursor]) => (
        <Group key={id} x={cursor.x} y={cursor.y}>
          <Circle radius={6} fill={cursor.color} />
          <Text
            text={cursor.name}
            y={10}
            fontSize={12}
            fontFamily="sans-serif"
            fill={cursor.color}
            offsetX={0}
          />
        </Group>
      ))}
    </>
  );
}
