'use client';

/**
 * FrameModule — property controls for frame objects.
 * Handles fill color and title text color. Border/stroke controls are omitted
 * to keep the panel minimal.
 */

import type { BoardObject } from '@/lib/types';
import ColorRow from '../controls/ColorRow';

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
        label="Title color"
        value={object.textColor ?? object.color ?? '#6366f1'}
        onChange={(hex) => onChange({ textColor: hex })}
      />
    </div>
  );
}
