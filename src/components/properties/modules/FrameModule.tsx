'use client';

/**
 * FrameModule — property controls for frame objects.
 * Handles fill color, border color, border thickness, and title font size.
 */

import type { BoardObject } from '@/lib/types';
import ColorRow from '../controls/ColorRow';
import SliderRow from '../controls/SliderRow';

interface FrameModuleProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

export default function FrameModule({ object, onChange }: FrameModuleProps) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Frame</p>
      <ColorRow
        label="Fill"
        value={object.color ?? '#6366f1'}
        onChange={(hex) => onChange({ color: hex })}
      />
      <ColorRow
        label="Border"
        value={object.strokeColor ?? object.color ?? '#6366f1'}
        onChange={(hex) => onChange({ strokeColor: hex })}
      />
      <SliderRow
        label="Thickness"
        value={object.thickness ?? 2}
        min={0}
        max={10}
        step={0.5}
        onChange={(v) => onChange({ thickness: v })}
      />
      <ColorRow
        label="Title color"
        value={object.textColor ?? object.color ?? '#6366f1'}
        onChange={(hex) => onChange({ textColor: hex })}
      />
    </div>
  );
}
