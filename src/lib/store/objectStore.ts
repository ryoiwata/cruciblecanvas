import { create } from "zustand";
import type { BoardObject, ObjectLock } from "../types";

interface ObjectState {
  objects: Record<string, BoardObject>;
  locks: Record<string, ObjectLock>;
  isLoaded: boolean;

  // Object actions
  setObjects: (objects: Record<string, BoardObject>) => void;
  upsertObject: (object: BoardObject) => void;
  updateObjectLocal: (id: string, updates: Partial<BoardObject>) => void;
  removeObject: (id: string) => void;

  // Lock actions
  setLocks: (locks: Record<string, ObjectLock>) => void;

  // Loading state
  setIsLoaded: (loaded: boolean) => void;
}

export const useObjectStore = create<ObjectState>((set, get) => ({
  objects: {},
  locks: {},
  isLoaded: false,

  setObjects: (objects) => set({ objects }),

  upsertObject: (object) =>
    set((state) => ({
      objects: { ...state.objects, [object.id]: object },
    })),

  updateObjectLocal: (id, updates) => {
    const existing = get().objects[id];
    if (!existing) return; // No-op if object was deleted by another user
    set((state) => ({
      objects: {
        ...state.objects,
        [id]: { ...existing, ...updates },
      },
    }));
  },

  removeObject: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.objects;
      return { objects: rest };
    }),

  setLocks: (locks) => set({ locks }),

  setIsLoaded: (loaded) => set({ isLoaded: loaded }),
}));
