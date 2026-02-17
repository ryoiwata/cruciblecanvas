import { create } from "zustand";
import type { ObjectType, BoardObject, ContextMenuState } from "../types";

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

  // Text editing (Phase 3)
  editingObjectId: string | null;

  // Clipboard (Phase 3)
  clipboard: BoardObject[];

  // Context menu (Phase 3)
  contextMenu: ContextMenuState;

  // Connector creation (Phase 3)
  connectorStart: string | null;

  // Actions
  setMode: (mode: CanvasMode) => void;
  enterCreateMode: (tool: ObjectType) => void;
  exitToPan: () => void;
  selectObject: (id: string) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setViewport: (x: number, y: number, scale: number) => void;

  // Phase 3 actions
  setEditingObject: (id: string | null) => void;
  copyToClipboard: (objects: BoardObject[]) => void;
  clearClipboard: () => void;
  showContextMenu: (state: ContextMenuState) => void;
  hideContextMenu: () => void;
  setConnectorStart: (id: string | null) => void;
}

const INITIAL_CONTEXT_MENU: ContextMenuState = {
  visible: false,
  x: 0,
  y: 0,
  targetObjectId: null,
  nearbyFrames: [],
};

export const useCanvasStore = create<CanvasState>((set, get) => ({
  mode: "pan",
  creationTool: null,
  selectedObjectIds: [],
  stageX: 0,
  stageY: 0,
  stageScale: 1,
  editingObjectId: null,
  clipboard: [],
  contextMenu: INITIAL_CONTEXT_MENU,
  connectorStart: null,

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
      connectorStart: null,
    }),

  exitToPan: () =>
    set({
      mode: "pan",
      creationTool: null,
      selectedObjectIds: [],
      connectorStart: null,
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

  // Phase 3 actions
  setEditingObject: (id) => set({ editingObjectId: id }),

  copyToClipboard: (objects) => {
    const clones = objects.map((obj) => ({
      ...obj,
      id: "",
      createdAt: 0,
      updatedAt: 0,
    }));
    set({ clipboard: clones });
  },

  clearClipboard: () => set({ clipboard: [] }),

  showContextMenu: (state) => set({ contextMenu: state }),

  hideContextMenu: () => set({ contextMenu: INITIAL_CONTEXT_MENU }),

  setConnectorStart: (id) => set({ connectorStart: id }),
}));
