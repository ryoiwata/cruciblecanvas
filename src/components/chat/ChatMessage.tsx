/**
 * ChatMessage — renders a single chat message based on its type.
 * Handles group messages, system messages, AI commands, and AI responses.
 * Object reference chips are rendered inline within message text.
 */

'use client';

import { memo, useCallback } from 'react';
import ObjectRefChip from './ObjectRefChip';
import { useObjectStore } from '@/lib/store/objectStore';
import { useCanvasStore } from '@/lib/store/canvasStore';
import type { ChatMessage as ChatMessageType, ObjectReference } from '@/lib/types';

function RobotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="5" y="8" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="8" cy="11.5" r="1" fill="currentColor" />
      <circle cx="12" cy="11.5" r="1" fill="currentColor" />
      <line x1="10" y1="8" x2="10" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10" cy="4" r="1.2" fill="currentColor" />
      <line x1="3" y1="11" x2="5" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="15" y1="11" x2="17" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

interface ChatMessageProps {
  message: ChatMessageType;
  isOwnMessage: boolean;
  boardId: string;
}

function formatTimestamp(createdAt: ChatMessageType['createdAt']): string {
  // createdAt is null when Firestore's serverTimestamp() sentinel is still pending
  // (optimistic update not yet acknowledged by the server). Fall back to now.
  const date =
    typeof createdAt === 'number'
      ? new Date(createdAt)
      : createdAt != null && typeof createdAt === 'object' && 'toDate' in createdAt
        ? createdAt.toDate()
        : new Date();
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Violet group chip shown when a message has 2+ object references.
 * Clicking the body selects all referenced objects on the canvas and pans to fit them.
 */
function GroupRefChip({ refs }: { refs: ObjectReference[] }) {
  const handleClick = useCallback(() => {
    const allObjects = useObjectStore.getState().objects;
    const ids = refs.map((r) => r.objectId).filter((id) => !!allObjects[id]);
    if (ids.length === 0) return;

    useCanvasStore.getState().setSelectedObjectIds(ids);

    // Pan + zoom to fit all referenced objects in the viewport.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const o = allObjects[id];
      if (!o) continue;
      minX = Math.min(minX, o.x);   minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x + o.width); maxY = Math.max(maxY, o.y + o.height);
    }
    if (!isFinite(minX)) return;

    const konvaEl = document.querySelector('.konvajs-content');
    const vpW = konvaEl?.clientWidth  ?? window.innerWidth;
    const vpH = konvaEl?.clientHeight ?? window.innerHeight;
    const PADDING = 80;
    const boxW = maxX - minX;
    const boxH = maxY - minY;
    const scale = (boxW > 0 && boxH > 0)
      ? Math.max(0.1, Math.min(3, Math.min((vpW - PADDING * 2) / boxW, (vpH - PADDING * 2) / boxH)))
      : 1;
    const cx = minX + boxW / 2;
    const cy = minY + boxH / 2;
    useCanvasStore.getState().setViewport(vpW / 2 - cx * scale, vpH / 2 - cy * scale, scale);
  }, [refs]);

  return (
    <button
      onClick={handleClick}
      title={`Select all ${refs.length} references on canvas`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-violet-100 text-violet-700 text-xs hover:bg-violet-200 transition-colors cursor-pointer"
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <rect x="0.5" y="3.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <rect x="3.5" y="0.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1" fill="currentColor" fillOpacity="0.2" />
      </svg>
      <span>{refs.length} items</span>
    </button>
  );
}

/**
 * Renders message content followed by any object reference chips.
 * When 2+ references are present a violet Group chip is shown first so the user
 * can select and pan to all referenced objects in one click.
 */
function MessageContent({ message }: { message: ChatMessageType }) {
  const refs = message.objectReferences ?? [];

  return (
    <span className="whitespace-pre-wrap break-words">
      {message.content}
      {refs.length > 0 && (
        <span className="inline-flex flex-wrap gap-1 ml-1 align-middle">
          {refs.length > 1 && <GroupRefChip refs={refs} />}
          {refs.map((ref) => (
            <ObjectRefChip key={ref.objectId} reference={ref} />
          ))}
        </span>
      )}
    </span>
  );
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
            <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
              <RobotIcon />
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
