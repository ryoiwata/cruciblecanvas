"use client";

/** Inline SVG icons for the shortcut legend. */
function MarqueeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      {/* dashed selection rectangle */}
      <rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 1.5" fill="none" />
    </svg>
  );
}

function MultiSelectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      {/* two overlapping rectangles */}
      <rect x="0.5" y="3.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="4.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

interface Shortcut {
  icon: React.ReactNode;
  label: string;
  keys: string;
}

const shortcuts: Shortcut[] = [
  { icon: <MarqueeIcon />, label: "Select", keys: "Ctrl + Drag" },
  { icon: <MultiSelectIcon />, label: "Multi-Select", keys: "Ctrl + Click" },
];

export default function ShortcutLegend() {
  return (
    <div className="fixed bottom-[58px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-md bg-white/60 px-3 py-1 shadow-sm backdrop-blur-sm">
      {shortcuts.map((s) => (
        <div key={s.label} className="flex items-center gap-1.5 text-gray-400" style={{ fontSize: 11 }}>
          {s.icon}
          <span className="font-medium text-gray-500">{s.label}:</span>
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-px font-mono text-[10px] text-gray-400">
            {s.keys}
          </kbd>
        </div>
      ))}
    </div>
  );
}
