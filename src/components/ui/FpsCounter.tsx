"use client";

/**
 * FpsCounter
 *
 * Displays a live frames-per-second reading in the top header bar.
 * Uses a requestAnimationFrame loop to count frames and recalculates FPS
 * once per second.  Colour-codes the reading so degradation is immediately
 * visible at a glance:
 *   green  (≥ 58 fps) — nominal
 *   amber  (≥ 40 fps) — mild degradation
 *   red    (<  40 fps) — heavy jank
 *
 * The loop is started in a useEffect and cancelled on unmount, so it never
 * runs while the component is not on screen.
 */

import { useState, useEffect, useRef } from "react";

export default function FpsCounter() {
  const [fps, setFps] = useState<number | null>(null);
  const rafId = useRef<number>(0);
  const frameCount = useRef(0);
  const lastTickMs = useRef(performance.now());

  useEffect(() => {
    function tick(): void {
      frameCount.current += 1;

      const now = performance.now();
      const elapsed = now - lastTickMs.current;

      // Recalculate once per second to smooth out sub-second jitter
      if (elapsed >= 1_000) {
        setFps(Math.round((frameCount.current * 1_000) / elapsed));
        frameCount.current = 0;
        lastTickMs.current = now;
      }

      rafId.current = requestAnimationFrame(tick);
    }

    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  if (fps === null) return null;

  const color =
    fps >= 58 ? "text-green-500" : fps >= 40 ? "text-amber-500" : "text-red-500";

  return (
    <span
      className={`tabular-nums text-xs font-medium select-none ${color}`}
      title={`Canvas frame rate: ${fps} fps`}
    >
      {fps} fps
    </span>
  );
}
