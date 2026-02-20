'use client';

/**
 * ShapeModule — property controls for rectangle and circle objects.
 * Handles fill color, stroke color, border width, and border dash style.
 */

import type { BoardObject } from '@/lib/types';
import ColorRow from '../controls/ColorRow';
import SliderRow from '../controls/SliderRow';
import DropdownRow from '../controls/DropdownRow';

interface ShapeModuleProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

const BORDER_STYLE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

export default function ShapeModule({ object, onChange }: ShapeModuleProps) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Shape</p>
      <ColorRow
        label="Fill"
        value={object.color ?? '#E3E8EF'}
        onChange={(hex) => onChange({ color: hex })}
      />
      <ColorRow
        label="Stroke"
        value={object.strokeColor ?? '#374151'}
        onChange={(hex) => onChange({ strokeColor: hex })}
      />
      <SliderRow
        label="Width"
        value={object.thickness ?? 2}
        min={0}
        max={20}
        step={0.5}
        onChange={(v) => onChange({ thickness: v })}
      />
      <DropdownRow
        label="Style"
        value={object.borderType ?? 'solid'}
        options={BORDER_STYLE_OPTIONS}
        onChange={(v) => onChange({ borderType: v as BoardObject['borderType'] })}
      />
    </div>
  );
}
