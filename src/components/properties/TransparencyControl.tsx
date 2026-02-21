'use client';

/**
 * TransparencyControl — shared opacity slider row shown at the top of every
 * property module. Displays as 0–100 percentage (opacity stored as 0–1).
 */

import type { BoardObject } from '@/lib/types';
import SliderRow from './controls/SliderRow';

interface TransparencyControlProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

export default function TransparencyControl({ object, onChange }: TransparencyControlProps) {
  // Convert 0-1 opacity → 0-100 transparency percentage for display
  const transparency = Math.round((1 - (object.opacity ?? 1)) * 100);

  return (
    <SliderRow
      label="Transparency"
      value={transparency}
      min={0}
      max={90}
      step={1}
      unit="%"
      onChange={(v) => onChange({ opacity: parseFloat((1 - v / 100).toFixed(2)) })}
    />
  );
}
