/**
 * MasonBadge — static indicator showing that The Mason is the active AI agent.
 * Replaces the old persona dropdown now that Mason is the sole AI persona.
 */

'use client';

export default function MasonBadge() {
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-100">
      <span className="text-xs" aria-hidden="true">⚙</span>
      <span className="text-xs font-medium text-indigo-600">The Mason</span>
    </div>
  );
}
