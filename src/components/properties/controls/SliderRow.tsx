'use client';

/**
 * SliderRow — a labeled property row with a numeric input and a range slider
 * kept bidirectionally in sync. Used throughout the Properties Sidebar for
 * numeric properties (opacity, thickness, font size, etc.).
 *
 * The onChange callback fires on every input event so canvas updates are
 * smooth at 60 fps. Callers should debounce the Firestore write separately.
 */

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

export default function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: SliderRowProps) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-20 shrink-0 text-sm text-gray-600">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className="w-14 shrink-0 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-center text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      {unit && <span className="shrink-0 text-xs text-gray-400">{unit}</span>}
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-blue-500"
      />
    </div>
  );
}
