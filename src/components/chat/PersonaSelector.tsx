/**
 * PersonaSelector — per-user AI persona preference dropdown in the chat header.
 * Persisted to localStorage via usePersonaStore.
 * Each user can independently choose their persona; it applies to their @ai commands.
 */

'use client';

import { usePersonaStore } from '@/lib/store/chatStore';
import type { AiPersona } from '@/lib/types';

const PERSONA_LABELS: Record<AiPersona, string> = {
  neutral: 'Neutral Critic',
  skeptical_investor: 'Skeptical Investor',
  opposing_counsel: 'Opposing Counsel',
};

const PERSONA_DESCRIPTIONS: Record<AiPersona, string> = {
  neutral: 'Balanced, constructive, Socratic',
  skeptical_investor: 'Numbers-focused, skeptical',
  opposing_counsel: 'Adversarial, evidence-focused',
};

export default function PersonaSelector() {
  const persona = usePersonaStore((s) => s.persona);
  const setPersona = usePersonaStore((s) => s.setPersona);

  return (
    <div className="relative flex items-center gap-1">
      <span className="text-xs text-gray-400">As:</span>
      <select
        value={persona}
        onChange={(e) => setPersona(e.target.value as AiPersona)}
        title={PERSONA_DESCRIPTIONS[persona]}
        className="text-xs bg-transparent text-gray-600 border-none outline-none cursor-pointer hover:text-gray-900 transition-colors pr-1"
      >
        {(Object.entries(PERSONA_LABELS) as [AiPersona, string][]).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
