'use client';

/**
 * RecentColorsSection — shows the last 5 unique fill colors applied during
 * the current session, positioned directly below the Presets section.
 *
 * Clicking a swatch applies that color to the selected object's fill.
 * The list is driven by `recentColors` in canvasStore and updated whenever a
 * color is changed via the Properties Panel or the toolbar ColorPickerPopup.
 */

import { useCanvasStore } from '@/lib/store/canvasStore';
import type { BoardObject } from '@/lib/types';

interface RecentColorsSectionProps {
  onChange: (patch: Partial<BoardObject>) => void;
}

export default function RecentColorsSection({ onChange }: RecentColorsSectionProps) {
  const recentColors = useCanvasStore((s) => s.recentColors);

  if (recentColors.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Recent Colors
      </p>
      <div className="flex gap-1.5 flex-wrap">
        {recentColors.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange({ color })}
            className="h-8 w-8 rounded-md border border-black/10 shadow-sm transition-all hover:scale-105 hover:shadow-md"
            style={{ backgroundColor: color }}
            title={color}
            aria-label={`Apply recent color ${color}`}
          />
        ))}
      </div>
    </div>
  );
}
