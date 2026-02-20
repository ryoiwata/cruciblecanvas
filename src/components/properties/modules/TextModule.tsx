'use client';

/**
 * TextModule — typography controls for text and sticky note objects.
 * Handles font family, font size, text color, and alignment.
 */

import type { BoardObject, StickyFontFamily, TextAlign, TextVerticalAlign } from '@/lib/types';
import ColorRow from '../controls/ColorRow';
import SliderRow from '../controls/SliderRow';
import DropdownRow from '../controls/DropdownRow';
import AlignButtonGroup from '../controls/AlignButtonGroup';

interface TextModuleProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

const FONT_OPTIONS = [
  { value: 'sans-serif', label: 'Sans-Serif' },
  { value: 'handwritten', label: 'Handwritten' },
  { value: 'monospace', label: 'Monospace' },
];

const H_ALIGN_OPTIONS: { value: TextAlign; label: string; icon: React.ReactNode }[] = [
  { value: 'left',   label: 'Align Left',   icon: <HAlignLeftIcon /> },
  { value: 'center', label: 'Align Center', icon: <HAlignCenterIcon /> },
  { value: 'right',  label: 'Align Right',  icon: <HAlignRightIcon /> },
];

const V_ALIGN_OPTIONS: { value: TextVerticalAlign; label: string; icon: React.ReactNode }[] = [
  { value: 'top',    label: 'Align Top',    icon: <VAlignTopIcon /> },
  { value: 'middle', label: 'Align Middle', icon: <VAlignMiddleIcon /> },
  { value: 'bottom', label: 'Align Bottom', icon: <VAlignBottomIcon /> },
];

export default function TextModule({ object, onChange }: TextModuleProps) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Text</p>
      <DropdownRow
        label="Font"
        value={object.fontFamily ?? 'sans-serif'}
        options={FONT_OPTIONS}
        onChange={(v) => onChange({ fontFamily: v as StickyFontFamily })}
      />
      <SliderRow
        label="Size"
        value={object.fontSize ?? 14}
        min={8}
        max={96}
        step={1}
        onChange={(v) => onChange({ fontSize: v })}
      />
      <ColorRow
        label="Color"
        value={object.textColor ?? '#111827'}
        onChange={(hex) => onChange({ textColor: hex })}
      />
      <AlignButtonGroup<TextAlign>
        rowLabel="H-Align"
        value={object.textAlign ?? 'left'}
        options={H_ALIGN_OPTIONS}
        onChange={(v) => onChange({ textAlign: v })}
      />
      <AlignButtonGroup<TextVerticalAlign>
        rowLabel="V-Align"
        value={object.textVerticalAlign ?? 'top'}
        options={V_ALIGN_OPTIONS}
        onChange={(v) => onChange({ textVerticalAlign: v })}
      />
    </div>
  );
}

// ---- Inline SVG alignment icons (avoids extra lucide-react import overhead) ----

function HAlignLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1" y1="7" x2="9"  y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1" y1="11" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HAlignCenterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HAlignRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <line x1="1"  y1="3"  x2="13" y2="3"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5"  y1="7"  x2="13" y2="7"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3"  y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function VAlignTopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <line x1="1" y1="2" x2="13" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3" y="4" width="3" height="7" rx="0.5" fill="currentColor" opacity="0.5" />
      <rect x="8" y="4" width="3" height="5" rx="0.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function VAlignMiddleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3" y="2.5" width="3" height="9" rx="0.5" fill="currentColor" opacity="0.5" />
      <rect x="8" y="3.5" width="3" height="7" rx="0.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function VAlignBottomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <line x1="1" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3" y="3" width="3" height="7" rx="0.5" fill="currentColor" opacity="0.5" />
      <rect x="8" y="5" width="3" height="5" rx="0.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}
