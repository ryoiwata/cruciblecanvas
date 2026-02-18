"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import { signOutUser } from "@/lib/firebase/auth";
import {
  createBoardMetadata,
  getUserBoards,
  getVisitedBoards,
} from "@/lib/firebase/firestore";
import type { BoardMetadata } from "@/lib/types";
import type { Timestamp } from "firebase/firestore";

/** Convert a Firestore Timestamp or epoch number to relative time string. */
function timeAgo(ts: Timestamp | number): string {
  const ms = typeof ts === "number" ? ts : ts.toMillis();
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Extract boardId from a URL or plain ID string. */
function extractBoardId(input: string): string {
  const trimmed = input.trim();
  // Try to match /board/{boardId} pattern in a URL
  const urlMatch = trimmed.match(/\/board\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // Otherwise treat the whole input as a board ID
  return trimmed;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);
  const isLoading = useAuthStore((s) => s.isLoading);
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [boards, setBoards] = useState<(BoardMetadata & { boardId: string })[]>([]);
  const [visitedBoards, setVisitedBoards] = useState<(BoardMetadata & { boardId: string; lastVisited?: Timestamp | number })[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  // Fetch user's boards on mount
  useEffect(() => {
    if (!user) return;
    setBoardsLoading(true);

    const fetchBoards = async () => {
      try {
        const [created, visited] = await Promise.all([
          getUserBoards(user.uid),
          getVisitedBoards(user.uid),
        ]);
        setBoards(created);
        // Filter out boards the user created (already shown in "Your Boards")
        const createdIds = new Set(created.map((b) => b.boardId));
        setVisitedBoards(visited.filter((b) => !createdIds.has(b.boardId)));
      } catch (err) {
        console.error("Failed to fetch boards:", err);
      } finally {
        setBoardsLoading(false);
      }
    };

    fetchBoards();
  }, [user]);

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
    if (creating) return;
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

  const handleJoinBoard = () => {
    setJoinError(null);
    const boardId = extractBoardId(joinInput);
    if (!boardId) {
      setJoinError("Please enter a board ID or URL.");
      return;
    }
    router.push(`/board/${boardId}`);
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
        {/* Join Board */}
        <div className="mb-8 flex items-center gap-3">
          <input
            type="text"
            value={joinInput}
            onChange={(e) => {
              setJoinInput(e.target.value);
              setJoinError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleJoinBoard();
            }}
            placeholder="Paste board ID or URL to join..."
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={handleJoinBoard}
            className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
          >
            Join Board
          </button>
          {joinError && (
            <span className="text-sm text-red-500">{joinError}</span>
          )}
        </div>

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

        {/* Board list */}
        {boardsLoading ? (
          <div className="rounded-lg border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400">Loading boards...</p>
          </div>
        ) : boards.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400">
              No boards yet. Click &quot;New Board&quot; to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <button
                key={board.boardId}
                onClick={() => router.push(`/board/${board.boardId}`)}
                className="flex flex-col rounded-lg border border-gray-200 bg-white p-5 text-left transition-shadow hover:shadow-md"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-base font-medium text-gray-900 truncate">
                    {board.title || "Untitled Board"}
                  </span>
                  <span className="text-xs" title={board.isPublic ? "Public" : "Private"}>
                    {board.isPublic ? "👀" : "🥸"}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {board.createdAt ? timeAgo(board.createdAt) : ""}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Visited boards */}
        {visitedBoards.length > 0 && (
          <>
            <h2 className="mt-10 mb-4 text-xl font-semibold text-gray-900">
              Recently Visited
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visitedBoards.map((board) => (
                <button
                  key={board.boardId}
                  onClick={() => router.push(`/board/${board.boardId}`)}
                  className="flex flex-col rounded-lg border border-gray-200 bg-white p-5 text-left transition-shadow hover:shadow-md"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-base font-medium text-gray-900 truncate">
                      {board.title || "Untitled Board"}
                    </span>
                    <span className="text-xs text-indigo-400">visited</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {board.lastVisited
                      ? `Last visited ${timeAgo(board.lastVisited)}`
                      : board.createdAt
                        ? timeAgo(board.createdAt)
                        : ""}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
