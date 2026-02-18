/**
 * AIStreamMessage — renders a streaming or completed AI response bubble.
 * Shows live streaming content from chatStore.activeStreams while streaming,
 * then displays the persisted content on completion.
 * Provides an inline Undo button that any user can click to rollback AI objects.
 */

'use client';

import { useState, useCallback } from 'react';
import { useChatStore } from '@/lib/store/chatStore';
import { useAuthStore } from '@/lib/store/authStore';
import { deleteObjectsByAiCommand, updateChatMessage } from '@/lib/firebase/firestore';
import type { ChatMessage } from '@/lib/types';

interface AIStreamMessageProps {
  message: ChatMessage;
  boardId: string;
}

function formatTimestamp(createdAt: ChatMessage['createdAt']): string {
  const date =
    typeof createdAt === 'number'
      ? new Date(createdAt)
      : 'toDate' in createdAt
        ? createdAt.toDate()
        : new Date();
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AIStreamMessage({ message, boardId }: AIStreamMessageProps) {
  const activeStreams = useChatStore((s) => s.activeStreams);
  const displayName = useAuthStore((s) => s.displayName);
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoneBy, setUndoneBy] = useState<string | null>(null);

  // Use live stream content while streaming, persisted content when complete
  const activeStream = message.aiCommandId ? activeStreams[message.aiCommandId] : null;
  const isStreaming = message.aiStatus === 'streaming' || activeStream?.status === 'streaming';
  const displayContent = activeStream?.content ?? message.content ?? '';

  const handleUndo = useCallback(async () => {
    if (!message.aiCommandId || isUndoing) return;
    setIsUndoing(true);
    try {
      await deleteObjectsByAiCommand(boardId, message.aiCommandId);
      await updateChatMessage(boardId, message.id, {
        aiStatus: 'failed',
        aiError: `Undone by ${displayName || 'a user'}`,
      });
      setUndoneBy(displayName || 'a user');
    } catch (err) {
      console.error('[AI] Undo failed:', err);
    } finally {
      setIsUndoing(false);
    }
  }, [message.aiCommandId, message.id, boardId, displayName, isUndoing]);

  const isUndone = message.aiStatus === 'failed' && message.aiError?.startsWith('Undone by');

  return (
    <div className="flex justify-start mb-1">
      <div className="max-w-[85%]">
        <div className="flex items-center gap-1.5 mb-0.5">
          <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-sm">
            ✨
          </div>
          <span className="text-xs text-gray-500">AI Assistant</span>
          {isStreaming && (
            <span className="text-xs text-indigo-400 animate-pulse">typing…</span>
          )}
        </div>

        <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-indigo-50 border border-indigo-100 text-sm text-gray-900">
          {displayContent ? (
            <span className="whitespace-pre-wrap break-words">{displayContent}</span>
          ) : (
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
            </span>
          )}

          {/* Error / undo state */}
          {message.aiStatus === 'failed' && message.aiError && (
            <div className="mt-2 px-2 py-1.5 rounded bg-red-50 border border-red-200 text-xs text-red-600">
              {message.aiError}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-gray-400">{formatTimestamp(message.createdAt)}</span>

          {/* Undo button — shown on completed, non-undone responses */}
          {!isStreaming && !isUndone && message.aiStatus === 'completed' && (
            <button
              onClick={handleUndo}
              disabled={isUndoing}
              className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isUndoing ? 'Undoing…' : 'Undo'}
            </button>
          )}

          {/* Undone status */}
          {undoneBy && (
            <span className="text-xs text-gray-400 italic">(Undone by {undoneBy})</span>
          )}
          {isUndone && !undoneBy && (
            <span className="text-xs text-gray-400 italic">{message.aiError}</span>
          )}
        </div>
      </div>
    </div>
  );
}
