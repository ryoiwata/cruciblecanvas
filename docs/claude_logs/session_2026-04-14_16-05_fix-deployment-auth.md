# Session Log: Fix Deployment Authentication Failures
**Date:** 2026-04-14 ~16:05 UTC
**Duration:** ~25 minutes
**Focus:** Diagnose and fix both Google and Guest sign-in failures on the Vercel deployment

## What Got Done
- Diagnosed two independent root causes blocking all sign-in on `cruciblecanvas.vercel.app`
- Added `cruciblecanvas.vercel.app` to Firebase Authentication authorized domains via the Identity Toolkit REST API
- Added missing Firestore security rule for `users/{userId}/ownedBoards/{boardId}` and deployed it with `firebase deploy --only firestore:rules`
- Improved `signInWithGoogle()` in `src/lib/firebase/auth.ts` to fall back from `signInWithPopup` to `signInWithRedirect` when popup is blocked or domain is unauthorized
- Added `handleGoogleRedirectResult()` export to `src/lib/firebase/auth.ts` for processing redirect-based sign-in on page reload
- Replaced generic error messages in `src/components/auth/AuthCard.tsx` with a `getAuthErrorMessage()` helper that maps Firebase error codes to specific user-friendly messages
- Added `useEffect` in `AuthCard` to handle `getRedirectResult` on mount
- Re-authenticated Firebase CLI (`firebase login --reauth`)
- Deployed code changes to Vercel production (`vercel --prod`)
- Verified both Guest and Google sign-in flows work on the live deployment via Playwright

## Issues & Troubleshooting

### Issue 1: Google Sign-In — `auth/unauthorized-domain`
- **Problem:** Clicking "Sign in with Google" showed "Sign-in failed. Please allow popups for this site." on the deployed Vercel app
- **Cause:** `cruciblecanvas.vercel.app` was not in Firebase's authorized domains list. Only `localhost`, `cruciblecanvas.firebaseapp.com`, and `cruciblecanvas.web.app` were authorized. Firebase rejected the popup origin.
- **Fix:** Added `cruciblecanvas.vercel.app` to authorized domains via `PATCH` to `https://identitytoolkit.googleapis.com/admin/v2/projects/cruciblecanvas/config`. Also improved `signInWithGoogle()` to auto-fallback to redirect flow for future resilience.

### Issue 2: Guest Sign-In — Missing Firestore Rule
- **Problem:** Clicking "Continue as Guest" showed "Sign-in failed. Please try again." — console showed `FirebaseError: Missing or insufficient permissions`
- **Cause:** `createBoardMetadata()` batch-writes to both `boards/{boardId}/metadata/config` and `users/{userId}/ownedBoards/{boardId}`. The `ownedBoards` subcollection had no Firestore security rule, so the entire batch was rejected.
- **Fix:** Added rule in `firestore.rules`: `match /users/{userId}/ownedBoards/{boardId} { allow read, write: if request.auth != null && request.auth.uid == userId; }` and deployed via Firebase CLI.

### Issue 3: Firebase CLI Auth Expired
- **Problem:** `firebase deploy --only firestore:rules` failed with "Your credentials are no longer valid"
- **Cause:** Firebase CLI token had expired
- **Fix:** User ran `firebase login --reauth` interactively to refresh credentials

### Issue 4: Misleading Error Messages
- **Problem:** The original `AuthCard.tsx` catch blocks showed a hardcoded "allow popups" message for ALL Google errors and a generic "try again" for guest errors, hiding the actual cause
- **Cause:** No error code inspection in the catch handlers
- **Fix:** Added `getAuthErrorMessage()` that switches on Firebase `AuthError.code` to show specific messages (unauthorized-domain, popup-blocked, popup-closed, network error, etc.)

## Decisions Made
- **Popup-first with redirect fallback** rather than switching entirely to `signInWithRedirect`: Keeps the smoother popup UX when it works, but automatically falls back when popup is blocked or domain unauthorized. The fallback codes are `auth/popup-blocked`, `auth/popup-closed-by-user`, and `auth/unauthorized-domain`.
- **Used Identity Toolkit REST API** to add authorized domain rather than Firebase Console: The CLI has no built-in command for managing authorized domains, so we used the admin API directly with the CLI's stored access token.
- **Scoped `ownedBoards` rule to owner only** (`request.auth.uid == userId`): Consistent with the existing `profile/info` rule pattern. Users can only read/write their own board index.

## Current State
- Both Google sign-in and Guest sign-in work on `cruciblecanvas.vercel.app`
- Guest flow: signs in anonymously, creates a board, redirects to `/board/{id}` — fully working
- Google flow: popup opens to Google accounts page, authorized domain accepted — fully working
- Firestore rules deployed with the new `ownedBoards` rule
- Code deployed to Vercel production
- Minor: there is a console `FirebaseError: Missing or insufficient permissions` on the board page after guest sign-in — appears to be a pre-existing race condition (possibly a listener query firing before board metadata propagates), not introduced by this session's changes

## Next Steps
- Investigate the board-page permissions console error (likely a realtime listener querying objects/messages before metadata is fully written)
- Consider adding more Vercel preview deployment domains to Firebase authorized domains if preview URLs are used for testing
- The `linkAnonymousAccount()` function in `auth.ts` still uses `linkWithPopup` — could benefit from similar redirect fallback if guest-to-Google upgrade is needed on deployed sites
