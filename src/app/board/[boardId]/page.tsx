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
import SubHeaderToolbar from "@/components/ui/SubHeaderToolbar";
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

  const toggleSidebar = useChatStore((s) => s.toggleSidebar);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const unreadCount = useChatStore((s) => s.unreadCount);
  const clarificationPending = useChatStore((s) => s.clarificationPending);

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
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* Anonymous-user banner — prompts linking to a permanent account */}
      <SaveToAccountBanner />

      {/* ── Tier 1: Top Header ─────────────────────────────────────────────── */}
      <header className="flex h-12 w-full shrink-0 items-center border-b border-gray-200 bg-white px-4 z-40">
        {/* Left: Board title */}
        <div className="flex items-center gap-2 min-w-0 mr-4">
          <span className="hidden text-sm font-bold text-indigo-600 tracking-tight sm:inline select-none">
            CrucibleCanvas
          </span>
          <span className="hidden text-gray-300 sm:inline">|</span>
          <CanvasTitle boardId={boardId} inline />
        </div>

        {/* Right: Controls */}
        <div className="ml-auto flex items-center gap-2">
          <PresenceIndicator />
          <div className="h-5 w-px bg-gray-200" />
          <PrivacyToggle boardId={boardId} />
          <ShareButton boardId={boardId} />
          <div className="h-5 w-px bg-gray-200" />

          {/* Chat toggle — chat bubble icon with "Chat" label */}
          <button
            onClick={toggleSidebar}
            title={clarificationPending ? 'Mason is waiting for your reply' : 'Toggle chat (press /)'}
            className="relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M2 3a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H6l-4 4V3z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            <span>Chat</span>
            {/* Clarification-pending pulse — amber, higher priority than unread dot */}
            {clarificationPending ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
              </span>
            ) : unreadCount > 0 ? (
              <span className="absolute -top-0.5 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </button>

          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            Dashboard
          </button>
          <button
            onClick={async () => {
              await signOutUser();
              router.replace("/auth");
            }}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-600"
          >
            Log Off
          </button>
        </div>
      </header>

      {/* ── Tier 2: Sub-header toolbar ─────────────────────────────────────── */}
      <SubHeaderToolbar boardId={boardId} />

      {/* ── Tier 3: Main work area (Properties | Canvas | Chat) ────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* LEFT: Properties sidebar — collapses to w-0 when nothing is selected */}
        <PropertiesSidebar boardId={boardId} />

        {/* CENTER: Canvas */}
        <div className="flex-1 relative min-w-0 overflow-hidden">
          <Canvas boardId={boardId} />
          <ContextMenu boardId={boardId} />

          {/*
           * Bottom-center info stack — all floating canvas overlays collected here
           * so they stay naturally centered within the visible canvas column.
           * Using `absolute` (not `fixed`) means the stack is clipped to this
           * container; no manual sidebar-width offsets required.
           */}
          <div className="absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
            {/* Item count pill — shown when objects are selected */}
            <div className="pointer-events-auto">
              <SelectionCounter />
            </div>
          </div>

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

        {/* RIGHT: Chat sidebar — expands/collapses */}
        <ChatSidebar
          boardId={boardId}
          onSendAICommand={handleSendAICommand}
          isAILoading={isAILoading}
        />
      </div>
    </div>
  );
}
