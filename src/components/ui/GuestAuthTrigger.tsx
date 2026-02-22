'use client';

/**
 * GuestAuthTrigger — a compact corner pill that prompts anonymous users to
 * link their session to a permanent account via Google Sign-In.
 *
 * Renders only when `user.isAnonymous === true`. On click it triggers the
 * Firebase account-linking flow directly; the AuthProvider's onAuthStateChanged
 * listener updates the store once linking succeeds, which unmounts this
 * component automatically.
 */

import { useState } from 'react';
import { getAuth } from 'firebase/auth';
import { useAuthStore } from '@/lib/store/authStore';
import { linkAnonymousToGoogle } from '@/lib/firebase/linkAccount';

export default function GuestAuthTrigger() {
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const user = useAuthStore((s) => s.user);

  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only render for anonymous sessions that have a Firebase user
  if (!isAnonymous || !user) return null;

  const handleLink = async () => {
    if (linking) return;
    setLinking(true);
    setError(null);
    try {
      const auth = getAuth();
      await linkAnonymousToGoogle(auth);
      // AuthProvider's onAuthStateChanged will flip isAnonymous → false,
      // causing this component to unmount automatically.
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/popup-blocked') {
        setError('Popups blocked — allow popups and try again.');
      } else {
        setError('Sign-in failed. Please try again.');
      }
      setLinking(false);
    }
  };

  return (
    <div className="relative flex items-center">
      <button
        onClick={handleLink}
        disabled={linking}
        title={error ?? 'Link your anonymous session to a permanent Google account'}
        className="flex items-center gap-1.5 rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Google "G" icon */}
        <svg width="12" height="12" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
            fill="#4285F4"
          />
          <path
            d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
            fill="#34A853"
          />
          <path
            d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
            fill="#FBBC05"
          />
          <path
            d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
            fill="#EA4335"
          />
        </svg>
        {linking ? 'Signing in…' : 'Sign up to save'}
      </button>

      {/* Inline error tooltip — shown briefly below the pill */}
      {error && (
        <span className="absolute top-full right-0 mt-1.5 w-52 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 shadow-sm border border-red-200 z-50">
          {error}
        </span>
      )}
    </div>
  );
}
