"use client";

import { useEffect, useState, useCallback } from "react";
import { Circle, Text, Group } from "react-konva";
import { onCursorChildEvents } from "@/lib/firebase/rtdb";
import { useAuthStore } from "@/lib/store/authStore";
import type { CursorData } from "@/lib/types";

interface CursorLayerProps {
  boardId: string;
}

const STALE_THRESHOLD_MS = 10_000; // Ignore cursors older than 10 seconds

/**
 * Renders remote user cursors from RTDB.
 *
 * Uses granular child listeners (onChildAdded/Changed/Removed) instead of
 * a parent-node onValue — only the specific cursor that changed triggers
 * a state update, reducing re-render payload at scale.
 */
export default function CursorLayer({ boardId }: CursorLayerProps) {
  const [cursors, setCursors] = useState<Record<string, CursorData>>({});
  const userId = useAuthStore((s) => s.user?.uid);

  const handleUpsert = useCallback((id: string, data: CursorData) => {
    setCursors((prev) => ({ ...prev, [id]: data }));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setCursors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onCursorChildEvents(boardId, {
      onAdd: handleUpsert,
      onChange: handleUpsert,
      onRemove: handleRemove,
    });
    return () => {
      unsubscribe();
      setCursors({});
    };
  }, [boardId, handleUpsert, handleRemove]);

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
