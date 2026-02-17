# Auto Board Creation for Guest Login

## Goal

Modify the guest login flow so anonymous users bypass the dashboard and are immediately redirected to a freshly created board (`/board/[newBoardId]`). Social logins (Google/GitHub) continue to redirect to `/dashboard` as before.

## Current Flow

```
Guest: signInAsGuest() → write displayName → router.push("/dashboard")
Google: signInWithGoogle()                  → router.push("/dashboard")
GitHub: signInWithGithub()                  → router.push("/dashboard")
```

## Target Flow

```
Guest: signInAsGuest() → write displayName → createBoardMetadata() → router.push("/board/{boardId}")
Google: signInWithGoogle()                  → router.push("/dashboard")   (unchanged)
GitHub: signInWithGithub()                  → router.push("/dashboard")   (unchanged)
```

## Files to Modify

| File | Change |
|------|--------|
| `src/components/auth/AuthCard.tsx` | Update `handleGuest` to create a board and redirect to it |

No new files required.

## Detailed Changes

### `src/components/auth/AuthCard.tsx`

1. Add import for `createBoardMetadata` from `@/lib/firebase/firestore`.
2. In `handleGuest`, after the display name is written to Firestore:
   - Generate a board ID via `crypto.randomUUID()`.
   - Call `await createBoardMetadata(boardId, credential.user.uid, "Untitled Board")`.
   - Replace `router.push("/dashboard")` with `router.push(`/board/${boardId}`)`.
3. `handleGoogle` and `handleGithub` remain unchanged.

### Before (lines 30-36)

```typescript
const credential = await signInAsGuest();
const profileRef = doc(db, "users", credential.user.uid, "profile", "info");
await setDoc(profileRef, { displayName: trimmed }, { merge: true });
setStoreName(trimmed);
router.push("/dashboard");
```

### After

```typescript
const credential = await signInAsGuest();
const profileRef = doc(db, "users", credential.user.uid, "profile", "info");
await setDoc(profileRef, { displayName: trimmed }, { merge: true });
setStoreName(trimmed);

// Auto-create a board and redirect guest directly to it
const boardId = crypto.randomUUID();
await createBoardMetadata(boardId, credential.user.uid, "Untitled Board");
router.push(`/board/${boardId}`);
```

## Implementation Tasks

| # | Task | Est. |
|---|------|------|
| 1 | Add `createBoardMetadata` import to AuthCard.tsx | 1 min |
| 2 | Update `handleGuest` with board creation + redirect | 2 min |
| 3 | Verify social login redirects are unchanged | 1 min |
| 4 | Manual test: guest login → lands on board page | 2 min |
| 5 | Manual test: Google/GitHub login → lands on dashboard | 2 min |

**Total estimate**: ~8 minutes

## Edge Cases

- **Board creation failure**: The existing try/catch in `handleGuest` already handles errors — if `createBoardMetadata` throws, the user sees the generic "Sign-in failed" error and stays on the auth page.
- **Anonymous user revisits**: If a guest navigates to `/dashboard` later (e.g. via URL), they can still see their boards and create new ones — this change only affects the initial redirect after login.
- **Auth page redirect guard**: `src/app/auth/page.tsx` has a `useEffect` that redirects authenticated users to `/dashboard`. This only fires when a user who is already logged in visits `/auth` — it does not interfere with the guest flow since the redirect in `handleGuest` fires before the auth page's effect re-evaluates. No change needed here.

## Verification Checklist

- [ ] Guest login creates a board document at `boards/{boardId}/metadata/config`
- [ ] Guest is redirected to `/board/{boardId}` (not `/dashboard`)
- [ ] Google login redirects to `/dashboard`
- [ ] GitHub login redirects to `/dashboard`
- [ ] Board title defaults to "Untitled Board"
- [ ] `createdBy` on the board matches the anonymous user's UID
- [ ] Error state shown if board creation fails
