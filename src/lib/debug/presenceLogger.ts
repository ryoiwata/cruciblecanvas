/**
 * Debug Logger for presence and cursor packet tracking.
 *
 * Usage (in code):
 *   import { presenceLogger } from '@/lib/debug/presenceLogger';
 *   presenceLogger.enable();
 *
 * Usage (browser console):
 *   window.presenceLogger.enable()
 *   window.presenceLogger.getHistory()   // dump all logged packets
 *   window.presenceLogger.summary()      // packet counts + error rate
 *   window.presenceLogger.dumpLatest(20) // last 20 entries, formatted
 *   window.presenceLogger.clear()        // clear history buffer
 *
 * Or toggle via global flag:
 *   window.__presenceDebug = true
 */

type PacketDirection = "OUT" | "IN";
type PacketType = "cursor" | "presence" | "connection";

interface LogEntry {
  timestamp: number;
  direction: PacketDirection;
  type: PacketType;
  event: string;
  userId?: string;
  data: unknown;
}

interface PacketStats {
  cursorOut: number;
  cursorIn: number;
  presenceOut: number;
  presenceIn: number;
  connectionEvents: number;
  errors: number;
  firstPacketAt: number | null;
  lastPacketAt: number | null;
}

let enabled = false;
const history: LogEntry[] = [];
const MAX_HISTORY = 500;

const stats: PacketStats = {
  cursorOut: 0,
  cursorIn: 0,
  presenceOut: 0,
  presenceIn: 0,
  connectionEvents: 0,
  errors: 0,
  firstPacketAt: null,
  lastPacketAt: null,
};

function isEnabled(): boolean {
  return (
    enabled ||
    (typeof window !== "undefined" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__presenceDebug === true)
  );
}

function updateStats(direction: PacketDirection, type: PacketType, event: string): void {
  const now = Date.now();
  if (!stats.firstPacketAt) stats.firstPacketAt = now;
  stats.lastPacketAt = now;

  if (event.startsWith("WRITE_ERROR")) {
    stats.errors++;
  } else if (type === "cursor") {
    if (direction === "OUT") stats.cursorOut++;
    else stats.cursorIn++;
  } else if (type === "presence") {
    if (direction === "OUT") stats.presenceOut++;
    else stats.presenceIn++;
  } else if (type === "connection") {
    stats.connectionEvents++;
  }
}

function log(
  direction: PacketDirection,
  type: PacketType,
  event: string,
  userId?: string,
  data?: unknown
): void {
  // Always track stats, even when console logging is disabled
  updateStats(direction, type, event);

  if (!isEnabled()) return;

  const entry: LogEntry = {
    timestamp: Date.now(),
    direction,
    type,
    event,
    userId,
    data,
  };

  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();

  const time = new Date(entry.timestamp).toISOString().split("T")[1];
  const prefix = `[${time}] ${direction} ${type}`;

  if (type === "connection") {
    console.log(
      `%c${prefix}: ${event}`,
      "color: #f59e0b; font-weight: bold",
      data ?? ""
    );
  } else if (direction === "OUT") {
    console.log(`%c${prefix}: ${event}`, "color: #06b6d4", userId, data ?? "");
  } else {
    console.log(`%c${prefix}: ${event}`, "color: #22c55e", userId, data ?? "");
  }
}

export const presenceLogger = {
  enable(): void {
    enabled = true;
    console.log("[PresenceLogger] Enabled — tracking all presence/cursor packets");
  },
  disable(): void {
    enabled = false;
    console.log("[PresenceLogger] Disabled");
  },
  isEnabled,
  getHistory(): LogEntry[] {
    return [...history];
  },
  clear(): void {
    history.length = 0;
    Object.assign(stats, {
      cursorOut: 0,
      cursorIn: 0,
      presenceOut: 0,
      presenceIn: 0,
      connectionEvents: 0,
      errors: 0,
      firstPacketAt: null,
      lastPacketAt: null,
    });
    console.log("[PresenceLogger] History and stats cleared");
  },

  /** Print a formatted summary of packet counts and error rate. */
  summary(): void {
    const durationMs = stats.firstPacketAt && stats.lastPacketAt
      ? stats.lastPacketAt - stats.firstPacketAt
      : 0;
    const durationSec = Math.max(1, durationMs / 1000);

    console.log(
      "%c[PresenceLogger] Packet Summary",
      "color: #8b5cf6; font-weight: bold"
    );
    console.table({
      "Cursors OUT": { count: stats.cursorOut, rate: `${(stats.cursorOut / durationSec).toFixed(1)}/s` },
      "Cursors IN": { count: stats.cursorIn, rate: `${(stats.cursorIn / durationSec).toFixed(1)}/s` },
      "Presence OUT": { count: stats.presenceOut, rate: `${(stats.presenceOut / durationSec).toFixed(1)}/s` },
      "Presence IN": { count: stats.presenceIn, rate: `${(stats.presenceIn / durationSec).toFixed(1)}/s` },
      "Connection Events": { count: stats.connectionEvents, rate: "-" },
      "Errors": { count: stats.errors, rate: stats.errors > 0 ? "CHECK LOGS" : "none" },
    });
    console.log(`  Duration: ${durationSec.toFixed(0)}s | History buffer: ${history.length}/${MAX_HISTORY}`);
  },

  /** Print the latest N entries in a compact table. */
  dumpLatest(n = 20): void {
    const entries = history.slice(-n).map((e) => ({
      time: new Date(e.timestamp).toISOString().split("T")[1].slice(0, 12),
      dir: e.direction,
      type: e.type,
      event: e.event,
      userId: e.userId?.slice(0, 8) ?? "-",
      data: e.data ? JSON.stringify(e.data).slice(0, 60) : "-",
    }));
    console.table(entries);
  },

  /** Get raw stats object for programmatic access. */
  getStats(): PacketStats {
    return { ...stats };
  },

  // --- Outbound ---
  cursorSent(userId: string, data: { x: number; y: number }): void {
    log("OUT", "cursor", "cursor_sent", userId, data);
  },
  presenceSet(userId: string, data: unknown): void {
    log("OUT", "presence", "presence_set", userId, data);
  },
  presenceRemoved(userId: string): void {
    log("OUT", "presence", "presence_removed", userId);
  },
  cursorRemoved(userId: string): void {
    log("OUT", "cursor", "cursor_removed", userId);
  },

  // --- Inbound ---
  cursorReceived(userId: string, data: unknown): void {
    log("IN", "cursor", "cursor_received", userId, data);
  },
  cursorChildRemoved(userId: string): void {
    log("IN", "cursor", "cursor_child_removed", userId);
  },
  presenceAdded(userId: string, data: unknown): void {
    log("IN", "presence", "presence_child_added", userId, data);
  },
  presenceChanged(userId: string, data: unknown): void {
    log("IN", "presence", "presence_child_changed", userId, data);
  },
  presenceChildRemoved(userId: string): void {
    log("IN", "presence", "presence_child_removed", userId);
  },

  // --- Connection ---
  connectionStateChanged(connected: boolean): void {
    log(
      "IN",
      "connection",
      connected ? "CONNECTED" : "DISCONNECTED",
      undefined,
      { connected }
    );
  },
  reconnectPresence(userId: string): void {
    log("OUT", "connection", "reconnect_presence_set", userId);
  },
  writeError(operation: string, error: unknown): void {
    log("OUT", "connection", `WRITE_ERROR: ${operation}`, undefined, error);
  },
};

// Expose globally for browser console access
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).presenceLogger = presenceLogger;
}
