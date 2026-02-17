"use client";

import { useEffect, useRef } from "react";

interface DeleteDialogProps {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteDialog({
  count,
  onConfirm,
  onCancel,
}: DeleteDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/30">
      <div
        ref={dialogRef}
        className="w-80 rounded-lg bg-white p-5 shadow-xl"
      >
        <h3 className="text-lg font-semibold text-gray-900">
          Delete {count} object{count !== 1 ? "s" : ""}?
        </h3>
        <p className="mt-2 text-sm text-gray-500">
          This action cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
