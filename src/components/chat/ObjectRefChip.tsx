/**
 * ObjectRefChip — clickable inline chip for object references in chat messages.
 *
 * Click behaviour ("Teleport-to-Reference"):
 *  1. Visibility check — if the object is already fully visible, skip panning.
 *  2. Smart pan — ease-out cubic animation (400 ms) to centre the object.
 *  3. Frame zoom — when the target is a frame, scale so the whole frame fits.
 *  4. Selection — selects the object once the animation completes.
 *  5. Highlight — sets teleportHighlightId so TeleportHighlight renders a pulse ring.
 *
 * Renders with strikethrough styling when the referenced object has been deleted.
 */

'use client';

import { useCallback } from 'react';
import { useObjectStore } from '@/lib/store/objectStore';
import { useCanvasStore } from '@/lib/store/canvasStore';
import { ZOOM_MIN, ZOOM_MAX } from '@/lib/types';
import type { ObjectReference } from '@/lib/types';

interface ObjectRefChipProps {
  reference: ObjectReference;
}

/** Icons for every ObjectType, ensuring consistent coverage across the UI. */
export const OBJECT_TYPE_ICONS: Record<string, string> = {
  stickyNote:  '📝',
  rectangle:   '▭',
  circle:      '⬤',
  frame:       '⬜',
  connector:   '→',
  colorLegend: '🎨',
  text:        '✏️',
  line:        '—',
};

/** Ease-out cubic — fast start, gentle finish. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const ANIMATION_DURATION_MS = 400;

export default function ObjectRefChip({ reference }: ObjectRefChipProps) {
  // Narrow selector: only re-renders when this specific object changes or is deleted.
  const referencedObject = useObjectStore((s) => s.objects[reference.objectId]);

  const isDeadReference = !referencedObject;
  const icon = OBJECT_TYPE_ICONS[reference.objectType] ?? '□';

  const handleClick = useCallback(() => {
    // Read all mutable values imperatively to avoid stale closure captures.
    const obj = useObjectStore.getState().objects[reference.objectId];
    if (!obj) return;

    const {
      stageX: fromX,
      stageY: fromY,
      stageScale: fromScale,
      setViewport,
      selectObject,
      setTeleportHighlightId,
    } = useCanvasStore.getState();

    // Container dimensions — prefer the actual Konva canvas element so that
    // open sidebars (properties, chat) are accounted for automatically.
    const konvaEl = document.querySelector('.konvajs-content');
    const containerWidth  = konvaEl?.clientWidth  ?? window.innerWidth;
    const containerHeight = konvaEl?.clientHeight ?? window.innerHeight;

    // ── Visibility check ──────────────────────────────────────────────────
    const scrX = obj.x * fromScale + fromX;
    const scrY = obj.y * fromScale + fromY;
    const scrW = obj.width  * fromScale;
    const scrH = obj.height * fromScale;

    const isFullyVisible =
      scrX >= 0 && scrY >= 0 &&
      scrX + scrW <= containerWidth &&
      scrY + scrH <= containerHeight;

    // ── Target scale (fit-to-frame for frame objects) ─────────────────────
    let targetScale = fromScale;
    if (obj.type === 'frame') {
      const FRAME_PADDING = 80;
      const fitX = (containerWidth  - FRAME_PADDING * 2) / obj.width;
      const fitY = (containerHeight - FRAME_PADDING * 2) / obj.height;
      targetScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(fitX, fitY)));
    }

    // ── Target viewport position (object centred in canvas container) ─────
    const objCentreX = obj.x + obj.width  / 2;
    const objCentreY = obj.y + obj.height / 2;
    const targetX = containerWidth  / 2 - objCentreX * targetScale;
    const targetY = containerHeight / 2 - objCentreY * targetScale;

    const noMoveNeeded = isFullyVisible && targetScale === fromScale;

    if (noMoveNeeded) {
      // Already visible — just select + highlight.
      selectObject(obj.id);
      setTeleportHighlightId(obj.id);
      return;
    }

    // ── Smooth pan + zoom animation ───────────────────────────────────────
    const startTime = performance.now();

    function step(now: number) {
      const t      = Math.min((now - startTime) / ANIMATION_DURATION_MS, 1);
      const eased  = easeOutCubic(t);

      setViewport(
        fromX     + (targetX     - fromX)     * eased,
        fromY     + (targetY     - fromY)     * eased,
        fromScale + (targetScale - fromScale) * eased,
      );

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        // Animation complete — selection + highlight trigger.
        selectObject(obj.id);
        setTeleportHighlightId(obj.id);
      }
    }

    requestAnimationFrame(step);
  }, [reference.objectId]);

  const truncatedText =
    reference.objectText.length > 20
      ? reference.objectText.slice(0, 20) + '…'
      : reference.objectText;

  if (isDeadReference) {
    return (
      <span
        title="This object was deleted."
        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-gray-100 text-gray-400 text-xs line-through cursor-not-allowed"
      >
        <span aria-hidden="true">{icon}</span>
        <span>{truncatedText || reference.objectType}</span>
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      title={`Teleport to: ${reference.objectText || reference.objectType}`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-indigo-100 text-indigo-700 text-xs hover:bg-indigo-200 transition-colors cursor-pointer"
    >
      <span aria-hidden="true">{icon}</span>
      <span>{truncatedText || reference.objectType}</span>
    </button>
  );
}
