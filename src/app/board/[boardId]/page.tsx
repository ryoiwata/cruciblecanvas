"use client";

import { useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuthStore } from "@/lib/store/authStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useChatStore } from "@/lib/store/chatStore";
import { signOutUser } from "@/lib/firebase/auth";
import { useFirestoreSync } from "@/hooks/useFirestoreSync";
import { recordBoardVisit } from "@/lib/firebase/firestore";
import { useLockSync } from "@/hooks/useLockSync";
import { useMultiplayer } from "@/hooks/useMultiplayer";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useChatMessages } from "@/hooks/useChatMessages";
import { useAIStream } from "@/hooks/useAIStream";
import { useAICommand } from "@/hooks/useAICommand";
import Toolbar from "@/components/ui/Toolbar";
import ShortcutLegend from "@/components/ui/ShortcutLegend";
import PropertiesSidebar from "@/components/properties/PropertiesSidebar";
import ContextMenu from "@/components/ui/ContextMenu";
import DeleteDialog from "@/components/ui/DeleteDialog";
import PresenceIndicator from "@/components/ui/PresenceIndicator";
import PrivacyToggle from "@/components/ui/PrivacyToggle";
import ShareButton from "@/components/ui/ShareButton";
import CanvasTitle from "@/components/ui/CanvasTitle";
import SelectionCounter from "@/components/ui/SelectionCounter";
import ChatSidebar from "@/components/chat/ChatSidebar";
import MessagePreview from "@/components/chat/MessagePreview";
import SelectionActionBar from "@/components/ui/SelectionActionBar";
import SaveToAccountBanner from "@/components/ui/SaveToAccountBanner";

// Dynamic import — Konva requires the DOM, cannot render server-side
const Canvas = dynamic(() => import("@/components/canvas/Canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
      <p className="text-gray-400">Loading canvas...</p>
    </div>
  ),
});

// Skip auth guard and loading checks when running perf benchmarks (dev only).
const IS_PERF_BYPASS = process.env.NEXT_PUBLIC_PERF_BYPASS === "true";

export default function BoardPage() {
  const params = useParams<{ boardId: string }>();
  const router = useRouter();
  const boardId = params.boardId;

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isObjectsLoaded = useObjectStore((s) => s.isLoaded);

  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const sidebarWidth = useChatStore((s) => s.sidebarWidth);
  const toggleSidebar = useChatStore((s) => s.toggleSidebar);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const unreadCount = useChatStore((s) => s.unreadCount);

  // Keyboard shortcuts (delete, copy, paste, duplicate, tool switching)
  const { pendingDelete, setPendingDelete, performDelete, deleteCount } =
    useKeyboardShortcuts({ boardId });

  // Chat message subscription (eager load last 20 for badge/notifications)
  useChatMessages(user ? boardId : undefined);

  // RTDB AI stream relay listener (other users' AI responses)
  useAIStream(user ? boardId : undefined);

  // AI command hook
  const { sendAICommand, isAILoading } = useAICommand(boardId);

  // Auth guard — pass redirect so guests return here after sign-in.
  // Bypassed in perf test mode (NEXT_PUBLIC_PERF_BYPASS=true) to allow
  // Playwright to load the canvas without OAuth flow.
  useEffect(() => {
    if (IS_PERF_BYPASS) return;
    if (!isLoading && !user) {
      router.replace(`/auth?redirect=/board/${boardId}`);
    }
  }, [user, isLoading, router, boardId]);

  // Record board visit for dashboard (all authenticated users)
  useEffect(() => {
    if (user) {
      recordBoardVisit(user.uid, boardId).catch(console.error);
    }
  }, [user, boardId]);

  // Firestore object sync — only after auth resolves
  useFirestoreSync(user ? boardId : undefined);

  // RTDB lock sync — only after auth resolves
  useLockSync(user ? boardId : undefined);

  // Multiplayer: presence sync, heartbeat, connection monitoring, cursor cleanup
  useMultiplayer({ boardId, user, displayName });

  const handleSendAICommand = useCallback(
    (command: string) => {
      sendAICommand(command);
    },
    [sendAICommand]
  );

  // Loading states — skipped in perf bypass mode to render canvas immediately
  if (!IS_PERF_BYPASS && isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">Authenticating...</p>
      </div>
    );
  }

  if (!IS_PERF_BYPASS && !user) {
    return null; // Redirect in progress
  }

  if (!IS_PERF_BYPASS && !isObjectsLoaded) {
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
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Anonymous-user banner — prompts linking to a permanent account */}
      <SaveToAccountBanner />

      {/* LEFT: Properties sidebar — collapses to w-0 when nothing is selected */}
      <PropertiesSidebar boardId={boardId} />

      {/* Main canvas area */}
      <div className="flex-1 relative min-w-0">
        <Toolbar boardId={boardId} />
        <ShortcutLegend />
        <CanvasTitle boardId={boardId} />

        {/* Top-right header controls */}
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2" style={{ right: sidebarOpen ? `${sidebarWidth + 8}px` : '16px', transition: 'right 300ms ease-in-out' }}>
          <PrivacyToggle boardId={boardId} />
          <ShareButton boardId={boardId} />
          <PresenceIndicator />
          <div className="mx-1 h-6 w-px bg-gray-200" />

          {/* Chat toggle button with unread badge */}
          <button
            onClick={toggleSidebar}
            className="relative rounded-md bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-gray-900"
            title="Toggle chat (or press /)"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              {/* Robot head */}
              <rect x="4" y="6" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              {/* Antenna */}
              <line x1="10" y1="6" x2="10" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="10" cy="2.5" r="1" fill="currentColor" />
              {/* Eyes */}
              <circle cx="7.5" cy="10" r="1.2" fill="currentColor" />
              <circle cx="12.5" cy="10" r="1.2" fill="currentColor" />
              {/* Mouth */}
              <path d="M7.5 12.5 Q10 14 12.5 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
              {/* Ear ports */}
              <line x1="1.5" y1="10" x2="4" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="16" y1="10" x2="18.5" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-xs w-4 h-4 flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

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
        <SelectionCounter />
        <SelectionActionBar boardId={boardId} />

        {/* Floating message preview when sidebar is closed */}
        <MessagePreview onOpenSidebar={() => setSidebarOpen(true)} />

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
      </div>

      {/* Chat sidebar — pushes canvas left when open */}
      <ChatSidebar
        boardId={boardId}
        onSendAICommand={handleSendAICommand}
        isAILoading={isAILoading}
      />
    </div>
  );
}
