"use client";

import { useEffect, useState } from "react";
import {
  getBoardMetadata,
  updateBoardMetadata,
} from "@/lib/firebase/firestore";
import { setBoardPrivacy } from "@/lib/firebase/rtdb";
import { useAuthStore } from "@/lib/store/authStore";

interface PrivacyToggleProps {
  boardId: string;
}

export default function PrivacyToggle({ boardId }: PrivacyToggleProps) {
  const [isPublic, setIsPublic] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  const user = useAuthStore((s) => s.user);
  const isCreator = !!user && createdBy === user.uid;

  // Load initial state from Firestore
  useEffect(() => {
    getBoardMetadata(boardId).then((meta) => {
      if (meta) {
        setIsPublic(meta.isPublic);
        setCreatedBy(meta.createdBy);
      }
      setIsLoaded(true);
    });
  }, [boardId]);

  const handleToggle = (newValue: boolean) => {
    if (!isCreator) return;
    if (newValue === isPublic) return;
    setIsPublic(newValue);
    updateBoardMetadata(boardId, { isPublic: newValue }).catch(console.error);
    setBoardPrivacy(boardId, newValue);
  };

  if (!isLoaded) return null;

  return (
    <div className="flex items-center gap-1.5">
      <div className="group relative flex rounded-full bg-gray-100 p-0.5">
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
          disabled={!isCreator}
          className={`relative z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            isPublic ? "text-gray-800" : "text-gray-400"
          } ${!isCreator ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span>👀</span>
          <span>Public</span>
        </button>

        {/* Private option */}
        <button
          onClick={() => handleToggle(false)}
          disabled={!isCreator}
          className={`relative z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            !isPublic ? "text-gray-800" : "text-gray-400"
          } ${!isCreator ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span>🥸</span>
          <span>Private</span>
        </button>

        {/* Tooltip for non-creators */}
        {!isCreator && (
          <div className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
            Only the owner can change privacy settings.
          </div>
        )}
      </div>
    </div>
  );
}
