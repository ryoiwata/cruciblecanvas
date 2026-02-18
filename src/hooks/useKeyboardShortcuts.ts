import { useEffect, useCallback, useState } from "react";
import { useCanvasStore } from "@/lib/store/canvasStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useAuthStore } from "@/lib/store/authStore";
import {
  deleteObject,
  deleteObjects,
  createObject,
  generateObjectId,
  updateObject,
} from "@/lib/firebase/firestore";
import { performLayerAction } from "@/components/ui/ArrangeMenu";

interface UseKeyboardShortcutsOptions {
  boardId: string;
}

export function useKeyboardShortcuts({ boardId }: UseKeyboardShortcutsOptions) {
  const [pendingDelete, setPendingDelete] = useState(false);

  const mode = useCanvasStore((s) => s.mode);
  const setMode = useCanvasStore((s) => s.setMode);
  const enterCreateMode = useCanvasStore((s) => s.enterCreateMode);
  const exitToPointer = useCanvasStore((s) => s.exitToPointer);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const copyToClipboard = useCanvasStore((s) => s.copyToClipboard);
  const clipboard = useCanvasStore((s) => s.clipboard);
  const editingObjectId = useCanvasStore((s) => s.editingObjectId);

  const objects = useObjectStore((s) => s.objects);
  const batchRemove = useObjectStore((s) => s.batchRemove);
  const upsertObject = useObjectStore((s) => s.upsertObject);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const getChildrenOfFrame = useObjectStore((s) => s.getChildrenOfFrame);

  const user = useAuthStore((s) => s.user);

  const performDelete = useCallback(() => {
    if (selectedObjectIds.length === 0) return;

    const idsToDelete = [...selectedObjectIds];
    const orphanConnectorIds: string[] = [];

    for (const id of idsToDelete) {
      const obj = objects[id];
      // Clear children of deleted frames
      if (obj?.type === "frame") {
        const children = getChildrenOfFrame(id);
        for (const child of children) {
          updateObjectLocal(child.id, { parentFrame: undefined });
          updateObject(boardId, child.id, { parentFrame: "" }).catch(
            console.error
          );
        }
      }

      // Find orphan connectors
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
    batchRemove(allIds);
    clearSelection();

    // Persist
    for (const id of idsToDelete) {
      deleteObject(boardId, id).catch(console.error);
    }
    if (orphanConnectorIds.length > 0) {
      deleteObjects(boardId, orphanConnectorIds).catch(console.error);
    }
  }, [
    selectedObjectIds,
    objects,
    boardId,
    batchRemove,
    clearSelection,
    getChildrenOfFrame,
    updateObjectLocal,
  ]);

  const handleCopy = useCallback(() => {
    if (selectedObjectIds.length === 0) return;
    const selected = selectedObjectIds
      .map((id) => objects[id])
      .filter(Boolean);
    copyToClipboard(selected);
  }, [selectedObjectIds, objects, copyToClipboard]);

  const handlePaste = useCallback(() => {
    if (!user || clipboard.length === 0) return;

    // Cascading offset: each paste adds +20px diagonal from previous
    const pasteCount = useCanvasStore.getState().pasteCount + 1;
    useCanvasStore.setState({ pasteCount });
    const offset = pasteCount * 20;

    // Compute max zIndex for placing pasted objects on top
    const allObjects = useObjectStore.getState().objects;
    let maxZ = 0;
    for (const o of Object.values(allObjects)) {
      const z = o.zIndex ?? 0;
      if (z > maxZ) maxZ = z;
    }

    const newIds: string[] = [];

    for (let i = 0; i < clipboard.length; i++) {
      const obj = clipboard[i];
      const newId = generateObjectId(boardId);
      newIds.push(newId);
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
  }, [user, clipboard, boardId, upsertObject]);

  const handleDuplicate = useCallback(() => {
    if (!user || selectedObjectIds.length === 0) return;

    // Compute max zIndex so duplicates appear on top
    const allObjects = useObjectStore.getState().objects;
    let maxZ = 0;
    for (const o of Object.values(allObjects)) {
      const z = o.zIndex ?? 0;
      if (z > maxZ) maxZ = z;
    }

    let idx = 0;
    for (const id of selectedObjectIds) {
      const obj = objects[id];
      if (!obj) continue;

      const newId = generateObjectId(boardId);
      const newZIndex = maxZ + 1 + idx;
      idx++;
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
          zIndex: newZIndex,
          createdBy: user.uid,
        },
        newId
      ).catch(console.error);
    }
  }, [user, selectedObjectIds, objects, boardId, upsertObject]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when editing text
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (editingObjectId) return;

      // Tool switching
      switch (e.key) {
        case "1":
          setMode("pointer");
          return;
        case "2":
          enterCreateMode("stickyNote");
          return;
        case "3":
          enterCreateMode("rectangle");
          return;
        case "4":
          enterCreateMode("circle");
          return;
        case "5":
          enterCreateMode("frame");
          return;
        case "6":
          enterCreateMode("connector");
          return;
        case "Escape":
          exitToPointer();
          return;
      }

      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedObjectIds.length === 0) return;
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+Delete: bypass confirmation
          performDelete();
        } else {
          setPendingDelete(true);
        }
        return;
      }

      // Copy
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        handleCopy();
        return;
      }

      // Paste
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        handlePaste();
        return;
      }

      // Duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        handleDuplicate();
        return;
      }

      // Layering shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key === "]") {
        e.preventDefault();
        const action = e.shiftKey ? "bringToFront" : "bringForward";
        performLayerAction(action, selectedObjectIds, objects, updateObjectLocal, boardId);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "[") {
        e.preventDefault();
        const action = e.shiftKey ? "sendToBack" : "sendBackward";
        performLayerAction(action, selectedObjectIds, objects, updateObjectLocal, boardId);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    mode,
    setMode,
    enterCreateMode,
    exitToPointer,
    selectedObjectIds,
    editingObjectId,
    performDelete,
    handleCopy,
    handlePaste,
    handleDuplicate,
  ]);

  return {
    pendingDelete,
    setPendingDelete,
    performDelete,
    deleteCount: selectedObjectIds.length,
  };
}
