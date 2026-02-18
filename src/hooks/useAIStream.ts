/**
 * useAIStream — subscribes to RTDB AI streams from other users.
 * When another user issues an @ai command, this hook picks up their
 * live stream and adds it to the chat timeline as a streaming message.
 * When the stream node is removed, it finalizes the message.
 */

'use client';

import { useEffect } from 'react';
import { onAIStreamChildEvents } from '@/lib/firebase/rtdb';
import { useChatStore } from '@/lib/store/chatStore';
import { useAuthStore } from '@/lib/store/authStore';

export function useAIStream(boardId: string | undefined): void {
  const userId = useAuthStore((s) => s.user?.uid);
  const setStream = useChatStore((s) => s.setStream);
  const removeStream = useChatStore((s) => s.removeStream);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const messages = useChatStore((s) => s.messages);

  useEffect(() => {
    if (!boardId || !userId) return;

    const unsubscribe = onAIStreamChildEvents(boardId, {
      onAdded: (commandId, stream) => {
        // Skip our own streams — we manage them locally in useAICommand
        if (stream.requesterId === userId) return;

        // Add the stream to the store for live rendering
        setStream(commandId, stream);

        // If there's no existing message for this commandId, create a placeholder
        const existingMsg = messages.find((m) => m.aiCommandId === commandId);
        if (!existingMsg) {
          addMessage({
            id: `stream-${commandId}`,
            boardId,
            senderId: stream.requesterId,
            senderName: stream.requesterName,
            type: 'ai_response',
            content: stream.content ?? '',
            aiCommandId: commandId,
            aiStatus: 'streaming',
            createdAt: stream.timestamp,
          });
        }
      },
      onChanged: (commandId, stream) => {
        if (stream.requesterId === userId) return;

        // Update the stream in the store (triggers AIStreamMessage re-render)
        setStream(commandId, stream);

        // Also update the placeholder message content
        const msgId = `stream-${commandId}`;
        updateMessage(msgId, {
          content: stream.content ?? '',
          aiStatus: stream.status === 'completed' ? 'completed' : 'streaming',
        });
      },
      onRemoved: (commandId) => {
        removeStream(commandId);
        // The final message will arrive via the Firestore onChatMessages listener
        // Remove the placeholder once the real message is synced
        updateMessage(`stream-${commandId}`, { aiStatus: 'completed' });
      },
    });

    return () => {
      unsubscribe();
    };
  }, [boardId, userId, setStream, removeStream, addMessage, updateMessage, messages]);
}
