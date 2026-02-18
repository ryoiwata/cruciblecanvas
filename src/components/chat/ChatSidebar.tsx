/**
 * ChatSidebar — collapsible right-side chat panel.
 * Contains the chat header (title + persona selector), timeline, and input.
 * Pushes the canvas left when opened via flex layout.
 * Resets unread count when opened.
 */

'use client';

import { useEffect } from 'react';
import { useChatStore } from '@/lib/store/chatStore';
import ChatTimeline from './ChatTimeline';
import ChatInput from './ChatInput';
import PersonaSelector from './PersonaSelector';

interface ChatSidebarProps {
  boardId: string;
  onSendAICommand?: (command: string) => void;
  isAILoading?: boolean;
}

export default function ChatSidebar({ boardId, onSendAICommand, isAILoading }: ChatSidebarProps) {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const resetUnread = useChatStore((s) => s.resetUnread);

  // Reset unread count when the sidebar opens
  useEffect(() => {
    if (sidebarOpen) {
      resetUnread();
    }
  }, [sidebarOpen, resetUnread]);

  return (
    <div
      className={`flex flex-col h-screen border-l border-gray-200 bg-white transition-all duration-300 ease-in-out flex-shrink-0 ${
        sidebarOpen ? 'w-80' : 'w-0 overflow-hidden'
      }`}
    >
      {sidebarOpen && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-800">Chat</h2>
            </div>
            <div className="flex items-center gap-3">
              <PersonaSelector />
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-gray-400 hover:text-gray-700 transition-colors"
                title="Close chat"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Message timeline */}
          <ChatTimeline boardId={boardId} />

          {/* Input area */}
          <ChatInput
            boardId={boardId}
            onSendAICommand={onSendAICommand}
            isAILoading={isAILoading}
          />
        </>
      )}
    </div>
  );
}
