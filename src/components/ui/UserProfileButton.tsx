'use client';

/**
 * UserProfileButton — a small avatar button in the TopHeader that lets any
 * authenticated user (including anonymous guest) edit their display name.
 *
 * On save, `updateUserProfile` writes to Firebase Auth + Firestore and then
 * `setDisplayName` updates the Zustand store. The updated name propagates to
 * RTDB presence automatically because `useMultiplayer`'s `buildPresenceData`
 * callback has `displayName` in its deps, causing the presence effect to re-run
 * and call `setPresence` with the new name.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/store/authStore';
import { updateUserProfile } from '@/lib/firebase/auth';

const MAX_NAME_LENGTH = 25;

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

export default function UserProfileButton() {
  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);
  const setDisplayName = useAuthStore((s) => s.setDisplayName);

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

  if (!user) return null;

  const initials = getInitials(displayName, user.email);

  return (
    <div ref={popoverRef} className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        title="Edit display name"
        aria-label="Edit display name"
        className="flex items-center justify-center h-7 w-7 rounded-full bg-indigo-500 text-xs font-semibold text-white transition-opacity hover:opacity-90"
      >
        {initials}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
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
        </div>
      )}
    </div>
  );
}
