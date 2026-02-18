/**
 * chatStore — manages chat sidebar state, messages, AI stream relay,
 * notification counts, and per-user AI persona preference (persisted to localStorage).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RefObject } from 'react';
import type { ChatMessage, AIStream, AiPersona } from '@/lib/types';

/** Controls which message list and input behaviour the chat sidebar presents. */
export type ChatMode = 'ai' | 'group';

interface ChatState {
  // Sidebar open/close state
  sidebarOpen: boolean;
  sidebarWidth: number;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (w: number) => void;
  toggleSidebar: () => void;

  // Active chat mode: 'ai' for AI agent commands, 'group' for multiplayer chat
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;

  // Messages loaded from Firestore
  messages: ChatMessage[];
  setMessages: (msgs: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;

  // Unread notifications when sidebar is closed
  unreadCount: number;
  setUnreadCount: (n: number) => void;
  incrementUnread: () => void;
  resetUnread: () => void;

  // Active AI streams from RTDB, keyed by aiCommandId
  activeStreams: Record<string, AIStream>;
  setStream: (commandId: string, stream: AIStream) => void;
  removeStream: (commandId: string) => void;

  // Object reference insertion mode for chat input
  isInsertingRef: boolean;
  setIsInsertingRef: (v: boolean) => void;

  // Chat input ref for / shortcut focus
  chatInputRef: RefObject<HTMLInputElement> | null;
  setChatInputRef: (ref: RefObject<HTMLInputElement>) => void;
}

interface PersistedChatState {
  // Per-user persona preference persisted to localStorage
  persona: AiPersona;
  setPersona: (p: AiPersona) => void;
}

// Non-persisted chat state
export const useChatStore = create<ChatState>()((set) => ({
  sidebarOpen: true,
  sidebarWidth: 320,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  chatMode: 'ai',
  setChatMode: (mode) => set({ chatMode: mode }),

  messages: [],
  setMessages: (msgs) => set({ messages: msgs }),
  addMessage: (msg) =>
    set((state) => ({
      messages: [...state.messages.filter((m) => m.id !== msg.id), msg],
    })),
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    })),

  unreadCount: 0,
  setUnreadCount: (n) => set({ unreadCount: n }),
  incrementUnread: () => set((state) => ({ unreadCount: state.unreadCount + 1 })),
  resetUnread: () => set({ unreadCount: 0 }),

  activeStreams: {},
  setStream: (commandId, stream) =>
    set((state) => ({
      activeStreams: { ...state.activeStreams, [commandId]: stream },
    })),
  removeStream: (commandId) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [commandId]: _removed, ...rest } = state.activeStreams;
      return { activeStreams: rest };
    }),

  isInsertingRef: false,
  setIsInsertingRef: (v) => set({ isInsertingRef: v }),

  chatInputRef: null,
  setChatInputRef: (ref) => set({ chatInputRef: ref }),
}));

// Persisted slice for persona — stored in localStorage
export const usePersonaStore = create<PersistedChatState>()(
  persist(
    (set) => ({
      persona: 'neutral' as AiPersona,
      setPersona: (p) => set({ persona: p }),
    }),
    { name: 'cruciblecanvas-persona' }
  )
);
