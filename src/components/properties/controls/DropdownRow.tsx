'use client';

/**
 * DropdownRow — a labeled row with a styled <select> dropdown.
 * Used for enum-valued properties like lineType, fontFamily, borderStyle, etc.
 */

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownRowProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
}

export default function DropdownRow({
  label,
  value,
  options,
  onChange,
}: DropdownRowProps) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-20 shrink-0 text-sm text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
