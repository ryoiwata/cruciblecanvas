import { create } from "zustand";
import type { ObjectType, BoardObject, ContextMenuState } from "../types";

export type CanvasMode = "pointer" | "create";

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
  pasteCount: number;

  // Context menu (Phase 3)
  contextMenu: ContextMenuState;

  // Connector creation (Phase 3)
  connectorStart: string | null;

  // Connector drag creation (Phase 4)
  connectorDragging: boolean;
  connectorHoverTarget: string | null;

  // Color memory
  activeColor: string;
  lastUsedColors: Record<string, string>;

  // Border resize generation counter — incremented on border resize start/end
  // to trigger Transformer re-sync in SelectionLayer (detach during resize, re-attach after)
  borderResizeGeneration: number;

  // Frame drag highlight — set to a frame's id when a dragged object overlaps it >50%
  frameDragHighlightId: string | null;

  // Recently used colors — last 5 unique colors applied; shown at top of color picker
  recentColors: string[];

  // Properties sidebar open/collapsed state — persists across selections
  isPropertiesOpen: boolean;

  // Pending initial character for "type to edit" on sticky notes:
  // set by useKeyboardShortcuts when a printable key enters edit mode,
  // consumed by TextEditor on mount so the key appears in the textarea.
  pendingEditChar: string | null;

  // Pointer sub-modes — both are pointer-mode only; reset on tool/mode change.
  // isMarqueeMode: empty-canvas drags always start a selection rect (no Ctrl needed).
  // isMultiSelectMode: clicking objects toggles them into selection without Ctrl.
  isMarqueeMode: boolean;
  isMultiSelectMode: boolean;

  // Actions
  setMode: (mode: CanvasMode) => void;
  enterCreateMode: (tool: ObjectType) => void;
  exitToPointer: () => void;
  selectObject: (id: string) => void;
  toggleSelection: (id: string) => void;
  setSelectedObjectIds: (ids: string[]) => void;
  clearSelection: () => void;
  setViewport: (x: number, y: number, scale: number) => void;

  // Phase 3 actions
  setEditingObject: (id: string | null) => void;
  copyToClipboard: (objects: BoardObject[]) => void;
  clearClipboard: () => void;
  showContextMenu: (state: ContextMenuState) => void;
  hideContextMenu: () => void;
  setConnectorStart: (id: string | null) => void;
  setConnectorDragging: (dragging: boolean) => void;
  setConnectorHoverTarget: (id: string | null) => void;
  setActiveColor: (color: string) => void;
  setLastUsedColor: (type: string, color: string) => void;
  bumpBorderResizeGeneration: () => void;
  setFrameDragHighlightId: (id: string | null) => void;
  addRecentColor: (color: string) => void;
  setIsPropertiesOpen: (open: boolean) => void;
  setPendingEditChar: (char: string | null) => void;
  setMarqueeMode: (enabled: boolean) => void;
  setMultiSelectMode: (enabled: boolean) => void;
}

const INITIAL_CONTEXT_MENU: ContextMenuState = {
  visible: false,
  x: 0,
  y: 0,
  targetObjectId: null,
  targetObjectIds: [],
  nearbyFrames: [],
};

export const useCanvasStore = create<CanvasState>((set, get) => ({
  mode: "pointer",
  creationTool: null,
  selectedObjectIds: [],
  stageX: 0,
  stageY: 0,
  stageScale: 1,
  editingObjectId: null,
  clipboard: [],
  pasteCount: 0,
  contextMenu: INITIAL_CONTEXT_MENU,
  connectorStart: null,
  connectorDragging: false,
  connectorHoverTarget: null,
  activeColor: "#FEF3C7",
  lastUsedColors: {},
  borderResizeGeneration: 0,
  frameDragHighlightId: null,
  recentColors: [],
  isPropertiesOpen: true,
  pendingEditChar: null,
  isMarqueeMode: false,
  isMultiSelectMode: false,

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
      connectorDragging: false,
      connectorHoverTarget: null,
      isMarqueeMode: false,
      isMultiSelectMode: false,
    }),

  exitToPointer: () =>
    set({
      mode: "pointer",
      creationTool: null,
      selectedObjectIds: [],
      connectorStart: null,
      connectorDragging: false,
      connectorHoverTarget: null,
      isMarqueeMode: false,
      isMultiSelectMode: false,
    }),

  selectObject: (id) => {
    if (get().mode !== "pointer") return;
    set({ selectedObjectIds: [id] });
  },

  toggleSelection: (id) => {
    if (get().mode !== "pointer") return;
    const current = get().selectedObjectIds;
    if (current.includes(id)) {
      set({ selectedObjectIds: current.filter((oid) => oid !== id) });
    } else {
      set({ selectedObjectIds: [...current, id] });
    }
  },

  setSelectedObjectIds: (ids) => {
    if (get().mode !== "pointer") return;
    set({ selectedObjectIds: ids });
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
    set({ clipboard: clones, pasteCount: 0 });
  },

  clearClipboard: () => set({ clipboard: [] }),

  showContextMenu: (state) => set({ contextMenu: state }),

  hideContextMenu: () => set({ contextMenu: INITIAL_CONTEXT_MENU }),

  setConnectorStart: (id) => set({ connectorStart: id }),

  setConnectorDragging: (dragging) => set({ connectorDragging: dragging }),

  setConnectorHoverTarget: (id) => set({ connectorHoverTarget: id }),

  setActiveColor: (color) => set({ activeColor: color }),

  setLastUsedColor: (type, color) =>
    set((s) => ({
      activeColor: color,
      lastUsedColors: { ...s.lastUsedColors, [type]: color },
    })),

  bumpBorderResizeGeneration: () =>
    set((s) => ({ borderResizeGeneration: s.borderResizeGeneration + 1 })),

  setFrameDragHighlightId: (id) => set({ frameDragHighlightId: id }),

  setIsPropertiesOpen: (open) => set({ isPropertiesOpen: open }),

  addRecentColor: (color) =>
    set((s) => {
      const filtered = s.recentColors.filter((c) => c !== color);
      return { recentColors: [color, ...filtered].slice(0, 5) };
    }),

  setPendingEditChar: (char) => set({ pendingEditChar: char }),

  // Sub-mode setters — mutually exclusive; activating one deactivates the other.
  setMarqueeMode: (enabled) =>
    set({ isMarqueeMode: enabled, isMultiSelectMode: enabled ? false : get().isMultiSelectMode }),
  setMultiSelectMode: (enabled) =>
    set({ isMultiSelectMode: enabled, isMarqueeMode: enabled ? false : get().isMarqueeMode }),
}));
