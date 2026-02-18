"use client";

import { useEffect, useRef } from "react";
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
import {
  STICKY_NOTE_COLORS,
  STICKY_NOTE_DEFAULT,
  SHAPE_DEFAULTS,
} from "@/lib/types";

interface ContextMenuProps {
  boardId: string;
}

export default function ContextMenu({ boardId }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const contextMenu = useCanvasStore((s) => s.contextMenu);
  const hideContextMenu = useCanvasStore((s) => s.hideContextMenu);
  const setEditingObject = useCanvasStore((s) => s.setEditingObject);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const clipboard = useCanvasStore((s) => s.clipboard);

  const objects = useObjectStore((s) => s.objects);
  const removeObject = useObjectStore((s) => s.removeObject);
  const batchRemove = useObjectStore((s) => s.batchRemove);
  const upsertObject = useObjectStore((s) => s.upsertObject);
  const updateObjectLocal = useObjectStore((s) => s.updateObjectLocal);
  const getChildrenOfFrame = useObjectStore((s) => s.getChildrenOfFrame);

  const user = useAuthStore((s) => s.user);

  // Close on click outside or Escape
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hideContextMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideContextMenu();
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu.visible, hideContextMenu]);

  if (!contextMenu.visible) return null;

  const target = contextMenu.targetObjectId
    ? objects[contextMenu.targetObjectId]
    : null;

  const handleDelete = async () => {
    if (!contextMenu.targetObjectId) return;
    const id = contextMenu.targetObjectId;
    const obj = objects[id];

    // Collect orphan connectors
    const connectorIds = Object.values(objects)
      .filter(
        (o) =>
          o.type === "connector" && o.connectedTo?.includes(id)
      )
      .map((o) => o.id);

    // If deleting a frame, clear children's parentFrame
    if (obj?.type === "frame") {
      const children = getChildrenOfFrame(id);
      for (const child of children) {
        updateObjectLocal(child.id, { parentFrame: undefined });
        updateObject(boardId, child.id, { parentFrame: "" }).catch(
          console.error
        );
      }
    }

    // Remove locally
    removeObject(id);
    batchRemove(connectorIds);
    clearSelection();
    hideContextMenu();

    // Persist
    try {
      await deleteObject(boardId, id);
      if (connectorIds.length > 0) {
        await deleteObjects(boardId, connectorIds);
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleChangeColor = (color: string) => {
    if (!contextMenu.targetObjectId) return;
    updateObjectLocal(contextMenu.targetObjectId, { color });
    updateObject(boardId, contextMenu.targetObjectId, { color }).catch(
      console.error
    );
    hideContextMenu();
  };

  const handleEditText = () => {
    if (!contextMenu.targetObjectId) return;
    setEditingObject(contextMenu.targetObjectId);
    hideContextMenu();
  };

  const handleDeframeAll = () => {
    if (!contextMenu.targetObjectId) return;
    const children = getChildrenOfFrame(contextMenu.targetObjectId);
    for (const child of children) {
      updateObjectLocal(child.id, { parentFrame: undefined });
      updateObject(boardId, child.id, { parentFrame: "" }).catch(
        console.error
      );
    }
    hideContextMenu();
  };

  const handleAddToFrame = (frameId: string) => {
    if (!contextMenu.targetObjectId) return;
    updateObjectLocal(contextMenu.targetObjectId, { parentFrame: frameId });
    updateObject(boardId, contextMenu.targetObjectId, {
      parentFrame: frameId,
    }).catch(console.error);
    hideContextMenu();
  };

  const handleDuplicate = () => {
    if (!contextMenu.targetObjectId || !user) return;
    const obj = objects[contextMenu.targetObjectId];
    if (!obj) return;

    // Compute max zIndex so duplicate appears on top
    const allObjects = useObjectStore.getState().objects;
    let maxZ = 0;
    for (const o of Object.values(allObjects)) {
      const z = o.zIndex ?? 0;
      if (z > maxZ) maxZ = z;
    }

    const newId = generateObjectId(boardId);
    const newObj = {
      ...obj,
      id: newId,
      x: obj.x + 20,
      y: obj.y + 20,
      zIndex: maxZ + 1,
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
        connectedTo: newObj.type === "connector" ? newObj.connectedTo : undefined,
        legendEntries: newObj.legendEntries,
      },
      newId
    ).catch(console.error);

    hideContextMenu();
  };

  const handlePaste = () => {
    if (!user || clipboard.length === 0) return;

    // Cascading offset: each paste adds +20px diagonal from previous
    const pasteCount = useCanvasStore.getState().pasteCount + 1;
    useCanvasStore.setState({ pasteCount });
    const offset = pasteCount * 20;

    // Compute max zIndex so pasted objects appear on top
    const allObjects = useObjectStore.getState().objects;
    let maxZ = 0;
    for (const o of Object.values(allObjects)) {
      const z = o.zIndex ?? 0;
      if (z > maxZ) maxZ = z;
    }

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

    hideContextMenu();
  };

  const handleOpacityChange = (value: number) => {
    if (!contextMenu.targetObjectId) return;
    const opacity = Math.round(value) / 100;
    updateObjectLocal(contextMenu.targetObjectId, { opacity });
    updateObject(boardId, contextMenu.targetObjectId, { opacity }).catch(
      console.error
    );
  };

  const handleCreateStickyNote = () => {
    if (!user) return;
    const newId = generateObjectId(boardId);
    // Place near right-click position (approximate canvas coords)
    const stageX = useCanvasStore.getState().stageX;
    const stageY = useCanvasStore.getState().stageY;
    const stageScale = useCanvasStore.getState().stageScale;
    const x = Math.round((contextMenu.x - stageX) / stageScale / 20) * 20;
    const y = Math.round((contextMenu.y - stageY) / stageScale / 20) * 20;

    // Compute max zIndex so new object appears on top
    const allObjects = useObjectStore.getState().objects;
    let maxZ = 0;
    for (const o of Object.values(allObjects)) {
      const z = o.zIndex ?? 0;
      if (z > maxZ) maxZ = z;
    }

    const newObj = {
      id: newId,
      type: "stickyNote" as const,
      x,
      y,
      width: STICKY_NOTE_DEFAULT.width,
      height: STICKY_NOTE_DEFAULT.height,
      color: STICKY_NOTE_DEFAULT.color,
      text: "",
      zIndex: maxZ + 1,
      createdBy: user.uid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertObject(newObj);
    createObject(
      boardId,
      { type: newObj.type, x, y, width: newObj.width, height: newObj.height, color: newObj.color, text: "", zIndex: newObj.zIndex, createdBy: user.uid },
      newId
    ).catch(console.error);
    hideContextMenu();
  };

  const handleCreateShape = () => {
    if (!user) return;
    const newId = generateObjectId(boardId);
    const stageX = useCanvasStore.getState().stageX;
    const stageY = useCanvasStore.getState().stageY;
    const stageScale = useCanvasStore.getState().stageScale;
    const x = Math.round((contextMenu.x - stageX) / stageScale / 20) * 20;
    const y = Math.round((contextMenu.y - stageY) / stageScale / 20) * 20;

    // Compute max zIndex so new object appears on top
    const allObjects = useObjectStore.getState().objects;
    let maxZ = 0;
    for (const o of Object.values(allObjects)) {
      const z = o.zIndex ?? 0;
      if (z > maxZ) maxZ = z;
    }

    const newObj = {
      id: newId,
      type: "rectangle" as const,
      x,
      y,
      width: SHAPE_DEFAULTS.rectangle.width,
      height: SHAPE_DEFAULTS.rectangle.height,
      color: SHAPE_DEFAULTS.rectangle.color,
      text: "",
      zIndex: maxZ + 1,
      createdBy: user.uid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertObject(newObj);
    createObject(
      boardId,
      { type: newObj.type, x, y, width: newObj.width, height: newObj.height, color: newObj.color, text: "", zIndex: newObj.zIndex, createdBy: user.uid },
      newId
    ).catch(console.error);
    hideContextMenu();
  };

  // Build menu items based on target
  const items: { label: string; onClick: () => void; danger?: boolean }[] = [];

  if (!target) {
    // Empty canvas context menu
    if (clipboard.length > 0) {
      items.push({ label: "Paste", onClick: handlePaste });
    }
    items.push({ label: "Create Sticky Note", onClick: handleCreateStickyNote });
    items.push({ label: "Create Rectangle", onClick: handleCreateShape });
  } else {
    // Object context menu
    if (
      target.type === "stickyNote" ||
      target.type === "frame" ||
      target.type === "colorLegend"
    ) {
      items.push({
        label: target.type === "frame" ? "Edit Title" : "Edit Text",
        onClick: handleEditText,
      });
    }

    if (target.type === "connector") {
      items.push({ label: "Edit Label", onClick: handleEditText });
    }

    items.push({ label: "Duplicate", onClick: handleDuplicate });

    if (target.type === "frame") {
      items.push({ label: "Deframe All", onClick: handleDeframeAll });
    }

    // "Add to Frame" for non-frame, non-connector objects
    if (
      target.type !== "frame" &&
      target.type !== "connector" &&
      contextMenu.nearbyFrames.length > 0
    ) {
      for (const frame of contextMenu.nearbyFrames) {
        items.push({
          label: `Add to Frame: ${frame.title || "Untitled"}`,
          onClick: () => handleAddToFrame(frame.id),
        });
      }
    }

    items.push({ label: "Delete", onClick: handleDelete, danger: true });
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {/* Color swatches for objects with color */}
      {target &&
        target.type !== "connector" &&
        target.type !== "colorLegend" && (
          <div className="flex gap-1 border-b border-gray-100 px-3 py-2">
            {STICKY_NOTE_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => handleChangeColor(color)}
                className="h-6 w-6 rounded-full border border-gray-300 transition-transform hover:scale-110"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        )}

      {/* Opacity slider for non-connector objects */}
      {target && target.type !== "connector" && (
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <span className="text-xs text-gray-500 w-12 shrink-0">Opacity</span>
          <input
            type="range"
            min={10}
            max={100}
            value={Math.round((target.opacity ?? 1) * 100)}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-indigo-500"
          />
          <span className="text-xs text-gray-400 w-8 text-right tabular-nums">
            {Math.round((target.opacity ?? 1) * 100)}%
          </span>
        </div>
      )}

      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.onClick}
          className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
            item.danger ? "text-red-600" : "text-gray-700"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
