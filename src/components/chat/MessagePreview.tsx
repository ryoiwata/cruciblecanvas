/**
 * MessagePreview — floating notification preview shown when the sidebar is closed
 * and a new message arrives. Auto-dismisses after 3 seconds.
 */

'use client';

import { useEffect, useState } from 'react';
import { useChatStore } from '@/lib/store/chatStore';
import type { ChatMessage } from '@/lib/types';

interface MessagePreviewProps {
  onOpenSidebar: () => void;
}

export default function MessagePreview({ onOpenSidebar }: MessagePreviewProps) {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const messages = useChatStore((s) => s.messages);

  const [preview, setPreview] = useState<ChatMessage | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (sidebarOpen || messages.length === 0) {
      setPreview(null);
      setIsVisible(false);
      return;
    }

    const latest = messages[messages.length - 1];
    if (!latest || latest.type === 'system') return;

    setPreview(latest);
    setIsVisible(true);

    const timeout = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => setPreview(null), 300); // Wait for fade-out animation
    }, 3000);

    return () => clearTimeout(timeout);
  }, [messages, sidebarOpen]);

  if (!preview || sidebarOpen) return null;

  const previewText =
    preview.type === 'ai_response'
      ? `AI: ${preview.content.slice(0, 60)}`
      : preview.type === 'ai_command'
        ? `@ai: ${preview.content.slice(0, 60)}`
        : preview.content.slice(0, 60);

  return (
    <div
      className={`fixed bottom-24 right-4 z-50 w-64 bg-white rounded-xl shadow-lg border border-gray-200 p-3 cursor-pointer transition-all duration-300 ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
      }`}
      onClick={onOpenSidebar}
    >
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-sm flex-shrink-0">
          {preview.type === 'ai_response' ? '✨' : (preview.senderName?.[0]?.toUpperCase() ?? '?')}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-700 truncate">
            {preview.type === 'ai_response' ? 'AI Assistant' : preview.senderName}
          </p>
          <p className="text-xs text-gray-500 truncate">{previewText}</p>
        </div>
      </div>
    </div>
  );
}
