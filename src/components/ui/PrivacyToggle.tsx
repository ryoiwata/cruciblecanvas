"use client";

import { useEffect, useState } from "react";
import {
  getBoardMetadata,
  updateBoardMetadata,
} from "@/lib/firebase/firestore";

interface PrivacyToggleProps {
  boardId: string;
}

export default function PrivacyToggle({ boardId }: PrivacyToggleProps) {
  const [isPublic, setIsPublic] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load initial state from Firestore
  useEffect(() => {
    getBoardMetadata(boardId).then((meta) => {
      if (meta) {
        setIsPublic(meta.isPublic);
      }
      setIsLoaded(true);
    });
  }, [boardId]);

  const handleToggle = (newValue: boolean) => {
    if (newValue === isPublic) return;
    setIsPublic(newValue);
    updateBoardMetadata(boardId, { isPublic: newValue }).catch(console.error);
  };

  if (!isLoaded) return null;

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex rounded-full bg-gray-100 p-0.5">
        {/* Active pill indicator */}
        <div
          className="absolute top-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out"
          style={{
            transform: isPublic ? "translateX(2px)" : "translateX(calc(100% + 2px))",
          }}
        />

        {/* Public option */}
        <button
          onClick={() => handleToggle(true)}
          className={`relative z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            isPublic ? "text-gray-800" : "text-gray-400"
          }`}
        >
          <span>👀</span>
          <span>Public</span>
        </button>

        {/* Private option */}
        <button
          onClick={() => handleToggle(false)}
          className={`relative z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            !isPublic ? "text-gray-800" : "text-gray-400"
          }`}
        >
          <span>🥸</span>
          <span>Private</span>
        </button>
      </div>
    </div>
  );
}
