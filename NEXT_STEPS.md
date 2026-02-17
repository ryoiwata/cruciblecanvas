# NEXT_STEPS.md — Phase 2 Implementation Roadmap

**Goal:** Two users can create and move sticky notes simultaneously with soft locking.

**Current State:** Phase 1 complete — Firebase Auth (anonymous + Google + GitHub), Zustand auth store, AuthProvider, middleware redirect, placeholder auth/dashboard pages. No canvas, no board page, no Firestore CRUD, no RTDB helpers, no object or canvas stores, no Konva components.

**Phase 2 Target:** Real-time collaborative canvas where multiple users can create sticky notes by clicking, drag them around with optimistic updates, and see soft locking prevent drag conflicts — all synced via Firestore + RTDB listeners.

---

## Current File Inventory (What Exists)

| File | Status | Notes |
|------|--------|-------|
| `src/lib/firebase/config.ts` | Done | Firebase app + Auth + Firestore + RTDB singletons |
| `src/lib/firebase/auth.ts` | Done | signInAsGuest, Google, GitHub, linkAccount, writeUserProfile |
| `src/lib/store/authStore.ts` | Done | Zustand: user, displayName, isAnonymous, isLoading |
| `src/providers/AuthProvider.tsx` | Done | onAuthStateChanged, redirect guard for /dashboard |
| `src/middleware.ts` | Done | `/` -> `/dashboard` redirect |
| `src/app/layout.tsx` | Done | Root layout with AuthProvider wrapper |
| `src/app/auth/page.tsx` | Placeholder | Says "coming soon" — needs full auth UI |
| `src/app/dashboard/page.tsx` | Placeholder | Shows user info — needs board creation + navigation |
| `src/app/globals.css` | Minimal | Tailwind + CSS vars — needs canvas reset styles |
| `src/app/board/` | Empty dir | No `[boardId]/page.tsx` exists |

---

## Files to Create (Phase 2)

| File | Purpose |
|------|---------|
| `src/lib/types.ts` | Shared TypeScript interfaces: BoardObject, ObjectType, BoardMetadata, ObjectLock, CursorData, PresenceData |
| `src/lib/utils.ts` | snapToGrid, getUserColor, getCanvasPoint helpers |
| `src/lib/store/canvasStore.ts` | Zustand: mode (pan/select/create), creationTool, selectedObjectIds, viewport (stageX/Y/Scale) |
| `src/lib/store/objectStore.ts` | Zustand: objects Record, locks Record, isLoaded. CRUD actions. |
| `src/lib/firebase/firestore.ts` | Firestore CRUD: createObject, updateObject, deleteObject, createBoardMetadata |
| `src/lib/firebase/rtdb.ts` | RTDB helpers: setCursor, onCursorsChange, removeCursor, setPresence, onPresenceChange, acquireLock, releaseLock, onLocksChange, getUserColor |
| `src/hooks/useFirestoreSync.ts` | onSnapshot listener hook — populates objectStore from Firestore |
| `src/hooks/useLockSync.ts` | RTDB lock listener hook — populates objectStore.locks |
| `src/components/canvas/Canvas.tsx` | Konva Stage with 4 layers, pan/zoom, click-to-create dispatch, mouse move cursor write |
| `src/components/canvas/DotGrid.tsx` | Static infinite dot grid (Layer 1) |
| `src/components/canvas/BoardObjects.tsx` | Renders objects from objectStore (Layer 2) |
| `src/components/canvas/StickyNote.tsx` | Konva Group: Rect + Text, drag events, lock check |
| `src/components/canvas/SelectionLayer.tsx` | Transformer handles for selected objects (Layer 3, skeleton) |
| `src/components/canvas/CursorLayer.tsx` | Remote cursors from RTDB (Layer 4) |
| `src/components/auth/AuthCard.tsx` | Centered login card with guest + social buttons |
| `src/components/ui/Toolbar.tsx` | Top-centered floating toolbar — mode switching |
| `src/app/board/[boardId]/page.tsx` | Board workspace page — wires Canvas, listeners, presence |

## Files to Modify (Phase 2)

| File | Changes |
|------|---------|
| `src/app/auth/page.tsx` | Replace placeholder with full auth UI using AuthCard |
| `src/app/dashboard/page.tsx` | Add "New Board" button, board creation flow, navigation to `/board/{id}` |
| `src/app/globals.css` | Add `overflow: hidden` for board pages, toolbar positioning |
| `src/providers/AuthProvider.tsx` | Extend auth guard to also protect `/board/*` routes for private boards (future-proofing) |

---

## Implementation Tasks (Atomic Steps)

### Step 1: Shared Types (15 min)

**File:** `src/lib/types.ts` [NEW]

**What to define:**
- `ObjectType` union: `'stickyNote' | 'rectangle' | 'circle' | 'frame' | 'connector' | 'colorLegend'`
- `BoardObject` interface with all fields from PHASE_2_PLAN.md section 1 (id, type, x, y, width, height, rotation, color, text, createdBy, createdAt, updatedAt, parentFrame, connectedTo, isAIGenerated, aiCommandId, role, metadata)
- `BoardMetadata` interface (title, createdBy, createdAt, isPublic, invitedEmails, aiPersona, aiCommandsToday, aiCommandsResetAt, analysisHistory)
- `ObjectLock` interface (userId, userName, timestamp)
- `CursorData` interface (x, y, name, color, timestamp)
- `PresenceData` interface (name, email, photoURL, color, online, lastSeen, isAnonymous)
- `STICKY_NOTE_COLORS` constant array: `['#FEFF9C', '#FF7EB9', '#7AFCFF', '#98FF98', '#DDA0DD', '#FFAB91']`
- Default dimensions constants: `STICKY_NOTE_DEFAULT = { width: 200, height: 150 }`

**Why first:** Every other file imports these types. Zero dependencies.

**Edge cases to consider:**
- Use `Timestamp` from `firebase/firestore` for Firestore fields, but `number` for RTDB fields (RTDB uses millisecond timestamps, Firestore uses its own Timestamp type)
- The `createdAt` field serves double duty as z-index — document this with a comment

---

### Step 2: Utility Functions (15 min)

**File:** `src/lib/utils.ts` [NEW]

**Functions:**

1. **`snapToGrid(value: number, gridSize = 20): number`**
   - Formula: `Math.round(value / gridSize) * gridSize`
   - Used on object creation and dragend

2. **`getUserColor(userId: string): string`**
   - Deterministic HSL from string hash
   - Hash userId → number → `hue = hash % 360`, fixed saturation (70%) and lightness (60%)
   - Returns hex string (not HSL) for Konva compatibility

3. **`getCanvasPoint(stage: Konva.Stage, pointerPos: { x: number; y: number }): { x: number; y: number }`**
   - Converts screen coordinates to canvas-space coordinates
   - Accounts for pan (stage.x, stage.y) and zoom (stage.scaleX)
   - Formula: `canvasX = (pointerPos.x - stage.x()) / stage.scaleX()`

**Edge cases:**
- `getUserColor` must be deterministic — same userId always produces same color across sessions and users
- `getCanvasPoint` must handle non-uniform scale (use scaleX only since we enforce uniform scaling)
- Grid snapping with negative coordinates: `snapToGrid(-15)` should return `-20`, not `0` — verify `Math.round` handles negatives correctly (it does: `Math.round(-0.75) = -1`, so `Math.round(-15/20)*20 = -20`)

---

### Step 3: Canvas Store (20 min)

**File:** `src/lib/store/canvasStore.ts` [NEW]

**State shape:**
```
mode: 'pan' | 'select' | 'create'          (default: 'pan')
creationTool: ObjectType | null             (default: null)
selectedObjectIds: string[]                 (default: [])
stageX: number                              (default: 0)
stageY: number                              (default: 0)
stageScale: number                          (default: 1)
```

**Actions:**
- `setMode(mode)` — sets mode, clears creationTool if not 'create'
- `enterCreateMode(tool)` — sets mode='create', creationTool=tool
- `exitToPan()` — sets mode='pan', creationTool=null, clears selection
- `selectObject(id)` — replaces selectedObjectIds with [id]
- `toggleSelection(id)` — add/remove id (Ctrl+Click)
- `clearSelection()` — empties selectedObjectIds
- `setViewport(x, y, scale)` — updates stageX, stageY, stageScale

**Edge cases:**
- `enterCreateMode` while already in create mode with a different tool should just switch the tool, not reset other state
- `selectObject` should be no-op if mode is 'pan' or 'create' — selection only happens in select mode
- Keyboard shortcut '3' pressing rapidly shouldn't cause state thrashing — Zustand handles this naturally since it batches

---

### Step 4: Object Store (20 min)

**File:** `src/lib/store/objectStore.ts` [NEW]

**State shape:**
```
objects: Record<string, BoardObject>        (default: {})
locks: Record<string, ObjectLock>           (default: {})
isLoaded: boolean                           (default: false)
```

**Actions:**
- `setObjects(objects)` — full replacement from onSnapshot initial load
- `upsertObject(object)` — adds or replaces one object (optimistic create, or snapshot update)
- `updateObjectLocal(id, updates)` — patches one object locally (drag position update, no Firestore write)
- `removeObject(id)` — deletes from local state (optimistic delete)
- `setLocks(locks)` — full replacement from RTDB listener
- `setIsLoaded(loaded)` — marks initial load complete

**Edge cases:**
- `updateObjectLocal` on a non-existent id should be a no-op (race condition: object deleted by another user while being dragged locally)
- `upsertObject` from onSnapshot may arrive after a local optimistic update — this is correct behavior (server state wins, last-write-wins)
- `removeObject` must also remove the object from any selection state in canvasStore — but stores shouldn't be coupled. Handle this at the component level instead: SelectionLayer filters out IDs not in objectStore.

---

### Step 5: Firestore CRUD Helpers (25 min)

**File:** `src/lib/firebase/firestore.ts` [NEW]

**Functions:**

1. **`createObject(boardId: string, data: Omit<BoardObject, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>`**
   - Uses `doc(collection(...))` to pre-generate an ID (needed for optimistic rendering)
   - Writes with `setDoc` including `serverTimestamp()` for createdAt and updatedAt
   - Returns the generated document ID

2. **`updateObject(boardId: string, objectId: string, updates: Partial<BoardObject>): Promise<void>`**
   - `updateDoc` with `{ ...updates, updatedAt: serverTimestamp() }`
   - Strip `id`, `createdAt`, `createdBy` from updates (immutable fields)

3. **`deleteObject(boardId: string, objectId: string): Promise<void>`**
   - `deleteDoc`

4. **`createBoardMetadata(boardId: string, userId: string, title: string): Promise<void>`**
   - `setDoc` at `boards/{boardId}/metadata/config`
   - Sets defaults: isPublic=true, invitedEmails=[], aiPersona='neutral', aiCommandsToday=0

**Edge cases:**
- `createObject` must strip `undefined` values before writing — Firestore rejects `undefined` (use a filter utility)
- `updateObject` with an empty updates object should still write `updatedAt` timestamp (to indicate a touch)
- Network failures: these functions throw — callers must handle errors. For Phase 2, we log errors but don't show UI feedback (deferred to Phase 5).
- Pre-generated ID approach prevents duplicate optimistic objects: the temp ID matches the Firestore ID, so onSnapshot upsert cleanly overwrites.

---

### Step 6: RTDB Helpers (30 min)

**File:** `src/lib/firebase/rtdb.ts` [NEW]

**Cursor functions:**
- `setCursor(boardId, userId, data: CursorData)` — `set(ref(rtdb, path), data)`
- `onCursorsChange(boardId, callback)` — `onValue` on `/boards/{boardId}/cursors`, returns unsubscribe
- `removeCursor(boardId, userId)` — `remove(ref(rtdb, path))`
- `setupCursorDisconnect(boardId, userId)` — `onDisconnect().remove()` on cursor ref

**Presence functions:**
- `setPresence(boardId, userId, data: PresenceData)` — `set` presence node + `onDisconnect().update({ online: false, lastSeen: serverTimestamp() })`
- `onPresenceChange(boardId, callback)` — `onValue` on `/boards/{boardId}/presence`
- `removePresence(boardId, userId)` — `remove`

**Lock functions:**
- `acquireLock(boardId, objectId, userId, userName)` — `set()` + `onDisconnect().remove()`
- `releaseLock(boardId, objectId)` — `remove()`
- `onLocksChange(boardId, callback)` — `onValue` on `/boards/{boardId}/locks`

**Edge cases:**
- **onDisconnect race:** If a user's browser crashes, `onDisconnect` fires server-side — but there's a window (up to 60s) where stale locks persist. Mitigation: in `useLockSync`, treat locks older than 30 seconds as stale and ignore them visually.
- **RTDB serverTimestamp:** Use `firebase/database`'s `serverTimestamp()` (different import from Firestore's). For lock timestamp, use `Date.now()` instead (RTDB serverTimestamp is a placeholder object, not a value — it resolves server-side, so you can't read it back immediately).
- **Connection state:** Consider exposing a `onConnectionStateChange(callback)` helper using `.info/connected` ref — needed for Phase 5 offline banner but can be stubbed now.
- **Multiple listeners:** Each `onValue` returns an unsubscribe function. Callers MUST clean up on unmount to prevent memory leaks and phantom updates.

---

### Step 7: useFirestoreSync Hook (25 min)

**File:** `src/hooks/useFirestoreSync.ts` [NEW]

**Signature:** `useFirestoreSync(boardId: string): void`

**Behavior:**
1. On mount: subscribe to `onSnapshot(collection(db, boards/${boardId}/objects))`
2. On initial snapshot: call `objectStore.setObjects()` with full map, set `isLoaded = true`
3. On subsequent snapshots: iterate `docChanges()`:
   - `'added'` → `upsertObject`
   - `'modified'` → `upsertObject` (server state wins)
   - `'removed'` → `removeObject`
4. On unmount: unsubscribe

**Edge cases:**
- **First vs. subsequent snapshots:** Firestore's first `onSnapshot` callback contains ALL documents as 'added' changes. Using `setObjects` for the first call avoids N individual `upsertObject` calls. Track `isFirstSnapshot` with a ref.
- **Optimistic conflict:** User drags object → local position updates → dragend writes to Firestore → onSnapshot fires with the new position → `upsertObject` overwrites local state. This is correct. But if the Firestore write fails, the local state is stale. Solution: on Firestore write failure, revert local state (handled in StickyNote dragend).
- **Board doesn't exist:** If the collection is empty, `onSnapshot` fires with an empty array. `setObjects({})` and `isLoaded = true` is correct — board is just empty.
- **Cleanup timing:** React StrictMode in dev mode mounts/unmounts/remounts. The hook must tolerate this: unsubscribe on first unmount, resubscribe on remount.
- **Type conversion:** Firestore documents come back as `DocumentData`. Must cast `{ id: doc.id, ...doc.data() } as BoardObject`. Validate that `createdAt` and `updatedAt` are Firestore Timestamps (they will be after server write, but optimistic writes may have `null` for serverTimestamp placeholder — handle gracefully).

---

### Step 8: useLockSync Hook (15 min)

**File:** `src/hooks/useLockSync.ts` [NEW]

**Signature:** `useLockSync(boardId: string): void`

**Behavior:**
1. On mount: subscribe to `onLocksChange(boardId, callback)`
2. Callback: `objectStore.setLocks(snapshot || {})`
3. On unmount: unsubscribe

**Edge cases:**
- **Null snapshot:** RTDB returns `null` if no locks exist. Convert to `{}` before calling `setLocks`.
- **Stale lock detection:** Locks with `timestamp` older than 30 seconds may indicate a crashed client whose `onDisconnect` hasn't fired yet. The hook or the consuming component should visually treat these as "possibly stale" but still prevent drag (conservative approach).
- **Rapid lock/unlock:** Multiple users locking/unlocking rapidly causes frequent `setLocks` calls. This is fine — Zustand batches React renders.

---

### Step 9: DotGrid Component (30 min)

**File:** `src/components/canvas/DotGrid.tsx` [NEW]

**Rendering approach:**
- Konva `Shape` with custom `sceneFunc`
- Reads viewport from canvasStore (stageX, stageY, stageScale)
- Calculates visible area from Stage transform
- Draws dots at 20px intervals within visible area + small buffer
- Dot style: 1px radius, `#d0d0d0` fill (light gray)

**Performance:**
- Layer has `listening={false}` — no hit testing or event overhead
- Only draws dots within the viewport (no infinite pre-rendering)
- At zoom 0.05x (5%), a 1920x1080 viewport shows ~2880 x 1620 grid units — that's 4.6 million dots. Must cap dot rendering: skip dots when `scale < 0.2` (show only every 5th dot) or hide grid entirely below a threshold.

**Edge cases:**
- **Zoom levels:** At extreme zoom out (scale < 0.1), drawing millions of dots kills performance. Strategy: scale dot spacing inversely — at 50% zoom show every other dot, at 25% show every 4th, below 10% hide grid entirely.
- **Pan offset:** Dot positions must align to the global 20px grid, not the viewport. Formula: `startX = Math.floor(vpLeft / 20) * 20` where `vpLeft = -stageX / scale`.
- **Canvas resize:** On window resize, the grid must recalculate. Use `window.innerWidth/Height` in the sceneFunc or pass dimensions as props.
- **Konva redraw trigger:** The Shape's sceneFunc runs on every layer redraw. Since this layer is static (`listening={false}`), it only redraws when explicitly told to. The Canvas component must call `gridLayerRef.batchDraw()` after pan/zoom changes.

---

### Step 10: StickyNote Component (30 min)

**File:** `src/components/canvas/StickyNote.tsx` [NEW]

**Structure:** Konva `Group` containing:
- `Rect`: 200x150, fill from `color`, cornerRadius 4, shadow (subtle)
- `Text`: 14px sans-serif, padding 10px, width = rect width - 20, auto-height (but clipped to rect height for now, text editing in Phase 3)

**Props:** `object: BoardObject`, `isLocked: boolean`, `lockedByName: string | null`, `isSelected: boolean`

**Drag behavior:**
1. `draggable` = `mode === 'select' && !isLockedByOther`
2. `onDragStart`:
   - Save pre-drag position `{ x: object.x, y: object.y }` in a ref
   - Call `acquireLock(boardId, object.id, userId, displayName)`
   - If lock acquire fails (another user grabbed it simultaneously), cancel drag
3. `onDragMove`:
   - Call `objectStore.updateObjectLocal(object.id, { x: node.x(), y: node.y() })`
   - No Firestore write, no RTDB write
4. `onDragEnd`:
   - Snap final position: `x = snapToGrid(node.x()), y = snapToGrid(node.y())`
   - Update Konva node position to snapped values
   - `objectStore.updateObjectLocal(object.id, { x, y })`
   - Async: `updateObject(boardId, object.id, { x, y })`
   - Async: `releaseLock(boardId, object.id)`
   - On Firestore write failure: revert to pre-drag position

**Click behavior (select mode):**
- `onClick`: `canvasStore.selectObject(object.id)` or `toggleSelection` with Ctrl

**Visual states:**
- Normal: standard appearance
- Selected: blue border (handled by SelectionLayer Transformer)
- Locked by other: semi-transparent (opacity 0.6), lock icon overlay, cursor `not-allowed`
- Locked by self: normal appearance (drag in progress)

**Edge cases:**
- **Drag start race condition:** Two users click the same sticky note at ~the same time. Both call `acquireLock`. RTDB `set()` is last-write-wins, so the second user's lock overwrites the first. Mitigation: use a transaction (`runTransaction`) to check if lock already exists before writing. If lock exists and userId !== self, abort drag. Alternative (simpler): use `set()` with a listener — check lock state after write, and if it's not yours, release and cancel.
- **Konva node position vs. store position:** During drag, the Konva node's position diverges from the store (Konva handles the drag visually, store updates via `updateObjectLocal`). On dragend, we must read from the Konva node (not the store) to get the actual drop position, then snap and sync.
- **Text truncation:** Long text in a 200x150 note will overflow. For Phase 2, truncate visually (Konva Text `ellipsis: true`). Full text editing with auto-resize is Phase 3.
- **Z-index during drag:** The dragged note should render on top of all others. Set `node.moveToTop()` on dragstart. On dragend, z-order resets to createdAt ordering on next render.

---

### Step 11: BoardObjects Renderer (20 min)

**File:** `src/components/canvas/BoardObjects.tsx` [NEW]

**Responsibility:** Reads `objectStore.objects`, filters by type (Phase 2: only `stickyNote`), renders `<StickyNote>` for each. Passes lock and selection state.

**Props:** `boardId: string`

**Implementation:**
- Subscribe to `objectStore` (objects, locks)
- Subscribe to `canvasStore` (selectedObjectIds, mode)
- Sort objects by `createdAt` for z-index ordering
- For each object, compute: `isLocked = locks[obj.id] && locks[obj.id].userId !== currentUserId`
- Render in a Konva `Layer` (Layer 2)

**Viewport culling (performance):**
- Only render objects whose bounding box intersects the viewport + 200px padding
- Read viewport from canvasStore (stageX, stageY, stageScale)
- Compute viewport bounds: `vpLeft = -stageX / scale`, `vpRight = vpLeft + windowWidth / scale`, etc.
- Filter: skip object if `obj.x + obj.width < vpLeft - 200 || obj.x > vpRight + 200 || ...`

**Edge cases:**
- **Object count scaling:** With 500+ objects, iterating and filtering on every render is O(n). This is acceptable for Phase 2 — spatial indexing (quadtree) is a Phase 5 optimization.
- **createdAt ordering:** Optimistic objects have a local timestamp (Date.now()), not a Firestore Timestamp. Sort must handle both: convert Firestore Timestamp to millis with `.toMillis()`, use raw number for local timestamps.
- **React key prop:** Use `object.id` as key. If using pre-generated Firestore doc IDs, the key is stable across optimistic → server reconciliation. If using temp IDs that change, React would re-mount the component — avoid this by using pre-generated IDs.

---

### Step 12: SelectionLayer Component (20 min)

**File:** `src/components/canvas/SelectionLayer.tsx` [NEW]

**Phase 2 scope:** Skeleton implementation — Konva `Transformer` attached to selected object nodes. Drag-rectangle multi-select is deferred to Phase 3.

**Implementation:**
- Reads `canvasStore.selectedObjectIds`
- Finds Konva nodes by ID using `stageRef.current.findOne('#' + id)`
- Attaches `Transformer` to the nodes array
- Transformer config: 8 resize anchors (but resize disabled for Phase 2 — sticky notes are fixed size), rotation handle disabled

**Edge cases:**
- **Node not found:** If a selected object ID has no corresponding Konva node (deleted by another user), skip it silently and remove from selection.
- **Transformer performance:** Konva Transformer recalculates on every frame when attached. With many selected objects, this can cause lag. For Phase 2, multi-select is limited, so this is acceptable.
- **Layer ordering:** SelectionLayer must be ABOVE BoardObjects layer so Transformer handles render on top of objects.

---

### Step 13: CursorLayer Component (25 min)

**File:** `src/components/canvas/CursorLayer.tsx` [NEW]

**Implementation:**
- Subscribes to `onCursorsChange(boardId, callback)` on mount
- Stores remote cursors in local state (or a Zustand cursorStore)
- Filters out the local user's own cursor
- Renders each cursor as:
  - `Circle`: 6px radius (12px diameter), fill = user color from `getUserColor(userId)`
  - `Text`: display name, 12px font, below the circle, fill = same color
- Stale cursor cleanup: ignore cursors with `timestamp` older than 10 seconds

**Edge cases:**
- **Canvas-space vs. screen-space:** Cursors are stored in canvas-space coordinates but rendered in canvas-space on a Konva Layer that moves with the stage. This means remote cursors naturally pan/zoom with the canvas — correct behavior. If rendered in screen-space, they'd be fixed on screen while the canvas moves beneath them — wrong.
- **High cursor count:** With 20+ users, rendering 20 circles + text labels is trivial for Konva. No performance concern here.
- **Cursor flicker:** RTDB updates arrive asynchronously. If a cursor position jumps (e.g., from `(100,100)` to `(500,500)` in one update because the user moved fast between throttled sends), the cursor teleports. This is acceptable — smooth interpolation is a polish task.
- **Cleanup on unmount:** Must unsubscribe from `onCursorsChange` and call `removeCursor` for the local user.

---

### Step 14: Toolbar Component (25 min)

**File:** `src/components/ui/Toolbar.tsx` [NEW]

**Layout:**
- Horizontal bar, centered at top of canvas viewport
- `position: fixed`, top ~16px, centered horizontally
- Semi-transparent white bg (`bg-white/80 backdrop-blur-md`), rounded corners (8px), shadow

**Tools (Phase 2 subset):**
1. Pan (hand icon) — default active
2. Select (cursor/arrow icon)
3. Sticky Note (square with lines icon)

**Behavior:**
- Clicking Pan → `canvasStore.setMode('pan')`
- Clicking Select → `canvasStore.setMode('select')`
- Clicking Sticky Note → `canvasStore.enterCreateMode('stickyNote')`
- Active tool: highlighted with brand purple bg tint (`bg-indigo-100 text-indigo-600`)
- Inactive: `text-gray-600 hover:bg-gray-100`

**Keyboard shortcuts:**
- `1` → Pan mode
- `2` → Select mode
- `3` → Sticky Note create mode
- `Escape` → exitToPan

**Edge cases:**
- **Keyboard listener scope:** Must not fire when user is typing in an input field (e.g., display name, future text editing). Check `document.activeElement.tagName !== 'INPUT' && !== 'TEXTAREA'` before handling shortcuts.
- **Fixed positioning on canvas:** The toolbar uses `position: fixed` in the DOM, sitting above the Konva canvas. It's a React component, not a Konva node. This means it doesn't pan/zoom with the canvas — correct.

---

### Step 15: Canvas Component (30 min)

**File:** `src/components/canvas/Canvas.tsx` [NEW]

**The central orchestrator. Wires everything together.**

**Structure:**
```
<Stage>
  <Layer listening={false}>   ← DotGrid (Layer 1)
  <Layer>                      ← BoardObjects (Layer 2)
  <Layer>                      ← SelectionLayer (Layer 3, skeleton)
  <Layer>                      ← CursorLayer (Layer 4)
</Stage>
```

**Props:** `boardId: string`

**Must use `dynamic(() => import(...), { ssr: false })` wrapper** because Konva requires the DOM and cannot render server-side in Next.js.

**Stage configuration:**
- `width={window.innerWidth}`, `height={window.innerHeight}` (or container dimensions)
- `draggable={mode === 'pan'}`
- On window resize: update Stage dimensions

**Pan (Stage drag):**
- `onDragEnd` on Stage: update `canvasStore.setViewport(stage.x(), stage.y(), stage.scaleX())`
- Cursor: `grab` in pan mode, `grabbing` during drag

**Zoom (mouse wheel):**
- `onWheel` handler on Stage
- Calculate new scale: `newScale = oldScale * (e.evt.deltaY > 0 ? 0.9 : 1.1)`
- Clamp: `Math.max(0.05, Math.min(5.0, newScale))`
- Zoom centered on cursor position (adjust stage.x/y to keep pointer position fixed)
- Update `canvasStore.setViewport`

**Click handler (create mode):**
- `onMouseDown` or `onClick` on Stage (not on objects)
- If `mode === 'create' && creationTool === 'stickyNote'`:
  - Compute canvas coords: `getCanvasPoint(stage, pointer)`
  - Snap: `snapToGrid(x), snapToGrid(y)`
  - Generate ID: `doc(collection(db, ...)).id`
  - Optimistic: `objectStore.upsertObject(newStickyNote)`
  - Async: `createObject(boardId, newStickyNote)` to Firestore
  - Stay in create mode (tool stays active for repeated placement)

**Mouse move (cursor sync):**
- `onMouseMove` on Stage
- Throttle to 30 Hz (33ms)
- Only send if cursor moved >5px since last send
- Compute canvas coords, call `setCursor(boardId, userId, { x, y, name, color, timestamp })`

**Click handler (select mode):**
- Click on empty canvas area → `canvasStore.clearSelection()`

**Edge cases:**
- **Zoom to cursor position math:**
  ```
  const oldScale = stage.scaleX()
  const pointer = stage.getPointerPosition()
  const mousePointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale,
  }
  const newScale = clamp(oldScale * factor, 0.05, 5.0)
  stage.scale({ x: newScale, y: newScale })
  stage.position({
    x: pointer.x - mousePointTo.x * newScale,
    y: pointer.y - mousePointTo.y * newScale,
  })
  ```
  This preserves the canvas point under the cursor during zoom.

- **Event propagation:** When clicking on a StickyNote, the Stage's click handler also fires (Konva event bubbling). Must check `e.target === stage` to distinguish empty-canvas clicks from object clicks.

- **SSR guard:** The entire Canvas component tree must be loaded with `dynamic(() => import('./Canvas'), { ssr: false })` in the board page. Alternatively, each Konva component uses `'use client'` directive + window check, but the dynamic import at page level is cleaner.

- **Window resize:** Add `window.addEventListener('resize', ...)` to update Stage width/height. Debounce to 100ms.

- **Pointer position during pan:** `stage.getPointerPosition()` returns null if the mouse is outside the Stage. Guard against this in mousemove handler.

---

### Step 16: Board Page (25 min)

**File:** `src/app/board/[boardId]/page.tsx` [NEW]

**Structure:**
- Reads `boardId` from `params`
- Client component (`'use client'`)
- Dynamic import of Canvas (SSR disabled)
- Renders: Toolbar + Canvas

**On mount:**
- `useFirestoreSync(boardId)` — starts Firestore listener
- `useLockSync(boardId)` — starts RTDB lock listener
- `setPresence(boardId, userId, ...)` — marks user as online, sets `onDisconnect`
- Sets up cursor `onDisconnect` cleanup

**On unmount:**
- Remove presence
- Remove cursor
- (Listeners auto-cleanup via hook returns)

**Loading state:**
- Show spinner until `objectStore.isLoaded === true`

**Auth guard:**
- Check `authStore.user` — if null and not loading, redirect to `/auth`
- For Phase 2, all boards are public, so no further access checks

**Edge cases:**
- **Missing boardId:** If URL has no boardId (shouldn't happen with Next.js routing), show error
- **Board metadata doesn't exist:** If the user navigates to a board URL that hasn't been created yet (no metadata doc), show "Board not found" message. Check by reading metadata doc on mount.
- **Rapid navigation:** If user navigates away and back quickly, React StrictMode may cause double mount/unmount. Hooks must handle this gracefully (unsubscribe on unmount, resubscribe on mount).
- **Presence color consistency:** The user's cursor color (from `getUserColor`) must match their presence color. Both derive from `userId`, so this is automatically consistent.

---

### Step 17: Auth Page Full UI (25 min)

**Files:** `src/app/auth/page.tsx` [MOD], `src/components/auth/AuthCard.tsx` [NEW]

**AuthCard layout:**
- Centered card on clean gray background
- Brand header: "CrucibleCanvas" in bold + tagline
- Display name input (required for guest entry)
- "Continue as Guest" button — primary, brand purple (`bg-[#6366f1]`)
- "Sign in with Google" button — secondary, white bg with Google icon
- "Sign in with GitHub" button — secondary, dark bg with GitHub icon
- Error message area (below buttons)

**Behavior:**
- Guest flow: validate display name is non-empty → `signInAsGuest()` → update Firestore profile with displayName → navigate to `/dashboard`
- Google flow: `signInWithGoogle()` → navigate to `/dashboard`
- GitHub flow: `signInWithGithub()` → navigate to `/dashboard`
- Loading state: disable buttons, show spinner while auth in progress
- Error: show red text (e.g., "Sign-in failed. Please try again.")

**Edge cases:**
- **Already authenticated:** If user navigates to `/auth` while already signed in, redirect to `/dashboard`
- **Popup blocked:** `signInWithPopup` fails if browser blocks popups. Show error: "Please allow popups for this site."
- **Display name persistence:** For guest users, the display name input value must be written to both the Firestore profile AND the `authStore.displayName`. It's NOT set on the Firebase Auth user object (anonymous users can't set displayName on Auth).
- **Empty display name:** Don't allow guest sign-in with empty name. Validate before calling `signInAsGuest()`.

---

### Step 18: Dashboard Update (25 min)

**File:** `src/app/dashboard/page.tsx` [MOD]

**Changes:**
- Show user greeting: "Welcome, {displayName}"
- "New Board" button:
  1. Generate random ID: `crypto.randomUUID()` (or a shorter nanoid)
  2. Create board metadata in Firestore: `createBoardMetadata(boardId, userId, 'Untitled Board')`
  3. Navigate to `/board/{boardId}`
- Sign Out button: calls `signOutUser()`, redirects to `/auth`
- Board list: stub for Phase 2 — text saying "Your boards will appear here"

**Edge cases:**
- **Duplicate board creation:** If user double-clicks "New Board", two boards could be created. Disable button after first click (loading state).
- **Firestore write failure:** If `createBoardMetadata` fails, show error, don't navigate.
- **UUID format:** `crypto.randomUUID()` returns a full UUID like `a1b2c3d4-e5f6-...`. This is fine for URLs but long. Consider truncating to first 8 chars or using a custom short ID. For Phase 2, full UUID is acceptable.

---

### Step 19: CSS Resets (10 min)

**File:** `src/app/globals.css` [MOD]

**Add:**
```css
/* Board canvas — no scrollbars, full viewport */
.board-canvas {
  overflow: hidden;
  width: 100vw;
  height: 100vh;
  position: relative;
}

/* Toolbar floating above canvas */
.toolbar-float {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
}
```

**Remove dark mode CSS** (spec says light mode only):
```css
/* Remove this block: */
@media (prefers-color-scheme: dark) { ... }
```

**Edge cases:**
- **Tailwind purging:** Custom CSS classes not used in components will be purged. Ensure they're used in JSX or added to Tailwind's safelist.
- **Body scroll on board pages:** The board page sets `overflow: hidden` on its container div, not on `body`. This way, the dashboard page still scrolls normally.

---

### Step 20: Integration Test Plan (30 min)

**Manual testing — not automated.**

**Test 1: Single-user sticky note creation**
1. Sign in as guest with name "User A"
2. Click "New Board" on dashboard
3. Verify canvas renders with dot grid
4. Click Sticky Note tool in toolbar (verify highlight)
5. Click on canvas — verify yellow sticky note appears at snapped position
6. Click again — verify second sticky note appears
7. Press Escape — verify mode returns to Pan
8. Verify pan (drag canvas) works
9. Verify zoom (mouse wheel) works

**Test 2: Single-user sticky note dragging**
1. Switch to Select mode (click tool or press 2)
2. Click a sticky note — verify selection border appears
3. Drag the sticky note — verify smooth movement
4. Release — verify position snaps to grid
5. Verify the snapped position persists after page refresh (Firestore write succeeded)

**Test 3: Two-user creation sync**
1. Open a second browser window (or incognito)
2. Sign in as "User B", navigate to same board URL
3. User A creates a sticky note
4. Verify: User B sees the sticky note appear in <100ms
5. User B creates a sticky note
6. Verify: User A sees it appear in <100ms

**Test 4: Two-user cursor sync**
1. Both users on same board
2. Move mouse in one window
3. Verify: other window shows remote cursor with correct name and color

**Test 5: Soft locking**
1. User A starts dragging a sticky note
2. User B attempts to drag the SAME sticky note
3. Verify: User B sees lock indicator, cannot drag
4. User A releases — verify lock clears
5. User B can now drag the note

**Test 6: Lock cleanup on disconnect**
1. User A starts dragging a sticky note (holds drag)
2. Close User A's browser tab abruptly (simulate crash)
3. Verify: After ≤60s, lock auto-clears via `onDisconnect`
4. User B can now drag the note

**Test 7: Presence**
1. Both users on same board
2. Verify presence data in RTDB shows both users online
3. Close one browser — verify presence updates

**Pass criteria for Phase 2 gate:** Tests 1-5 pass cleanly. Test 6 passes within 60s. Test 7 passes.

---

## Task Dependencies (Execution Order)

```
LAYER 1 — No dependencies (parallel):
  [1] types.ts
  [2] utils.ts
  [19] globals.css

LAYER 2 — Depends on types/utils (parallel):
  [3] canvasStore      (needs types)
  [4] objectStore      (needs types)
  [5] firestore.ts     (needs types)
  [6] rtdb.ts          (needs types, utils for getUserColor)

LAYER 3 — Depends on stores + helpers (parallel):
  [7] useFirestoreSync (needs objectStore, firestore)
  [8] useLockSync      (needs objectStore, rtdb)
  [9] DotGrid          (needs canvasStore)
  [13] CursorLayer     (needs rtdb)
  [14] Toolbar         (needs canvasStore)
  [17] Auth page       (needs auth.ts — already exists)
  [18] Dashboard       (needs firestore.ts)

LAYER 4 — Depends on components (parallel):
  [10] StickyNote      (needs objectStore, canvasStore, rtdb, firestore, utils)
  [12] SelectionLayer  (needs canvasStore)

LAYER 5 — Depends on sub-components:
  [11] BoardObjects    (needs StickyNote, objectStore, canvasStore)

LAYER 6 — Final assembly:
  [15] Canvas          (needs DotGrid, BoardObjects, SelectionLayer, CursorLayer, canvasStore, objectStore)

LAYER 7 — Page wiring:
  [16] Board page      (needs Canvas, useFirestoreSync, useLockSync, rtdb)

LAYER 8 — Validation:
  [20] Integration test (needs everything)
```

**Recommended execution order (sequential with parallelism noted):**

| Order | Tasks | Est. Time |
|-------|-------|-----------|
| 1 | [1] types.ts + [2] utils.ts + [19] CSS | 30 min |
| 2 | [3] canvasStore + [4] objectStore | 40 min |
| 3 | [5] firestore.ts + [6] rtdb.ts | 55 min |
| 4 | [7] useFirestoreSync + [8] useLockSync | 40 min |
| 5 | [9] DotGrid + [13] CursorLayer + [14] Toolbar | 80 min |
| 6 | [10] StickyNote + [12] SelectionLayer | 50 min |
| 7 | [11] BoardObjects | 20 min |
| 8 | [15] Canvas | 30 min |
| 9 | [16] Board page | 25 min |
| 10 | [17] Auth page + [18] Dashboard (parallel) | 25 min |
| 11 | [20] Integration test | 30 min |
| **Total** | | **~7 hours** |

---

## Critical Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Konva SSR crash in Next.js | Build breaks | Dynamic import with `{ ssr: false }` — enforce from day 1 |
| RTDB lock race condition (two users grab same object) | Data inconsistency | Use RTDB transaction or check lock state after write |
| Firestore onSnapshot fires during drag | Object teleports to old position | Only apply snapshot updates for objects NOT currently being dragged locally |
| Optimistic create with wrong ID | Duplicate objects on canvas | Pre-generate Firestore doc ID so optimistic ID matches server ID |
| DotGrid performance at extreme zoom out | Canvas freezes | Adaptive dot density — reduce dots at low zoom levels |
| Stale locks from crashed clients | Objects permanently locked | Treat locks >30s old as stale; `onDisconnect` handles cleanup |
| React StrictMode double mount in dev | Double listeners, double presence | All hooks must return cleanup functions; use refs to track initialization |

---

## Not In Scope (Deferred)

These items are mentioned in PHASE_2_PLAN.md or spec.MD but explicitly deferred:

- Text editing (double-click → textarea overlay) → Phase 3
- Resize handles on sticky notes → Phase 3
- Multi-select drag rectangle → Phase 3
- Shapes (rectangle, circle) → Phase 3
- Frames and connectors → Phase 3
- Color picker → Phase 3
- Copy/paste/duplicate → Phase 3
- Delete with confirmation dialog → Phase 3 (can stub with simple delete for testing)
- AI sidebar → Phase 4
- Board listing on dashboard → Phase 5
- Share modal → Phase 5
- Presence UI (avatar stack) → Phase 5
