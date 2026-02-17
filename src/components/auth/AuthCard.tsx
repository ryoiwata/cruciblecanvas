"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { createBoardMetadata } from "@/lib/firebase/firestore";
import {
  signInAsGuest,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
} from "@/lib/firebase/auth";
import { useAuthStore } from "@/lib/store/authStore";
import { FirebaseError } from "firebase/app";

export default function AuthCard() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const setStoreName = useAuthStore((s) => s.setDisplayName);

  function friendlyError(err: unknown): string {
    if (err instanceof FirebaseError) {
      switch (err.code) {
        case "auth/user-not-found":
          return "No account found with that email.";
        case "auth/wrong-password":
        case "auth/invalid-credential":
          return "Incorrect password. Please try again.";
        case "auth/invalid-email":
          return "Please enter a valid email address.";
        case "auth/email-already-in-use":
          return "An account with that email already exists.";
        case "auth/weak-password":
          return "Password must be at least 6 characters.";
        case "auth/too-many-requests":
          return "Too many attempts. Please try again later.";
      }
    }
    return "Sign-in failed. Please try again.";
  }

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
      const profileRef = doc(db, "users", credential.user.uid, "profile", "info");
      await setDoc(profileRef, { displayName: trimmed }, { merge: true });
      setStoreName(trimmed);

      // Auto-create a board and redirect guest directly to it
      const boardId = crypto.randomUUID();
      await createBoardMetadata(boardId, credential.user.uid, "Untitled Board");
      router.push("/board/" + boardId);
    } catch (err) {
      console.error("Guest sign-in failed:", err);
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async () => {
    if (!email.trim() || !password) {
      setError("Please enter both email and password.");
      return;
    }
    if (isSignUp && !displayName.trim()) {
      setError("Please enter a display name to create an account.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(email.trim(), password, displayName.trim());
      } else {
        await signInWithEmail(email.trim(), password);
      }
      router.push("/dashboard");
    } catch (err) {
      console.error("Email sign-in failed:", err);
      setError(friendlyError(err));
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

      {/* Email/Password form */}
      <div className="mb-4 flex flex-col gap-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          disabled={loading}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleEmailSubmit();
          }}
          placeholder="Password"
          disabled={loading}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          onClick={handleEmailSubmit}
          disabled={loading}
          className="w-full rounded-md bg-[#6366f1] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4f46e5] disabled:opacity-50"
        >
          {loading
            ? "Signing in..."
            : isSignUp
              ? "Create Account"
              : "Sign In"}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp);
            setError(null);
          }}
          disabled={loading}
          className="text-sm text-[#6366f1] hover:underline disabled:opacity-50"
        >
          {isSignUp
            ? "Already have an account? Sign in"
            : "Need an account? Create one"}
        </button>
      </div>

      {/* Divider */}
      <div className="mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400">or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      {/* Google button */}
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

      {/* Error message */}
      {error && (
        <p className="mt-4 text-center text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
