/**
 * ChatMessage — renders a single chat message based on its type.
 * Handles group messages, system messages, AI commands, and AI responses.
 * Object reference chips are rendered inline within message text.
 */

'use client';

import { memo } from 'react';
import ObjectRefChip from './ObjectRefChip';
import type { ChatMessage as ChatMessageType } from '@/lib/types';

interface ChatMessageProps {
  message: ChatMessageType;
  isOwnMessage: boolean;
  boardId: string;
}

function formatTimestamp(createdAt: ChatMessageType['createdAt']): string {
  const date =
    typeof createdAt === 'number'
      ? new Date(createdAt)
      : 'toDate' in createdAt
        ? createdAt.toDate()
        : new Date();
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Renders message content with inline object reference chips. */
function MessageContent({ message }: { message: ChatMessageType }) {
  if (!message.objectReferences || message.objectReferences.length === 0) {
    return <span className="whitespace-pre-wrap break-words">{message.content}</span>;
  }

  // Replace @[Type: Text] patterns with ObjectRefChip components
  const parts: (string | React.ReactNode)[] = [];
  let remaining = message.content;
  let keyIdx = 0;

  for (const ref of message.objectReferences) {
    const chipPattern = `@[${ref.objectType}: ${ref.objectText}]`;
    const idx = remaining.indexOf(chipPattern);
    if (idx === -1) {
      // Fallback: append chip at end
      parts.push(remaining);
      remaining = '';
      parts.push(<ObjectRefChip key={keyIdx++} reference={ref} />);
    } else {
      parts.push(remaining.slice(0, idx));
      parts.push(<ObjectRefChip key={keyIdx++} reference={ref} />);
      remaining = remaining.slice(idx + chipPattern.length);
    }
  }
  if (remaining) parts.push(remaining);

  return <span className="whitespace-pre-wrap break-words">{parts}</span>;
}

export default memo(function ChatMessage({
  message,
  isOwnMessage,
}: ChatMessageProps) {
  // System messages: centered small text
  if (message.type === 'system') {
    return (
      <div className="flex justify-center my-1">
        <span className="text-xs text-gray-400 italic">{message.content}</span>
      </div>
    );
  }

  // AI command messages: user message with @ai badge
  if (message.type === 'ai_command') {
    return (
      <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mb-1`}>
        <div className="max-w-[75%]">
          <div
            className={`flex items-center gap-1 mb-0.5 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
          >
            <span className="text-xs text-gray-500">{message.senderName}</span>
          </div>
          <div
            className={`px-3 py-2 rounded-2xl text-sm ${
              isOwnMessage
                ? 'bg-blue-500 text-white rounded-br-md'
                : 'bg-gray-100 text-gray-900 rounded-bl-md'
            }`}
          >
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 mr-1.5 rounded bg-indigo-100 text-indigo-700 text-xs font-medium">
              @ai
            </span>
            <MessageContent message={message} />
          </div>
          <div
            className={`text-xs text-gray-400 mt-0.5 ${isOwnMessage ? 'text-right' : 'text-left'}`}
          >
            {formatTimestamp(message.createdAt)}
          </div>
        </div>
      </div>
    );
  }

  // AI response messages: left-aligned with AI avatar, handled by parent via AIStreamMessage
  if (message.type === 'ai_response') {
    return (
      <div className="flex justify-start mb-1">
        <div className="max-w-[85%]">
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-sm">
              ✨
            </div>
            <span className="text-xs text-gray-500">AI Assistant</span>
            {message.aiStatus === 'streaming' && (
              <span className="text-xs text-indigo-400 animate-pulse">typing…</span>
            )}
          </div>
          <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-indigo-50 border border-indigo-100 text-sm text-gray-900">
            {message.content ? (
              <span className="whitespace-pre-wrap break-words">{message.content}</span>
            ) : (
              <span className="text-gray-400 animate-pulse">●●●</span>
            )}
            {message.aiStatus === 'failed' && message.aiError && (
              <div className="mt-2 px-2 py-1.5 rounded bg-red-50 border border-red-200 text-xs text-red-600">
                {message.aiError}
              </div>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {formatTimestamp(message.createdAt)}
          </div>
        </div>
      </div>
    );
  }

  // Group messages: standard chat bubble
  return (
    <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mb-1`}>
      <div className="max-w-[75%]">
        {!isOwnMessage && (
          <div className="flex items-center gap-1 mb-0.5">
            {message.senderPhotoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={message.senderPhotoURL}
                alt={message.senderName}
                className="w-5 h-5 rounded-full"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-xs text-white">
                {message.senderName?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <span className="text-xs text-gray-500">{message.senderName}</span>
          </div>
        )}
        <div
          className={`px-3 py-2 rounded-2xl text-sm ${
            isOwnMessage
              ? 'bg-blue-500 text-white rounded-br-md'
              : 'bg-gray-100 text-gray-900 rounded-bl-md'
          }`}
        >
          <MessageContent message={message} />
        </div>
        <div
          className={`text-xs text-gray-400 mt-0.5 ${isOwnMessage ? 'text-right' : 'text-left'}`}
        >
          {formatTimestamp(message.createdAt)}
        </div>
      </div>
    </div>
  );
});
