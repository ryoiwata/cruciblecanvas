"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuthStore } from "@/lib/store/authStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useFirestoreSync } from "@/hooks/useFirestoreSync";
import { useLockSync } from "@/hooks/useLockSync";
import { usePresenceSync } from "@/hooks/usePresenceSync";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import {
  setPresence,
  removePresence,
  removeCursor,
  setupCursorDisconnect,
} from "@/lib/firebase/rtdb";
import { getUserColor } from "@/lib/utils";
import Toolbar from "@/components/ui/Toolbar";
import ShortcutLegend from "@/components/ui/ShortcutLegend";
import ContextMenu from "@/components/ui/ContextMenu";
import ColorPicker from "@/components/ui/ColorPicker";
import DeleteDialog from "@/components/ui/DeleteDialog";
import PresenceIndicator from "@/components/ui/PresenceIndicator";
import PrivacyToggle from "@/components/ui/PrivacyToggle";
import ShareButton from "@/components/ui/ShareButton";

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

  // Keyboard shortcuts (delete, copy, paste, duplicate, tool switching)
  const { pendingDelete, setPendingDelete, performDelete, deleteCount } =
    useKeyboardShortcuts({ boardId });

  // Auth guard
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/auth");
    }
  }, [user, isLoading, router]);

  // Firestore object sync — only after auth resolves
  useFirestoreSync(user ? boardId : undefined);

  // RTDB lock sync — only after auth resolves
  useLockSync(user ? boardId : undefined);

  // RTDB presence sync — subscribe to other users' presence
  usePresenceSync(user ? boardId : undefined);

  // Presence + cursor cleanup + heartbeat
  useEffect(() => {
    if (!user) return;

    const color = getUserColor(user.uid);

    const presenceData = {
      name: displayName || "Guest",
      email: user.email || undefined,
      photoURL: user.photoURL || undefined,
      color,
      isAnonymous: user.isAnonymous,
    };

    setPresence(boardId, user.uid, presenceData);
    setupCursorDisconnect(boardId, user.uid);

    // Heartbeat: update lastSeen every 15 seconds while tab is visible
    let heartbeatId: ReturnType<typeof setInterval> | null = setInterval(() => {
      setPresence(boardId, user.uid, presenceData);
    }, 15_000);

    const handleVisibility = () => {
      if (document.hidden) {
        // Tab hidden — stop heartbeat
        if (heartbeatId) {
          clearInterval(heartbeatId);
          heartbeatId = null;
        }
      } else {
        // Tab visible — resume heartbeat + immediate presence update
        setPresence(boardId, user.uid, presenceData);
        if (!heartbeatId) {
          heartbeatId = setInterval(() => {
            setPresence(boardId, user.uid, presenceData);
          }, 15_000);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (heartbeatId) clearInterval(heartbeatId);
      document.removeEventListener("visibilitychange", handleVisibility);
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
      <Toolbar boardId={boardId} />
      <ShortcutLegend />

      {/* Top-right header controls: Privacy toggle, Share button, Presence */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3">
        <PrivacyToggle boardId={boardId} />
        <ShareButton boardId={boardId} />
        <PresenceIndicator />
      </div>

      <Canvas boardId={boardId} />
      <ContextMenu boardId={boardId} />
      <ColorPicker boardId={boardId} />

      {pendingDelete && (
        <DeleteDialog
          count={deleteCount}
          onConfirm={() => {
            performDelete();
            setPendingDelete(false);
          }}
          onCancel={() => setPendingDelete(false)}
        />
      )}
    </>
  );
}
