'use client';

/**
 * AlignButtonGroup — a row of icon-button toggles for alignment properties.
 * Used for both horizontal (left/center/right) and vertical (top/middle/bottom) text alignment.
 */

interface AlignOption<T extends string> {
  value: T;
  /** Accessible label for the button */
  label: string;
  /** Icon element (lucide-react or SVG) */
  icon: React.ReactNode;
}

interface AlignButtonGroupProps<T extends string> {
  rowLabel: string;
  value: T;
  options: AlignOption<T>[];
  onChange: (value: T) => void;
}

export default function AlignButtonGroup<T extends string>({
  rowLabel,
  value,
  options,
  onChange,
}: AlignButtonGroupProps<T>) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-20 shrink-0 text-sm text-gray-600">{rowLabel}</span>
      <div className="flex gap-0.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.label}
            aria-label={opt.label}
            aria-pressed={value === opt.value}
            className={`flex h-7 w-7 items-center justify-center rounded text-sm transition-colors ${
              value === opt.value
                ? 'bg-blue-100 text-blue-600'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {opt.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
