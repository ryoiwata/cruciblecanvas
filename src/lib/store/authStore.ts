import { create } from "zustand";
import { User } from "firebase/auth";

interface AuthState {
  user: User | null;
  displayName: string | null;
  isAnonymous: boolean;
  isLoading: boolean;
  /** User-selected cursor/avatar color. Null = use deterministic hash from UID. */
  preferredColor: string | null;
  setUser: (user: User | null) => void;
  setDisplayName: (name: string) => void;
  setPreferredColor: (color: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  displayName: null,
  isAnonymous: false,
  isLoading: true,
  preferredColor: null,
  setUser: (user) =>
    set({
      user,
      displayName: user?.displayName || null,
      isAnonymous: user?.isAnonymous ?? false,
      isLoading: false,
    }),
  setDisplayName: (name) => set({ displayName: name }),
  setPreferredColor: (color) => set({ preferredColor: color }),
}));
