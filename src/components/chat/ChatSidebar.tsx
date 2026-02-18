/**
 * ChatSidebar — collapsible, resizable right-side chat panel.
 * Contains the chat header (title + persona selector), timeline, and input.
 * Pushes the canvas left when opened via flex layout.
 * Resets unread count when opened. Auto-focuses the input on open.
 * Exposes a drag handle on the left edge to resize width (200–600px).
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useChatStore } from '@/lib/store/chatStore';
import ChatTimeline from './ChatTimeline';
import ChatInput from './ChatInput';
import PersonaSelector from './PersonaSelector';

interface ChatSidebarProps {
  boardId: string;
  onSendAICommand?: (command: string) => void;
  isAILoading?: boolean;
}

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;

export default function ChatSidebar({ boardId, onSendAICommand, isAILoading }: ChatSidebarProps) {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const sidebarWidth = useChatStore((s) => s.sidebarWidth);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const setSidebarWidth = useChatStore((s) => s.setSidebarWidth);
  const resetUnread = useChatStore((s) => s.resetUnread);
  const chatInputRef = useChatStore((s) => s.chatInputRef);

  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Reset unread count when the sidebar opens
  useEffect(() => {
    if (sidebarOpen) {
      resetUnread();
    }
  }, [sidebarOpen, resetUnread]);

  // Auto-focus the input field whenever the sidebar is toggled open
  useEffect(() => {
    if (sidebarOpen) {
      // Brief delay to allow ChatInput to mount and register its ref
      const timer = setTimeout(() => {
        chatInputRef?.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [sidebarOpen, chatInputRef]);

  // Lock cursor and disable text selection while dragging
  useEffect(() => {
    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      return () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing]);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = sidebarWidth;
      setIsResizing(true);
    },
    [sidebarWidth]
  );

  // Attach global mouse listeners only while dragging
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Moving mouse left increases width (sidebar grows leftward)
      const delta = resizeStartX.current - e.clientX;
      const newWidth = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, resizeStartWidth.current + delta)
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <div
      className="flex flex-col h-screen border-l border-gray-200 bg-white transition-[width] duration-300 ease-in-out flex-shrink-0 relative"
      style={{ width: sidebarOpen ? sidebarWidth : 0, overflow: sidebarOpen ? 'visible' : 'hidden' }}
    >
      {sidebarOpen && (
        <>
          {/* Resize handle — left edge, 12px wide hit area */}
          <div
            className="absolute -left-1.5 top-0 bottom-0 w-3 cursor-col-resize z-10 hover:bg-indigo-400/20 transition-colors"
            onMouseDown={handleResizeMouseDown}
            title="Drag to resize"
          />

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
