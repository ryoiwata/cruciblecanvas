"use client";

/**
 * SelectionActionBar — floating action bar that appears above the shortcut legend
 * when one or more objects are selected. Provides Copy, Paste, and Delete buttons
 * so users can discover these operations without knowing keyboard shortcuts.
 */

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
import type { BoardObject } from "@/lib/types";

interface SelectionActionBarProps {
  boardId: string;
}

export default function SelectionActionBar({ boardId }: SelectionActionBarProps) {
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);
  const clipboard = useCanvasStore((s) => s.clipboard);
  const copyToClipboard = useCanvasStore((s) => s.copyToClipboard);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const objects = useObjectStore((s) => s.objects);
  const removeObject = useObjectStore((s) => s.removeObject);
  const batchRemove = useObjectStore((s) => s.batchRemove);
  const upsertObject = useObjectStore((s) => s.upsertObject);
  const getChildrenOfFrame = useObjectStore((s) => s.getChildrenOfFrame);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const user = useAuthStore((s) => s.user);

  if (selectedObjectIds.length === 0) return null;

  const handleCopy = () => {
    const selected = selectedObjectIds
      .map((id) => objects[id])
      .filter((o): o is BoardObject => o !== undefined);
    copyToClipboard(selected);
  };

  const handlePaste = () => {
    if (!user) return;
    const { clipboard: cb, pasteCount } = useCanvasStore.getState();
    if (cb.length === 0) return;

    const nextPasteCount = pasteCount + 1;
    useCanvasStore.setState({ pasteCount: nextPasteCount });
    const offset = nextPasteCount * 20;

    const allObjects = useObjectStore.getState().objects;
    let maxZ = 0;
    for (const o of Object.values(allObjects)) {
      const z = o.zIndex ?? 0;
      if (z > maxZ) maxZ = z;
    }

    for (let i = 0; i < cb.length; i++) {
      const obj = cb[i];
      const newId = generateObjectId(boardId);
      const newObj: BoardObject = {
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
  };

  const handleDelete = async () => {
    const ids = [...selectedObjectIds];
    const orphanConnectorIds: string[] = [];

    for (const id of ids) {
      const obj = objects[id];
      if (obj?.type === "frame") {
        const children = getChildrenOfFrame(id);
        for (const child of children) {
          updateObjectLocal(child.id, { parentFrame: undefined });
          updateObject(boardId, child.id, { parentFrame: "" }).catch(console.error);
        }
      }
      for (const o of Object.values(objects)) {
        if (
          o.type === "connector" &&
          o.connectedTo?.includes(id) &&
          !ids.includes(o.id) &&
          !orphanConnectorIds.includes(o.id)
        ) {
          orphanConnectorIds.push(o.id);
        }
      }
    }

    for (const id of ids) removeObject(id);
    if (orphanConnectorIds.length > 0) batchRemove(orphanConnectorIds);
    clearSelection();

    for (const id of ids) {
      deleteObject(boardId, id).catch(console.error);
    }
    if (orphanConnectorIds.length > 0) {
      deleteObjects(boardId, orphanConnectorIds).catch(console.error);
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1.5 shadow-md backdrop-blur-sm border border-gray-100">
      <span className="mr-2 text-xs text-gray-400 select-none">
        {selectedObjectIds.length} selected
      </span>
      <button
        onClick={handleCopy}
        className="rounded px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
        title="Copy (Ctrl+C)"
      >
        Copy
      </button>
      {clipboard.length > 0 && (
        <button
          onClick={handlePaste}
          className="rounded px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          title="Paste (Ctrl+V)"
        >
          Paste
        </button>
      )}
      <div className="mx-1 h-4 w-px bg-gray-200" />
      <button
        onClick={handleDelete}
        className="rounded px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
        title="Delete"
      >
        Delete
      </button>
    </div>
  );
}
