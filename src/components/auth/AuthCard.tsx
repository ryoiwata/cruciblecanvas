"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  signInAsGuest,
  signInWithGoogle,
  signInWithGithub,
} from "@/lib/firebase/auth";
import { useAuthStore } from "@/lib/store/authStore";

export default function AuthCard() {
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const setStoreName = useAuthStore((s) => s.setDisplayName);

  const handleGuest = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError("Please enter a display name.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const credential = await signInAsGuest();
      // Write display name to Firestore profile (anonymous users can't set Auth displayName)
      const profileRef = doc(db, "users", credential.user.uid, "profile", "info");
      await setDoc(profileRef, { displayName: trimmed }, { merge: true });
      setStoreName(trimmed);
      router.push("/dashboard");
    } catch (err) {
      console.error("Guest sign-in failed:", err);
      setError("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      router.push("/dashboard");
    } catch (err) {
      console.error("Google sign-in failed:", err);
      setError("Sign-in failed. Please allow popups for this site.");
    } finally {
      setLoading(false);
    }
  };

  const handleGithub = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGithub();
      router.push("/dashboard");
    } catch (err) {
      console.error("GitHub sign-in failed:", err);
      setError("Sign-in failed. Please allow popups for this site.");
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

      {/* Display name input */}
      <div className="mb-4">
        <label
          htmlFor="displayName"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Display Name
        </label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleGuest();
          }}
          placeholder="Enter your name"
          disabled={loading}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
      </div>

      {/* Continue as Guest */}
      <button
        onClick={handleGuest}
        disabled={loading}
        className="mb-6 w-full rounded-md bg-[#6366f1] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4f46e5] disabled:opacity-50"
      >
        {loading ? "Signing in..." : "Continue as Guest"}
      </button>

      {/* Divider */}
      <div className="mb-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400">or sign in with</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      {/* Social buttons */}
      <div className="flex flex-col gap-3">
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

        <button
          onClick={handleGithub}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-900 bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Sign in with GitHub
        </button>
      </div>

      {/* Error message */}
      {error && (
        <p className="mt-4 text-center text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
