"use client";

/**
 * ShortcutLegend — bottom-bar hint strip showing keyboard shortcuts.
 *
 * Renders two rows of four shortcuts each. Anchored to the bottom-right so it
 * automatically avoids the chat sidebar when it is open (same dynamic-right
 * pattern used by the top-right header controls in page.tsx).
 */

import { useChatStore } from "@/lib/store/chatStore";

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

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <rect x="0.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M3.5 7H5.5M5.5 7L4 5.5M5.5 7L4 8.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="8" y1="5" x2="10.5" y2="7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="10.5" y1="5" x2="8" y2="7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <rect x="0.5" y="3.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="4" y="0.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="white" />
      <rect x="4" y="0.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <line x1="8" y1="3.5" x2="8" y2="7.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="6" y1="5.5" x2="10" y2="5.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <path d="M1 5L7 2L13 5L7 8L1 5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
      <path d="M1 8L7 11L13 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <path d="M2 2.5C2 1.95 2.45 1.5 3 1.5H11C11.55 1.5 12 1.95 12 2.5V8.5C12 9.05 11.55 9.5 11 9.5H8L5 12V9.5H3C2.45 9.5 2 9.05 2 8.5V2.5Z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

// ---- Data -------------------------------------------------------------------

interface Shortcut {
  icon: React.ReactNode;
  label: string;
  keys: string;
}

/** First row: selection and clipboard shortcuts. */
const ROW_1: Shortcut[] = [
  { icon: <MarqueeIcon />, label: "Select", keys: "Ctrl + Drag" },
  { icon: <MultiSelectIcon />, label: "Multi-Select", keys: "Ctrl / Shift + Click" },
  { icon: <SelectAllIcon />, label: "Select All", keys: "Ctrl + A" },
  { icon: <CopyPasteIcon />, label: "Copy / Paste", keys: "Ctrl + C / V" },
];

/** Second row: edit and navigation shortcuts. */
const ROW_2: Shortcut[] = [
  { icon: <DeleteIcon />, label: "Delete", keys: "Del" },
  { icon: <DuplicateIcon />, label: "Duplicate", keys: "Ctrl + D" },
  { icon: <LayersIcon />, label: "Layers", keys: "[ / ]" },
  { icon: <ChatIcon />, label: "Chat", keys: "/" },
];

// ---- Component --------------------------------------------------------------

function ShortcutRow({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <div className="flex items-center gap-3">
      {shortcuts.map((s) => (
        <div key={s.label} className="flex items-center gap-1.5 text-gray-400 shrink-0" style={{ fontSize: 11 }}>
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

export default function ShortcutLegend() {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const sidebarWidth = useChatStore((s) => s.sidebarWidth);

  const rightOffset = sidebarOpen ? sidebarWidth + 8 : 16;

  return (
    <div
      className="fixed bottom-4 z-40 flex flex-col gap-1.5 rounded-md bg-white/60 px-3 py-2 shadow-sm backdrop-blur-sm"
      style={{ right: rightOffset, transition: 'right 300ms ease-in-out' }}
    >
      <ShortcutRow shortcuts={ROW_1} />
      <div className="h-px w-full bg-gray-200/70" />
      <ShortcutRow shortcuts={ROW_2} />
    </div>
  );
}
