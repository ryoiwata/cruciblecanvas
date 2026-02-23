"use client";

/**
 * ShareButton — toolbar button that opens the full ShareModal.
 * Replaces the original simple link-copy popover with the collaboration management UI.
 */

import { useState, useCallback } from "react";
import ShareModal from "./ShareModal";

interface ShareButtonProps {
  boardId: string;
}

export default function ShareButton({ boardId }: ShareButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = useCallback(() => setIsModalOpen(true), []);
  const handleClose = useCallback(() => setIsModalOpen(false), []);

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 rounded-lg bg-[#6366f1] px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#4f46e5]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        Share
      </button>

      <ShareModal boardId={boardId} isOpen={isModalOpen} onClose={handleClose} />
    </>
  );
}
