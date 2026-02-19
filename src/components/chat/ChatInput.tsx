/**
 * ChatInput — text input for the unified chat sidebar.
 * An inline toggle button selects the send target per message:
 *   - ✨ AI    → dispatches to the AI agent
 *   - 👥 Group → writes to Firestore as a group message
 * Send on Enter, newline on Shift+Enter.
 */

'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useChatStore, usePersonaStore } from '@/lib/store/chatStore';
import { useAuthStore } from '@/lib/store/authStore';
import { sendChatMessage, checkRateLimit } from '@/lib/firebase/firestore';
import type { ChatMessage, ObjectReference } from '@/lib/types';

interface ChatInputProps {
  boardId: string;
  onSendAICommand?: (command: string) => void;
  isAILoading?: boolean;
}

export default function ChatInput({ boardId, onSendAICommand, isAILoading }: ChatInputProps) {
  const [inputText, setInputText] = useState('');
  const [pendingRefs, setPendingRefs] = useState<ObjectReference[]>([]);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const setChatInputRef = useChatStore((s) => s.setChatInputRef);
  const isInsertingRef = useChatStore((s) => s.isInsertingRef);
  const setIsInsertingRef = useChatStore((s) => s.setIsInsertingRef);
  const chatMode = useChatStore((s) => s.chatMode);
  const setChatMode = useChatStore((s) => s.setChatMode);
  const persona = usePersonaStore((s) => s.persona);

  const isAIMode = chatMode === 'ai';

  // Register input ref for / shortcut focus
  useEffect(() => {
    if (inputRef.current) {
      setChatInputRef(inputRef as React.RefObject<HTMLInputElement>);
    }
  }, [setChatInputRef]);

  // When isInsertingRef becomes true, focus the input and signal ref mode
  useEffect(() => {
    if (isInsertingRef && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isInsertingRef]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !user) return;

    setInputText('');
    setPendingRefs([]);
    setIsInsertingRef(false);
    setRateLimitError(null);

    if (chatMode === 'ai') {
      // AI mode — check rate limit then dispatch to the AI agent
      try {
        const { allowed, remaining } = await checkRateLimit(boardId, user.uid, isAnonymous);
        if (!allowed) {
          setRateLimitError('Rate limit reached. Try again later.');
          setInputText(text);
          return;
        }
        if (remaining <= 3) {
          setRateLimitError(`${remaining} AI commands remaining this hour`);
        }
      } catch {
        // If the rate limit check fails, allow the command to proceed
      }

      // Strip a leading @ai prefix in case the user typed it from habit
      const command = text.replace(/^@ai\s*/i, '');
      onSendAICommand?.(command);
    } else {
      // Group mode — write directly to Firestore
      const messageData: Omit<ChatMessage, 'id' | 'createdAt'> = {
        boardId,
        senderId: user.uid,
        senderName: displayName || 'Guest',
        senderPhotoURL: user.photoURL ?? undefined,
        type: 'group',
        content: text,
        ...(pendingRefs.length > 0 ? { objectReferences: pendingRefs } : {}),
        aiPersona: persona,
      };

      sendChatMessage(boardId, messageData).catch(console.error);
    }
  }, [inputText, user, displayName, isAnonymous, boardId, chatMode, pendingRefs, persona, onSendAICommand, setIsInsertingRef]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleFocus = () => {
    setIsInsertingRef(true);
  };

  const handleBlur = () => {
    // Only clear inserting mode if sidebar is still open
    setTimeout(() => setIsInsertingRef(false), 200);
  };

  const placeholder = isAILoading
    ? 'AI is thinking…'
    : isAIMode
      ? 'Ask the AI agent…'
      : 'Message the group…';

  return (
    <div
      className="border-t border-gray-200 bg-white cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Rate limit warning — only shown when send target is AI */}
      {rateLimitError && (
        <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
          {rateLimitError}
        </div>
      )}

      {/* Object reference insertion hint */}
      {isInsertingRef && (
        <div className="px-3 py-1.5 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-600">
          Click an object on the canvas to reference it
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        {/* Send-target toggle — cycles between AI and Group per message */}
        <button
          onClick={() => setChatMode(isAIMode ? 'group' : 'ai')}
          title={isAIMode ? 'Sending to AI — click to switch to Group' : 'Sending to Group — click to switch to AI'}
          className={`flex-shrink-0 w-8 h-8 rounded-full text-sm flex items-center justify-center transition-colors border ${
            isAIMode
              ? 'bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-100'
              : 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100'
          }`}
        >
          {isAIMode ? '✨' : '👥'}
        </button>

        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={isAILoading}
          className="flex-1 text-sm outline-none rounded-lg px-3 py-2 transition-colors bg-gray-50 placeholder-gray-400 text-gray-900 border border-gray-200 focus:border-gray-300 focus:bg-white disabled:opacity-50"
        />

        <button
          onClick={handleSend}
          disabled={!inputText.trim() || isAILoading}
          className={`flex-shrink-0 w-8 h-8 rounded-full text-white text-sm flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isAIMode
              ? 'bg-indigo-500 hover:bg-indigo-600'
              : 'bg-emerald-500 hover:bg-emerald-600'
          }`}
        >
          {isAILoading ? (
            <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            '↑'
          )}
        </button>
      </div>
    </div>
  );
}
