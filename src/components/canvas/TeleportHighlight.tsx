/**
 * TeleportHighlight — fixed HTML overlay that renders a brief pulsing ring
 * around a canvas object immediately after a "teleport-to-reference" navigation.
 *
 * Lifecycle:
 *  1. ObjectRefChip sets `teleportHighlightId` in canvasStore after the pan
 *     animation completes (so the stage position is already at the target).
 *  2. This component reads the object position once, converts to screen coords,
 *     and renders the ring with the `.teleport-pulse` CSS animation.
 *  3. After 1.2 s (animation duration) it clears `teleportHighlightId`.
 *
 * The component is pointer-events-none so it never blocks canvas interaction.
 */

'use client';

import { useState, useEffect } from 'react';
import { useCanvasStore } from '@/lib/store/canvasStore';
import { useObjectStore } from '@/lib/store/objectStore';

interface HighlightRect {
  screenX: number;
  screenY: number;
  screenW: number;
  screenH: number;
}

const HIGHLIGHT_DURATION_MS = 1200;
const RING_PADDING_PX = 6;

export default function TeleportHighlight() {
  const teleportHighlightId    = useCanvasStore((s) => s.teleportHighlightId);
  const setTeleportHighlightId = useCanvasStore((s) => s.setTeleportHighlightId);

  const [rect, setRect] = useState<HighlightRect | null>(null);
  // Increment to force a CSS animation restart when the same object is
  // teleported to twice in a row (same teleportHighlightId value).
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    if (!teleportHighlightId) {
      setRect(null);
      return;
    }

    const obj = useObjectStore.getState().objects[teleportHighlightId];
    if (!obj) {
      setTeleportHighlightId(null);
      return;
    }

    // Read stage state imperatively — it's already at the animation's final
    // position because ObjectRefChip sets teleportHighlightId only after the
    // pan animation frame loop finishes.
    const { stageX, stageY, stageScale } = useCanvasStore.getState();

    setRect({
      screenX: obj.x * stageScale + stageX,
      screenY: obj.y * stageScale + stageY,
      screenW: obj.width  * stageScale,
      screenH: obj.height * stageScale,
    });
    setAnimKey((k) => k + 1);

    const timer = setTimeout(() => setTeleportHighlightId(null), HIGHLIGHT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [teleportHighlightId, setTeleportHighlightId]);

  if (!rect) return null;

  return (
    <div
      key={animKey}
      className="teleport-pulse pointer-events-none fixed z-50"
      style={{
        left:         rect.screenX - RING_PADDING_PX,
        top:          rect.screenY - RING_PADDING_PX,
        width:        rect.screenW + RING_PADDING_PX * 2,
        height:       rect.screenH + RING_PADDING_PX * 2,
        border:       '3px solid #6366f1',
        borderRadius: 6,
        boxShadow:    '0 0 14px 4px rgba(99, 102, 241, 0.35)',
        // transform-origin must be centre so the scale() in teleport-pulse
        // expands outward from the object's centre.
        transformOrigin: 'center center',
      }}
    />
  );
}
