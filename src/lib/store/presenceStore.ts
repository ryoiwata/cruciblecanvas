import { create } from "zustand";
import type { PresenceData } from "../types";

interface PresenceState {
  presence: Record<string, PresenceData>;
  setPresence: (data: Record<string, PresenceData>) => void;
  upsertPresence: (userId: string, data: PresenceData) => void;
  removePresence: (userId: string) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presence: {},
  setPresence: (data) => set({ presence: data }),
  upsertPresence: (userId, data) =>
    set((state) => ({
      presence: { ...state.presence, [userId]: data },
    })),
  removePresence: (userId) =>
    set((state) => {
      const next = { ...state.presence };
      delete next[userId];
      return { presence: next };
    }),
}));
