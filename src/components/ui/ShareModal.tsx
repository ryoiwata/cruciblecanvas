"use client";

/**
 * ShareModal — full collaboration management modal.
 * Handles collaborator invites, general link access control, and link copying.
 * Dual-writes privacy changes to both Firestore and RTDB for instant propagation
 * to all connected clients without a page refresh.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getBoardMetadata, updateBoardMetadata } from "@/lib/firebase/firestore";
import { setBoardPrivacy } from "@/lib/firebase/rtdb";
import { useAuthStore } from "@/lib/store/authStore";
import Toast from "./Toast";

interface ShareModalProps {
  boardId: string;
  isOpen: boolean;
  onClose: () => void;
}

type InvitePermission = 'edit' | 'view';
type GeneralAccess = 'no_access' | 'can_view' | 'can_edit';

const INVITE_PERMISSION_OPTIONS: ReadonlyArray<{
  value: InvitePermission;
  label: string;
  description: string;
}> = [
  { value: 'edit', label: 'Can edit', description: 'Can edit and invite collaborators' },
  { value: 'view', label: 'Can view', description: 'Can view and make a copy' },
];

const GENERAL_ACCESS_OPTIONS: ReadonlyArray<{
  value: GeneralAccess;
  label: string;
  description: string;
}> = [
  { value: 'can_edit', label: 'Can edit', description: 'Can edit and invite collaborators' },
  { value: 'can_view', label: 'Can view', description: 'Can view file and make a copy' },
  { value: 'no_access', label: 'No access', description: 'Remove file access' },
];

/** Derives 1–2 uppercase initials from a display name or email address. */
function getInitials(
  displayName: string | null | undefined,
  email: string | null | undefined
): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return displayName[0].toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}

/** Maps the current isPublic boolean to a GeneralAccess display state. */
function resolveGeneralAccess(isPublic: boolean): GeneralAccess {
  return isPublic ? 'can_edit' : 'no_access';
}

// ---- Shared icon components ----

function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function ShareModal({ boardId, isOpen, onClose }: ShareModalProps) {
  const user = useAuthStore((s) => s.user);
  const displayName = useAuthStore((s) => s.displayName);

  const [emailInput, setEmailInput] = useState('');
  const [invitePermission, setInvitePermission] = useState<InvitePermission>('edit');
  const [isInviteDropdownOpen, setIsInviteDropdownOpen] = useState(false);
  const [isGeneralDropdownOpen, setIsGeneralDropdownOpen] = useState(false);
  const [generalAccess, setGeneralAccess] = useState<GeneralAccess>('no_access');
  const [invitedEmails, setInvitedEmails] = useState<string[]>([]);
  const [createdBy, setCreatedBy] = useState<string | null>(null);
  const [isMetaLoading, setIsMetaLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  const inviteDropdownRef = useRef<HTMLDivElement>(null);
  const generalDropdownRef = useRef<HTMLDivElement>(null);

  const isCreator = !!user && createdBy === user.uid;

  const selectedInviteOption = INVITE_PERMISSION_OPTIONS.find((o) => o.value === invitePermission)!;
  const selectedGeneralOption = GENERAL_ACCESS_OPTIONS.find((o) => o.value === generalAccess)!;

  const generalAccessSubtext = (() => {
    if (generalAccess === 'no_access') return 'Only people added as collaborators can access with the link.';
    if (generalAccess === 'can_view') return 'Anyone with the link can view this board.';
    return 'Anyone with the link can edit this board.';
  })();

  // Load board metadata whenever the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setIsMetaLoading(true);
    getBoardMetadata(boardId).then((meta) => {
      if (meta) {
        setGeneralAccess(resolveGeneralAccess(meta.isPublic));
        setInvitedEmails(meta.invitedEmails ?? []);
        setCreatedBy(meta.createdBy);
      }
      setIsMetaLoading(false);
    });
  }, [boardId, isOpen]);

  // Dismiss on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Close floating dropdowns when clicking outside their refs
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (inviteDropdownRef.current && !inviteDropdownRef.current.contains(e.target as Node)) {
        setIsInviteDropdownOpen(false);
      }
      if (generalDropdownRef.current && !generalDropdownRef.current.contains(e.target as Node)) {
        setIsGeneralDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  /**
   * Updates the general link access level.
   * Dual-writes isPublic to both Firestore and RTDB so connected clients
   * see the change immediately without polling.
   */
  const handleGeneralAccessChange = useCallback(
    async (access: GeneralAccess) => {
      if (!isCreator) return;
      setGeneralAccess(access);
      setIsGeneralDropdownOpen(false);
      const isPublic = access !== 'no_access';
      await updateBoardMetadata(boardId, { isPublic }).catch(console.error);
      setBoardPrivacy(boardId, isPublic);
    },
    [boardId, isCreator]
  );

  /** Appends a validated email to invitedEmails in Firestore. */
  const handleSendInvite = useCallback(async () => {
    const trimmed = emailInput.trim();
    if (!trimmed || isSending) return;
    if (!trimmed.includes('@')) return;
    if (invitedEmails.includes(trimmed)) {
      setEmailInput('');
      return;
    }
    setIsSending(true);
    const next = [...invitedEmails, trimmed];
    try {
      await updateBoardMetadata(boardId, { invitedEmails: next });
      setInvitedEmails(next);
      setEmailInput('');
    } catch (err) {
      console.error('[ShareModal] Failed to invite collaborator:', err);
    } finally {
      setIsSending(false);
    }
  }, [boardId, emailInput, invitedEmails, isSending]);

  const handleCopyLink = useCallback(async () => {
    const url = `${window.location.origin}/board/${boardId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for browsers that block clipboard API without HTTPS
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setToastVisible(true);
  }, [boardId]);

  const handleToastDismiss = useCallback(() => setToastVisible(false), []);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={handleBackdropClick}
      >
        {/* Modal panel */}
        <div
          className="relative flex w-[640px] flex-col rounded-2xl bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ---- Header ---- */}
          <div className="flex items-center gap-4 px-6 pt-6 pb-5">
            <h2 className="text-xl font-bold text-gray-900">Invite collaborators</h2>
            <button className="text-base font-medium text-gray-400 hover:text-gray-600 transition-colors">
              Add to community
            </button>
            <button
              onClick={onClose}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              aria-label="Close share modal"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* ---- Invite input row ---- */}
          <div className="flex items-center gap-3 px-6 pb-5">
            {/* Email input + inline permission dropdown */}
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2.5 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400">
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendInvite();
                }}
                placeholder="Add people, emails, or groups"
                className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none"
              />
              {/* Branded dots icon (matches design's red grid icon) */}
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-red-500">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="white">
                  <rect x="1" y="1" width="5" height="5" rx="1" />
                  <rect x="8.5" y="1" width="5" height="5" rx="1" />
                  <rect x="1" y="8.5" width="5" height="5" rx="1" />
                  <rect x="8.5" y="8.5" width="5" height="5" rx="1" />
                </svg>
              </div>
              {/* Invite permission selector */}
              <div ref={inviteDropdownRef} className="relative flex-shrink-0">
                <button
                  onClick={() => setIsInviteDropdownOpen((v) => !v)}
                  className="flex items-center gap-1 text-sm font-medium text-[#6366f1] transition-colors hover:text-[#4f46e5]"
                >
                  {selectedInviteOption.label}
                  <ChevronDownIcon />
                </button>
                {isInviteDropdownOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-gray-200 bg-white py-2 shadow-xl">
                    {INVITE_PERMISSION_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setInvitePermission(option.value);
                          setIsInviteDropdownOpen(false);
                        }}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                      >
                        <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center text-gray-900">
                          {invitePermission === option.value && <CheckIcon />}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{option.label}</p>
                          <p className="text-sm text-gray-500">{option.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Send Invite CTA */}
            <button
              onClick={handleSendInvite}
              disabled={!emailInput.trim() || isSending}
              className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>

          {/* ---- Collaborator list ---- */}
          <div className="px-6 pb-4">
            {isMetaLoading ? (
              <div className="py-4 text-center text-sm text-gray-400">Loading…</div>
            ) : (
              <div>
                {/* Owner row */}
                {user && (
                  <div className="flex items-center gap-3 py-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-400 text-sm font-semibold text-white">
                      {getInitials(displayName, user.email)}
                    </div>
                    <div className="flex flex-1 flex-col min-w-0">
                      <span className="truncate text-sm font-semibold text-gray-900">
                        {displayName || user.email}
                      </span>
                      {displayName && (
                        <span className="truncate text-sm text-gray-500">{user.email}</span>
                      )}
                    </div>
                    <span className="flex-shrink-0 text-sm text-gray-500">Owner</span>
                  </div>
                )}
                {/* Invited collaborators */}
                {invitedEmails.map((email) => (
                  <div key={email} className="flex items-center gap-3 border-t border-gray-100 py-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-300 text-sm font-semibold text-gray-700">
                      {email[0].toUpperCase()}
                    </div>
                    <div className="flex flex-1 flex-col min-w-0">
                      <span className="truncate text-sm text-gray-900">{email}</span>
                    </div>
                    <span className="flex-shrink-0 text-sm text-gray-500">
                      {invitePermission === 'edit' ? 'Editor' : 'Viewer'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-6 border-t border-gray-200" />

          {/* ---- General access + Copy Link ---- */}
          <div className="flex items-start gap-3 px-6 py-5">
            {/* Lock icon badge */}
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-100">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gray-600"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            {/* Label + dropdown + description */}
            <div className="flex flex-1 flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-gray-900">Anyone with the link</span>
                <div ref={generalDropdownRef} className="relative">
                  <button
                    onClick={() => isCreator && setIsGeneralDropdownOpen((v) => !v)}
                    disabled={!isCreator}
                    className={`flex items-center gap-1 text-sm font-medium text-[#6366f1] transition-colors ${
                      isCreator ? 'hover:text-[#4f46e5] cursor-pointer' : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    {selectedGeneralOption.label}
                    <ChevronDownIcon />
                  </button>
                  {isGeneralDropdownOpen && (
                    <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-gray-200 bg-white py-2 shadow-xl">
                      {GENERAL_ACCESS_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => handleGeneralAccessChange(option.value)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                        >
                          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center text-gray-900">
                            {generalAccess === option.value && <CheckIcon />}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{option.label}</p>
                            <p className="text-sm text-gray-500">{option.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-0.5 text-sm text-gray-500">{generalAccessSubtext}</p>
            </div>
            {/* Copy Link button */}
            <button
              onClick={handleCopyLink}
              className="flex flex-shrink-0 items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Copy Link
            </button>
          </div>
        </div>
      </div>

      <Toast message="Link copied to clipboard!" visible={toastVisible} onDismiss={handleToastDismiss} />
    </>
  );
}
