'use client';

/**
 * StickyNoteModule — property controls for sticky note objects.
 * Handles background fill color and font family.
 * Text-specific controls (size, alignment) are provided by the separate TextModule.
 */

import type { BoardObject, StickyFontFamily } from '@/lib/types';
import ColorRow from '../controls/ColorRow';
import DropdownRow from '../controls/DropdownRow';

interface StickyNoteModuleProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

const FONT_OPTIONS = [
  { value: 'sans-serif',  label: 'Sans-Serif' },
  { value: 'handwritten', label: 'Handwritten' },
  { value: 'monospace',   label: 'Monospace' },
];

export default function StickyNoteModule({ object, onChange }: StickyNoteModuleProps) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Sticky Note</p>
      <ColorRow
        label="Color"
        value={object.color ?? '#FEF3C7'}
        onChange={(hex) => onChange({ color: hex })}
      />
      <ColorRow
        label="Text color"
        value={object.textColor ?? '#111827'}
        onChange={(hex) => onChange({ textColor: hex })}
      />
      <DropdownRow
        label="Font"
        value={object.fontFamily ?? 'sans-serif'}
        options={FONT_OPTIONS}
        onChange={(v) => onChange({ fontFamily: v as StickyFontFamily })}
      />
    </div>
  );
}
