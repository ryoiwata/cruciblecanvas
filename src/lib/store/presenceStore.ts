import { create } from "zustand";
import type { PresenceData } from "../types";

interface PresenceState {
  presence: Record<string, PresenceData>;
  setPresence: (data: Record<string, PresenceData>) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presence: {},
  setPresence: (data) => set({ presence: data }),
}));
