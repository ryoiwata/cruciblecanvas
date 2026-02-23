"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBoardMetadata } from "@/lib/firebase/firestore";
import { signInAsGuest, signInWithGoogle } from "@/lib/firebase/auth";

interface AuthCardProps {
  redirectUrl?: string | null;
}

export default function AuthCard({ redirectUrl }: AuthCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleGuest = async () => {
    setError(null);
    setLoading(true);
    try {
      const credential = await signInAsGuest();
      if (redirectUrl) {
        // Guest is joining a shared board link — navigate there directly
        router.push(redirectUrl);
      } else {
        // Auto-create a board and redirect guest directly to it
        const boardId = crypto.randomUUID();
        await createBoardMetadata(boardId, credential.user.uid, 'Untitled Board');
        router.push('/board/' + boardId);
      }
    } catch (err) {
      console.error('Guest sign-in failed:', err);
      setError('Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      router.push(redirectUrl || '/dashboard');
    } catch (err) {
      console.error('Google sign-in failed:', err);
      setError('Sign-in failed. Please allow popups for this site.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
      {/* Header */}
      <h1 className="mb-1 text-center text-2xl font-bold text-gray-900">
        CrucibleCanvas
      </h1>
      <p className="mb-8 text-center text-sm text-gray-500">
        Strategic Thinking Canvas
      </p>

      {/* Google sign-in — primary action */}
      <button
        onClick={handleGoogle}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Sign in with Google
      </button>

      {/* Divider */}
      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400">or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      {/* Continue as Guest — secondary action */}
      <button
        onClick={handleGuest}
        disabled={loading}
        className="w-full rounded-md border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
      >
        {loading ? 'Signing in...' : 'Continue as Guest'}
      </button>

      {/* Error message */}
      {error && (
        <p className="mt-4 text-center text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
