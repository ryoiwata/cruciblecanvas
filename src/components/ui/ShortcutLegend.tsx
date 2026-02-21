"use client";

/**
 * ShortcutLegend — hint strip showing the four most useful keyboard shortcuts
 * in a two-row, two-column grid.
 *
 * Rows: [Marquee, Multi-Select] / [Select All, Copy/Paste]
 *
 * No positional styles; positioning is handled by the parent info-stack
 * container in board/[boardId]/page.tsx.
 */

// ---- Inline SVG icons -------------------------------------------------------

function MarqueeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 1.5" fill="none" />
    </svg>
  );
}

function MultiSelectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="0.5" y="3.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="4.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function SelectAllIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="1" cy="1" r="1.2" fill="currentColor" />
      <circle cx="13" cy="1" r="1.2" fill="currentColor" />
      <circle cx="1" cy="13" r="1.2" fill="currentColor" />
      <circle cx="13" cy="13" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CopyPasteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <rect x="0.5" y="3.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="4" y="0.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="white" />
      <rect x="4" y="0.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

// ---- Data -------------------------------------------------------------------

interface Shortcut {
  icon: React.ReactNode;
  label: string;
  keys: string;
}

/** First row of the 2×2 grid. */
const ROW_1: Shortcut[] = [
  { icon: <MarqueeIcon />, label: 'Marquee', keys: 'Ctrl/Shift + Drag' },
  { icon: <MultiSelectIcon />, label: 'Multi-select', keys: 'Ctrl/Shift + Click' },
];

/** Second row of the 2×2 grid. */
const ROW_2: Shortcut[] = [
  { icon: <SelectAllIcon />, label: 'Select All', keys: 'Ctrl + A' },
  { icon: <CopyPasteIcon />, label: 'Copy / Paste', keys: 'Ctrl + C / V' },
];

// ---- Component --------------------------------------------------------------

function ShortcutItem({ shortcut }: { shortcut: Shortcut }) {
  return (
    <div className="flex items-center gap-1.5 text-gray-400 shrink-0" style={{ fontSize: 11 }}>
      {shortcut.icon}
      <span className="font-medium text-gray-500">{shortcut.label}:</span>
      <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-px font-mono text-[10px] text-gray-400">
        {shortcut.keys}
      </kbd>
    </div>
  );
}

export default function ShortcutLegend() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md bg-white/60 px-3 py-2 shadow-sm backdrop-blur-sm">
      {[...ROW_1, ...ROW_2].map((s) => (
        <ShortcutItem key={s.label} shortcut={s} />
      ))}
    </div>
  );
}
