"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuthStore } from "@/lib/store/authStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { signOutUser } from "@/lib/firebase/auth";
import { useFirestoreSync } from "@/hooks/useFirestoreSync";
import { recordBoardVisit } from "@/lib/firebase/firestore";
import { useLockSync } from "@/hooks/useLockSync";
import { useMultiplayer } from "@/hooks/useMultiplayer";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import Toolbar from "@/components/ui/Toolbar";
import ShortcutLegend from "@/components/ui/ShortcutLegend";
import ContextMenu from "@/components/ui/ContextMenu";
import ColorPicker from "@/components/ui/ColorPicker";
import DeleteDialog from "@/components/ui/DeleteDialog";
import PresenceIndicator from "@/components/ui/PresenceIndicator";
import PrivacyToggle from "@/components/ui/PrivacyToggle";
import ShareButton from "@/components/ui/ShareButton";
import CanvasTitle from "@/components/ui/CanvasTitle";
import SelectionCounter from "@/components/ui/SelectionCounter";

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

  // Auth guard — pass redirect so guests return here after sign-in
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(`/auth?redirect=/board/${boardId}`);
    }
  }, [user, isLoading, router, boardId]);

  // Record board visit for dashboard
  useEffect(() => {
    if (user && !user.isAnonymous) {
      recordBoardVisit(user.uid, boardId).catch(console.error);
    }
  }, [user, boardId]);

  // Firestore object sync — only after auth resolves
  useFirestoreSync(user ? boardId : undefined);

  // RTDB lock sync — only after auth resolves
  useLockSync(user ? boardId : undefined);

  // Multiplayer: presence sync, heartbeat, connection monitoring, cursor cleanup
  useMultiplayer({ boardId, user, displayName });

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
      <CanvasTitle boardId={boardId} />

      {/* Top-right header controls */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <PrivacyToggle boardId={boardId} />
        <ShareButton boardId={boardId} />
        <PresenceIndicator />
        <div className="mx-1 h-6 w-px bg-gray-200" />
        <button
          onClick={() => router.push("/dashboard")}
          className="rounded-md bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-gray-900"
        >
          Dashboard
        </button>
        <button
          onClick={async () => {
            await signOutUser();
            router.replace("/auth");
          }}
          className="rounded-md bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-red-600"
        >
          Log Off
        </button>
      </div>

      <Canvas boardId={boardId} />
      <ContextMenu boardId={boardId} />
      <ColorPicker boardId={boardId} />
      <SelectionCounter />

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
