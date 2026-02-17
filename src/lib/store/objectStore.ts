import { create } from "zustand";
import type { BoardObject, ObjectLock } from "../types";
import { overlapFraction } from "../utils";

interface ObjectState {
  objects: Record<string, BoardObject>;
  locks: Record<string, ObjectLock>;
  isLoaded: boolean;

  // Object actions
  setObjects: (objects: Record<string, BoardObject>) => void;
  upsertObject: (object: BoardObject) => void;
  updateObjectLocal: (id: string, updates: Partial<BoardObject>) => void;
  removeObject: (id: string) => void;

  // Batch actions (Phase 3)
  batchRemove: (ids: string[]) => void;
  batchUpsert: (objects: BoardObject[]) => void;

  // Lock actions
  setLocks: (locks: Record<string, ObjectLock>) => void;

  // Loading state
  setIsLoaded: (loaded: boolean) => void;

  // Frame helpers (Phase 3)
  getChildrenOfFrame: (frameId: string) => BoardObject[];
  getFramesContaining: (objectId: string) => BoardObject[];
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
    if (!existing) return;
    set((state) => ({
      objects: {
        ...state.objects,
        [id]: { ...existing, ...updates },
      },
    }));
  },

  removeObject: (id) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _removed, ...rest } = state.objects;
      return { objects: rest };
    }),

  batchRemove: (ids) =>
    set((state) => {
      const next = { ...state.objects };
      for (const id of ids) {
        delete next[id];
      }
      return { objects: next };
    }),

  batchUpsert: (objects) =>
    set((state) => {
      const next = { ...state.objects };
      for (const obj of objects) {
        next[obj.id] = obj;
      }
      return { objects: next };
    }),

  setLocks: (locks) => set({ locks }),

  setIsLoaded: (loaded) => set({ isLoaded: loaded }),

  getChildrenOfFrame: (frameId) => {
    const objs = get().objects;
    return Object.values(objs).filter((o) => o.parentFrame === frameId);
  },

  getFramesContaining: (objectId) => {
    const objs = get().objects;
    const target = objs[objectId];
    if (!target) return [];

    return Object.values(objs).filter((o) => {
      if (o.type !== "frame" || o.id === objectId) return false;
      return overlapFraction(target, o) > 0;
    });
  },
}));
