'use client';

/**
 * ColorRow — a labeled row with a color swatch and hex input.
 *
 * Clicking the swatch opens a native color picker via an invisible <input type="color">
 * overlay. The hex field also accepts direct text entry (validated on blur/enter).
 * Changes are forwarded via onChange immediately for live canvas preview.
 */

import { useRef, useState, useEffect } from 'react';

interface ColorRowProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

/** Returns true if `s` is a valid 6-digit hex color (with or without #). */
function isValidHex(s: string): boolean {
  return /^#?[0-9A-Fa-f]{6}$/.test(s);
}

/** Normalises input to a #RRGGBB uppercase string. */
function normaliseHex(s: string): string {
  return s.startsWith('#') ? s.toUpperCase() : `#${s.toUpperCase()}`;
}

export default function ColorRow({ label, value, onChange }: ColorRowProps) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  // Always store text as uppercase to avoid case-mismatch loops with the parent value.
  const [textValue, setTextValue] = useState(() => normaliseHex(value));

  // Sync text field when parent value changes externally (e.g. preset applied, undo).
  // useEffect is the correct place — never call setState during the render body.
  useEffect(() => {
    if (isValidHex(value)) {
      setTextValue(normaliseHex(value));
    }
  }, [value]);

  const commitHex = (raw: string) => {
    if (isValidHex(raw)) {
      const hex = normaliseHex(raw);
      onChange(hex);
      setTextValue(hex);
    } else {
      // Revert to last valid value on invalid input
      setTextValue(normaliseHex(value));
    }
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-20 shrink-0 text-sm text-gray-600">{label}</span>

      {/* Swatch — clicking delegates to the hidden color input */}
      <button
        type="button"
        onClick={() => colorInputRef.current?.click()}
        className="h-7 w-7 shrink-0 rounded border border-gray-300 shadow-sm transition-shadow hover:shadow-md"
        style={{ backgroundColor: value }}
        title="Pick color"
        aria-label={`${label} color swatch`}
      />

      {/* Native color picker (invisible, triggered by the swatch button above).
          Always normalise to uppercase before forwarding so the parent value prop
          stays uppercase — preventing the textValue/value case-mismatch loop. */}
      <input
        ref={colorInputRef}
        type="color"
        value={value}
        onChange={(e) => {
          const hex = normaliseHex(e.target.value);
          setTextValue(hex);
          onChange(hex);
        }}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Hex text input */}
      <input
        type="text"
        value={textValue}
        maxLength={7}
        onChange={(e) => setTextValue(e.target.value)}
        onBlur={(e) => commitHex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitHex((e.target as HTMLInputElement).value);
        }}
        placeholder="#000000"
        className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </div>
  );
}
