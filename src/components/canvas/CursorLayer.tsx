"use client";

import { useEffect, useState, useCallback } from "react";
import { Path, Rect, Text, Group } from "react-konva";
import { onCursorChildEvents } from "@/lib/firebase/rtdb";
import { useAuthStore } from "@/lib/store/authStore";
import type { CursorData } from "@/lib/types";

interface CursorLayerProps {
  boardId: string;
}

const STALE_THRESHOLD_MS = 10_000; // Ignore cursors older than 10 seconds

// Standard cursor arrow pointer path (points top-left)
const CURSOR_ARROW_PATH =
  "M0,0 L0,16 L4.5,12.5 L8,20 L10.5,19 L7,11.5 L12,11.5 Z";

const NAME_TAG_Y = 22;
const NAME_TAG_FONT_SIZE = 11;
const NAME_TAG_PADDING_X = 6;
const NAME_TAG_PADDING_Y = 3;
const NAME_TAG_CORNER_RADIUS = 4;

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
      {remoteCursors.map(([id, cursor]) => {
        // Estimate name tag width based on character count
        const nameWidth =
          cursor.name.length * (NAME_TAG_FONT_SIZE * 0.6) +
          NAME_TAG_PADDING_X * 2;
        const nameHeight = NAME_TAG_FONT_SIZE + NAME_TAG_PADDING_Y * 2;

        return (
          <Group key={id} x={cursor.x} y={cursor.y}>
            {/* Pointer arrow icon */}
            <Path
              data={CURSOR_ARROW_PATH}
              fill={cursor.color}
              stroke="#ffffff"
              strokeWidth={1}
            />

            {/* Name tag */}
            <Group y={NAME_TAG_Y} x={2}>
              <Rect
                width={nameWidth}
                height={nameHeight}
                fill={cursor.color}
                cornerRadius={NAME_TAG_CORNER_RADIUS}
              />
              <Text
                text={cursor.name}
                x={NAME_TAG_PADDING_X}
                y={NAME_TAG_PADDING_Y}
                fontSize={NAME_TAG_FONT_SIZE}
                fontFamily="sans-serif"
                fill="#ffffff"
              />
            </Group>
          </Group>
        );
      })}
    </>
  );
}
