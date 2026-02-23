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

      {/* Connector controls — direction toggle + fine-grained arrowhead options */}
      {object.type === 'connector' && (() => {
        const isDirected = (object.endEffect ?? 'arrow') !== 'none';
        return (
          <>
            <div className="my-2 border-t border-gray-100" />
            {/* Quick directed toggle — flips endEffect between 'arrow' and 'none' */}
            <div className="flex items-center gap-2 py-1.5">
              <span className="w-20 shrink-0 text-sm text-gray-600">Directed</span>
              <button
                type="button"
                onClick={() => onChange({ endEffect: isDirected ? 'none' : 'arrow' })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  isDirected ? 'bg-indigo-500' : 'bg-gray-200'
                }`}
                role="switch"
                aria-checked={isDirected}
                title={isDirected ? 'Make non-directed' : 'Make directed'}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                    isDirected ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
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
        );
      })()}
    </div>
  );
}
