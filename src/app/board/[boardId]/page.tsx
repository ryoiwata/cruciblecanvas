"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuthStore } from "@/lib/store/authStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useFirestoreSync } from "@/hooks/useFirestoreSync";
import { useLockSync } from "@/hooks/useLockSync";
import {
  setPresence,
  removePresence,
  removeCursor,
  setupCursorDisconnect,
} from "@/lib/firebase/rtdb";
import { getUserColor } from "@/lib/utils";
import Toolbar from "@/components/ui/Toolbar";

// Dynamic import — Konva requires the DOM, cannot render server-side
const Canvas = dynamic(() => import("@/components/canvas/Canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
      <p className="text-gray-400">Loading canvas...</p>
    </div>
  ),
});

export default function BoardPage() {
  const params = useParams<{ boardId: string }>();
  const router = useRouter();
  const boardId = params.boardId;

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isObjectsLoaded = useObjectStore((s) => s.isLoaded);

  // Auth guard
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/auth");
    }
  }, [user, isLoading, router]);

  // Firestore object sync — only after auth resolves
  // Pass undefined when not ready so the hook skips subscription
  useFirestoreSync(user ? boardId : undefined);

  // RTDB lock sync — only after auth resolves
  useLockSync(user ? boardId : undefined);

  // Presence + cursor cleanup
  useEffect(() => {
    if (!user) return;

    const color = getUserColor(user.uid);

    setPresence(boardId, user.uid, {
      name: displayName || "Guest",
      email: user.email || undefined,
      photoURL: user.photoURL || undefined,
      color,
      isAnonymous: user.isAnonymous,
    });

    setupCursorDisconnect(boardId, user.uid);

    return () => {
      removePresence(boardId, user.uid);
      removeCursor(boardId, user.uid);
    };
  }, [boardId, user, displayName]);

  // Loading states
  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">Authenticating...</p>
      </div>
    );
  }

  if (!user) {
    return null; // Redirect in progress
  }

  if (!isObjectsLoaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-2 h-8 w-8 mx-auto animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500" />
          <p className="text-gray-400">Loading board...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toolbar />
      <Canvas boardId={boardId} />
    </>
  );
}
