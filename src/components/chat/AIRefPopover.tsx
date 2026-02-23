/**
 * AIRefPopover — Smart object-reference display for AI-generated object batches.
 *
 * UI hierarchy:
 *  - refs.length === 0: renders nothing.
 *  - refs.length === 1: single ObjectRefChip, no group needed.
 *  - 1 < refs.length ≤ SMART_POPOVER_THRESHOLD: MasterGroupChip + all individual chips inline.
 *  - refs.length > SMART_POPOVER_THRESHOLD: MasterGroupChip + "View X items" toggle;
 *    individual chips are revealed inline on expand to avoid clutter.
 *
 * MasterGroupChip:
 *  - Finds the top-leftmost object (minimum x + y sum) in the batch.
 *  - Eased-animation pan to centre that object in the canvas.
 *  - Selects ALL referenced objects.
 *  - Triggers teleportHighlightId so TeleportHighlight renders the pulse ring.
 */

'use client';

import { useState, useCallback } from 'react';
import ObjectRefChip from './ObjectRefChip';
import { useObjectStore } from '@/lib/store/objectStore';
import { useCanvasStore } from '@/lib/store/canvasStore';
import type { ObjectReference } from '@/lib/types';

/** Chips above this count collapse behind the "View X items" toggle. */
const SMART_POPOVER_THRESHOLD = 5;

const ANIMATION_DURATION_MS = 400;

/** Ease-out cubic — fast start, gentle finish. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ─── MasterGroupChip ─────────────────────────────────────────────────────────

interface MasterGroupChipProps {
  refs: ObjectReference[];
}

/**
 * Violet chip that navigates to the top-leftmost object in the AI-generated batch
 * and selects all referenced objects on the canvas.
 *
 * "Top-leftmost" is defined as the object whose (x + y) sum is smallest —
 * i.e. the one closest to the canvas origin in both axes simultaneously.
 */
function MasterGroupChip({ refs }: MasterGroupChipProps) {
  const handleClick = useCallback(() => {
    const objectsMap = useObjectStore.getState().objects;
    const validIds = refs.map((r) => r.objectId).filter((id) => !!objectsMap[id]);
    if (validIds.length === 0) return;

    // Select all referenced objects so the user can see the full batch.
    useCanvasStore.getState().setSelectedObjectIds(validIds);

    // Find top-leftmost object: minimum (x + y) coordinate sum.
    let topLeftId = validIds[0];
    let minSum = Infinity;
    for (const id of validIds) {
      const obj = objectsMap[id];
      if (!obj) continue;
      const sum = obj.x + obj.y;
      if (sum < minSum) {
        minSum = sum;
        topLeftId = id;
      }
    }

    const topLeftObj = objectsMap[topLeftId];
    if (!topLeftObj) return;

    // Read stage state imperatively so animation captures current values.
    const {
      stageX: fromX,
      stageY: fromY,
      stageScale: fromScale,
      setViewport,
    } = useCanvasStore.getState();

    const konvaEl = document.querySelector('.konvajs-content');
    const containerWidth = konvaEl?.clientWidth ?? window.innerWidth;
    const containerHeight = konvaEl?.clientHeight ?? window.innerHeight;

    // Centre the top-leftmost object in the viewport, preserving current zoom.
    const objCentreX = topLeftObj.x + topLeftObj.width / 2;
    const objCentreY = topLeftObj.y + topLeftObj.height / 2;
    const targetX = containerWidth / 2 - objCentreX * fromScale;
    const targetY = containerHeight / 2 - objCentreY * fromScale;

    const startTime = performance.now();
    // Capture the id in a const so the RAF closure stays stable.
    const capturedId = topLeftId;

    function step(now: number) {
      const t = Math.min((now - startTime) / ANIMATION_DURATION_MS, 1);
      const eased = easeOutCubic(t);
      setViewport(
        fromX + (targetX - fromX) * eased,
        fromY + (targetY - fromY) * eased,
        fromScale,
      );
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        // Trigger pulse ring on the top-leftmost object once animation settles.
        useCanvasStore.getState().setTeleportHighlightId(capturedId);
      }
    }

    requestAnimationFrame(step);
  }, [refs]);

  return (
    <button
      onClick={handleClick}
      title={`Navigate to top-leftmost of ${refs.length} AI-generated items and select all`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-violet-100 text-violet-700 text-xs hover:bg-violet-200 transition-colors cursor-pointer font-medium"
    >
      {/* Stacked-layers icon — represents a group/batch */}
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <rect
          x="0.5" y="3.5" width="6" height="6" rx="1"
          stroke="currentColor" strokeWidth="1.1" fill="none"
        />
        <rect
          x="3.5" y="0.5" width="6" height="6" rx="1"
          stroke="currentColor" strokeWidth="1.1"
          fill="currentColor" fillOpacity="0.2"
        />
      </svg>
      <span>{refs.length} items</span>
    </button>
  );
}

// ─── AIRefPopover ─────────────────────────────────────────────────────────────

interface AIRefPopoverProps {
  refs: ObjectReference[];
}

/**
 * Renders the MasterGroupChip plus individual reference chips for an AI batch.
 * When the batch exceeds SMART_POPOVER_THRESHOLD, individual chips are hidden
 * behind an inline expand/collapse toggle to keep the chat clean.
 */
export default function AIRefPopover({ refs }: AIRefPopoverProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (refs.length === 0) return null;

  // Single item — skip the group chip, just show the chip directly.
  if (refs.length === 1) {
    return (
      <span className="inline-flex items-center align-middle">
        <ObjectRefChip reference={refs[0]} />
      </span>
    );
  }

  const useCollapse = refs.length > SMART_POPOVER_THRESHOLD;

  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {/* Master Group chip — always visible regardless of collapse state */}
      <MasterGroupChip refs={refs} />

      {useCollapse ? (
        <>
          {/* "View X items" toggle button — shown when batch is large */}
          <button
            onClick={() => setIsExpanded((prev) => !prev)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-600 text-xs hover:bg-indigo-100 transition-colors cursor-pointer"
          >
            {isExpanded ? '▲' : '▼'} View {refs.length} items
          </button>

          {/* Expanded chip list — full width row below the controls */}
          {isExpanded && (
            <span className="w-full flex flex-wrap gap-1 mt-1 pl-0.5">
              {refs.map((ref) => (
                <ObjectRefChip key={ref.objectId} reference={ref} />
              ))}
            </span>
          )}
        </>
      ) : (
        /* Under threshold — all chips shown inline next to the group chip */
        refs.map((ref) => <ObjectRefChip key={ref.objectId} reference={ref} />)
      )}
    </span>
  );
}
