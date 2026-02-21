'use client';

/**
 * ShapeModule — property controls for rectangle and circle objects.
 * Shows only fill color — outline/stroke controls are intentionally omitted
 * to keep the panel minimal.
 */

import type { BoardObject } from '@/lib/types';
import ColorRow from '../controls/ColorRow';

interface ShapeModuleProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

export default function ShapeModule({ object, onChange }: ShapeModuleProps) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Shape</p>
      <ColorRow
        label="Fill"
        value={object.color ?? '#E3E8EF'}
        onChange={(hex) => onChange({ color: hex })}
      />
    </div>
  );
}
