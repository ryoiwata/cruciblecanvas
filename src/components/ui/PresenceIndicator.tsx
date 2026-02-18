"use client";

import { useState, useRef, useEffect } from "react";
import { usePresenceStore } from "@/lib/store/presenceStore";
import { useAuthStore } from "@/lib/store/authStore";

const MAX_VISIBLE_AVATARS = 4;
const INACTIVE_THRESHOLD_MS = 30_000; // 30 seconds without heartbeat = inactive

export default function PresenceIndicator() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const presence = usePresenceStore((s) => s.presence);
  const currentUserId = useAuthStore((s) => s.user?.uid);

  // Tick every 10s to update inactive fading
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isExpanded) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isExpanded]);

  const onlineUsers = Object.entries(presence)
    .filter(([, data]) => data.online)
    .map(([id, data]) => ({ id, ...data }));

  // Put current user first
  onlineUsers.sort((a, b) => {
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    return a.name.localeCompare(b.name);
  });

  const visibleUsers = onlineUsers.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = Math.max(0, onlineUsers.length - MAX_VISIBLE_AVATARS);

  if (onlineUsers.length === 0) return null;

  return (
    <div
      ref={dropdownRef}
      className="relative flex items-center gap-2"
    >
      {/* Online count label */}
      <span className="text-xs font-medium text-gray-500 select-none">
        {onlineUsers.length} online
      </span>

      {/* Avatar stack */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center -space-x-2 hover:opacity-90 transition-opacity"
        aria-label="Show online users"
      >
        {visibleUsers.map((user) => {
          const isInactive =
            user.id !== currentUserId &&
            now - user.lastSeen > INACTIVE_THRESHOLD_MS;
          return (
            <div
              key={user.id}
              className="relative flex items-center justify-center w-8 h-8 rounded-full border-2 border-white text-white text-xs font-bold shadow-sm transition-opacity duration-300"
              style={{
                backgroundColor: user.color,
                opacity: isInactive ? 0.4 : 1,
              }}
              title={
                user.id === currentUserId
                  ? `${user.name} (You)`
                  : isInactive
                    ? `${user.name} (Inactive)`
                    : user.name
              }
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          );
        })}
        {overflowCount > 0 && (
          <div className="relative flex items-center justify-center w-8 h-8 rounded-full border-2 border-white bg-gray-400 text-white text-xs font-bold shadow-sm">
            +{overflowCount}
          </div>
        )}
      </button>

      {/* Expanded dropdown */}
      {isExpanded && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
          <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Online — {onlineUsers.length}
          </div>
          {onlineUsers.map((user) => {
            const isInactive =
              user.id !== currentUserId &&
              now - user.lastSeen > INACTIVE_THRESHOLD_MS;
            return (
              <div
                key={user.id}
                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 transition-opacity duration-300"
                style={{ opacity: isInactive ? 0.4 : 1 }}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: user.color }}
                />
                <span className="text-sm text-gray-700 truncate">
                  {user.name}
                </span>
                {user.id === currentUserId && (
                  <span className="text-xs text-indigo-500 font-medium ml-auto">
                    You
                  </span>
                )}
                {isInactive && user.id !== currentUserId && (
                  <span className="text-xs text-gray-400 ml-auto">
                    Idle
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
