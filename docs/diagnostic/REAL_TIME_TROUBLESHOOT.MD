# Realtime Multiplayer Troubleshooting

## Issue

Other users' cursors are not visible and other users do not appear in the online user list.

## Root Cause

**Firebase RTDB security rules are blocking all reads and writes.**

Confirmed via diagnostic test: an authenticated anonymous user can sign in (Firebase Auth works) but writing to RTDB at `boards/{boardId}/presence/{userId}` fails with `PERMISSION_DENIED`. The default RTDB rules deny all access, which means:

- Cursor data written by other users cannot be read (cursors invisible)
- Presence data written by other users cannot be read (online list empty)
- Your own presence/cursor writes also fail silently

The writes appeared to succeed from the app's perspective because all `.catch()` handlers only logged to `presenceLogger` (a debug tool disabled by default), making RTDB errors completely invisible.

## Fix Applied

### 1. RTDB Security Rules (deploy required)

Created `database.rules.json` with rules that allow authenticated users to read all board data and write only their own cursor/presence entries:

```json
{
  "rules": {
    "boards": {
      "$boardId": {
        "cursors": {
          ".read": "auth != null",
          "$userId": { ".write": "auth != null && auth.uid === $userId" }
        },
        "presence": {
          ".read": "auth != null",
          "$userId": { ".write": "auth != null && auth.uid === $userId" }
        },
        "locks": {
          ".read": "auth != null",
          ".write": "auth != null"
        }
      }
    }
  }
}
```

**To deploy:**

```bash
firebase login --reauth
firebase deploy --only database
```

Supporting files created: `firebase.json`, `.firebaserc` (project: `cruciblecanvas`).

### 2. Silent Error Handling Fixed (`src/lib/firebase/rtdb.ts`)

- Added `cancelCallback` (3rd argument) to all 6 RTDB child listeners (`onChildAdded`, `onChildChanged`, `onChildRemoved` for both cursors and presence). Previously, when security rules denied read access, these listeners were **silently cancelled** with no error logged anywhere.
- Added `console.error` to `setCursor` and `setPresence` write failures so RTDB permission errors appear in the browser console.
- Added a shared `handleListenerError()` function that logs the error with a clear message pointing to RTDB security rules as the likely cause.

### 3. Ghost Node Prevention (`src/hooks/useMultiplayer.ts`)

When a user leaves a board, the cleanup function called `removePresence()` to delete the RTDB node. However, the `onDisconnect` handler (registered by `setupPresenceDisconnect`) was still active on the server. When the connection subsequently dropped, `onDisconnect().update({online: false})` would re-create a partial ghost node (missing `name`, `color`, etc.).

Fix: Added `cancelPresenceDisconnect()` and `cancelCursorDisconnect()` calls before removal in the cleanup function. New exported functions `cancelPresenceDisconnect` and `cancelCursorDisconnect` in `rtdb.ts` call `onDisconnect(ref).cancel()`.

### 4. Missing Config Warning (`src/lib/firebase/config.ts`)

Added a runtime `console.warn` if `NEXT_PUBLIC_FIREBASE_DATABASE_URL` is not set, since RTDB features silently fail without it.

## Diagnostic Method

Created a Node.js script that:
1. Reads Firebase config from `.env.local`
2. Initializes Firebase client SDK
3. Signs in anonymously
4. Attempts to write test presence data to RTDB
5. Reports success or failure with diagnosis

Result: Auth succeeded, write failed with `PERMISSION_DENIED` — confirming RTDB rules as the root cause.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/firebase/rtdb.ts` | Added `cancelCallback` to listeners, `console.error` on writes, new `cancelPresenceDisconnect` and `cancelCursorDisconnect` exports |
| `src/hooks/useMultiplayer.ts` | Cancel onDisconnect handlers before cleanup removal |
| `src/lib/firebase/config.ts` | Warning if `databaseURL` env var is missing |
| `database.rules.json` | **New** — RTDB security rules |
| `firebase.json` | **New** — Firebase config pointing to rules file |
| `.firebaserc` | **New** — Default project set to `cruciblecanvas` |
