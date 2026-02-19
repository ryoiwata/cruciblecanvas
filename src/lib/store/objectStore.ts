import { create } from "zustand";
import type { BoardObject, ObjectLock } from "../types";
import { overlapFraction } from "../utils";

interface ObjectState {
  objects: Record<string, BoardObject>;
  locks: Record<string, ObjectLock>;
  isLoaded: boolean;
  locallyEditingIds: Set<string>;

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
  upsertLock: (id: string, lock: ObjectLock) => void;
  removeLock: (id: string) => void;

  // Loading state
  setIsLoaded: (loaded: boolean) => void;

  // Local edit guards (prevents Firestore echoes from overwriting in-progress resizes)
  startLocalEdit: (id: string) => void;
  endLocalEdit: (id: string) => void;

  // Frame helpers (Phase 3)
  getChildrenOfFrame: (frameId: string) => BoardObject[];
  getFramesContaining: (objectId: string) => BoardObject[];
}

export const useObjectStore = create<ObjectState>((set, get) => ({
  objects: {},
  locks: {},
  isLoaded: false,
  locallyEditingIds: new Set<string>(),

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

  // Granular lock mutations — avoid replacing the entire locks map on every change
  upsertLock: (id, lock) =>
    set((s) => ({ locks: { ...s.locks, [id]: lock } })),
  removeLock: (id) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _removed, ...rest } = s.locks;
      return { locks: rest };
    }),

  setIsLoaded: (loaded) => set({ isLoaded: loaded }),

  startLocalEdit: (id) =>
    set((state) => {
      const next = new Set(state.locallyEditingIds);
      next.add(id);
      return { locallyEditingIds: next };
    }),

  endLocalEdit: (id) =>
    set((state) => {
      const next = new Set(state.locallyEditingIds);
      next.delete(id);
      return { locallyEditingIds: next };
    }),

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
