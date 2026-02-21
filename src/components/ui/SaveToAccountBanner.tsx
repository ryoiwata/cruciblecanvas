'use client';

/**
 * SaveToAccountBanner — dismissible top banner prompting anonymous users to
 * link their session to a permanent Google account.
 *
 * Shown only when `user.isAnonymous === true`. Dismissed state is persisted in
 * localStorage so the banner does not reappear after a page reload.
 */

import { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { useAuthStore } from '@/lib/store/authStore';
import { linkAnonymousToGoogle } from '@/lib/firebase/linkAccount';

/** localStorage key for the dismissed flag. */
const DISMISS_KEY = 'cc_save_banner_dismissed';

export default function SaveToAccountBanner() {
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const user = useAuthStore((s) => s.user);

  const [dismissed, setDismissed] = useState(true); // start hidden to avoid SSR flash
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read localStorage on mount (client-only)
  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (!isAnonymous || !user || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const handleLink = async () => {
    setLinking(true);
    setError(null);
    try {
      const auth = getAuth();
      await linkAnonymousToGoogle(auth);
      // On success the auth state listener in AuthProvider will update the store.
      // The banner will disappear automatically once isAnonymous becomes false.
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/popup-blocked') {
        setError('Popup was blocked. Please allow popups for this site.');
      } else if (code === 'auth/credential-already-in-use') {
        setError('This Google account is already linked to another user.');
      } else {
        setError('Failed to sign in. Please try again.');
      }
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center gap-3 bg-indigo-600 px-4 py-2 text-sm text-white shadow-md">
      <span className="flex-1">
        You&apos;re working anonymously. Sign in to keep your board forever.
      </span>

      {error && (
        <span className="rounded bg-red-500/30 px-2 py-0.5 text-xs">{error}</span>
      )}

      <button
        onClick={handleLink}
        disabled={linking}
        className="shrink-0 rounded bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-60"
      >
        {linking ? 'Connecting…' : 'Sign in with Google'}
      </button>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 hover:bg-white/20"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
