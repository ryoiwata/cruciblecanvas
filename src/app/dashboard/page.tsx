"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import { signOutUser } from "@/lib/firebase/auth";
import { createBoardMetadata } from "@/lib/firebase/firestore";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);
  const isLoading = useAuthStore((s) => s.isLoading);
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">Not signed in. Redirecting...</p>
      </div>
    );
  }

  const handleNewBoard = async () => {
    if (creating) return; // Prevent double-click
    setCreating(true);
    try {
      const boardId = crypto.randomUUID();
      await createBoardMetadata(boardId, user.uid, "Untitled Board");
      router.push(`/board/${boardId}`);
    } catch (err) {
      console.error("Failed to create board:", err);
      setCreating(false);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    router.replace("/auth");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">CrucibleCanvas</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">
              {displayName || user.displayName || "Guest"}
            </span>
            <button
              onClick={handleSignOut}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Your Boards</h2>
          <button
            onClick={handleNewBoard}
            disabled={creating}
            className="rounded-md bg-[#6366f1] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#4f46e5] disabled:opacity-50"
          >
            {creating ? "Creating..." : "New Board"}
          </button>
        </div>

        {/* Board list stub */}
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-12 text-center">
          <p className="text-gray-400">
            Your boards will appear here. Click &quot;New Board&quot; to get started.
          </p>
        </div>
      </main>
    </div>
  );
}
