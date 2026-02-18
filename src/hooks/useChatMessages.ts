/**
 * useChatMessages — subscribes to Firestore chat messages for a board.
 * Loads the last 20 messages eagerly on mount for badge count and notifications.
 * Increments unread count when the sidebar is closed.
 */

'use client';

import { useEffect, useRef } from 'react';
import { onChatMessages } from '@/lib/firebase/firestore';
import { useChatStore } from '@/lib/store/chatStore';
import type { ChatMessage } from '@/lib/types';

const EAGER_LOAD_LIMIT = 20;

export function useChatMessages(boardId: string | undefined): void {
  const setMessages = useChatStore((s) => s.setMessages);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const incrementUnread = useChatStore((s) => s.incrementUnread);

  // Track the count of messages seen so far to detect new ones
  const prevMessageCount = useRef(0);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    if (!boardId) return;

    const unsubscribe = onChatMessages(boardId, EAGER_LOAD_LIMIT, (msgs: ChatMessage[]) => {
      setMessages(msgs);

      // Skip incrementing unread on the initial load
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        prevMessageCount.current = msgs.length;
        return;
      }

      // Increment unread only when sidebar is closed and new messages arrive
      const newCount = msgs.length - prevMessageCount.current;
      if (newCount > 0 && !sidebarOpen) {
        for (let i = 0; i < newCount; i++) {
          incrementUnread();
        }
      }
      prevMessageCount.current = msgs.length;
    });

    return () => {
      unsubscribe();
      isFirstLoad.current = true;
      prevMessageCount.current = 0;
    };
  }, [boardId, setMessages, sidebarOpen, incrementUnread]);
}
