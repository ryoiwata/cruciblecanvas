/**
 * ChatTimeline — scrollable chat message list.
 * Auto-scrolls to bottom on new messages unless user has scrolled up.
 * Supports infinite scroll (load older messages on scroll to top).
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '@/lib/store/chatStore';
import type { ChatMode } from '@/lib/store/chatStore';
import { useAuthStore } from '@/lib/store/authStore';
import { loadOlderMessages } from '@/lib/firebase/firestore';
import { Timestamp } from 'firebase/firestore';
import ChatMessageComponent from './ChatMessage';
import AIStreamMessage from './AIStreamMessage';
import type { ChatMessage, ChatMessageType } from '@/lib/types';

interface ChatTimelineProps {
  boardId: string;
}

// Firestore Timestamp check — used for pagination
function isFirestoreTimestamp(val: unknown): val is Timestamp {
  return val instanceof Timestamp;
}

/** Message types surfaced in each chat mode. */
const MODE_TYPES: Record<ChatMode, ChatMessageType[]> = {
  ai: ['ai_command', 'ai_response', 'system'],
  group: ['group', 'system'],
};

export default function ChatTimeline({ boardId }: ChatTimelineProps) {
  const allMessages = useChatStore((s) => s.messages);
  const chatMode = useChatStore((s) => s.chatMode);
  const setMessages = useChatStore((s) => s.setMessages);
  const userId = useAuthStore((s) => s.user?.uid);

  // Only show messages that belong to the active chat mode
  const messages = allMessages.filter((m) => MODE_TYPES[chatMode].includes(m.type));

  const timelineRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);
  const isLoadingOlder = useRef(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (!isUserScrolledUp.current && timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [messages]);

  // Track whether user has scrolled up
  const handleScroll = useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    isUserScrolledUp.current = !isAtBottom;
  }, []);

  // IntersectionObserver on sentinel at top for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isLoadingOlder.current) return;
        if (messages.length === 0) return;

        const oldest = messages[0];
        if (!oldest?.createdAt) return;

        isLoadingOlder.current = true;
        try {
          const olderTimestamp = isFirestoreTimestamp(oldest.createdAt)
            ? oldest.createdAt
            : null;

          if (olderTimestamp) {
            const older = await loadOlderMessages(boardId, olderTimestamp, 50);
            if (older.length > 0) {
              setMessages([...older, ...messages]);
            }
          }
        } catch (err) {
          console.error('[Chat] Failed to load older messages:', err);
        } finally {
          isLoadingOlder.current = false;
        }
      },
      { root: timelineRef.current, threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [boardId, messages, setMessages]);

  const renderMessage = (message: ChatMessage) => {
    const isOwn = message.senderId === userId;

    // AI response messages may be actively streaming
    if (message.type === 'ai_response') {
      return (
        <AIStreamMessage
          key={message.id}
          message={message}
          boardId={boardId}
        />
      );
    }

    return (
      <ChatMessageComponent
        key={message.id}
        message={message}
        isOwnMessage={isOwn}
        boardId={boardId}
      />
    );
  };

  return (
    <div
      ref={timelineRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5"
    >
      {/* Scroll sentinel for loading older messages */}
      <div ref={sentinelRef} className="h-px" />

      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 text-center px-4">
          {chatMode === 'ai' ? (
            <>
              <p className="text-2xl mb-1">✨</p>
              <p className="text-sm text-gray-400">No AI messages yet</p>
              <p className="text-xs text-gray-300 mt-1">
                Type a command and the AI agent will respond here
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl mb-1">👥</p>
              <p className="text-sm text-gray-400">No group messages yet</p>
              <p className="text-xs text-gray-300 mt-1">
                Send a message to start the conversation
              </p>
            </>
          )}
        </div>
      )}

      {messages.map(renderMessage)}
    </div>
  );
}
