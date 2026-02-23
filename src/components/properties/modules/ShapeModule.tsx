'use client';

/**
 * ShapeModule — property controls for rectangle and circle objects.
 * Shows fill color and an optional arrowhead toggle that marks a shape
 * as a directional pointer (stores the effect in the endEffect field).
 */

import type { BoardObject } from '@/lib/types';
import ColorRow from '../controls/ColorRow';

interface ShapeModuleProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

export default function ShapeModule({ object, onChange }: ShapeModuleProps) {
  const hasArrow = (object.endEffect ?? 'none') !== 'none';

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Shape</p>
      <ColorRow
        label="Fill"
        value={object.color ?? '#E3E8EF'}
        onChange={(hex) => onChange({ color: hex })}
      />

      {/* Arrowhead toggle — marks shape as a directional pointer */}
      <div className="flex items-center gap-2 py-1.5">
        <span className="w-20 shrink-0 text-sm text-gray-600">Arrowhead</span>
        <button
          type="button"
          onClick={() => onChange({ endEffect: hasArrow ? 'none' : 'arrow' })}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
            hasArrow ? 'bg-indigo-500' : 'bg-gray-200'
          }`}
          role="switch"
          aria-checked={hasArrow}
          title={hasArrow ? 'Remove arrowhead' : 'Add arrowhead'}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
              hasArrow ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
