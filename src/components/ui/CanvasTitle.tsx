"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  getBoardMetadata,
  updateBoardMetadata,
} from "@/lib/firebase/firestore";

interface CanvasTitleProps {
  boardId: string;
}

export default function CanvasTitle({ boardId }: CanvasTitleProps) {
  const [title, setTitle] = useState("Untitled Board");
  const [isEditing, setIsEditing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load title from Firestore
  useEffect(() => {
    getBoardMetadata(boardId).then((meta) => {
      if (meta) {
        setTitle(meta.title || "Untitled Board");
      }
      setIsLoaded(true);
    });
  }, [boardId]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const saveTitle = useCallback(
    (newTitle: string) => {
      const trimmed = newTitle.trim() || "Untitled Board";
      setTitle(trimmed);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateBoardMetadata(boardId, { title: trimmed }).catch(console.error);
      }, 500);
    },
    [boardId]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTitle(value);
    saveTitle(value);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (!title.trim()) {
      setTitle("Untitled Board");
      saveTitle("Untitled Board");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") {
      setIsEditing(false);
      inputRef.current?.blur();
    }
  };

  if (!isLoaded) return null;

  return (
    <div className="fixed top-4 left-4 z-50">
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          style={{ minWidth: 120, maxWidth: 300 }}
        />
      ) : (
        <button
          onClick={() => setIsEditing(true)}
          className="rounded-md bg-white/80 px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm backdrop-blur transition-colors hover:bg-white"
        >
          {title}
        </button>
      )}
    </div>
  );
}
