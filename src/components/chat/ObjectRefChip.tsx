/**
 * ObjectRefChip — clickable inline chip for object references in chat messages.
 * Pans the canvas to center on the referenced object when clicked.
 * Renders with strikethrough when the object has been deleted (dead reference).
 */

'use client';

import { useCallback } from 'react';
import { useObjectStore } from '@/lib/store/objectStore';
import { useCanvasStore } from '@/lib/store/canvasStore';
import type { ObjectReference } from '@/lib/types';

interface ObjectRefChipProps {
  reference: ObjectReference;
}

const OBJECT_TYPE_ICONS: Record<string, string> = {
  stickyNote: '📝',
  rectangle: '▭',
  circle: '⬤',
  frame: '⬜',
  connector: '→',
  colorLegend: '🎨',
};

export default function ObjectRefChip({ reference }: ObjectRefChipProps) {
  const objects = useObjectStore((s) => s.objects);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const stageScale = useCanvasStore((s) => s.stageScale);

  const referencedObject = objects[reference.objectId];
  const isDeadReference = !referencedObject;
  const icon = OBJECT_TYPE_ICONS[reference.objectType] ?? '□';

  const handleClick = useCallback(() => {
    if (isDeadReference || !referencedObject) return;

    // Pan canvas to center on the referenced object
    const centerX = referencedObject.x + referencedObject.width / 2;
    const centerY = referencedObject.y + referencedObject.height / 2;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    setViewport(
      viewportWidth / 2 - centerX * stageScale,
      viewportHeight / 2 - centerY * stageScale,
      stageScale
    );
  }, [isDeadReference, referencedObject, setViewport, stageScale]);

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
        <span>{icon}</span>
        <span>{truncatedText || reference.objectType}</span>
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      title={`Click to pan to: ${reference.objectText}`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-indigo-100 text-indigo-700 text-xs hover:bg-indigo-200 transition-colors cursor-pointer"
    >
      <span>{icon}</span>
      <span>{truncatedText || reference.objectType}</span>
    </button>
  );
}
