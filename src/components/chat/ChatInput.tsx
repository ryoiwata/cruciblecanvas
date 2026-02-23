/**
 * ChatInput — text input for the unified chat sidebar.
 * An inline toggle button selects the send target per message:
 *   - ✨ AI    → dispatches to the AI agent
 *   - 👥 Group → writes to Firestore as a group message
 * Send on Enter, newline on Shift+Enter.
 *
 * Object referencing:
 *  • Auto-add on focus — if objects are already selected when the input receives
 *    focus they are immediately added as reference chips.
 *  • Dynamic sync — while the input is focused, canvas selection changes are
 *    reflected in real-time (debounced 100 ms to absorb marquee bursts).
 *    Newly selected objects are added; deselected objects are NOT auto-removed
 *    so that manually kept references survive selection tweaks.
 *  • Auto-add on mode switch — switching to "Group" mode adds any currently
 *    selected objects that are not already referenced.
 *  • Backspace on empty input removes the last chip.
 *  • The × button on each chip removes that specific reference.
 */

'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useChatStore, usePersonaStore } from '@/lib/store/chatStore';
import { useAuthStore } from '@/lib/store/authStore';
import { useCanvasStore } from '@/lib/store/canvasStore';
import { useObjectStore } from '@/lib/store/objectStore';
import { sendChatMessage, checkRateLimit } from '@/lib/firebase/firestore';
import type { ChatMessage, ObjectReference } from '@/lib/types';
import { OBJECT_TYPE_ICONS } from '@/components/chat/ObjectRefChip';

interface ChatInputProps {
  boardId: string;
  onSendAICommand?: (command: string, refs: ObjectReference[]) => void;
  isAILoading?: boolean;
}

/** Build ObjectReference records for a list of object IDs from the current store snapshot. */
function buildRefs(ids: string[]): ObjectReference[] {
  const objects = useObjectStore.getState().objects;
  const refs: ObjectReference[] = [];
  for (const id of ids) {
    const obj = objects[id];
    if (!obj) continue;
    refs.push({ objectId: id, objectText: obj.text ?? '', objectType: obj.type });
  }
  return refs;
}

/** Merge `incoming` refs into `existing`, skipping duplicates. Returns same array if nothing changed. */
function mergeRefs(existing: ObjectReference[], incoming: ObjectReference[]): ObjectReference[] {
  if (incoming.length === 0) return existing;
  let next = existing;
  for (const ref of incoming) {
    if (next.some((r) => r.objectId === ref.objectId)) continue;
    next = [...next, ref];
  }
  return next;
}

export default function ChatInput({ boardId, onSendAICommand, isAILoading }: ChatInputProps) {
  const [inputText, setInputText] = useState('');
  const [pendingRefs, setPendingRefs] = useState<ObjectReference[]>([]);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Tracks the previous selection so we can diff for newly added objects.
  const prevSelectedIdsRef = useRef<string[]>([]);
  // Debounce timer for selection-change sync.
  const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the previous isInsertingRef to detect the focus-entry transition.
  const prevIsInsertingRefRef = useRef(false);
  // Track the previous chatMode to detect mode-switch events.
  const prevChatModeRef = useRef<'ai' | 'group'>('ai');

  const user         = useAuthStore((s) => s.user);
  const displayName  = useAuthStore((s) => s.displayName);
  const isAnonymous  = useAuthStore((s) => s.isAnonymous);

  const setChatInputRef   = useChatStore((s) => s.setChatInputRef);
  const isInsertingRef    = useChatStore((s) => s.isInsertingRef);
  const setIsInsertingRef = useChatStore((s) => s.setIsInsertingRef);
  const chatMode          = useChatStore((s) => s.chatMode);
  const setChatMode       = useChatStore((s) => s.setChatMode);
  const persona           = usePersonaStore((s) => s.persona);

  // Narrow subscription — triggers re-render only when the selection array changes.
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);

  const isAIMode = chatMode === 'ai';

  // ── Register input ref for the "/" keyboard shortcut ─────────────────────
  useEffect(() => {
    if (inputRef.current) {
      setChatInputRef(inputRef as React.RefObject<HTMLInputElement>);
    }
  }, [setChatInputRef]);

  // ── Focus when ref-insertion mode activates programmatically ─────────────
  useEffect(() => {
    if (isInsertingRef && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isInsertingRef]);

  // ── Auto-add on focus (entry transition) ─────────────────────────────────
  // When isInsertingRef transitions false → true, add all currently selected
  // objects that are not already referenced.
  useEffect(() => {
    const justActivated = !prevIsInsertingRefRef.current && isInsertingRef;
    prevIsInsertingRefRef.current = isInsertingRef;

    if (justActivated) {
      const currentIds = useCanvasStore.getState().selectedObjectIds;
      if (currentIds.length > 0) {
        setPendingRefs((prev) => mergeRefs(prev, buildRefs(currentIds)));
      }
      // Sync the prev-tracking ref so the debounced effect doesn't re-add them.
      prevSelectedIdsRef.current = [...currentIds];
    }
  }, [isInsertingRef]);

  // ── Dynamic sync: debounced selection-change handler ─────────────────────
  // Only fires while the input is focused (isInsertingRef). Adds newly selected
  // objects; does not remove deselected ones to preserve intentional references.
  // Debounced at 100 ms to absorb rapid marquee-selection bursts.
  useEffect(() => {
    if (!isInsertingRef) {
      // Keep prev-tracking in sync even when not in ref mode.
      prevSelectedIdsRef.current = [...selectedObjectIds];
      return;
    }

    if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
    syncDebounceRef.current = setTimeout(() => {
      const prevIds = new Set(prevSelectedIdsRef.current);
      const newlySelectedIds = selectedObjectIds.filter((id) => !prevIds.has(id));

      if (newlySelectedIds.length > 0) {
        setPendingRefs((prev) => mergeRefs(prev, buildRefs(newlySelectedIds)));
      }

      prevSelectedIdsRef.current = [...selectedObjectIds];
    }, 100);

    return () => {
      if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
    };
  }, [selectedObjectIds, isInsertingRef]);

  // ── Auto-add on mode switch to "Group" ───────────────────────────────────
  useEffect(() => {
    const switchedToGroup =
      prevChatModeRef.current !== 'group' && chatMode === 'group';
    prevChatModeRef.current = chatMode;

    if (switchedToGroup) {
      const currentIds = useCanvasStore.getState().selectedObjectIds;
      if (currentIds.length > 0) {
        setPendingRefs((prev) => mergeRefs(prev, buildRefs(currentIds)));
      }
    }
  }, [chatMode]);

  // ── Remove a single chip ──────────────────────────────────────────────────
  const removeRef = useCallback((objectId: string) => {
    setPendingRefs((prev) => prev.filter((r) => r.objectId !== objectId));
  }, []);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !user) return;

    // Capture before clearing so rate-limit restore has the full snapshot.
    const refsToSend = pendingRefs;

    setInputText('');
    setPendingRefs([]);
    setIsInsertingRef(false);
    setRateLimitError(null);

    if (chatMode === 'ai') {
      try {
        const { allowed, remaining } = await checkRateLimit(boardId, user.uid, isAnonymous);
        if (!allowed) {
          setRateLimitError('Rate limit reached. Try again later.');
          setInputText(text);
          setPendingRefs(refsToSend);
          return;
        }
        if (remaining <= 3) {
          setRateLimitError(`${remaining} AI commands remaining this hour`);
        }
      } catch {
        // Rate-limit check failure is non-blocking — let the command through.
      }

      // Strip an accidental @ai prefix the user may have typed out of habit.
      let command = text.replace(/^@ai\s*/i, '');

      // Append referenced-object context so the AI can identify objects by id.
      // The format mirrors board-state serialisation used elsewhere in prompts.ts.
      if (refsToSend.length > 0) {
        const refContext = refsToSend
          .map((r) => `- ${r.objectType} "${r.objectText}" [id:${r.objectId}]`)
          .join('\n');
        command = `${command}\n\nReferenced objects:\n${refContext}`;
      }

      onSendAICommand?.(command, refsToSend);
    } else {
      const messageData: Omit<ChatMessage, 'id' | 'createdAt'> = {
        boardId,
        senderId:       user.uid,
        senderName:     displayName || 'Guest',
        senderPhotoURL: user.photoURL ?? undefined,
        type:           'group',
        content:        text,
        ...(refsToSend.length > 0 ? { objectReferences: refsToSend } : {}),
        aiPersona:      persona,
      };
      sendChatMessage(boardId, messageData).catch(console.error);
    }
  }, [inputText, user, displayName, isAnonymous, boardId, chatMode, pendingRefs, persona, onSendAICommand, setIsInsertingRef]);

  // ── Keyboard handling ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Backspace on an empty text field removes the last reference chip.
      if (e.key === 'Backspace' && inputText === '' && pendingRefs.length > 0) {
        e.preventDefault();
        setPendingRefs((prev) => prev.slice(0, -1));
      }
    },
    [handleSend, inputText, pendingRefs.length],
  );

  const handleFocus = () => setIsInsertingRef(true);

  const handleBlur = () => {
    // Delay so a canvas click that blurs the input can still register as a ref
    // selection within the 200 ms window before ref mode deactivates.
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
      {/* Rate limit warning */}
      {rateLimitError && (
        <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
          {rateLimitError}
        </div>
      )}

      {/* Pending object reference chips */}
      {pendingRefs.length > 0 && (
        <div className="px-3 py-1.5 flex flex-wrap gap-1 border-b border-indigo-100 bg-indigo-50">
          {/* Group chip — only shown when 2+ refs are active.
              Clicking the chip body selects all referenced objects and pans to fit them.
              The × button clears all references at once. */}
          {pendingRefs.length > 1 && (
            <span className="inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 rounded bg-violet-100 text-violet-700 text-xs">
              <button
                type="button"
                onClick={() => {
                  // Select all referenced objects that still exist on the canvas.
                  const ids = pendingRefs
                    .map((r) => r.objectId)
                    .filter((id) => !!useObjectStore.getState().objects[id]);
                  if (ids.length === 0) return;
                  useCanvasStore.getState().setSelectedObjectIds(ids);
                  // Pan + zoom to fit all referenced objects in the viewport.
                  const allObjects = useObjectStore.getState().objects;
                  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                  for (const id of ids) {
                    const o = allObjects[id];
                    if (!o) continue;
                    minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
                    maxX = Math.max(maxX, o.x + o.width); maxY = Math.max(maxY, o.y + o.height);
                  }
                  if (!isFinite(minX)) return;
                  const konvaEl = document.querySelector('.konvajs-content');
                  const vpW = konvaEl?.clientWidth ?? window.innerWidth;
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
                }}
                title="Select all references on canvas"
                className="inline-flex items-center gap-1 hover:text-violet-900 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <rect x="0.5" y="3.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" />
                  <rect x="3.5" y="0.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1" fill="currentColor" fillOpacity="0.2" />
                </svg>
                <span>{pendingRefs.length} items</span>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPendingRefs([]); }}
                title="Remove all references"
                className="ml-0.5 w-4 h-4 rounded flex items-center justify-center hover:bg-violet-200 text-violet-500 hover:text-violet-800 transition-colors leading-none"
              >
                ×
              </button>
            </span>
          )}

          {/* Individual object chips */}
          {pendingRefs.map((ref) => {
            const icon  = OBJECT_TYPE_ICONS[ref.objectType] ?? '□';
            const label =
              ref.objectText.length > 20
                ? ref.objectText.slice(0, 20) + '…'
                : ref.objectText || ref.objectType;
            return (
              <span
                key={ref.objectId}
                className="inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-xs"
              >
                <span aria-hidden="true">{icon}</span>
                <span>{label}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeRef(ref.objectId); }}
                  title="Remove reference"
                  className="ml-0.5 w-4 h-4 rounded flex items-center justify-center hover:bg-indigo-200 text-indigo-500 hover:text-indigo-800 transition-colors leading-none"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Hint — only shown when ref mode is active and no chips yet */}
      {isInsertingRef && pendingRefs.length === 0 && (
        <div className="px-3 py-1.5 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-600">
          Click an object on the canvas to reference it
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        {/* Send-target toggle */}
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
