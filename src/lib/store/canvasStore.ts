import { create } from "zustand";
import type { ObjectType } from "../types";

export type CanvasMode = "pan" | "select" | "create";

interface CanvasState {
  // Mode
  mode: CanvasMode;
  creationTool: ObjectType | null;

  // Selection
  selectedObjectIds: string[];

  // Viewport
  stageX: number;
  stageY: number;
  stageScale: number;

  // Actions
  setMode: (mode: CanvasMode) => void;
  enterCreateMode: (tool: ObjectType) => void;
  exitToPan: () => void;
  selectObject: (id: string) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setViewport: (x: number, y: number, scale: number) => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  mode: "pan",
  creationTool: null,
  selectedObjectIds: [],
  stageX: 0,
  stageY: 0,
  stageScale: 1,

  setMode: (mode) =>
    set({
      mode,
      creationTool: mode === "create" ? get().creationTool : null,
    }),

  enterCreateMode: (tool) =>
    set({
      mode: "create",
      creationTool: tool,
      selectedObjectIds: [],
    }),

  exitToPan: () =>
    set({
      mode: "pan",
      creationTool: null,
      selectedObjectIds: [],
    }),

  selectObject: (id) => {
    if (get().mode !== "select") return;
    set({ selectedObjectIds: [id] });
  },

  toggleSelection: (id) => {
    if (get().mode !== "select") return;
    const current = get().selectedObjectIds;
    if (current.includes(id)) {
      set({ selectedObjectIds: current.filter((oid) => oid !== id) });
    } else {
      set({ selectedObjectIds: [...current, id] });
    }
  },

  clearSelection: () => set({ selectedObjectIds: [] }),

  setViewport: (x, y, scale) =>
    set({ stageX: x, stageY: y, stageScale: scale }),
}));
