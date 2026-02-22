"use client";

import { useEffect, useState, useCallback, useRef, memo } from "react";
import { Path, Rect, Text, Group } from "react-konva";
import type Konva from "konva";
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
// Memoized per-cursor component — only re-renders when its own data changes.
// Uses an imperative Konva ref + RAF lerp loop so cursor position updates
// are applied directly to the Konva node, bypassing React's render cycle.
// ---------------------------------------------------------------------------

interface RemoteCursorProps {
  data: CursorData;
}

const RemoteCursor = memo(function RemoteCursor({ data }: RemoteCursorProps) {
  const groupRef = useRef<Konva.Group>(null);
  // Current interpolated position — mutated imperatively, not via React state
  const posRef = useRef({ x: data.x, y: data.y });
  const targetRef = useRef({ x: data.x, y: data.y });
  const rafRef = useRef(0);

  // Update target whenever new position data arrives from RTDB
  useEffect(() => {
    targetRef.current = { x: data.x, y: data.y };

    // Restart lerp loop on each new position update. The loop runs until
    // the cursor converges within 0.5px of the target, then stops to avoid
    // wasting CPU when the remote user is stationary.
    function tick() {
      const pos = posRef.current;
      const target = targetRef.current;
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;

      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        // Snap to target and stop the loop
        posRef.current = { x: target.x, y: target.y };
        groupRef.current?.x(target.x);
        groupRef.current?.y(target.y);
        groupRef.current?.getLayer()?.batchDraw();
        rafRef.current = 0;
        return;
      }

      // Exponential ease-out: 30% toward target per frame (~83ms to converge within 1px)
      posRef.current = { x: pos.x + dx * 0.3, y: pos.y + dy * 0.3 };
      groupRef.current?.x(posRef.current.x);
      groupRef.current?.y(posRef.current.y);
      groupRef.current?.getLayer()?.batchDraw();
      rafRef.current = requestAnimationFrame(tick);
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [data.x, data.y]);

  const nameWidth =
    data.name.length * (NAME_TAG_FONT_SIZE * 0.6) + NAME_TAG_PADDING_X * 2;
  const nameHeight = NAME_TAG_FONT_SIZE + NAME_TAG_PADDING_Y * 2;

  // Initial position set from props; subsequent positions driven by the RAF lerp above
  return (
    <Group ref={groupRef} x={data.x} y={data.y}>
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
const CursorLayer = memo(function CursorLayer({ boardId }: CursorLayerProps) {
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

  // Subscribe to RTDB cursor events — guard against unauthenticated access.
  // In perf bypass mode the canvas renders before Firebase restores auth from
  // IndexedDB, so we must wait for userId to be truthy before attaching the
  // listener. Without this guard, the RTDB client fires as unauthenticated and
  // the server rejects it with permission_denied, causing error log flooding
  // and degraded performance in concurrent-user tests.
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = onCursorChildEvents(boardId, {
      onAdd: handleUpsert,
      onChange: handleUpsert,
      onRemove: handleRemove,
    });
    return () => {
      unsubscribe();
      setCursors({});
    };
  }, [boardId, userId, handleUpsert, handleRemove]);

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

  // Cap at 10 visible remote cursors — beyond 10 they are visually indistinguishable
  // and rendering more adds GPU cost with no UX benefit.
  const visibleCursors = Object.entries(cursors)
    .filter(([id, cursor]) =>
      id !== userId &&
      now - cursor.timestamp <= STALE_THRESHOLD_MS &&
      isFinite(cursor.x) &&
      isFinite(cursor.y)
    )
    .slice(0, 10);

  return (
    <>
      {visibleCursors.map(([id, cursor]) => (
        <RemoteCursor key={id} data={cursor} />
      ))}
    </>
  );
});

export default CursorLayer;
