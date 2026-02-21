'use client';

/**
 * DimensionModule — numeric width/height inputs for the selected object.
 * Shown for shapes (rectangle, circle), frames, and standalone text objects.
 * Allows precision sizing without manual resize handles.
 */

import type { BoardObject } from '@/lib/types';

interface DimensionModuleProps {
  object: BoardObject;
  onChange: (patch: Partial<BoardObject>) => void;
}

export default function DimensionModule({ object, onChange }: DimensionModuleProps) {
  const w = Math.round(object.width ?? 100);
  const h = Math.round(object.height ?? 100);

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Size</p>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] font-medium text-gray-400">W</span>
          <input
            type="number"
            min={10}
            max={4000}
            value={w}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (val >= 10 && val <= 4000) onChange({ width: val });
            }}
            className="w-full rounded border border-gray-200 px-2 py-1 text-center text-sm text-gray-700 focus:border-indigo-400 focus:outline-none"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] font-medium text-gray-400">H</span>
          <input
            type="number"
            min={10}
            max={4000}
            value={h}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (val >= 10 && val <= 4000) onChange({ height: val });
            }}
            className="w-full rounded border border-gray-200 px-2 py-1 text-center text-sm text-gray-700 focus:border-indigo-400 focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}
