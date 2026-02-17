import { create } from "zustand";
import { User } from "firebase/auth";

interface AuthState {
  user: User | null;
  displayName: string | null;
  isAnonymous: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setDisplayName: (name: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  displayName: null,
  isAnonymous: false,
  isLoading: true,
  setUser: (user) =>
    set({
      user,
      displayName: user?.displayName || null,
      isAnonymous: user?.isAnonymous ?? false,
      isLoading: false,
    }),
  setDisplayName: (name) => set({ displayName: name }),
}));
