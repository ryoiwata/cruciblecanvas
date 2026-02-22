'use client';

/**
 * LineModule — property controls for line and connector objects.
 * Handles stroke color, width, and end effects (arrowheads).
 */

import type { BoardObject, LineEffect } from '@/lib/types';
import ColorRow from '../controls/ColorRow';
import SliderRow from '../controls/SliderRow';
import DropdownRow from '../controls/DropdownRow';

interface LineModuleProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

const EFFECT_OPTIONS: { value: LineEffect; label: string }[] = [
  { value: 'none',         label: '⊘ None' },
  { value: 'arrow',        label: '→ Arrow' },
  { value: 'filled-arrow', label: '▶ Filled Arrow' },
  { value: 'open-arrow',   label: '⇒ Open Arrow' },
  { value: 'dot',          label: '● Dot' },
];

export default function LineModule({ object, onChange }: LineModuleProps) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Line</p>
      <ColorRow
        label="Color"
        value={object.color ?? '#374151'}
        onChange={(hex) => onChange({ color: hex })}
      />
      <SliderRow
        label="Width"
        value={object.thickness ?? 2}
        min={0.5}
        max={20}
        step={0.5}
        onChange={(v) => onChange({ thickness: v })}
      />

      {/* End effects — only shown for connectors where arrow tips make sense */}
      {object.type === 'connector' && (
        <>
          <div className="my-2 border-t border-gray-100" />
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Arrow</p>
          <DropdownRow
            label="Start"
            value={object.startEffect ?? 'none'}
            options={EFFECT_OPTIONS}
            onChange={(v) => onChange({ startEffect: v as LineEffect })}
          />
          <DropdownRow
            label="End"
            value={object.endEffect ?? 'arrow'}
            options={EFFECT_OPTIONS}
            onChange={(v) => onChange({ endEffect: v as LineEffect })}
          />
          <SliderRow
            label="Start size"
            value={object.startEffectSize ?? 100}
            min={25}
            max={300}
            step={5}
            unit="%"
            onChange={(v) => onChange({ startEffectSize: v })}
          />
          <SliderRow
            label="End size"
            value={object.endEffectSize ?? 100}
            min={25}
            max={300}
            step={5}
            unit="%"
            onChange={(v) => onChange({ endEffectSize: v })}
          />
        </>
      )}
    </div>
  );
}
