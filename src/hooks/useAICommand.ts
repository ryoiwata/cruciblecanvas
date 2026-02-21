/**
 * useAICommand — client-side hook for sending @ai commands to the AI board agent.
 * Orchestrates:
 * 1. Serializing board state (viewport + selection)
 * 2. Writing the ai_command message to Firestore (optimistic)
 * 3. POSTing to /api/ai-command with streaming fetch
 * 4. Relaying streamed tokens to RTDB for other users
 * 5. Finalizing the ai_response message in Firestore on completion
 * 6. Rollback via deleteObjectsByAiCommand on failure
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAuthStore } from '@/lib/store/authStore';
import { useCanvasStore } from '@/lib/store/canvasStore';
import { useObjectStore } from '@/lib/store/objectStore';
import { useChatStore, usePersonaStore } from '@/lib/store/chatStore';
import {
  sendChatMessage,
  confirmAIPendingObjects,
  deleteObjectsByAiCommand,
} from '@/lib/firebase/firestore';
import { setAIStream, updateAIStream, removeAIStream } from '@/lib/firebase/rtdb';
import { serializeBoardState } from '@/lib/ai/context';
import { computeSuggestedPositions } from '@/lib/ai/spatialPlanning';
import type { ChatMessage } from '@/lib/types';

interface UseAICommandReturn {
  sendAICommand: (command: string) => void;
  isAILoading: boolean;
}

export function useAICommand(boardId: string): UseAICommandReturn {
  const [isAILoading, setIsAILoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const stageX = useCanvasStore((s) => s.stageX);
  const stageY = useCanvasStore((s) => s.stageY);
  const stageScale = useCanvasStore((s) => s.stageScale);
  const selectedObjectIds = useCanvasStore((s) => s.selectedObjectIds);

  const objects = useObjectStore((s) => s.objects);

  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setStream = useChatStore((s) => s.setStream);
  const removeStream = useChatStore((s) => s.removeStream);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const setClarificationPending = useChatStore((s) => s.setClarificationPending);

  const persona = usePersonaStore((s) => s.persona);

  const sendAICommand = useCallback(
    async (command: string) => {
      if (!user || isAILoading) return;

      // Open sidebar so user can see the response streaming
      setSidebarOpen(true);

      // If Mason was waiting for clarification, capture the turn history so it
      // can see its own question and this reply in the next request.
      // Reading from getState() avoids stale closure values.
      const wasPendingClarification = useChatStore.getState().clarificationPending;
      if (wasPendingClarification) {
        setClarificationPending(false);
      }

      // Build turn history for clarification replies: last 3 turns (6 messages)
      // interleaved as user/assistant, with the current command appended as the
      // final user message. Only sent when replying to a clarification.
      let clarificationMessages: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;
      if (wasPendingClarification) {
        const rawHistory = useChatStore.getState().messages
          .filter(
            (m) =>
              (m.type === 'ai_command' || m.type === 'ai_response') &&
              m.content.trim() !== ''
          )
          .slice(-6)
          .map((m) => ({
            role: (m.type === 'ai_command' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content,
          }));
        // Drop leading assistant turns so the array always starts with 'user'
        while (rawHistory.length > 0 && rawHistory[0].role === 'assistant') {
          rawHistory.shift();
        }
        clarificationMessages = [...rawHistory, { role: 'user' as const, content: command }];
      }

      const aiCommandId = uuidv4();

      // Serialize viewport bounds from current stage state
      const viewportBounds = {
        x: -stageX / stageScale,
        y: -stageY / stageScale,
        width: window.innerWidth / stageScale,
        height: window.innerHeight / stageScale,
      };

      const boardState = serializeBoardState(objects, viewportBounds, selectedObjectIds);
      const suggestedPositions = computeSuggestedPositions(objects, viewportBounds, 5);

      // Build optimistic ai_command message
      const commandMsgId = `optimistic-cmd-${aiCommandId}`;
      const commandMsg: ChatMessage = {
        id: commandMsgId,
        boardId,
        senderId: user.uid,
        senderName: displayName || 'Guest',
        senderPhotoURL: user.photoURL ?? undefined,
        type: 'ai_command',
        content: command,
        aiCommandId,
        aiPersona: persona,
        aiStatus: 'streaming',
        createdAt: Date.now(),
      };
      addMessage(commandMsg);

      // Build optimistic ai_response placeholder
      // senderId uses the requester's uid so the Firestore rule (senderId == request.auth.uid)
      // is satisfied. The 'ai_response' type distinguishes it from group messages in the UI.
      const responseMsgId = `optimistic-resp-${aiCommandId}`;
      const responseMsg: ChatMessage = {
        id: responseMsgId,
        boardId,
        senderId: user.uid,
        senderName: 'AI Assistant',
        type: 'ai_response',
        content: '',
        aiCommandId,
        aiPersona: persona,
        aiStatus: 'streaming',
        createdAt: Date.now(),
      };
      addMessage(responseMsg);

      setIsAILoading(true);

      // Initialize RTDB stream node for other users to see
      await setAIStream(boardId, aiCommandId, {
        requesterId: user.uid,
        requesterName: displayName || 'Guest',
        content: '',
        status: 'streaming',
        timestamp: Date.now(),
      }).catch(console.error);
      setStream(aiCommandId, {
        requesterId: user.uid,
        requesterName: displayName || 'Guest',
        content: '',
        status: 'streaming',
        timestamp: Date.now(),
      });

      // Persist the ai_command message to Firestore
      sendChatMessage(boardId, {
        boardId,
        senderId: user.uid,
        senderName: displayName || 'Guest',
        senderPhotoURL: user.photoURL ?? undefined,
        type: 'ai_command',
        content: command,
        aiCommandId,
        aiPersona: persona,
        aiStatus: 'completed',
      }).catch(console.error);

      // Get Firebase ID token for API authorization
      let idToken: string;
      try {
        idToken = await user.getIdToken();
      } catch (err) {
        console.error('[AI] Failed to get ID token:', err);
        setIsAILoading(false);
        updateMessage(responseMsgId, {
          aiStatus: 'failed',
          aiError: 'Authentication error. Please refresh and try again.',
        });
        return;
      }

      // Stream the AI response
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let accumulatedContent = '';
      let hasFailed = false;

      try {
        const response = await fetch('/api/ai-command', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            message: command,
            // Turn history is only included when replying to a clarification so
            // Mason can see its own question and the user's answer.
            ...(clarificationMessages ? { messages: clarificationMessages } : {}),
            boardId,
            boardState,
            selectedObjectIds,
            persona,
            aiCommandId,
            suggestedPositions,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errData.error ?? `HTTP ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        // The API uses toTextStreamResponse() — plain text chunks, no protocol framing
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (chunk) {
            accumulatedContent += chunk;
            // Update local state
            updateMessage(responseMsgId, { content: accumulatedContent });
            // Relay to RTDB for other users
            updateAIStream(boardId, aiCommandId, {
              content: accumulatedContent,
              status: 'streaming',
              timestamp: Date.now(),
            }).catch(console.error);
          }
        }

        // Detect clarification sentinel before confirming objects.
        // Mason outputs "Clarification needed: {question}" as its only text when
        // it calls askClarification. The sentinel lets the client set UI state
        // without needing to parse the tool-call stream directly.
        const isClarification = /^clarification needed:/i.test(accumulatedContent.trim());
        if (isClarification) {
          setClarificationPending(true);
        }

        // Success: confirm pending objects and write final response to Firestore
        await confirmAIPendingObjects(boardId, aiCommandId).catch(console.error);

        // Write the final ai_response message to Firestore
        const finalMsgId = await sendChatMessage(boardId, {
          boardId,
          senderId: user.uid,
          senderName: 'AI Assistant',
          type: 'ai_response',
          content: accumulatedContent,
          aiCommandId,
          aiPersona: persona,
          aiStatus: 'completed',
        }).catch(console.error);

        // Update local state to completed
        updateMessage(responseMsgId, {
          id: finalMsgId ?? responseMsgId,
          aiStatus: 'completed',
          content: accumulatedContent,
        });

        // Clean up RTDB stream
        await removeAIStream(boardId, aiCommandId).catch(console.error);
        removeStream(aiCommandId);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return; // User navigated away, silent exit
        }

        hasFailed = true;
        console.error('[AI] Command failed:', err);

        const errorMessage =
          err instanceof Error ? err.message : 'Command failed. Please try again.';

        // Rollback pending objects
        await deleteObjectsByAiCommand(boardId, aiCommandId).catch(console.error);

        // Update the response message with error
        updateMessage(responseMsgId, {
          aiStatus: 'failed',
          content: accumulatedContent,
          aiError: `Command failed mid-execution. All changes rolled back. (${errorMessage})`,
        });

        // Persist the failure to Firestore
        sendChatMessage(boardId, {
          boardId,
          senderId: user.uid,
          senderName: 'AI Assistant',
          type: 'ai_response',
          content: accumulatedContent,
          aiCommandId,
          aiPersona: persona,
          aiStatus: 'failed',
          aiError: `Command failed. All changes rolled back. (${errorMessage})`,
        }).catch(console.error);

        // Clean up RTDB stream
        await updateAIStream(boardId, aiCommandId, {
          status: 'failed',
          timestamp: Date.now(),
        }).catch(console.error);
        await removeAIStream(boardId, aiCommandId).catch(console.error);
        removeStream(aiCommandId);
      } finally {
        if (!hasFailed) {
          setIsAILoading(false);
        } else {
          setIsAILoading(false);
        }
        abortControllerRef.current = null;
      }
    },
    [
      user,
      displayName,
      isAILoading,
      boardId,
      objects,
      stageX,
      stageY,
      stageScale,
      selectedObjectIds,
      persona,
      addMessage,
      updateMessage,
      setStream,
      removeStream,
      setSidebarOpen,
      setClarificationPending,
    ]
  );

  return { sendAICommand, isAILoading };
}
