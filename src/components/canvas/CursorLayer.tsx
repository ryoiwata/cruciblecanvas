"use client";

import { useEffect, useState, useCallback, useRef, memo } from "react";
import { Path, Rect, Text, Group } from "react-konva";
import { onCursorChildEvents } from "@/lib/firebase/rtdb";
import { useAuthStore } from "@/lib/store/authStore";
import type { CursorData } from "@/lib/types";

interface CursorLayerProps {
  boardId: string;
}

const STALE_THRESHOLD_MS = 10_000; // Ignore cursors older than 10 seconds
const STALE_CHECK_INTERVAL_MS = 2_000; // Check for stale cursors every 2s

// Standard cursor arrow pointer path (points top-left)
const CURSOR_ARROW_PATH =
  "M0,0 L0,16 L4.5,12.5 L8,20 L10.5,19 L7,11.5 L12,11.5 Z";

const NAME_TAG_Y = 22;
const NAME_TAG_FONT_SIZE = 11;
const NAME_TAG_PADDING_X = 6;
const NAME_TAG_PADDING_Y = 3;
const NAME_TAG_CORNER_RADIUS = 4;

// ---------------------------------------------------------------------------
// Memoized per-cursor component — only re-renders when its own data changes
// ---------------------------------------------------------------------------

interface RemoteCursorProps {
  data: CursorData;
}

const RemoteCursor = memo(function RemoteCursor({ data }: RemoteCursorProps) {
  const nameWidth =
    data.name.length * (NAME_TAG_FONT_SIZE * 0.6) + NAME_TAG_PADDING_X * 2;
  const nameHeight = NAME_TAG_FONT_SIZE + NAME_TAG_PADDING_Y * 2;

  return (
    <Group x={data.x} y={data.y}>
      {/* Pointer arrow icon */}
      <Path
        data={CURSOR_ARROW_PATH}
        fill={data.color}
        stroke="#ffffff"
        strokeWidth={1}
      />

      {/* Name tag */}
      <Group y={NAME_TAG_Y} x={2}>
        <Rect
          width={nameWidth}
          height={nameHeight}
          fill={data.color}
          cornerRadius={NAME_TAG_CORNER_RADIUS}
        />
        <Text
          text={data.name}
          x={NAME_TAG_PADDING_X}
          y={NAME_TAG_PADDING_Y}
          fontSize={NAME_TAG_FONT_SIZE}
          fontFamily="sans-serif"
          fill="#ffffff"
        />
      </Group>
    </Group>
  );
});

// ---------------------------------------------------------------------------
// CursorLayer — manages RTDB subscription and stale cleanup
// ---------------------------------------------------------------------------

/**
 * Renders remote user cursors from RTDB.
 *
 * Uses granular child listeners (onChildAdded/Changed/Removed) instead of
 * a parent-node onValue — only the specific cursor that changed triggers
 * a state update, reducing re-render payload at scale.
 *
 * Each cursor is a memoized sub-component so updating one cursor's position
 * does not re-render the Konva nodes of other cursors.
 */
export default function CursorLayer({ boardId }: CursorLayerProps) {
  const [cursors, setCursors] = useState<Record<string, CursorData>>({});
  const [, setTick] = useState(0); // forces re-render for stale cleanup
  const userId = useAuthStore((s) => s.user?.uid);
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;

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

  // Subscribe to RTDB cursor events
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

  // Periodic stale cursor cleanup — removes cursors older than threshold
  // so they don't linger visually after a user disconnects without cleanup
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const cur = cursorsRef.current;
      let hasStale = false;
      for (const key of Object.keys(cur)) {
        if (now - cur[key].timestamp > STALE_THRESHOLD_MS) {
          hasStale = true;
          break;
        }
      }
      if (hasStale) {
        setCursors((prev) => {
          const next: Record<string, CursorData> = {};
          for (const [k, v] of Object.entries(prev)) {
            if (now - v.timestamp <= STALE_THRESHOLD_MS) {
              next[k] = v;
            }
          }
          return next;
        });
      }
      // Tick to re-evaluate stale filtering even if no cursor was removed
      setTick((t) => t + 1);
    }, STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();

  return (
    <>
      {Object.entries(cursors).map(([id, cursor]) => {
        // Filter out local user and stale cursors
        if (id === userId) return null;
        if (now - cursor.timestamp > STALE_THRESHOLD_MS) return null;
        return <RemoteCursor key={id} data={cursor} />;
      })}
    </>
  );
}
