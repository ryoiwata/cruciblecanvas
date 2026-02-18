# CrucibleCanvas Real-Time Collaboration — Current Implementation Audit

## Executive Summary

CrucibleCanvas implements a collaborative whiteboard using React + Konva.js for rendering, Zustand for client state, Firestore for persistent object storage with real-time listeners, and Firebase Realtime Database (RTDB) for cursors, presence, and soft locks. The architecture follows the specified optimistic-update pattern: user actions immediately update Zustand, then asynchronously write to Firestore, with a snapshot listener reconciling remote changes back into Zustand.

The **object sync** system is well-implemented with a clear data flow, local edit guards to suppress Firestore echoes during active manipulation, rollback on write failure, and soft locking via RTDB with `onDisconnect()` cleanup. Lock indicators are rendered on all draggable object types. The **cursor sync** system is fully functional with 30Hz throttling, 5px distance threshold, canvas-space coordinates, color generation from user IDs, and `onDisconnect()` cleanup. Cursors render on a dedicated non-listening Konva layer.

The **presence system** has its backend infrastructure fully built (RTDB write/read/onDisconnect) but **no UI component exists** — there is no avatar stack, no online user list, no presence indicator anywhere in the rendered board page. The `onPresenceChange` listener function exists in `rtdb.ts` but is never imported or called by any component or hook.

## File Inventory

| File | Role |
|------|------|
| `src/lib/firebase/config.ts` | Firebase app init; exports `auth`, `db` (Firestore), `rtdb` |
| `src/lib/firebase/firestore.ts` | Firestore CRUD: `createObject`, `updateObject`, `deleteObject`, batch variants |
| `src/lib/firebase/rtdb.ts` | RTDB functions: cursor, presence, lock read/write/disconnect |
| `src/lib/firebase/auth.ts` | Auth methods (guest, Google, email) |
| `src/lib/store/objectStore.ts` | Zustand store: objects, locks, `locallyEditingIds`, CRUD actions |
| `src/lib/store/canvasStore.ts` | Zustand store: mode, selection, viewport, clipboard, context menu |
| `src/lib/store/authStore.ts` | Zustand store: current user, displayName, isAnonymous |
| `src/lib/types.ts` | All type definitions: `BoardObject`, `CursorData`, `PresenceData`, `ObjectLock` |
| `src/lib/utils.ts` | `getUserColor()`, `getCanvasPoint()`, geometry helpers |
| `src/lib/resizeState.ts` | Non-reactive resize flags (`borderResizingIds`, `isTransforming`) |
| `src/lib/konvaSync.ts` | Direct Konva child node sync for resize operations |
| `src/hooks/useFirestoreSync.ts` | Firestore `onSnapshot` listener for board objects |
| `src/hooks/useLockSync.ts` | RTDB listener for lock changes |
| `src/hooks/useKeyboardShortcuts.ts` | Keyboard shortcuts (delete, copy, paste, duplicate, layering) |
| `src/hooks/useFrameNesting.ts` | Auto-nesting objects into frames on drag end |
| `src/app/board/[boardId]/page.tsx` | Board page: mounts Canvas, Toolbar, calls presence/cursor setup |
| `src/components/canvas/Canvas.tsx` | Konva Stage, all mouse event handlers, cursor sync writes |
| `src/components/canvas/BoardObjects.tsx` | Renders all objects with viewport culling and z-sorting |
| `src/components/canvas/CursorLayer.tsx` | Renders remote cursors from RTDB |
| `src/components/canvas/SelectionLayer.tsx` | Konva Transformer for selection/resize |
| `src/components/canvas/StickyNote.tsx` | Sticky note: drag, lock indicator, resize border |
| `src/components/canvas/ShapeObject.tsx` | Rectangle/Circle: drag, lock indicator, resize border |
| `src/components/canvas/FrameObject.tsx` | Frame: drag with children, lock indicator |
| `src/components/canvas/ColorLegendObject.tsx` | Color legend: drag, lock indicator |
| `src/components/canvas/ConnectorObject.tsx` | Connector lines between objects |
| `src/components/canvas/TextEditor.tsx` | HTML textarea overlay for text editing |
| `src/components/canvas/ResizeBorder.tsx` | Invisible border zones for edge/corner resize |
| `src/components/canvas/DotGrid.tsx` | Infinite dot grid background |
| `src/components/canvas/GhostPreview.tsx` | Ghost shape preview during create mode |
| `src/components/canvas/AnchorPoints.tsx` | Connector anchor dots on objects |
| `src/providers/AuthProvider.tsx` | `onAuthStateChanged` listener → authStore |

---

## Feature 1: Real-Time Object Sync

### Data Flow (End to End)

**Example: User A drags a sticky note; User B sees it update.**

1. **User A mousedown on StickyNote** → `StickyNote.tsx:50` `handleDragStart()`:
   - Saves pre-drag position in `preDragPos.current` (line 52)
   - Calls `groupRef.current?.moveToTop()` (line 53) — visual-only, moves Konva node to top of its layer
   - Calls `acquireLock(boardId, object.id, user.uid, displayName)` (line 54) → `rtdb.ts:111-125`:
     - Writes `{ userId, userName, timestamp }` to RTDB at `/boards/{boardId}/locks/{objectId}`
     - Registers `onDisconnect(lockRef).remove()` so lock is auto-released on disconnect

2. **User A drags** → `StickyNote.tsx:57` `handleDragMove()`:
   - Calls `updateObjectLocal(object.id, { x: node.x(), y: node.y() })` (line 59)
   - This updates Zustand's `objects` map in-place via `objectStore.ts:49-57`
   - **No Firestore write occurs during drag** — only local Zustand state is updated
   - React re-renders StickyNote with new x/y from the store

3. **User A mouseup** → `StickyNote.tsx:62` `handleDragEnd()`:
   - Rounds final coordinates (lines 64-65)
   - Calls `updateObjectLocal()` with rounded values (line 68) — final local state
   - Calls `releaseLock(boardId, object.id)` (line 69) → `rtdb.ts:127-130`: removes RTDB lock node
   - Calls `await updateObject(boardId, object.id, { x: finalX, y: finalY })` (line 72)
   - `firestore.ts:61-82`: strips immutable fields, adds `updatedAt: serverTimestamp()`, calls `updateDoc()`

4. **Firestore write propagates** → Firestore server receives the update, sets server timestamp

5. **Firestore listener fires on ALL clients** (including User A) → `useFirestoreSync.ts:47`:
   - `onSnapshot` callback processes `docChanges()`
   - For `"modified"` changes (line 53):
     - Checks `locallyEditingIds.has(change.doc.id)` (line 55)
     - If the object is NOT in `locallyEditingIds`, calls `upsertObject(obj)` to update Zustand
     - Since User A already released the lock and did NOT call `startLocalEdit` for drags (only for Transformer resizes and border resizes), the echo WILL be processed by User A too
   - For User B: `upsertObject` updates `objects[id]` in Zustand → React re-renders → User B sees the moved object

6. **Rollback on failure** (StickyNote.tsx:73-77):
   - If `updateObject()` throws, the catch block reverts the Konva node position and calls `updateObjectLocal()` with the saved `preDragPos`

### Firestore Listener Lifecycle

**Setup** (`useFirestoreSync.ts:14-76`):
- Called from `src/app/board/[boardId]/page.tsx:56` as `useFirestoreSync(user ? boardId : undefined)`
- Only activates when `user` is authenticated AND `boardId` is truthy
- Creates a Firestore `onSnapshot` listener on `collection(db, "boards", boardId, "objects")` (line 26)
- Uses `isFirstSnapshot` ref to distinguish initial load from incremental updates

**First snapshot** (lines 32-42):
- Bulk-loads all documents into a single `Record<string, BoardObject>` map
- Calls `setObjects(objects)` — replaces entire Zustand objects map
- Marks `setIsLoaded(true)` — triggers board UI to render (page.tsx:96 checks `isObjectsLoaded`)

**Subsequent snapshots** (lines 46-63):
- Iterates `docChanges()` — only processes incremental changes
- `"added"` / `"modified"`: checks `locallyEditingIds`, skips if object is being locally edited, otherwise calls `upsertObject(obj)`
- `"removed"`: calls `removeObject(change.doc.id)` unconditionally

**Teardown** (lines 72-74):
- Returns `unsubscribe()` from the `useEffect` cleanup function
- On unmount or `boardId` change, the Firestore listener is properly unsubscribed
- On remount (React StrictMode), `isFirstSnapshot` is reset to `true` and `isLoaded` is set to `false` (lines 21-22)

**Error handling** (lines 65-69):
- Logs error to console
- Still marks `isLoaded: true` so the UI doesn't spin forever on a loading screen

### Optimistic Update Pattern

The pattern is **truly optimistic** for all object operations:

1. **Object creation**: `upsertObject()` adds the object to Zustand immediately with a pre-generated ID from `generateObjectId()`. Then `createObject()` writes to Firestore asynchronously. The ID is stable because it's generated via `doc(colRef).id` which produces a Firestore document reference ID without writing.

2. **Object movement (drag)**: `updateObjectLocal()` updates Zustand on every `dragMove` event. Firestore write happens only on `dragEnd`. The local user sees smooth dragging at 60fps without network latency.

3. **Object deletion**: `removeObject()` / `batchRemove()` removes from Zustand immediately. `deleteObject()` / `deleteObjects()` persists to Firestore asynchronously.

4. **Object property changes** (color, opacity, text): `updateObjectLocal()` first, then `updateObject()` to Firestore.

**Ordering guarantee**: `updateObjectLocal` is always called BEFORE `updateObject`. They are independent operations — Zustand update is synchronous, Firestore write is async. There is no transactional coupling. If the Firestore write fails, only drag operations have rollback logic (StickyNote, ShapeObject, FrameObject). Color changes, opacity changes, and text edits do NOT rollback on Firestore failure — they just log an error.

### Local Edit Guards (startLocalEdit / endLocalEdit)

**Implementation** (`objectStore.ts:89-101`):
- `locallyEditingIds` is a `Set<string>` in Zustand state
- `startLocalEdit(id)`: adds `id` to the set
- `endLocalEdit(id)`: removes `id` from the set

**What they protect against**:
- When a Firestore snapshot arrives (`useFirestoreSync.ts:55`), the listener checks `locallyEditingIds.has(change.doc.id)`. If the object is being locally edited, the incoming Firestore data is **silently discarded**. This prevents the "echo problem" where User A's own Firestore write echoes back through the listener and overwrites in-progress local state (e.g., during a resize, the intermediate Konva dimensions would be overwritten by the slightly-stale Firestore echo).

**Where guards are used**:
1. **Transformer resize** (`SelectionLayer.tsx:199-202`): `startLocalEdit` called in `handleTransformStart` for all selected nodes. `endLocalEdit` called in `handleTransformEnd` after persisting (line 275).
2. **Border resize** (`Canvas.tsx:994`): `startLocalEdit` called when border resize starts. `endLocalEdit` called on mouseUp after persisting (line 781).
3. **NOT used for regular drags**: `StickyNote.tsx`, `ShapeObject.tsx`, `FrameObject.tsx`, `ColorLegendObject.tsx` do NOT call `startLocalEdit`/`endLocalEdit` during drag operations.

**What they do NOT protect against**:
- During a regular object drag (not a resize), there is no local edit guard. If User B modifies the same object while User A is dragging it, User A will receive the Firestore echo and `upsertObject` will overwrite the dragged position. However, this is partially mitigated by the soft lock: User B's client sees the lock and prevents dragging (though color/text changes are not lock-gated).
- The guard is all-or-nothing per object. If a guard is active, ALL property changes from Firestore are suppressed, not just the specific properties being edited. This means if User A is resizing an object and User B changes its color, User A will miss the color change entirely.
- There is no timeout on guards. If `endLocalEdit` is never called (e.g., component unmounts mid-resize without cleanup), the guard persists forever for that session. The border resize does have a mode-change cleanup (`Canvas.tsx:1004-1018`) that calls `endLocalEdit`, but there is no equivalent for Transformer resizes other than the `handleTransformEnd` callback.

### Soft Locking

**Acquisition** (`rtdb.ts:111-125`):
- Called from `handleDragStart` in each draggable component:
  - `StickyNote.tsx:54`, `ShapeObject.tsx:53`, `FrameObject.tsx:66`, `ColorLegendObject.tsx:48`
  - Also called during border resize start: `Canvas.tsx:997`
- Writes `{ userId, userName, timestamp }` to `/boards/{boardId}/locks/{objectId}`
- Registers `onDisconnect(lockRef).remove()` — RTDB server will auto-delete the lock if the client disconnects

**Release** (`rtdb.ts:127-130`):
- Called from `handleDragEnd` in each component: `StickyNote.tsx:69`, `ShapeObject.tsx:68`, `FrameObject.tsx:103`, `ColorLegendObject.tsx:62`
- Called from border resize end: `Canvas.tsx:789`
- Calls `remove(lockRef)` to delete the RTDB node

**Disconnect handling**:
- `onDisconnect(lockRef).remove()` is configured at acquisition time. If the client crashes or loses connection, the RTDB server removes the lock node automatically. This is correctly implemented.
- **Note**: `onDisconnect` is registered on every lock acquisition. Since each acquisition registers a new `onDisconnect`, there are no stale handlers from previous locks on different objects.

**Reading locks** (`useLockSync.ts:11-23`):
- `useLockSync(boardId)` subscribes to `onLocksChange(boardId, callback)` from `rtdb.ts:132-140`
- `onValue` listener on `/boards/{boardId}/locks` fires on any lock change
- Callback writes to `useObjectStore.getState().setLocks(locks ?? {})`
- Converts `null` (no locks) to empty object

**How other clients react** (`BoardObjects.tsx:94-96`):
- For each rendered object, `lock = locks[obj.id]` is checked
- `isLockedByOther = !!lock && lock.userId !== userId` — only other users' locks matter
- `lockedByName = isLockedByOther ? lock.userName : null`
- These props are passed to `StickyNote`, `ShapeObject`, `FrameObject`, `ColorLegendObject`

**Lock effects on components**:
- **Draggability**: `isDraggable = mode === "pointer" && !isLocked` — locked objects cannot be dragged by other users (`StickyNote.tsx:48`, `ShapeObject.tsx:47`, `FrameObject.tsx:51`, `ColorLegendObject.tsx:41`)
- **Visual indicator**: All four component types render a lock label when `isLocked && lockedByName`: `🔒 {lockedByName}` at bottom-left of the object (`StickyNote.tsx:171-179`, `ShapeObject.tsx:144-153`, `FrameObject.tsx:216-225`, `ColorLegendObject.tsx:180-189`)
- **Opacity dimming**: Locked objects render at `opacity={(isLocked ? 0.6 : 1) * (object.opacity ?? 1)}` — 60% opacity when locked by another user
- **Resize border**: `enabled={mode === "pointer" && !isLocked}` — resize borders are disabled for locked objects (`StickyNote.tsx:186`, `ShapeObject.tsx:160`)
- **Connectors**: Do not have lock props or lock behavior — they are not directly draggable

**Lock limitations**:
- Locks only prevent dragging and resizing. Other operations like color change, text editing, and deletion via context menu are NOT gated by locks. A user can right-click a locked object, change its color, edit its text, or delete it.
- Locks are not checked before Firestore writes. The lock is purely a UI hint — there is no server-side enforcement.

### Conflict Scenarios

**Two users drag the same object simultaneously**:
1. User A starts dragging → acquires lock → User B sees lock, cannot drag (UI disabled)
2. If User B's client hasn't received the lock update yet (RTDB propagation delay), User B could theoretically start dragging before seeing the lock. Both would then write to Firestore on dragEnd. Last write wins — whichever `updateObject` call reaches Firestore last sets the final position.
3. The "losing" user will see their position overwritten by the Firestore listener on the next snapshot.

**User A resizes while User B changes color**:
1. User A starts resize → `startLocalEdit(id)` — suppresses ALL Firestore echoes for this object
2. User B changes color → writes to Firestore → Firestore echo arrives at User A
3. User A's listener silently discards the echo because `locallyEditingIds.has(id)` is true
4. User A finishes resize → `endLocalEdit(id)` → writes resize dimensions to Firestore
5. The next Firestore snapshot User A receives will include User B's color change (since the guard is now off), but User A's resize echo may overwrite it depending on timing. Since `updateObject` only writes the changed fields (`{ x, y, width, height }`) with `updatedAt: serverTimestamp()`, the color field should persist. Both updates are additive — no data loss expected for non-overlapping fields.

**User A deletes an object User B is dragging**:
1. User A deletes → `removeObject()` locally, `deleteObject()` to Firestore
2. User B is still dragging — the Konva node still exists locally
3. Firestore listener fires `"removed"` → `removeObject(id)` runs on User B's client → object disappears from Zustand
4. User B's dragEnd handler fires, but the object no longer exists in the store. The `updateObject` Firestore call will fail (document doesn't exist). The error is caught and logged.

### Object Operations Sync

| Operation | Local Update | Firestore Write | Rollback? | Lock Acquired? |
|-----------|-------------|-----------------|-----------|----------------|
| **Create (drag-to-create)** | `upsertObject()` on threshold cross | `createObject()` on mouseUp | No | No |
| **Create (click-to-create)** | `upsertObject()` on mouseUp | `createObject()` on mouseUp | No | No |
| **Move (drag)** | `updateObjectLocal()` on dragMove | `updateObject()` on dragEnd | Yes | Yes |
| **Resize (Transformer)** | Konva scale during transform | `updateObject()` on transformEnd | No | No (but `startLocalEdit` used) |
| **Resize (border)** | Direct Konva manipulation via RAF | `updateObject()` on mouseUp | No | Yes |
| **Delete** | `removeObject()`/`batchRemove()` | `deleteObject()`/`deleteObjects()` | No | No |
| **Color change** | `updateObjectLocal()` | `updateObject()` | No | No |
| **Opacity change** | `updateObjectLocal()` | `updateObject()` | No | No |
| **Text edit** | `updateObjectLocal()` on commit | `updateObject()` on commit | No | No |
| **Duplicate** | `upsertObject()` | `createObject()` | No | No |
| **Paste** | `upsertObject()` per object | `createObject()` per object | No | No |

### Deviations from Spec

1. **No rollback on most write failures**: Only drag operations (move) implement rollback on Firestore write failure. Resize, color change, text edit, delete, and create operations do not rollback. The catch block just logs the error.

2. **No startLocalEdit for drag operations**: Drag operations do not use the local edit guard. This means Firestore echoes can arrive during a drag and overwrite the local position. However, the soft lock mitigates this by preventing other users from dragging the same object.

3. **Lock does not gate all operations**: Spec implies locks prevent editing by other users. Implementation only prevents dragging and resizing — color, text, opacity, and deletion are unrestricted.

4. **No soft lock during Transformer resize**: `SelectionLayer.tsx` calls `startLocalEdit` but does NOT call `acquireLock`. Other users can still attempt to interact with an object being Transformer-resized (though the local edit guard suppresses echoes).

### Missing Pieces

1. **No debouncing/batching on Firestore writes**: Each property change triggers an immediate `updateObject()` call. There is no debounce for rapid changes (e.g., quickly changing colors or opacity slider adjustments). The opacity slider in the context menu fires `updateObject` on every `onChange` event.

2. **No conflict resolution beyond last-write-wins**: Spec mentions "last-write-wins (Firestore server timestamp)" — this is the default Firestore behavior and is implicitly used via `serverTimestamp()` on `updatedAt`. But there is no explicit conflict detection or merge logic.

---

## Feature 2: Multiplayer Cursors

### Cursor Data Flow (End to End)

**Local cursor → RTDB → Remote render:**

1. **Mouse moves on canvas** → `Canvas.tsx:505` `handleMouseMove()`:
   - Gets pointer position from `stage.getPointerPosition()` (line 510)
   - After all mode-specific logic, reaches cursor sync section (line 699)

2. **Throttle check** (lines 701-703):
   - `if (now - lastCursorSend.current < CURSOR_THROTTLE_MS) return;`
   - `CURSOR_THROTTLE_MS = 33` (line 40) — 33ms = ~30Hz ✓

3. **Distance check** (lines 712-714):
   - Computes squared distance from last sent position
   - `if (dx * dx + dy * dy < CURSOR_MIN_DISTANCE * CURSOR_MIN_DISTANCE) return;`
   - `CURSOR_MIN_DISTANCE = 5` (line 41) — 5px threshold ✓

4. **Coordinate conversion** (lines 704-711):
   - Uses `getCanvasPoint(stage.x(), stage.y(), stage.scaleX(), pointer.x, pointer.y)` → `utils.ts:39-50`
   - Converts screen-space pointer to **canvas-space** coordinates: `x = (pointerX - stageX) / stageScale`
   - Cursor positions are stored in canvas-space (invariant to pan/zoom)

5. **RTDB write** (lines 719-725):
   - Calls `setCursor(boardId, user.uid, { x, y, name, color, timestamp })` → `rtdb.ts:17-24`
   - `setCursor` calls `set(cursorRef, data)` on `/boards/{boardId}/cursors/{userId}`
   - The `set()` call is fire-and-forget (no await, no error handling)
   - Data shape: `{ x: number, y: number, name: string, color: string, timestamp: number }`
   - `color` is `getUserColor(user.uid)` — same function used everywhere

6. **Remote listener** (`CursorLayer.tsx:25-30`):
   - `onCursorsChange(boardId, callback)` → `rtdb.ts:26-34`
   - `onValue` listener on `/boards/{boardId}/cursors` fires whenever any cursor changes
   - Callback sets React state: `setCursors(data ?? {})`

7. **Rendering** (`CursorLayer.tsx:34-57`):
   - Filters out local user's cursor (`id === userId`) (line 36)
   - Filters out stale cursors older than 10 seconds (`STALE_THRESHOLD_MS = 10_000`) (line 38)
   - **Note**: Stale threshold uses `Date.now()` computed once per render (line 32), NOT per cursor check. This means if the component doesn't re-render, stale cursors linger until the next RTDB update triggers a re-render.
   - Renders each cursor as a Konva `Group` at `(cursor.x, cursor.y)` containing:
     - `Circle` with `radius={6}` and `fill={cursor.color}` (line 46)
     - `Text` with `text={cursor.name}`, `y={10}` below the circle, `fontSize={12}`, `fill={cursor.color}` (lines 47-54)

### Throttling & Optimization

- **30Hz throttle**: Implemented via `CURSOR_THROTTLE_MS = 33` and `lastCursorSend.current` timestamp check. Correct. ✓
- **5px distance threshold**: Implemented via `CURSOR_MIN_DISTANCE = 5` with squared distance comparison. Correct. ✓
- **Coordinate space**: Cursors are stored in canvas-space. Remote cursors render in canvas-space within the Konva stage. Pan/zoom transformations are automatically handled by the Stage's `x`, `y`, and `scaleX`/`scaleY` — remote cursors move correctly with the canvas. ✓

### Cursor Rendering

- **Component**: `CursorLayer.tsx` — a dedicated component
- **Layer**: Rendered inside `Canvas.tsx:1149-1151` on **Layer 4**, a dedicated layer with `listening={false}`:
  ```jsx
  <Layer listening={false}>
    <CursorLayer boardId={boardId} />
  </Layer>
  ```
- **Visual appearance**:
  - Circle: `radius={6}` (12px diameter ✓), filled with user's color
  - Name label: `Text` component, `fontSize={12}`, positioned at `y={10}` below the circle center, same color as circle
  - **Spec says**: "Circle (12px radius)" — implementation uses `radius={6}` (6px radius = 12px diameter). This is a minor spec discrepancy — the circle is 12px across rather than 24px across.

### Color Generation

`utils.ts:6-14` — `getUserColor(userId: string): string`:
- Hashes the userId string to a 32-bit integer using a character-based hash function
- Extracts hue from `hash % 360`
- Fixed saturation=70%, lightness=55%
- Converts HSL to hex via `hslToHex()`
- Deterministic: same userId always produces the same color across all sessions and clients ✓
- Used for both cursor rendering (Canvas.tsx:723) and presence writing (page.tsx:65)

### Cleanup & Disconnect

- **`setupCursorDisconnect`** (`rtdb.ts:46-52`): Called from `page.tsx:75` on board mount
  - `onDisconnect(cursorRef).remove()` — RTDB server auto-removes cursor on disconnect ✓
- **Manual cleanup** (`page.tsx:77-79`): On component unmount (leaving the board):
  - `removePresence(boardId, user.uid)` — explicitly removes presence
  - `removeCursor(boardId, user.uid)` — explicitly removes cursor
- **Stale cursor filtering**: `CursorLayer.tsx:38` — cursors older than 10 seconds are not rendered, even if the RTDB node persists

### Coordinate Space Handling

Cursor positions are converted to canvas-space using `getCanvasPoint()` before writing to RTDB. Remote cursors are rendered within the Konva `<Layer>` which inherits the Stage's pan/zoom transform. This means:
- When User A pans or zooms, their cursor position is correctly recorded in canvas-space
- When User B views, the remote cursor renders at the correct canvas position regardless of User B's pan/zoom state
- This is correct and matches the spec ✓

### Deviations from Spec

1. **Circle radius**: Spec says "Circle (12px radius)". Implementation uses `radius={6}` (6px radius = 12px diameter). If spec means 12px radius (24px diameter), the cursor is half the specified size.

2. **No interpolation/smoothing**: Remote cursor movement is not interpolated — cursors jump to new positions on each RTDB update. At 30Hz this appears fairly smooth but may be jittery on poor network connections.

### Missing Pieces

1. **No cursor animation/transition**: Cursors snap to positions rather than interpolating smoothly.

2. **Cursor write is fire-and-forget**: `setCursor` does not handle errors. If the RTDB write fails (e.g., permissions issue), there is no feedback or retry.

---

## Feature 3: Presence Awareness

### Presence Data Flow

**Writing presence** (`page.tsx:62-80`):
- On board page mount, after auth resolves, `setPresence()` is called (line 67):
  ```js
  setPresence(boardId, user.uid, {
    name: displayName || "Guest",
    email: user.email || undefined,
    photoURL: user.photoURL || undefined,
    color: getUserColor(user.uid),
    isAnonymous: user.isAnonymous,
  });
  ```
- `rtdb.ts:62-86` `setPresence()`:
  - Strips `undefined` values from the data object (RTDB rejects `undefined`)
  - Writes to `/boards/{boardId}/presence/{userId}` with `online: true` and `lastSeen: Date.now()`
  - Registers `onDisconnect(presenceRef).update({ online: false, lastSeen: serverTimestamp() })` — on disconnect, marks user as offline with server timestamp

**Reading presence**:
- `onPresenceChange()` function exists in `rtdb.ts:88-96`
- **It is NEVER called anywhere in the codebase**. No component, hook, or page imports or uses `onPresenceChange`.
- There is no presence listener, no presence state in any Zustand store, and no presence UI.

**Cleanup** (`page.tsx:77-79`):
- On component unmount: `removePresence(boardId, user.uid)` — fully removes the presence node from RTDB
- On disconnect: `onDisconnect` handler sets `online: false` (but doesn't remove the node)
- These two cleanup paths are slightly inconsistent: manual unmount removes the node entirely, while disconnect just marks offline. The disconnect path is more graceful (preserves the `lastSeen` timestamp).

### UI Implementation

**There is no presence UI component.** The entire presence display is unimplemented:
- No `PresenceIndicator.tsx` or similar component exists in the project
- No avatar stack is rendered anywhere
- The board page (`page.tsx:107-126`) renders only: `Toolbar`, `ShortcutLegend`, `Canvas`, `ContextMenu`, `ColorPicker`, and `DeleteDialog`
- There is no "who's online" indicator, no user count, no avatar circles

### Disconnect Handling

- **`onDisconnect`**: Correctly configured in `setPresence()` (`rtdb.ts:82-85`). On disconnect, updates `{ online: false, lastSeen: serverTimestamp() }`. ✓
- **Manual cleanup**: `removePresence()` called on component unmount (`page.tsx:78`). ✓
- **Inactivity threshold**: NOT implemented. There is no heartbeat, no idle detection, no timer that marks a user as inactive after 30 seconds. The `online` field only changes on explicit disconnect or component unmount.
- **Page unload**: Component unmount triggers the cleanup function. However, `useEffect` cleanup may not fire on hard browser close/crash — the `onDisconnect` handler covers this case.
- **Tab switching**: No `visibilitychange` listener. If a user switches tabs, they remain "online" indefinitely.

### Anonymous vs Authenticated Users

- `PresenceData` includes `isAnonymous: boolean` field (`types.ts:148`)
- Anonymous users have `name: displayName || "Guest"` and `email: undefined` (stripped before RTDB write)
- Authenticated users have actual `name`, `email`, and `photoURL`
- Since there is no presence UI, this distinction has no visible effect

### Deviations from Spec

1. **No presence UI at all**: Spec requires avatar stack in top-right corner with overlapping circles, "+N" overflow, "Online" status label, and click-to-expand user list. None of this exists.

2. **No presence listener**: `onPresenceChange()` is defined but never used. No component subscribes to presence updates from other users.

3. **No inactivity threshold**: Spec requires 30-second offline threshold. No such mechanism exists.

### Missing Pieces

1. **Presence UI component** (avatar stack, click-to-expand list)
2. **Presence listener hook** (subscribe to `onPresenceChange`, maintain state)
3. **Inactivity detection** (idle timer, `visibilitychange` handler)
4. **Heartbeat** (periodic presence updates to keep `lastSeen` current)
5. **Integration with cursor color** — while the same `getUserColor()` function is used for both cursor color and presence `color` field, since there's no presence UI, the consistency is untestable

---

## Performance Assessment

### Frame Rate (Target: 60 FPS)

**Optimization mechanisms present:**

1. **Viewport culling** (`BoardObjects.tsx:58-78`):
   - Computes viewport bounds in canvas-space with 200px padding
   - Objects outside the viewport are skipped entirely (not rendered)
   - Connectors skip culling (they may span the viewport) — potential issue with many off-screen connectors

2. **Layer splitting** (`Canvas.tsx:1092-1151`):
   - Layer 1: DotGrid (`listening={false}`) — no event processing ✓
   - Layer 2: BoardObjects + GhostPreview — handles interaction events
   - Layer 3: SelectionLayer (Transformer) + selection rect
   - Layer 4: CursorLayer (`listening={false}`) — no event processing ✓

3. **React.memo on all object components**:
   - `StickyNote`, `ShapeObject`, `FrameObject`, `ColorLegendObject`, `ConnectorObject` are all wrapped in `memo()`
   - Custom comparison functions skip re-render during border resize (`borderResizingIds.has(nextProps.object.id)`)
   - Deep equality on `object` prop reference — Zustand creates new references on every update, but only changed objects get new references

4. **RAF-gated rendering during border resize** (`Canvas.tsx:610-628`):
   - Multiple mousemove events between frames are coalesced
   - Only the latest resize dimensions are painted per animation frame
   - Direct Konva node manipulation bypasses React reconciliation entirely

5. **RAF-gated selection rectangle** (`Canvas.tsx:683-695`):
   - Selection rect dragging uses direct Konva manipulation + RAF coalescing

6. **Non-reactive resize state** (`resizeState.ts`):
   - `borderResizingIds` and `isTransforming` are plain JS variables, not Zustand state
   - Avoids triggering React re-renders during active resize operations

**Identified risks:**
- `BoardObjects.tsx` re-renders on every Zustand `objects` change (new reference on any object update). The `memo()` on individual components mitigates downstream re-renders, but the parent component still iterates and sorts all visible objects.
- Each object component subscribes to `selectedObjectIds` from canvasStore, which changes on every selection change — all objects re-render to check `isSelected`.
- During drag, `updateObjectLocal` is called on every `dragMove` event, creating a new objects reference in Zustand. All subscribed components re-evaluate their selectors.

### Object Sync Latency (Target: <100ms)

**Estimated path from write to remote render:**
1. `updateObject()` → Firestore SDK serializes and sends (~5-20ms)
2. Firestore server processes write (~10-30ms)
3. Firestore snapshot listener fires on remote client (~20-50ms)
4. `upsertObject()` updates Zustand → React re-render (~5-10ms)

**Total estimated**: ~40-110ms under good conditions. Likely meets the <100ms target on LAN/fast connections, may exceed on slow connections.

**No unnecessary delays**: There is no debouncing or batching between the user action and the Firestore write. The write happens immediately on the relevant event (dragEnd, mouseUp, onChange).

### Cursor Sync Latency (Target: <50ms)

**Estimated path from mousemove to remote render:**
1. Throttle gate: up to 33ms wait (30Hz) — worst case adds 33ms latency
2. `setCursor()` → RTDB `set()` (~5-10ms)
3. RTDB server processes + fan-out (~10-20ms)
4. `onValue` fires on remote → `setCursors` → React re-render (~5-10ms)

**Total estimated**: 20-73ms. The throttle itself adds up to 33ms. Under optimal conditions (just passed throttle gate), latency could be ~20-40ms, meeting the <50ms target. Worst case (just missed throttle gate): ~53-73ms.

**Processing overhead**: Minimal — `getCanvasPoint` is simple arithmetic, distance check is squared comparison. No unnecessary processing between mousemove and RTDB write.

### Object Capacity (Target: 500+)

**Viewport culling**: Implemented with 200px padding. Only objects within the visible viewport (+padding) are rendered. With 500 objects spread across a large canvas, typically only a fraction are visible.

**Potential bottlenecks**:
- `BoardObjects.tsx:65-88`: Iterates ALL objects to filter and sort, even if most are culled. With 500 objects, this is O(n) iteration + O(n log n) sort on every render. The sort comparator is simple (two integer comparisons), so this should be fast.
- `useFirestoreSync.ts` first snapshot: Bulk-loads all 500 objects into a single `setObjects()` call — single Zustand state update. ✓
- Zustand subscription pattern: `useObjectStore((s) => s.objects)` returns the entire objects map. Any change to any object creates a new reference, causing all subscribers to re-evaluate. With `memo()` on each component, only changed objects re-render.
- No virtualization: Konva renders all visible objects as canvas draw calls. At 500 objects, most would be off-screen and culled, but if the user zooms out to see all 500, performance may degrade.

### Concurrent Users (Target: 5+)

**RTDB bandwidth estimation:**
- Cursor writes: 5 users × 30Hz = 150 writes/sec to RTDB
- Cursor reads: Each user receives all cursor updates via `onValue` on the cursors node. With 5 users, each update to any cursor triggers the full cursors snapshot to be sent to all 4 other users.
- `onValue` granularity: The listener is on `/boards/{boardId}/cursors` (the parent node), not on individual cursor nodes. This means every cursor update triggers a full snapshot of ALL cursors to ALL users. With 5 users at 30Hz, each user receives ~120 cursor updates/sec (4 other users × 30Hz), each containing the full cursors object.

**Firestore listener fan-out**: Firestore `onSnapshot` is per-client. Each of the 5 clients has their own listener. Firestore handles fan-out server-side. 5 listeners is well within Firestore's capacity.

**Lock listener**: `onLocksChange` also uses parent-node `onValue` listener. With 5 users, lock changes are less frequent than cursors (only on drag start/end), so bandwidth is minimal.

**Presence listener**: NOT active (no subscriber), so zero presence bandwidth currently.

**Identified risks:**
- The `onValue` on the parent cursors node is not bandwidth-optimal for 5+ users. A per-cursor `onChildChanged` listener would be more efficient but would require more complex state management.
- `CursorLayer.tsx` re-renders on every RTDB cursor update (React `useState`). At ~120 updates/sec, this could cause excessive re-rendering. However, the layer has `listening={false}` and the rendering logic is simple (6 Konva nodes per cursor).

---

## Cross-Cutting Concerns

### Race Conditions

1. **Drag echo overwrite**: During a drag (without `startLocalEdit`), a Firestore echo from the user's own previous drag could arrive and overwrite the current drag position. This is a low-probability race because the echo would need to arrive between two `dragMove` events.

2. **Lock acquisition race**: Two users could acquire a lock on the same object nearly simultaneously. RTDB `set()` is last-write-wins, so the second user's lock overwrites the first. The first user might see their lock briefly then lose it. Neither user's UI would reflect the conflict correctly — both would think they have the lock.

3. **Delete during drag**: If User A deletes an object that User B is dragging, the `removeObject` from the Firestore listener removes it from Zustand. User B's drag handlers continue to reference the now-removed object. The `handleDragEnd` call to `updateObject` will fail silently (document doesn't exist).

4. **Clipboard stale references**: If User A copies an object and User B deletes it, User A's clipboard still contains the object data. Pasting will create a new object — this is arguably correct behavior (the paste creates a new independent copy).

### Error Handling

- **Firestore write failures**: Logged via `console.error`. Drag operations (move) rollback position. All other operations silently proceed with the local state diverging from Firestore until the next snapshot reconciles.
- **RTDB write failures**: Cursor writes (`setCursor`) and lock writes (`acquireLock`) are fire-and-forget with no error handling. If RTDB is unreachable, cursor and lock sync silently fails.
- **Network drops**: Firestore listeners auto-reconnect and replay missed changes on reconnection. RTDB `onDisconnect` handlers fire server-side. Manual cleanup functions in `useEffect` cleanup would not fire during a hard disconnect (handled by `onDisconnect`).
- **Firestore listener error**: `useFirestoreSync.ts:65-69` catches listener errors, logs them, and marks `isLoaded: true` to prevent infinite loading screen. But there is no retry mechanism or user-facing error notification.

### Memory Leaks

- **Firestore listener**: Cleaned up via `unsubscribe()` in `useEffect` return. ✓
- **Lock listener**: Cleaned up via `unsubscribe()` in `useEffect` return. ✓
- **Cursor listener** (in CursorLayer): Cleaned up via `unsubscribe()` in `useEffect` return. ✓
- **Presence/cursor disconnect handlers**: `setupCursorDisconnect` is called once on mount. `setPresence` registers `onDisconnect` once on mount. These are server-side handlers and don't leak client memory. ✓
- **RAF handles**: `borderResizeRafRef` and `selRectRafRef` are cleaned up on mouseUp and mode change. Border resize RAF is also cancelled on mode change cleanup (`Canvas.tsx:1007-1009`). ✓
- **Event listeners**: `border-cursor`, `border-resize-start`, `object-drag-end` — all cleaned up in `useEffect` return. ✓
- **Potential leak**: If `SelectionLayer` unmounts during an active Transformer resize without `handleTransformEnd` firing, `locallyEditingIds` would not be cleared. The unmount cleanup (`useEffect` return on line 189-192) resets `isTransforming` but does NOT call `endLocalEdit`. Objects in `locallyEditingIds` would be permanently suppressed from Firestore echoes for the remainder of the session.

### Security

- **RTDB cursor writes**: Write path is `/boards/{boardId}/cursors/{userId}`. Any authenticated user can write to any userId's cursor path — security depends on RTDB rules (not visible in codebase).
- **RTDB presence writes**: Same — `/boards/{boardId}/presence/{userId}` has no client-side validation that userId matches the authenticated user.
- **RTDB lock writes**: Same pattern — no client-side validation. A malicious client could acquire locks on behalf of other users.
- **Firestore writes**: Object operations use `updateDoc`, `setDoc`, `deleteDoc` directly. Security depends on Firestore rules. The client strips immutable fields (`id`, `createdAt`, `createdBy`) from updates but doesn't validate authorization.
- **Board access**: No client-side board access control is enforced beyond authentication. Any authenticated user can access any board by URL (the `isPublic` field exists in metadata but is not checked).

---

## Summary Table

| Feature | Spec Requirement | Status | Notes |
|---------|-----------------|--------|-------|
| Object sync (optimistic + Firestore) | ✅ Specified | 🟢 Fully implemented | Optimistic updates → async Firestore writes → listener reconciliation |
| Soft locking | ✅ Specified | 🟢 Fully implemented | RTDB locks with acquire/release/onDisconnect |
| Lock visual indicator | ✅ Specified | 🟢 Fully implemented | 🔒 + username label + 60% opacity on all draggable types |
| Lock prevents drag | ✅ Specified | 🟢 Fully implemented | `isDraggable` gated by `!isLocked` |
| Lock onDisconnect cleanup | ✅ Specified | 🟢 Fully implemented | `onDisconnect(lockRef).remove()` on every acquisition |
| Firestore write on drag end only | ✅ Specified | 🟢 Fully implemented | `updateObject` in `handleDragEnd`, not `handleDragMove` |
| Rollback on Firestore failure | ✅ Specified | 🟡 Partial | Only drag/move operations rollback; resize/delete/color do not |
| Local edit guards | ✅ Specified | 🟡 Partial | Used for resize operations, NOT for drag operations |
| Cursor sync (30Hz, 5px threshold) | ✅ Specified | 🟢 Fully implemented | `CURSOR_THROTTLE_MS=33`, `CURSOR_MIN_DISTANCE=5` |
| Cursor name labels | ✅ Specified | 🟢 Fully implemented | `Text` component below cursor circle |
| Cursor color from user ID | ✅ Specified | 🟢 Fully implemented | `getUserColor()` deterministic hash → HSL → hex |
| Cursor circle size | ✅ Specified | 🟡 Minor deviation | Spec: 12px radius. Code: `radius={6}` (6px radius = 12px diameter) |
| Cursor onDisconnect cleanup | ✅ Specified | 🟢 Fully implemented | `setupCursorDisconnect` + manual `removeCursor` on unmount |
| Cursor on non-listening layer | ✅ Specified | 🟢 Fully implemented | Layer 4 with `listening={false}` |
| Presence system (RTDB write/disconnect) | ✅ Specified | 🟢 Fully implemented | `setPresence` with `onDisconnect` handler |
| Presence avatar stack UI | ✅ Specified | 🔴 Not implemented | No component exists |
| Presence click-to-expand | ✅ Specified | 🔴 Not implemented | No component exists |
| Presence listener (read remote) | ✅ Specified | 🔴 Not implemented | `onPresenceChange` defined but never called |
| Presence inactivity threshold | ✅ Specified | 🔴 Not implemented | No idle/heartbeat mechanism |
| Presence "Online" label | ✅ Specified | 🔴 Not implemented | No UI exists |
| 60 FPS target | ✅ Specified | 🟢 Mechanisms present | Viewport culling, layer splitting, memo, RAF coalescing, non-reactive flags |
| <100ms object sync | ✅ Specified | 🟡 Likely met | Estimated 40-110ms; depends on network |
| <50ms cursor sync | ✅ Specified | 🟡 Borderline | Estimated 20-73ms; 33ms throttle adds latency |
| 500+ objects | ✅ Specified | 🟢 Mechanisms present | Viewport culling active; no virtualization but culling scales well |
| 5+ concurrent users | ✅ Specified | 🟡 Functional but not optimal | Parent-node `onValue` for cursors sends full snapshot on every update |
