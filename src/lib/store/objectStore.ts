import { create } from "zustand";
import RBush from "rbush";
import type { BoardObject, ObjectLock } from "../types";
import { overlapFraction } from "../utils";

// ---------------------------------------------------------------------------
// Spatial index — maintained outside Zustand state so mutations don't trigger
// re-renders. Updated imperatively on every object mutation.
// ---------------------------------------------------------------------------

interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

/** R-tree spatial index for O(log N + k) viewport culling. Exported for BoardObjects. */
export const spatialIndex = new RBush<SpatialItem>();

/** Companion map for O(1) item lookup during incremental removes. */
const spatialItemMap = new Map<string, SpatialItem>();

/** Insert or update a single object in the spatial index. Skips connectors (no bbox). */
function upsertSpatialItem(obj: BoardObject): void {
  if (obj.type === "connector") return;
  const existing = spatialItemMap.get(obj.id);
  if (existing) {
    spatialIndex.remove(existing, (a: SpatialItem, b: SpatialItem) => a.id === b.id);
  }
  const item: SpatialItem = {
    minX: obj.x,
    minY: obj.y,
    maxX: obj.x + obj.width,
    maxY: obj.y + obj.height,
    id: obj.id,
  };
  spatialIndex.insert(item);
  spatialItemMap.set(obj.id, item);
}

/** Remove a single object from the spatial index by id. */
function removeSpatialItem(id: string): void {
  const existing = spatialItemMap.get(id);
  if (!existing) return;
  spatialIndex.remove(existing, (a: SpatialItem, b: SpatialItem) => a.id === b.id);
  spatialItemMap.delete(id);
}

/** Bulk-rebuild the spatial index from a full objects map. O(N log N) via rbush bulk load. */
export function rebuildSpatialIndex(objects: Record<string, BoardObject>): void {
  spatialIndex.clear();
  spatialItemMap.clear();
  const items: SpatialItem[] = [];
  for (const obj of Object.values(objects)) {
    if (obj.type === "connector") continue;
    const item: SpatialItem = {
      minX: obj.x,
      minY: obj.y,
      maxX: obj.x + obj.width,
      maxY: obj.y + obj.height,
      id: obj.id,
    };
    items.push(item);
    spatialItemMap.set(obj.id, item);
  }
  spatialIndex.load(items);
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

/** Max entries kept in undo/redo history. */
const MAX_HISTORY = 30;

interface HistoryDelta {
  before: Record<string, BoardObject>;
  after: Record<string, BoardObject>;
}

interface ObjectState {
  objects: Record<string, BoardObject>;
  locks: Record<string, ObjectLock>;
  isLoaded: boolean;
  locallyEditingIds: Set<string>;

  // Undo/redo history
  past: Record<string, BoardObject>[];
  future: Record<string, BoardObject>[];

  // Object actions
  setObjects: (objects: Record<string, BoardObject>) => void;
  upsertObject: (object: BoardObject) => void;
  updateObjectLocal: (id: string, updates: Partial<BoardObject>) => void;
  removeObject: (id: string) => void;

  // Batch actions (Phase 3)
  batchRemove: (ids: string[]) => void;
  batchUpsert: (objects: BoardObject[]) => void;

  // History actions
  /** Save current objects as a history checkpoint (call before meaningful mutations). */
  snapshot: () => void;
  /** Undo to the previous checkpoint. Returns delta for Firestore sync, or null if no history. */
  undo: () => HistoryDelta | null;
  /** Redo to the next checkpoint. Returns delta for Firestore sync, or null if at head. */
  redo: () => HistoryDelta | null;

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

  /**
   * Checks if `childId`'s bounding box extends beyond its parent frame and, if
   * so, expands the frame to contain it (plus a 24px padding buffer).
   *
   * Returns the frame id and the patch that was applied so the caller can
   * persist the change to Firestore.  Returns null when no expansion is needed
   * or when the object has no parentFrame.
   */
  expandFrameToContainChild: (childId: string) => { frameId: string; patch: Partial<BoardObject> } | null;

  /**
   * Called when a framed child finishes a drag.
   * If the child has no bounding-box overlap with its parent frame it is
   * deframed (parentFrame cleared).  If it still overlaps, the frame is
   * expanded to contain it (plus 24 px padding).
   * Returns an action descriptor so the caller can persist the change to Firestore.
   */
  deframeOrExpandChild: (childId: string) =>
    | { action: 'deframe'; childId: string; frameId: string }
    | { action: 'expand'; frameId: string; patch: Partial<BoardObject> }
    | null;
}

export const useObjectStore = create<ObjectState>((set, get) => ({
  objects: {},
  locks: {},
  isLoaded: false,
  locallyEditingIds: new Set<string>(),
  past: [],
  future: [],

  setObjects: (objects) => {
    set({ objects });
    rebuildSpatialIndex(objects);
  },

  upsertObject: (object) => {
    set((state) => ({
      objects: { ...state.objects, [object.id]: object },
    }));
    upsertSpatialItem(object);
  },

  updateObjectLocal: (id, updates) => {
    const existing = get().objects[id];
    if (!existing) return;
    const updated = { ...existing, ...updates };
    set((state) => ({
      objects: {
        ...state.objects,
        [id]: updated,
      },
    }));
    upsertSpatialItem(updated);
  },

  removeObject: (id) => {
    // Auto-snapshot before single deletion so it can be undone.
    const before = get().objects;
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _removed, ...rest } = state.objects;
      return {
        objects: rest,
        past: [...state.past, before].slice(-MAX_HISTORY),
        future: [],
      };
    });
    removeSpatialItem(id);
  },

  batchRemove: (ids) => {
    // Auto-snapshot before batch deletion so it can be undone.
    const before = get().objects;
    set((state) => {
      const next = { ...state.objects };
      for (const id of ids) {
        delete next[id];
      }
      return {
        objects: next,
        past: [...state.past, before].slice(-MAX_HISTORY),
        future: [],
      };
    });
    for (const id of ids) {
      removeSpatialItem(id);
    }
  },

  batchUpsert: (objects) => {
    set((state) => {
      const next = { ...state.objects };
      for (const obj of objects) {
        next[obj.id] = obj;
      }
      return { objects: next };
    });
    for (const obj of objects) {
      upsertSpatialItem(obj);
    }
  },

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

  snapshot: () => {
    const current = get().objects;
    set((s) => ({
      past: [...s.past, current].slice(-MAX_HISTORY),
      future: [],
    }));
  },

  undo: () => {
    const { past, objects, future } = get();
    if (past.length === 0) return null;
    const prev = past[past.length - 1];
    const newPast = past.slice(0, -1);
    set({
      past: newPast,
      future: [objects, ...future].slice(0, MAX_HISTORY),
      objects: prev,
    });
    rebuildSpatialIndex(prev);
    return { before: objects, after: prev };
  },

  redo: () => {
    const { past, objects, future } = get();
    if (future.length === 0) return null;
    const next = future[0];
    const newFuture = future.slice(1);
    set({
      past: [...past, objects].slice(-MAX_HISTORY),
      future: newFuture,
      objects: next,
    });
    rebuildSpatialIndex(next);
    return { before: objects, after: next };
  },

  getChildrenOfFrame: (frameId) => {
    const objs = get().objects;
    return Object.values(objs).filter((o) => o.parentFrame === frameId);
  },

  deframeOrExpandChild: (childId) => {
    const { objects } = get();
    const child = objects[childId];
    if (!child?.parentFrame) return null;
    const frame = objects[child.parentFrame];
    if (!frame || frame.type !== 'frame') return null;

    const childRight = child.x + child.width;
    const childBottom = child.y + child.height;
    const frameRight = frame.x + frame.width;
    const frameBottom = frame.y + frame.height;

    // Zero bounding-box overlap → child has fully left the frame → deframe it
    const hasOverlap =
      child.x < frameRight &&
      childRight > frame.x &&
      child.y < frameBottom &&
      childBottom > frame.y;

    if (!hasOverlap) {
      get().updateObjectLocal(childId, { parentFrame: undefined });
      return { action: 'deframe' as const, childId, frameId: frame.id };
    }

    // Still overlapping → expand frame to contain child with padding
    const PADDING = 24;
    const newX      = Math.min(frame.x, child.x - PADDING);
    const newY      = Math.min(frame.y, child.y - PADDING);
    const newRight  = Math.max(frameRight,  childRight  + PADDING);
    const newBottom = Math.max(frameBottom, childBottom + PADDING);

    const needsExpansion =
      newX < frame.x || newY < frame.y || newRight > frameRight || newBottom > frameBottom;

    if (needsExpansion) {
      const patch: Partial<BoardObject> = {
        x: newX, y: newY, width: newRight - newX, height: newBottom - newY,
      };
      get().updateObjectLocal(frame.id, patch);
      return { action: 'expand' as const, frameId: frame.id, patch };
    }

    return null;
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

  expandFrameToContainChild: (childId) => {
    const { objects } = get();
    const child = objects[childId];
    if (!child?.parentFrame) return null;
    const frame = objects[child.parentFrame];
    if (!frame || frame.type !== "frame") return null;

    const PADDING = 24;
    const childRight = child.x + child.width;
    const childBottom = child.y + child.height;

    const newX = Math.min(frame.x, child.x - PADDING);
    const newY = Math.min(frame.y, child.y - PADDING);
    const newRight = Math.max(frame.x + frame.width, childRight + PADDING);
    const newBottom = Math.max(frame.y + frame.height, childBottom + PADDING);

    // No expansion needed — child already fits within the frame (with padding)
    if (
      newX >= frame.x &&
      newY >= frame.y &&
      newRight <= frame.x + frame.width &&
      newBottom <= frame.y + frame.height
    ) {
      return null;
    }

    const patch: Partial<BoardObject> = {
      x: newX,
      y: newY,
      width: newRight - newX,
      height: newBottom - newY,
    };

    get().updateObjectLocal(frame.id, patch);
    return { frameId: frame.id, patch };
  },
}));
