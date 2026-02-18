"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Toast from "./Toast";

interface ShareButtonProps {
  boardId: string;
}

export default function ShareButton({ boardId }: ShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const boardUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/board/${boardId}`
      : "";

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(boardUrl);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = boardUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setIsOpen(false);
    setToastVisible(true);
  };

  const handleEmailInvite = () => {
    const subject = encodeURIComponent("Join my CrucibleCanvas board");
    const body = encodeURIComponent(
      `Hey! I'd like to collaborate with you on my CrucibleCanvas board.\n\nJoin here: ${boardUrl}`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self");
    setIsOpen(false);
  };

  const handleToastDismiss = useCallback(() => {
    setToastVisible(false);
  }, []);

  return (
    <>
      <div ref={popoverRef} className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
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

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-52 rounded-lg border border-gray-200 bg-white py-1.5 shadow-lg z-50">
            <button
              onClick={handleCopyLink}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="text-base">🔗</span>
              Copy Link
            </button>
            <button
              onClick={handleEmailInvite}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="text-base">✉️</span>
              Email Invite
            </button>
          </div>
        )}
      </div>

      <Toast
        message="Link copied to clipboard!"
        visible={toastVisible}
        onDismiss={handleToastDismiss}
      />
    </>
  );
}
