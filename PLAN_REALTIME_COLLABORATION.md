# Real-Time Collaboration Implementation Plan

## Status Baseline

### Confirmed Working
- **Object Sync**: `updateObjectLocal()` → `updateObject()` pattern with `locallyEditingIds` guard in `useFirestoreSync.ts:55` prevents echoes during resize. First snapshot bulk-loads; subsequent use `docChanges()`.
- **Soft Locking**: `acquireLock()` (rtdb.ts:111) writes to RTDB, `onDisconnect` auto-removes. All draggable components call `acquireLock` on dragStart, `releaseLock` on dragEnd. Lock indicator rendered on all object types.
- **Cursor Sync**: 30Hz throttle (Canvas.tsx:40, `CURSOR_THROTTLE_MS=33`), 5px distance threshold (Canvas.tsx:41), canvas-space coords via `getCanvasPoint()`. `CursorLayer.tsx` renders remote cursors with circle + name label, filters stale (>10s) and own cursors.

### Confirmed Missing
- **`onPresenceChange` (rtdb.ts:88)**: Exists but has ZERO callsites outside its own definition. No consumer anywhere.
- **No PresenceIndicator UI**: Grep for `*Presence*` / `*presence*` in src/ returns nothing.
- **No usePresenceSync hook**: `src/hooks/` contains only `useFirestoreSync`, `useLockSync`, `useFrameNesting`, `useKeyboardShortcuts`.
- **No presence store**: `src/lib/store/` contains only `authStore`, `objectStore`, `canvasStore`.
- **`setPresence` IS called on mount**: `page.tsx:67` inside useEffect with `[boardId, user, displayName]` deps.
- **No heartbeat / inactivity detection**: No `setInterval` for `lastSeen` updates, no `visibilitychange` listener.
- **Transformer resize has NO lock**: `SelectionLayer.tsx:194-203` calls `startLocalEdit` but not `acquireLock/releaseLock`.
- **Drag operations have NO locallyEditingIds guard**: `StickyNote.tsx:50`, `ShapeObject.tsx:49`, `FrameObject.tsx:53`, `ColorLegendObject.tsx:44` all call `acquireLock` but not `startLocalEdit/endLocalEdit`.
- **Cursor listener uses full-snapshot `onValue`**: `rtdb.ts:30-33` subscribes to entire `/cursors` node. Every cursor update triggers full snapshot to all listeners.

## Implementation Order

Changes ordered by dependencies:

1. **Presence Store** (new file, no deps)
2. **Presence Sync Hook** (depends on 1)
3. **Presence Indicator UI** (depends on 1, 2)
4. **Mount Presence UI + Inactivity Detection** (depends on 2, 3)
5. **Cursor Listener Optimization** (independent)
6. **CursorLayer Update Handler** (depends on 5)
7. **Drag Local Edit Guards** (independent)
8. **Transformer Soft Lock** (independent)

---

## Change 1: Presence Store

- **File**: `src/lib/store/presenceStore.ts` (new)
- **What**: Minimal Zustand store holding `Record<string, PresenceData>` presence map. Follows the same pattern as `objectStore.ts` for locks.
- **Interface**:
  - `presence: Record<string, PresenceData>` — all presence entries from RTDB
  - `setPresence(data: Record<string, PresenceData>)` — replaces entire map
- **Depends on**: `PresenceData` type from `types.ts` (already exists)

## Change 2: Presence Sync Hook

- **File**: `src/hooks/usePresenceSync.ts` (new)
- **What**: Hook that subscribes to `onPresenceChange(boardId, callback)` from rtdb.ts and writes to presenceStore. Follows exact pattern of `useLockSync.ts`.
- **Signature**: `usePresenceSync(boardId: string | undefined): void`
- **Logic**:
  - Guard: `if (!boardId) return`
  - Subscribe via `onPresenceChange(boardId, (presence) => { usePresenceStore.getState().setPresence(presence ?? {}) })`
  - Cleanup: `unsubscribe()` on unmount
- **Depends on**: rtdb.ts `onPresenceChange` (already exists), presenceStore (Change 1)

## Change 3: Presence Indicator UI

- **File**: `src/components/ui/PresenceIndicator.tsx` (new)
- **What**: HTML component (not Konva) rendering an avatar stack in the top-right of the board page.
- **Layout**:
  - Fixed position `top-4 right-4`, z-index above canvas but below modals
  - Row of overlapping colored circles (32px diameter, -8px margin overlap)
  - Each circle shows first initial of user name in white, filled with user's color
  - First 4 circles visible; if more, show "+N" pill
  - "N online" label to the left of avatars
  - Click on stack toggles a dropdown/popover listing all online users:
    - Each row: color dot (12px) + name + "(You)" label for current user
  - TailwindCSS styling consistent with brand (`#6366f1`, rounded-lg, shadow-md)
- **Props**: `boardId: string`
- **State**: Reads from `usePresenceStore` (all presence), `useAuthStore` (current user uid)
- **Filter**: Shows only users where `online === true`
- **Depends on**: presenceStore (Change 1), authStore (exists)

## Change 4: Mount Presence UI + Inactivity Detection

- **File**: `src/app/board/[boardId]/page.tsx` (modify)
- **What**:
  1. Import and call `usePresenceSync(user ? boardId : undefined)` alongside existing `useLockSync`
  2. Import and render `<PresenceIndicator boardId={boardId} />` in the JSX return block
  3. Add heartbeat: `setInterval` every 15s that calls `setPresence(boardId, user.uid, ...)` to update `lastSeen`
  4. Add `visibilitychange` listener: when tab hidden, clear heartbeat interval; when tab visible, restart heartbeat + immediate `setPresence` call
  5. Cleanup: clear interval + remove event listener on unmount
- **Depends on**: usePresenceSync (Change 2), PresenceIndicator (Change 3)

## Change 5: Cursor Listener Optimization

- **File**: `src/lib/firebase/rtdb.ts` (modify)
- **What**: Replace `onCursorsChange` (full-snapshot `onValue`) with granular per-cursor listeners:
  - New `onCursorAdded(boardId, callback)` using `onChildAdded`
  - New `onCursorChanged(boardId, callback)` using `onChildChanged`
  - New `onCursorRemoved(boardId, callback)` using `onChildRemoved`
  - Each callback receives `(userId: string, data: CursorData | null)`
  - Keep old `onCursorsChange` for backward compat but mark deprecated
- **New imports**: `onChildAdded, onChildChanged, onChildRemoved` from `firebase/database`
- **Depends on**: Nothing

## Change 6: CursorLayer Update Handler

- **File**: `src/components/canvas/CursorLayer.tsx` (modify)
- **What**: Switch from single `onCursorsChange` (full state replacement) to three granular listeners:
  - `onCursorAdded`: upsert individual cursor in state
  - `onCursorChanged`: upsert individual cursor in state
  - `onCursorRemoved`: delete individual cursor from state
  - State updates use functional `setCursors(prev => ...)` to avoid stale closure issues
  - Reduces React re-render payload: only the changed cursor triggers the filter/render cycle
- **Depends on**: Change 5

## Change 7: Drag Local Edit Guards

- **Files**: `StickyNote.tsx`, `ShapeObject.tsx`, `FrameObject.tsx`, `ColorLegendObject.tsx`
- **What**: Add `startLocalEdit(object.id)` in `handleDragStart` and `endLocalEdit(object.id)` in `handleDragEnd` (both success and error paths).
  - This prevents Firestore echoes from overwriting in-progress drag positions (same protection resize already has).
  - Import `useObjectStore` `startLocalEdit`/`endLocalEdit` — already imported via `useObjectStore` hook.
  - Call imperatively via `useObjectStore.getState().startLocalEdit(object.id)` in dragStart.
  - Call `useObjectStore.getState().endLocalEdit(object.id)` in dragEnd (before the Firestore write returns, after `releaseLock`).
  - For FrameObject: also call `startLocalEdit` for each child snapshot on dragStart, and `endLocalEdit` for each on dragEnd.
- **Depends on**: Nothing

## Change 8: Transformer Soft Lock

- **File**: `src/components/canvas/SelectionLayer.tsx` (modify)
- **What**: Add `acquireLock`/`releaseLock` calls to Transformer resize handlers:
  - `handleTransformStart`: After `startLocalEdit`, call `acquireLock(boardId, node.id(), userId, displayName)` for each selected node
  - `handleTransformEnd`: After `endLocalEdit`, call `releaseLock(boardId, id)` for each node
  - Need to access `boardId`, `userId`, `displayName`. Since SelectionLayer already uses `getBoardIdFromUrl()` workaround, use the same for boardId. Get `userId`/`displayName` from `useAuthStore`.
  - Import `acquireLock`, `releaseLock` from rtdb.ts
  - Import `useAuthStore` for user identity
- **Depends on**: Nothing

---

## Verification Plan

### Presence UI
1. Navigate to `localhost:3000`, log in, open a board
2. Screenshot top-right area — verify avatar stack renders with at least 1 user (self)
3. Click avatar stack — verify dropdown opens listing current user with "(You)" label
4. Open a second browser tab (or incognito) with different user, join same board
5. Screenshot both tabs — verify both show 2 online users
6. Close second tab, wait 30s — verify first tab shows 1 user

### Cursor Sync
1. Open two browser windows on same board
2. Move mouse on window 1, screenshot window 2 — verify remote cursor appears with name label
3. Check cursor color matches between cursor and presence indicator

### Object Sync
1. Open two browser windows on same board
2. Create a sticky note on window 1, screenshot window 2 — verify it appears
3. Drag object on window 1, screenshot window 2 — verify it moves
4. Check for lock indicator on window 2 during drag

### Performance
1. Navigate to a board with dev tools open
2. Verify no console errors from new code
3. Create multiple objects, drag them — verify smooth 60fps

---

## Risk Assessment

1. **Heartbeat writes**: Every 15s × N users = N writes per 15s to RTDB presence. At 10 users = ~40 writes/min. Acceptable for RTDB free tier.
2. **Presence store memory**: Minimal — just a map of userId → PresenceData. Negligible.
3. **Cursor optimization migration**: Old `onCursorsChange` will be deprecated but kept. CursorLayer is the only consumer, so migration is safe.
4. **Drag local edit guard timing**: `endLocalEdit` is called synchronously before the async Firestore write. The Firestore echo arrives after the write completes, by which time the guard is already released. This is correct — the echo will carry the final position which matches the local state.
5. **Transformer lock with getBoardIdFromUrl**: URL parsing workaround is already used for Firestore writes in SelectionLayer. Adding lock calls with same boardId source is consistent.
6. **FrameObject child drag guards**: Need to ensure `endLocalEdit` is called for ALL children in both success and error paths to prevent permanent guard leaks.
