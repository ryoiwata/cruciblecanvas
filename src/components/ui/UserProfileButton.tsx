'use client';

/**
 * UserProfileButton — avatar button in the TopHeader that lets any authenticated
 * user (including anonymous guest) edit their display name and choose a cursor color.
 *
 * Color changes are written to three places atomically:
 *   1. authStore.preferredColor — immediate local state so useMultiplayer picks it up
 *   2. RTDB presence/{userId}/color + cursors/{userId}/color — real-time broadcast
 *   3. Firestore users/{userId}/profile/preferredColor — cross-board persistence
 *
 * Display-name saves propagate to RTDB presence via useMultiplayer's buildPresenceData,
 * which re-runs whenever authStore.displayName changes.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store/authStore';
import { updateUserProfile, updatePreferredColor } from '@/lib/firebase/auth';
import { updatePresenceColor } from '@/lib/firebase/rtdb';
import { CURSOR_COLORS } from '@/lib/types';

const MAX_NAME_LENGTH = 25;

interface UserProfileButtonProps {
  /** Board ID for RTDB color sync. Optional — skipped on non-board pages. */
  boardId?: string;
}

/** Derives 1–2 uppercase initials from a display name or email. */
function getInitials(
  displayName: string | null | undefined,
  email: string | null | undefined
): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return displayName[0].toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return 'G';
}

export default function UserProfileButton({ boardId }: UserProfileButtonProps) {
  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);
  const preferredColor = useAuthStore((s) => s.preferredColor);
  const setDisplayName = useAuthStore((s) => s.setDisplayName);
  const setPreferredColor = useAuthStore((s) => s.setPreferredColor);

  const [isOpen, setIsOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-fill input and reset error state whenever the popover opens
  useEffect(() => {
    if (isOpen) {
      setNameInput(displayName || '');
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, displayName]);

  // Close the popover when clicking outside of it
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  const handleSave = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setError('Name cannot be empty.');
      return;
    }
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await updateUserProfile(trimmed);
      // Sync Zustand immediately so useMultiplayer re-broadcasts the new name
      // to RTDB presence before the next onAuthStateChanged fires.
      setDisplayName(trimmed);
      setIsOpen(false);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [nameInput, isSaving, setDisplayName]);

  const handleColorSelect = useCallback(
    (color: string) => {
      if (!user) return;

      // 1. Immediate local update — useMultiplayer re-broadcasts on next presence write.
      setPreferredColor(color);

      // 2. Real-time RTDB broadcast so other clients see the change immediately.
      if (boardId) {
        updatePresenceColor(boardId, user.uid, color);
      }

      // 3. Firestore persistence (non-blocking — failure is non-critical).
      updatePreferredColor(color).catch((err: Error) => {
        console.warn('[UserProfileButton] Failed to persist color preference:', err.message);
      });
    },
    [user, boardId, setPreferredColor]
  );

  if (!user) return null;

  const initials = getInitials(displayName, user.email);
  // The avatar uses the user's chosen color, falling back to a neutral indigo.
  const avatarColor = preferredColor ?? '#6366F1';

  return (
    <div ref={popoverRef} className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        title="Edit profile"
        aria-label="Edit profile"
        className="flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: avatarColor }}
      >
        {initials}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
          {/* Display name section */}
          <p className="mb-3 text-sm font-semibold text-gray-800">Display name</p>

          <input
            ref={inputRef}
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value.slice(0, MAX_NAME_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setIsOpen(false);
            }}
            placeholder="Enter your name"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />

          <div className="mt-1 flex items-start justify-between">
            {error ? (
              <p className="text-xs text-red-600">{error}</p>
            ) : (
              <span />
            )}
            <p className="text-xs text-gray-400">
              {nameInput.length}/{MAX_NAME_LENGTH}
            </p>
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !nameInput.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>

          {/* Cursor color section */}
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="mb-2 text-sm font-semibold text-gray-800">Cursor color</p>
            <div className="grid grid-cols-5 gap-2">
              {CURSOR_COLORS.map((color) => {
                const isSelected = preferredColor === color;
                return (
                  <button
                    key={color}
                    onClick={() => handleColorSelect(color)}
                    title={color}
                    aria-label={`Select cursor color ${color}`}
                    className="h-8 w-8 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-400"
                    style={{
                      backgroundColor: color,
                      boxShadow: isSelected
                        ? `0 0 0 2px white, 0 0 0 4px ${color}`
                        : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
