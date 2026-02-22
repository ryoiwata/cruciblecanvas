"use client";

import { useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuthStore } from "@/lib/store/authStore";
import { useObjectStore } from "@/lib/store/objectStore";
import { useCanvasStore } from "@/lib/store/canvasStore";
import type { BoardObject, CursorData } from "@/lib/types";
import { useChatStore } from "@/lib/store/chatStore";
import { signInAsGuest, signOutUser } from "@/lib/firebase/auth";
import { auth } from "@/lib/firebase/config";
import { useFirestoreSync } from "@/hooks/useFirestoreSync";
import { recordBoardVisit, createObject, updateObject, generateObjectId } from "@/lib/firebase/firestore";
import { setCursor, onCursorChildEvents } from "@/lib/firebase/rtdb";
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

// Module-level guard: ensures the bypass auto-sign-in useEffect and the
// __perfSignInAsGuest window helper never call signInAsGuest() concurrently.
// Concurrent calls cause writeUserProfile (setDoc) to hang indefinitely because
// both callers race on the same Firestore document write. By sharing a single
// in-flight promise, the second caller simply awaits the first.
let _perfBypassSignInGuard: Promise<void> | null = null;

function getPerfBypassSignIn(): Promise<void> {
  // If a sign-in is already in progress, return the same promise so both
  // callers resolve together instead of issuing parallel Firestore writes.
  if (_perfBypassSignInGuard) return _perfBypassSignInGuard;
  // If Firebase already has a current user (restored from IndexedDB or from a
  // previous sign-in in this context), there is nothing to do.
  if (auth.currentUser) return Promise.resolve();
  _perfBypassSignInGuard = signInAsGuest()
    .then(() => {
      _perfBypassSignInGuard = null;
    })
    .catch((err: Error) => {
      _perfBypassSignInGuard = null;
      console.warn("[PerfBypass] Anonymous sign-in failed:", err.message);
    });
  return _perfBypassSignInGuard;
}

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

  // In perf bypass mode the auth guard is skipped, but Firestore security rules
  // still require a valid auth token for board reads. Signing in anonymously
  // satisfies the rules (public boards allow any authenticated user) and lets
  // useFirestoreSync stream objects without a manual login step.
  // Uses getPerfBypassSignIn() so this useEffect and __perfSignInAsGuest share
  // the same in-flight promise and never issue concurrent Firestore writes.
  useEffect(() => {
    if (!IS_PERF_BYPASS || user) return;
    getPerfBypassSignIn();
  }, [user]);

  // Expose getPerfBypassSignIn on window so the Playwright bypassAuth() helper
  // can trigger anonymous sign-in directly via page.evaluate. Uses the same
  // module-level guard as the bypass useEffect above, so calling this while a
  // sign-in is already in progress awaits the existing promise rather than
  // issuing a second concurrent signInAsGuest() call.
  // Scoped strictly to bypass mode — never active in production builds.
  useEffect(() => {
    if (!IS_PERF_BYPASS) return;
    const w = window as Window & { __perfSignInAsGuest?: () => Promise<void> };
    w.__perfSignInAsGuest = getPerfBypassSignIn;
    return () => {
      delete w.__perfSignInAsGuest;
    };
  }, []);

  // Expose Playwright helpers for performance and sync tests.
  // All helpers are active only in bypass mode — never in production.
  useEffect(() => {
    if (!IS_PERF_BYPASS) return;

    const w = window as Window & {
      // ── Capacity test helpers ──────────────────────────────────────────────
      // Injects objects directly into the Zustand store, bypassing Firestore.
      __perfSeedObjects?: (objects: Record<string, unknown>[]) => number;
      // Reads the live object count from the Zustand store (not from Konva,
      // which only holds spatially-visible Groups due to R-tree culling).
      __perfGetObjectCount?: () => number;
      // Updates the canvas viewport (x, y, scale) via canvasStore so the
      // Konva stage and the R-tree culling logic stay in sync.
      __perfSetViewport?: (x: number, y: number, scale: number) => void;

      // ── Two-browser sync test helpers ─────────────────────────────────────
      // Generate a Firestore document ID without writing (for pre-coordination).
      __perfGenerateObjectId?: (boardId: string) => string;
      // Write a new object to Firestore and return Date.now() at write time.
      __perfCreateObject?: (
        boardId: string,
        id: string,
        data: Record<string, unknown>,
      ) => Promise<number>;
      // Update an existing Firestore object and return Date.now() at write time.
      __perfUpdateObject?: (
        boardId: string,
        id: string,
        updates: Record<string, unknown>,
      ) => Promise<number>;
      // Poll the Zustand store until objectId appears. Returns Date.now() when
      // found, or -1 after timeoutMs.
      __perfWaitForObjectId?: (id: string, timeoutMs: number) => Promise<number>;
      // Poll until objects[id][field] === expected. Returns Date.now() or -1.
      __perfWaitForObjectField?: (
        id: string,
        field: string,
        expected: unknown,
        timeoutMs: number,
      ) => Promise<number>;
      // Return the current user's Firebase UID (null when not yet signed in).
      __perfGetUserId?: () => string | null;
      // Write a cursor to RTDB and return Date.now() as the write timestamp.
      __perfWriteCursor?: (
        boardId: string,
        uid: string,
        x: number,
        y: number,
        name: string,
      ) => number;
      // Subscribe to RTDB cursor events and resolve with Date.now() when a
      // cursor from targetUid arrives with timestamp ≥ minTimestamp.
      __perfWaitForCursor?: (
        boardId: string,
        targetUid: string,
        minTimestamp: number,
        timeoutMs: number,
      ) => Promise<number>;
    };

    // ── Capacity helpers ─────────────────────────────────────────────────────
    w.__perfSeedObjects = (objects) => {
      useObjectStore.getState().batchUpsert(objects as unknown as BoardObject[]);
      return objects.length;
    };

    w.__perfGetObjectCount = () =>
      Object.keys(useObjectStore.getState().objects).length;

    w.__perfSetViewport = (x, y, scale) =>
      useCanvasStore.getState().setViewport(x, y, scale);

    // ── Two-browser sync helpers ─────────────────────────────────────────────
    w.__perfGenerateObjectId = (boardId) => generateObjectId(boardId);

    w.__perfCreateObject = async (boardId, id, data) => {
      const t0 = Date.now();
      await createObject(
        boardId,
        data as Omit<BoardObject, 'id' | 'createdAt' | 'updatedAt'>,
        id,
      );
      return t0;
    };

    w.__perfUpdateObject = async (boardId, id, updates) => {
      const t0 = Date.now();
      await updateObject(boardId, id, updates as Partial<BoardObject>);
      return t0;
    };

    w.__perfWaitForObjectId = (id, timeoutMs) =>
      new Promise<number>((resolve) => {
        const deadline = Date.now() + timeoutMs;
        function poll() {
          if (useObjectStore.getState().objects[id]) {
            resolve(Date.now());
          } else if (Date.now() >= deadline) {
            resolve(-1);
          } else {
            setTimeout(poll, 20);
          }
        }
        poll();
      });

    w.__perfWaitForObjectField = (id, field, expected, timeoutMs) =>
      new Promise<number>((resolve) => {
        const deadline = Date.now() + timeoutMs;
        function poll() {
          const obj = useObjectStore.getState().objects[id];
          if (obj && (obj as Record<string, unknown>)[field] === expected) {
            resolve(Date.now());
          } else if (Date.now() >= deadline) {
            resolve(-1);
          } else {
            setTimeout(poll, 20);
          }
        }
        poll();
      });

    w.__perfGetUserId = () => useAuthStore.getState().user?.uid ?? null;

    w.__perfWriteCursor = (boardId, uid, x, y, name) => {
      const t0 = Date.now();
      setCursor(boardId, uid, { x, y, name, color: '#6366f1', timestamp: t0 });
      return t0;
    };

    w.__perfWaitForCursor = (boardId, targetUid, minTimestamp, timeoutMs) =>
      new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Cursor for ${targetUid} not received within ${timeoutMs}ms`)),
          timeoutMs,
        );
        const unsub = onCursorChildEvents(boardId, {
          onAdd: (uid, data: CursorData) => {
            if (uid === targetUid && data.timestamp >= minTimestamp) {
              clearTimeout(timer);
              unsub();
              resolve(Date.now());
            }
          },
          onChange: (uid, data: CursorData) => {
            if (uid === targetUid && data.timestamp >= minTimestamp) {
              clearTimeout(timer);
              unsub();
              resolve(Date.now());
            }
          },
          onRemove: () => {},
        });
      });

    return () => {
      delete w.__perfSeedObjects;
      delete w.__perfGetObjectCount;
      delete w.__perfSetViewport;
      delete w.__perfGenerateObjectId;
      delete w.__perfCreateObject;
      delete w.__perfUpdateObject;
      delete w.__perfWaitForObjectId;
      delete w.__perfWaitForObjectField;
      delete w.__perfGetUserId;
      delete w.__perfWriteCursor;
      delete w.__perfWaitForCursor;
    };
  }, []);

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
