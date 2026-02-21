/**
 * useKeyboardShortcuts — global keyboard event handler for canvas interactions.
 *
 * Performance note: all reactive store reads inside the keydown handler use
 * getState() instead of closure captures, so the useEffect dependency array
 * is stable ([mode, editingObjectId]) and the handler only re-registers when
 * the canvas mode or active text editor changes — not on every object/selection update.
 */

import { useEffect, useCallback, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import { useChatStore } from "@/lib/store/chatStore";
import type { CanvasMode } from "@/lib/store/canvasStore";
import type { ObjectType } from "@/lib/types";
import {
  deleteObject,
  deleteObjects,
  createObject,
  generateObjectId,
  updateObject,
} from "@/lib/firebase/firestore";
import { performLayerAction } from "@/components/ui/ArrangeMenu";
import type { BoardObject } from "@/lib/types";

interface UseKeyboardShortcutsOptions {
  boardId: string;
}

/** Briefly shows a toast message at the bottom of the screen. */
function showToast(message: string) {
  const el = document.createElement("div");
  el.textContent = message;
  el.className =
    "fixed bottom-16 left-1/2 -translate-x-1/2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white shadow-lg z-[300] pointer-events-none transition-opacity";
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 1700);
}

export function useKeyboardShortcuts({ boardId }: UseKeyboardShortcutsOptions) {
  const [pendingDelete, setPendingDelete] = useState(false);

  // Tracks the mode to restore when Shift is released (Shift → temporary pointer)
  const preShiftStateRef = useRef<{ mode: CanvasMode; tool: ObjectType | null } | null>(null);

  // Minimal reactive subscriptions — only values used outside of the keydown handler.
  // mode is kept reactive so the useEffect dep array re-triggers on mode change.
  // editingObjectId is kept reactive to gate the handler when a text editor is open.
  // selectedObjectIds is kept reactive solely to expose deleteCount to the parent.
  const mode = useCanvasStore((s) => s.mode);
  const editingObjectId = useCanvasStore((s) => s.editingObjectId);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);

  // Exposed to parent (DeleteDialog). Uses getState() so it doesn't re-create
  // when selection or objects change — only when boardId changes (stable).
  const performDelete = useCallback(() => {
    const { selectedObjectIds: ids, clearSelection } = useCanvasStore.getState();
    const { objects, batchRemove, getChildrenOfFrame, updateObjectLocal } =
      useObjectStore.getState();

    if (ids.length === 0) return;

    const idsToDelete = [...ids];
    const orphanConnectorIds: string[] = [];

    for (const id of idsToDelete) {
      const obj = objects[id];
      // Clear children of deleted frames
      if (obj?.type === "frame") {
        const children = getChildrenOfFrame(id);
        for (const child of children) {
          updateObjectLocal(child.id, { parentFrame: undefined });
          updateObject(boardId, child.id, { parentFrame: "" }).catch(console.error);
        }
      }

      // Collect orphan connectors whose endpoint is being deleted
      for (const o of Object.values(objects)) {
        if (
          o.type === "connector" &&
          o.connectedTo?.includes(id) &&
          !idsToDelete.includes(o.id) &&
          !orphanConnectorIds.includes(o.id)
        ) {
          orphanConnectorIds.push(o.id);
        }
      }
    }

    const allIds = [...idsToDelete, ...orphanConnectorIds];
    // batchRemove auto-snapshots the full pre-deletion state for undo.
    batchRemove(allIds);
    clearSelection();

    for (const id of idsToDelete) {
      deleteObject(boardId, id).catch(console.error);
    }
    if (orphanConnectorIds.length > 0) {
      deleteObjects(boardId, orphanConnectorIds).catch(console.error);
    }
  }, [boardId]);

  // Shift key → temporary pointer mode. Restores previous mode/tool on key-up.
  // Separate effect so it doesn't share the dep array with the main keydown handler.
  useEffect(() => {
    const handleShiftDown = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || e.repeat) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (editingObjectId) return;
      const { mode: currentMode, creationTool: currentTool } = useCanvasStore.getState();
      if (currentMode !== "pointer") {
        preShiftStateRef.current = { mode: currentMode, tool: currentTool };
        useCanvasStore.getState().setMode("pointer");
      }
    };
    const handleShiftUp = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      const prev = preShiftStateRef.current;
      if (!prev) return;
      preShiftStateRef.current = null;
      if (prev.tool) useCanvasStore.getState().enterCreateMode(prev.tool);
      else useCanvasStore.getState().setMode(prev.mode);
    };
    window.addEventListener("keydown", handleShiftDown);
    window.addEventListener("keyup", handleShiftUp);
    return () => {
      window.removeEventListener("keydown", handleShiftDown);
      window.removeEventListener("keyup", handleShiftUp);
    };
  }, [editingObjectId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when editing text
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // editingObjectId from reactive closure — re-registers when it changes
      if (editingObjectId) return;

      const canvasState = useCanvasStore.getState();

      // Tool switching — number keys and letter aliases
      switch (e.key) {
        // Number shortcuts (legacy)
        case "1":
          canvasState.setMode("pointer");
          return;
        case "2":
          canvasState.enterCreateMode("stickyNote");
          return;
        case "3":
          canvasState.enterCreateMode("rectangle");
          return;
        case "4":
          canvasState.enterCreateMode("circle");
          return;
        case "5":
          canvasState.enterCreateMode("line");
          return;
        case "6":
          canvasState.enterCreateMode("frame");
          return;
        case "7":
          canvasState.enterCreateMode("connector");
          return;
        case "8":
          canvasState.enterCreateMode("text");
          return;
        // Letter shortcuts (matches toolbar badges)
        case "l":
        case "L":
          canvasState.enterCreateMode("line");
          return;
        case "r":
        case "R":
          canvasState.enterCreateMode("rectangle");
          return;
        case "t":
        case "T":
          canvasState.enterCreateMode("text");
          return;
        case "f":
        case "F":
          canvasState.enterCreateMode("frame");
          return;
        case "c":
        case "C":
          // Skip C if Ctrl/Cmd is held (that's copy)
          if (e.ctrlKey || e.metaKey) break;
          canvasState.enterCreateMode("connector");
          return;
        case "Control":
          // Ctrl pressed while a creation tool is active → permanently revert to pointer.
          // This is a one-way switch (no restore on keyup) because Ctrl is also used
          // for multi-step shortcuts (Ctrl+A, Ctrl+D) that make sense from pointer mode.
          if (e.repeat) return;
          if (canvasState.mode === "create") {
            canvasState.exitToPointer();
          }
          return;
        case "Escape":
          canvasState.exitToPointer();
          return;
        case "/": {
          // Open chat sidebar and focus the input field
          e.preventDefault();
          const chatStore = useChatStore.getState();
          chatStore.setSidebarOpen(true);
          setTimeout(() => chatStore.chatInputRef?.current?.focus(), 100);
          return;
        }
      }

      // All remaining shortcuts read state imperatively to avoid re-registration
      const { selectedObjectIds: ids } = useCanvasStore.getState();

      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        if (ids.length === 0) return;
        if (e.ctrlKey || e.metaKey) {
          performDelete();
        } else {
          setPendingDelete(true);
        }
        return;
      }

      // Copy
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        if (ids.length === 0) return;
        const { objects } = useObjectStore.getState();
        const selected = ids
          .map((id) => objects[id])
          .filter((obj): obj is BoardObject => obj !== undefined);
        useCanvasStore.getState().copyToClipboard(selected);
        showToast(`Copied ${selected.length} object${selected.length === 1 ? "" : "s"}`);
        return;
      }

      // Paste
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        const user = useAuthStore.getState().user;
        const { clipboard } = useCanvasStore.getState();
        if (!user || clipboard.length === 0) return;

        const pasteCount = useCanvasStore.getState().pasteCount + 1;
        useCanvasStore.setState({ pasteCount });
        const offset = pasteCount * 20;

        const allObjects = useObjectStore.getState().objects;
        let maxZ = 0;
        for (const o of Object.values(allObjects)) {
          const z = o.zIndex ?? 0;
          if (z > maxZ) maxZ = z;
        }

        const { upsertObject } = useObjectStore.getState();
        for (let i = 0; i < clipboard.length; i++) {
          const obj = clipboard[i];
          const newId = generateObjectId(boardId);
          const newObj = {
            ...obj,
            id: newId,
            x: obj.x + offset,
            y: obj.y + offset,
            zIndex: maxZ + 1 + i,
            createdBy: user.uid,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            parentFrame: undefined,
          };
          upsertObject(newObj);
          createObject(
            boardId,
            {
              type: newObj.type,
              x: newObj.x,
              y: newObj.y,
              width: newObj.width,
              height: newObj.height,
              color: newObj.color,
              text: newObj.text,
              zIndex: newObj.zIndex,
              createdBy: user.uid,
            },
            newId
          ).catch(console.error);
        }
        return;
      }

      // Select all
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        const { mode: currentMode, setSelectedObjectIds } = useCanvasStore.getState();
        if (currentMode !== "pointer") return;
        setSelectedObjectIds(Object.keys(useObjectStore.getState().objects));
        return;
      }

      // Duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        const user = useAuthStore.getState().user;
        const { selectedObjectIds: dupIds } = useCanvasStore.getState();
        const { objects: allObjs, upsertObject: upsert } = useObjectStore.getState();
        if (!user || dupIds.length === 0) return;

        let maxZ = 0;
        for (const o of Object.values(allObjs)) {
          const z = o.zIndex ?? 0;
          if (z > maxZ) maxZ = z;
        }

        let idx = 0;
        for (const id of dupIds) {
          const obj = allObjs[id];
          if (!obj) continue;
          const newId = generateObjectId(boardId);
          const newZIndex = maxZ + 1 + idx++;
          const newObj = {
            ...obj,
            id: newId,
            x: obj.x + 20,
            y: obj.y + 20,
            zIndex: newZIndex,
            createdBy: user.uid,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            parentFrame: undefined,
          };
          upsert(newObj);
          createObject(
            boardId,
            {
              type: newObj.type,
              x: newObj.x,
              y: newObj.y,
              width: newObj.width,
              height: newObj.height,
              color: newObj.color,
              text: newObj.text,
              zIndex: newZIndex,
              createdBy: user.uid,
            },
            newId
          ).catch(console.error);
        }
        return;
      }

      // Layering shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key === "]") {
        e.preventDefault();
        const action = e.shiftKey ? "bringToFront" : "bringForward";
        const { objects: layerObjs, updateObjectLocal } = useObjectStore.getState();
        performLayerAction(action, ids, layerObjs, updateObjectLocal, boardId);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "[") {
        e.preventDefault();
        const action = e.shiftKey ? "sendToBack" : "sendBackward";
        const { objects: layerObjs, updateObjectLocal } = useObjectStore.getState();
        performLayerAction(action, ids, layerObjs, updateObjectLocal, boardId);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, editingObjectId, performDelete, boardId]);

  return {
    pendingDelete,
    setPendingDelete,
    performDelete,
    deleteCount: selectedObjectIds.length,
  };
}
