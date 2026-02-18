import { useEffect, useRef, useState, useCallback } from "react";
import {
  setPresence,
  removePresence,
  removeCursor,
  setupPresenceDisconnect,
  setupCursorDisconnect,
  cancelPresenceDisconnect,
  cancelCursorDisconnect,
  updatePresenceTimestamp,
  getPresenceSnapshot,
  onPresenceChildEvents,
  onConnectionStateChange,
} from "@/lib/firebase/rtdb";
import { usePresenceStore } from "@/lib/store/presenceStore";
import { getUserColor } from "@/lib/utils";
import { presenceLogger } from "@/lib/debug/presenceLogger";
import type { PresenceData } from "@/lib/types";
import type { User } from "firebase/auth";

interface UseMultiplayerOptions {
  boardId: string;
  user: User | null;
  displayName: string | null;
}

interface UseMultiplayerReturn {
  /** Whether the RTDB WebSocket is currently connected */
  isConnected: boolean;
}

const HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_RETRY_DELAYS = [500, 1_000, 2_000, 5_000]; // Exponential backoff steps

/**
 * Comprehensive multiplayer hook that consolidates:
 * - RTDB connection state monitoring (.info/connected)
 * - Presence initialization with one-time onDisconnect registration
 * - Lightweight heartbeat (updatePresenceTimestamp, not full setPresence)
 * - Visibility-aware heartbeat (pause when tab hidden)
 * - Initial one-shot presence snapshot (fixes "Empty User List" on join)
 * - Granular child listeners for incremental updates
 * - Cursor disconnect handler
 * - Automatic presence re-establishment on reconnect with exponential backoff
 * - Offline presence pruning (removes stale offline entries from store)
 */
export function useMultiplayer({
  boardId,
  user,
  displayName,
}: UseMultiplayerOptions): UseMultiplayerReturn {
  const [isConnected, setIsConnected] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasConnectedRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  // Build presence data (stable across renders for same inputs)
  const buildPresenceData = useCallback(
    (): Omit<PresenceData, "online" | "lastSeen"> | null => {
      if (!user) return null;
      return {
        name: displayName || "Guest",
        email: user.email || undefined,
        photoURL: user.photoURL || undefined,
        color: getUserColor(user.uid),
        isAnonymous: user.isAnonymous,
      };
    },
    [user, displayName]
  );

  // Retry helper with exponential backoff
  const scheduleRetry = useCallback(
    (fn: () => void) => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      const delay =
        RECONNECT_RETRY_DELAYS[
          Math.min(retryCountRef.current, RECONNECT_RETRY_DELAYS.length - 1)
        ];
      retryCountRef.current++;
      presenceLogger.writeError(
        "scheduleRetry",
        `Attempt ${retryCountRef.current}, next retry in ${delay}ms`
      );
      retryTimeoutRef.current = setTimeout(fn, delay);
    },
    []
  );

  // --- Connection state monitoring ---
  // Re-establishes presence + disconnect handlers on reconnect.
  useEffect(() => {
    const unsubscribe = onConnectionStateChange((connected) => {
      setIsConnected(connected);

      if (connected && !wasConnectedRef.current && user && boardId) {
        const presenceData = buildPresenceData();
        if (presenceData) {
          presenceLogger.reconnectPresence(user.uid);
          retryCountRef.current = 0; // Reset backoff on successful connect

          // Re-establish full presence + both disconnect handlers
          setPresence(boardId, user.uid, presenceData);
          setupPresenceDisconnect(boardId, user.uid);
          setupCursorDisconnect(boardId, user.uid);
        }
      }

      if (!connected && wasConnectedRef.current && user && boardId) {
        // Connection dropped — schedule retry in case auto-reconnect fails
        const presenceData = buildPresenceData();
        if (presenceData) {
          scheduleRetry(() => {
            // Only retry if still disconnected when timeout fires
            if (!wasConnectedRef.current) {
              presenceLogger.writeError(
                "reconnectRetry",
                "Auto-reconnect hasn't fired, presence may be stale"
              );
            }
          });
        }
      }

      wasConnectedRef.current = connected;
    });

    return () => {
      unsubscribe();
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [boardId, user, buildPresenceData, scheduleRetry]);

  // --- Presence subscription: initial snapshot + granular listeners ---
  // The initial get() eagerly populates the store so the online user list
  // isn't empty during the brief window before onChildAdded fires.
  useEffect(() => {
    if (!boardId || !user) return;

    const store = usePresenceStore.getState();
    let cancelled = false;

    // Step 1: One-shot snapshot to seed the store immediately.
    // This fixes the "Empty User List" on initial join — the snapshot
    // resolves before onChildAdded fires for existing children.
    getPresenceSnapshot(boardId)
      .then((snapshot) => {
        if (cancelled || !snapshot) return;

        const now = Date.now();
        for (const [userId, data] of Object.entries(snapshot)) {
          // Prune clearly-offline entries (offline for >60s) from the snapshot
          // to avoid showing ghost users who crashed without cleanup.
          if (!data.online && now - data.lastSeen > 60_000) continue;

          presenceLogger.presenceAdded(userId, data);
          store.upsertPresence(userId, data);
        }
      })
      .catch((err) => {
        presenceLogger.writeError("getPresenceSnapshot", err);
      });

    // Step 2: Granular child listeners for incremental updates.
    // onChildAdded fires for existing children too, so the store
    // converges even if the snapshot was slightly stale.
    const unsubscribe = onPresenceChildEvents(boardId, {
      onAdd: (userId, data) => {
        if (!cancelled) store.upsertPresence(userId, data);
      },
      onChange: (userId, data) => {
        if (!cancelled) store.upsertPresence(userId, data);
      },
      onRemove: (userId) => {
        if (!cancelled) store.removePresence(userId);
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
      usePresenceStore.getState().setPresence({});
    };
  }, [boardId, user]);

  // --- Presence initialization + heartbeat + disconnect handlers ---
  useEffect(() => {
    if (!user || !boardId) return;

    const presenceData = buildPresenceData();
    if (!presenceData) return;

    // Set initial full presence
    setPresence(boardId, user.uid, presenceData);
    presenceLogger.presenceSet(user.uid, presenceData);

    // Register disconnect handlers ONCE (not on every heartbeat)
    setupPresenceDisconnect(boardId, user.uid);
    setupCursorDisconnect(boardId, user.uid);

    // Heartbeat: lightweight timestamp-only update every 15s.
    // Uses updatePresenceTimestamp() instead of full setPresence()
    // to reduce bandwidth and avoid re-registering onDisconnect.
    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeatRef.current = setInterval(() => {
        updatePresenceTimestamp(boardId, user.uid);
      }, HEARTBEAT_INTERVAL_MS);
    };

    const stopHeartbeat = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };

    startHeartbeat();

    const handleVisibility = () => {
      if (document.hidden) {
        stopHeartbeat();
      } else {
        // Tab visible — immediate full presence update (in case data changed
        // while tab was hidden) + restart lightweight heartbeat
        setPresence(boardId, user.uid, presenceData);
        presenceLogger.presenceSet(user.uid, presenceData);
        // Re-register disconnect in case it was lost during hidden period
        setupPresenceDisconnect(boardId, user.uid);
        startHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopHeartbeat();
      document.removeEventListener("visibilitychange", handleVisibility);
      // Cancel onDisconnect handlers BEFORE removing nodes to prevent
      // ghost re-creation (onDisconnect would re-create partial nodes)
      cancelPresenceDisconnect(boardId, user.uid);
      cancelCursorDisconnect(boardId, user.uid);
      removePresence(boardId, user.uid);
      removeCursor(boardId, user.uid);
      presenceLogger.presenceRemoved(user.uid);
      presenceLogger.cursorRemoved(user.uid);
    };
  }, [boardId, user, buildPresenceData]);

  return { isConnected };
}
