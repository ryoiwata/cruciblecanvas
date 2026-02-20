'use client';

/**
 * PresetsSection — a grid of style preset chips that apply fill + stroke + text
 * color in one click. Matches the Biorender-style "Styles / Presets" panel.
 *
 * First 6 presets are always visible; "See more" expands to show all 12.
 */

import { useState } from 'react';
import { STYLE_PRESETS, type StylePreset } from '@/lib/types';
import type { BoardObject } from '@/lib/types';

interface PresetsSectionProps {
  /** Currently selected object(s) — used to highlight the active preset if any. */
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

function isActivePreset(object: BoardObject, preset: StylePreset): boolean {
  return (
    object.color === preset.color &&
    (object.strokeColor ?? undefined) === (preset.strokeColor ?? undefined)
  );
}

export default function PresetsSection({ object, onChange }: PresetsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const visiblePresets = expanded ? STYLE_PRESETS : STYLE_PRESETS.slice(0, 6);

  const applyPreset = (preset: StylePreset) => {
    onChange({
      color: preset.color,
      strokeColor: preset.strokeColor,
      textColor: preset.textColor,
    });
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Presets</p>
      <div className="grid grid-cols-6 gap-1">
        {visiblePresets.map((preset) => {
          const isActive = isActivePreset(object, preset);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              title={preset.label}
              aria-label={preset.label}
              aria-pressed={isActive}
              className={`flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition-all ${
                isActive
                  ? 'ring-2 ring-blue-500 ring-offset-1'
                  : 'hover:scale-105 hover:shadow-sm'
              }`}
              style={{
                backgroundColor: preset.previewBg,
                borderColor: preset.previewBorder ?? preset.previewBg,
                color: preset.textColor ?? '#111827',
              }}
            >
              Aa
            </button>
          );
        })}
      </div>

      {STYLE_PRESETS.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-xs font-medium text-blue-500 hover:text-blue-700"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  );
}
