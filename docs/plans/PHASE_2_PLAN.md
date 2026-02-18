# Phase 2: Core Objects — Implementation Plan

**Gate:** Two users can create and move sticky notes simultaneously with soft locking.

**Estimated Duration:** 8 hours (Hours 4–12)

---

## Updated Directory Structure

Files marked `[NEW]` are created in Phase 2. Files marked `[MOD]` are modified.

```
src/
├── middleware.ts
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── globals.css                          [MOD] add canvas reset styles
│   ├── auth/
│   │   └── page.tsx                         [MOD] full auth UI
│   ├── dashboard/
│   │   └── page.tsx                         [MOD] board creation + navigation
│   └── board/
│       └── [boardId]/
│           └── page.tsx                     [NEW] board workspace — wires Canvas, listeners, presence
├── components/
│   ├── canvas/
│   │   ├── Canvas.tsx                       [NEW] Konva Stage, 4 layers, pan/zoom, event dispatch
│   │   ├── DotGrid.tsx                      [NEW] static infinite dot grid (Layer 1)
│   │   ├── BoardObjects.tsx                 [NEW] renders objects from objectStore (Layer 2)
│   │   ├── StickyNote.tsx                   [NEW] Konva Group: Rect + Text, drag events, lock check
│   │   ├── SelectionLayer.tsx               [NEW] Transformer + selection rectangle (Layer 3)
│   │   └── CursorLayer.tsx                  [NEW] remote cursors from Phase 1 spec (Layer 4)
│   ├── auth/
│   │   └── AuthCard.tsx                     [NEW] centered login card with guest + social buttons
│   └── ui/
│       └── Toolbar.tsx                      [NEW] top-centered floating toolbar — mode switching
├── lib/
│   ├── firebase/
│   │   ├── config.ts
│   │   ├── auth.ts
│   │   ├── firestore.ts                     [NEW] Firestore CRUD helpers for board objects + metadata
│   │   └── rtdb.ts                          [NEW] RTDB helpers: cursors, presence, locks, getUserColor
│   ├── store/
│   │   ├── authStore.ts
│   │   ├── canvasStore.ts                   [NEW] mode, selection, viewport state
│   │   └── objectStore.ts                   [NEW] board objects + locks state
│   ├── types.ts                             [NEW] shared TypeScript interfaces (BoardObject, etc.)
│   └── utils.ts                             [NEW] snapToGrid, getUserColor, viewport helpers
├── hooks/
│   ├── useFirestoreSync.ts                  [NEW] onSnapshot listener hook for objects
│   └── useLockSync.ts                       [NEW] RTDB lock listener hook
└── providers/
    └── AuthProvider.tsx
```

---

## 1. Firestore Schema

### Collection: `boards/{boardId}/objects/{objectId}`

Each document represents one canvas object. For Phase 2, only `stickyNote` type is fully implemented.

```typescript
// src/lib/types.ts

type ObjectType = 'stickyNote' | 'rectangle' | 'circle' | 'frame' | 'connector' | 'colorLegend';

interface BoardObject {
  id: string;                   // Firestore doc ID
  type: ObjectType;

  // Spatial
  x: number;                    // Canvas-space X
  y: number;                    // Canvas-space Y
  width: number;                // Pixels
  height: number;               // Pixels
  rotation?: number;            // Degrees

  // Visual
  color: string;                // Hex color
  text?: string;                // Text content

  // Ownership
  createdBy: string;            // Firebase Auth UID
  createdAt: Timestamp;         // Server timestamp — doubles as z-index
  updatedAt: Timestamp;         // Server timestamp

  // Relationships (Phase 3+)
  parentFrame?: string;
  connectedTo?: string[];

  // AI (Phase 4+)
  isAIGenerated?: boolean;
  aiCommandId?: string;
  role?: string;
  metadata?: Record<string, unknown>;
}
```

### Document: `boards/{boardId}/metadata` (single doc, ID = `config`)

```typescript
interface BoardMetadata {
  title: string;
  createdBy: string;
  createdAt: Timestamp;
  isPublic: boolean;             // Default: true
  invitedEmails: string[];       // Phase 5
  aiPersona: string;             // Default: 'neutral'
  aiCommandsToday: number;       // Default: 0
  aiCommandsResetAt: Timestamp;
  analysisHistory: [];           // Phase 4+
}
```

### RTDB Path: `/boards/{boardId}/locks/{objectId}`

```typescript
interface ObjectLock {
  userId: string;
  userName: string;
  timestamp: number;             // Date.now()
}
```

---

## 2. Zustand Stores

### `canvasStore` — Mode, Selection, Viewport

```typescript
// src/lib/store/canvasStore.ts

interface CanvasState {
  // Mode
  mode: 'pan' | 'select' | 'create';
  creationTool: ObjectType | null;        // Which object to create (null when not in create mode)

  // Selection
  selectedObjectIds: string[];

  // Viewport
  stageX: number;
  stageY: number;
  stageScale: number;                     // 0.05–5.0

  // Actions
  setMode: (mode: CanvasState['mode']) => void;
  enterCreateMode: (tool: ObjectType) => void;
  exitToPan: () => void;
  selectObject: (id: string) => void;
  toggleSelection: (id: string) => void;  // Ctrl+Click
  clearSelection: () => void;
  setViewport: (x: number, y: number, scale: number) => void;
}
```

**Key behaviors:**
- `enterCreateMode(tool)` sets `mode: 'create'` and `creationTool: tool`
- `exitToPane()` sets `mode: 'pan'`, `creationTool: null`, clears selection
- Escape key always calls `exitToPane()`
- Clicking a creation tool while already in create mode switches to the new tool

### `objectStore` — Board Objects + Lock State

```typescript
// src/lib/store/objectStore.ts

interface ObjectState {
  objects: Record<string, BoardObject>;    // Keyed by objectId
  locks: Record<string, ObjectLock>;       // Keyed by objectId

  // Object actions (local/optimistic)
  setObjects: (objects: Record<string, BoardObject>) => void;
  upsertObject: (object: BoardObject) => void;
  updateObjectLocal: (id: string, updates: Partial<BoardObject>) => void;
  removeObject: (id: string) => void;

  // Lock actions (from RTDB listener)
  setLocks: (locks: Record<string, ObjectLock>) => void;
}
```

**Key behaviors:**
- `setObjects` overwrites all objects (from onSnapshot full read)
- `upsertObject` adds or replaces one object (optimistic create)
- `updateObjectLocal` patches one object (optimistic drag position update)
- `removeObject` deletes locally (optimistic delete)
- `setLocks` full replacement from RTDB listener

---

## 3. Mode System — Interaction Model

```
┌──────────────┐     Escape / click Pan tool     ┌─────────────┐
│              │ ◄──────────────────────────────  │             │
│   Pan Mode   │                                  │ Select Mode │
│  (default)   │  ──────────────────────────────► │             │
│              │     click Select tool / key "2"  │             │
└──────┬───────┘                                  └─────────────┘
       │                                                ▲
       │  click creation tool / key "3"                 │ Escape
       ▼                                                │
┌──────────────┐                                        │
│ Create Mode  │ ───────────────────────────────────────┘
│ (sticky, etc)│
└──────────────┘
```

**Stage behavior per mode:**
| Property           | Pan Mode        | Select Mode       | Create Mode        |
|--------------------|-----------------|-------------------|--------------------|
| Stage `draggable`  | `true`          | `false`           | `false`            |
| Click on empty     | starts pan drag | clears selection  | creates object     |
| Click on object    | (no interaction)| selects object    | (no interaction)   |
| Drag on object     | (no interaction)| moves object      | (no interaction)   |
| Cursor             | `grab`/`grabbing`| `default`/`pointer`| `crosshair`      |

---

## 4. Sticky Note Creation Flow

```
User clicks canvas in Create Mode (tool = stickyNote)
    │
    ▼
Calculate canvas-space coords from pointer + stage transform
    │
    ▼
Snap to 20px grid: x = round(canvasX / 20) * 20, y = round(canvasY / 20) * 20
    │
    ▼
Generate temporary ID (crypto.randomUUID or Firestore doc().id)
    │
    ▼
Optimistic: objectStore.upsertObject({
    id: tempId, type: 'stickyNote',
    x, y, width: 200, height: 150,
    color: '#FEFF9C', text: '',
    createdBy: userId,
    createdAt: now, updatedAt: now
})
    │
    ▼
Canvas immediately renders the new sticky note
    │
    ▼
Async: addDoc(collection(db, `boards/${boardId}/objects`), { ... serverTimestamp ... })
    │
    ▼
onSnapshot fires → objectStore.setObjects() reconciles (replaces temp with server version)
```

---

## 5. Real-time Sync — onSnapshot Reconciliation

### Hook: `useFirestoreSync(boardId)`

```
Board page mounts
    │
    ▼
Subscribe to onSnapshot(collection(db, `boards/${boardId}/objects`))
    │
    ▼
On initial snapshot: populate objectStore with all objects
    │
    ▼
On subsequent changes (docChanges):
  - 'added'   → upsertObject
  - 'modified' → upsertObject  (server state wins — last-write-wins)
  - 'removed'  → removeObject
    │
    ▼
React re-renders Konva canvas via objectStore subscription
    │
    ▼
On unmount: unsubscribe listener
```

**Conflict resolution:** Server timestamp (`updatedAt`) determines winner. No merge logic needed — entire document overwrites.

**Loading state:** objectStore tracks `isLoaded: boolean`. Board page shows spinner until first snapshot arrives.

---

## 6. Soft Locking — Drag Conflict Prevention

### RTDB Lock Flow

```
User starts drag (dragstart on Konva node)
    │
    ▼
Check objectStore.locks[objectId]:
  - If locked by another user → cancel drag, show "Locked by {name}" indicator
  - If unlocked or locked by self → proceed
    │
    ▼
RTDB write: set(ref(rtdb, `boards/${boardId}/locks/${objectId}`), {
    userId, userName, timestamp: Date.now()
})
    │
    ▼
Register onDisconnect: onDisconnect(lockRef).remove()
    │
    ▼
Drag proceeds... (local Zustand updates only, no Firestore writes)
    │
    ▼
User releases (dragend)
    │
    ▼
Snap final position to 20px grid
    │
    ▼
Firestore write: updateDoc(objectRef, { x, y, updatedAt: serverTimestamp() })
    │
    ▼
RTDB remove: remove(ref(rtdb, `boards/${boardId}/locks/${objectId}`))
```

### Lock Listener: `useLockSync(boardId)`

```
Board page mounts
    │
    ▼
Subscribe to onValue(ref(rtdb, `boards/${boardId}/locks`))
    │
    ▼
On value change: objectStore.setLocks(snapshot.val() || {})
    │
    ▼
StickyNote component checks locks[object.id]:
  - If locked by another user → dim object, show lock icon, disable drag
  - If locked by self or unlocked → normal appearance, drag enabled
```

---

## 7. Optimistic Update — Drag Performance

```
60 FPS Local Loop (during drag):
  ┌─────────────────────────────────┐
  │ Konva dragmove event fires      │
  │         │                       │
  │         ▼                       │
  │ objectStore.updateObjectLocal(  │
  │   id, { x: newX, y: newY }     │  ← Zustand update (sync, ~0.1ms)
  │ )                               │
  │         │                       │
  │         ▼                       │
  │ React re-renders Konva node     │  ← React/Konva reconciliation
  │ at new position                 │
  └─────────────────────────────────┘

  NO Firestore writes during drag.
  NO RTDB cursor writes during drag (already throttled from Phase 1).

On dragend:
  ┌─────────────────────────────────┐
  │ Snap position to 20px grid      │
  │         │                       │
  │         ▼                       │
  │ objectStore.updateObjectLocal(  │  ← Final snapped position
  │   id, { x, y }                 │
  │ )                               │
  │         │                       │
  │         ▼                       │
  │ Firestore updateDoc (async)     │  ← Network write (fire-and-forget)
  │         │                       │
  │         ▼                       │
  │ Release RTDB lock               │
  └─────────────────────────────────┘
```

**Revert on write failure:** If `updateDoc` throws, revert the object's x/y to the pre-drag snapshot stored at `dragstart`.

---

## 8. Implementation Tasks

| #  | Task | Files | Description | Est. |
|----|------|-------|-------------|------|
| 1  | **Define shared types** | `src/lib/types.ts` [NEW] | `BoardObject`, `ObjectType`, `BoardMetadata`, `ObjectLock`, `CursorData`, `PresenceData` interfaces. Sticky note color palette constants. | 15 min |
| 2  | **Create utility functions** | `src/lib/utils.ts` [NEW] | `snapToGrid(value, gridSize=20)`, `getUserColor(userId)` (deterministic HSL from hash), `getCanvasPoint(stage, pointerPos)` (screen → canvas coords accounting for pan/zoom). | 15 min |
| 3  | **Create canvasStore** | `src/lib/store/canvasStore.ts` [NEW] | Zustand store for mode (`pan`/`select`/`create`), `creationTool`, `selectedObjectIds[]`, viewport (`stageX`, `stageY`, `stageScale`). Actions: `setMode`, `enterCreateMode`, `exitToPane`, `selectObject`, `toggleSelection`, `clearSelection`, `setViewport`. | 20 min |
| 4  | **Create objectStore** | `src/lib/store/objectStore.ts` [NEW] | Zustand store for `objects: Record<string, BoardObject>`, `locks: Record<string, ObjectLock>`, `isLoaded: boolean`. Actions: `setObjects`, `upsertObject`, `updateObjectLocal`, `removeObject`, `setLocks`. | 20 min |
| 5  | **Create Firestore helpers** | `src/lib/firebase/firestore.ts` [NEW] | `createObject(boardId, data)` → `addDoc`, `updateObject(boardId, objectId, updates)` → `updateDoc` with `serverTimestamp`, `deleteObject(boardId, objectId)` → `deleteDoc`, `createBoardMetadata(boardId, userId, title)` → `setDoc`. | 25 min |
| 6  | **Create RTDB helpers** | `src/lib/firebase/rtdb.ts` [NEW] | **Cursors:** `setCursor`, `onCursorsChange`, `removeCursor` + `onDisconnect` cleanup. **Presence:** `setPresence`, `onPresenceChange` + `onDisconnect` cleanup. **Locks:** `acquireLock(boardId, objectId, userId, userName)` → `set()` + `onDisconnect().remove()`, `releaseLock(boardId, objectId)` → `remove()`, `onLocksChange(boardId, callback)` → `onValue()`. | 30 min |
| 7  | **Create useFirestoreSync hook** | `src/hooks/useFirestoreSync.ts` [NEW] | Hook that takes `boardId`, subscribes to `onSnapshot(collection(db, boards/${boardId}/objects))`, maps `docChanges` to objectStore mutations. Returns cleanup function. Sets `isLoaded = true` after first snapshot. | 25 min |
| 8  | **Create useLockSync hook** | `src/hooks/useLockSync.ts` [NEW] | Hook that takes `boardId`, subscribes to `onValue(ref(rtdb, boards/${boardId}/locks))`, updates `objectStore.setLocks`. Returns cleanup function. | 15 min |
| 9  | **Build DotGrid component** | `src/components/canvas/DotGrid.tsx` [NEW] | Konva `Shape` with custom `sceneFunc` that draws dots at 20px intervals within the visible viewport. Recalculates on pan/zoom (reads stageX, stageY, stageScale from canvasStore). Static layer — `listening={false}`. | 30 min |
| 10 | **Build StickyNote component** | `src/components/canvas/StickyNote.tsx` [NEW] | Konva `Group` containing `Rect` (200x150, rounded corners, fill from `color`) + `Text` (14px, padded 10px, auto-height). Props: `BoardObject` + `isLocked` + `lockedBy`. Events: `onDragStart` (acquire lock, save pre-drag position), `onDragMove` (optimistic position update), `onDragEnd` (snap to grid, Firestore write, release lock). `draggable` disabled if locked by another user. | 45 min |
| 11 | **Build BoardObjects renderer** | `src/components/canvas/BoardObjects.tsx` [NEW] | Reads `objectStore.objects`, filters to only `stickyNote` type (Phase 2), renders `<StickyNote>` for each. Passes lock state from `objectStore.locks`. Sorts by `createdAt` for z-index ordering. | 20 min |
| 12 | **Build SelectionLayer component** | `src/components/canvas/SelectionLayer.tsx` [NEW] | Phase 2 skeleton: renders Konva `Transformer` attached to selected object nodes (from `canvasStore.selectedObjectIds`). Selection rectangle for drag-select deferred to Phase 3. | 25 min |
| 13 | **Build CursorLayer component** | `src/components/canvas/CursorLayer.tsx` [NEW] | Subscribes to `onCursorsChange(boardId)`. Renders each remote cursor as `Circle` (12px, user color) + `Text` (display name). Filters out local user. Stale cursor cleanup: ignore if `timestamp` > 10s old. | 25 min |
| 14 | **Build Toolbar component** | `src/components/ui/Toolbar.tsx` [NEW] | Top-centered floating bar with: Pan (hand icon), Select (arrow icon), Sticky Note (note icon). Active tool highlighted with brand purple tint (`#6366f1`). Clicks dispatch `canvasStore.setMode` / `canvasStore.enterCreateMode`. Semi-transparent white bg + backdrop blur + shadow. | 30 min |
| 15 | **Build Canvas component** | `src/components/canvas/Canvas.tsx` [NEW] | Konva `Stage` filling viewport. 4 layers: DotGrid, BoardObjects, SelectionLayer, CursorLayer. `draggable={mode === 'pan'}`. Wheel handler for zoom (clamped 0.05–5.0, centered on cursor). Click handler: in create mode, dispatches object creation. Mouse move: throttled cursor write to RTDB (30 Hz). Keyboard listener: Escape → exitToPane. Reads mode from canvasStore. | 45 min |
| 16 | **Build board page** | `src/app/board/[boardId]/page.tsx` [NEW] | Reads `boardId` from params. Renders `<Canvas>`. On mount: `useFirestoreSync(boardId)`, `useLockSync(boardId)`, `setPresence(boardId, userId)`. On unmount: removes presence + cursor. Auth guard: redirect to `/auth` if not logged in. Loading spinner until objectStore.isLoaded. | 30 min |
| 17 | **Build auth page (full UI)** | `src/app/auth/page.tsx` [MOD], `src/components/auth/AuthCard.tsx` [NEW] | Centered card on gray bg. Brand purple accent. Display name input. "Continue as Guest" (primary), "Sign in with Google", "Sign in with GitHub" buttons. On success: update displayName in Firestore profile, navigate to `/dashboard`. | 30 min |
| 18 | **Update dashboard page** | `src/app/dashboard/page.tsx` [MOD] | Show user info (name, avatar). "New Board" button: generates `crypto.randomUUID()`, calls `createBoardMetadata(boardId, userId, title)`, navigates to `/board/{id}`. Client-side auth guard already handled by AuthProvider. | 25 min |
| 19 | **Add canvas CSS resets** | `src/app/globals.css` [MOD] | Add `body { overflow: hidden; }` for board pages. Ensure no scrollbars on canvas. Toolbar positioning styles. | 10 min |
| 20 | **Integration test: two-user sticky note creation + drag with soft locking** | Manual testing | Open two browser windows, sign in as two guests, create board, create stickies, drag simultaneously, verify locking behavior. | 30 min |

**Total estimated: ~8 hours 10 min**

---

## 9. Task Dependencies

```
[1] Types ─────────┬──► [3] canvasStore ──────┐
                   ├──► [4] objectStore ──────┤
                   ├──► [5] Firestore helpers  │
                   └──► [6] RTDB helpers       │
                                               │
[2] Utils ─────────────────────────────────────┤
                                               │
[5] Firestore helpers ──► [7] useFirestoreSync │
[6] RTDB helpers ─────┬─► [8] useLockSync     │
                      └─► [13] CursorLayer    │
                                               │
[3] canvasStore ───────┬─► [9] DotGrid        │
                       ├─► [14] Toolbar        │
                       └─► [15] Canvas ◄───────┤
                                               │
[4] objectStore ───────┬─► [10] StickyNote     │
                       └─► [11] BoardObjects   │
                                               │
[10] StickyNote ──► [11] BoardObjects ──┐      │
[9] DotGrid ────────────────────────────┤      │
[12] SelectionLayer ────────────────────┤      │
[13] CursorLayer ───────────────────────┤      │
                                        ▼      │
                                  [15] Canvas ◄┘
                                        │
                                        ▼
                                  [16] Board Page
                                        │
[17] Auth Page (parallel) ──────────────┤
[18] Dashboard (parallel) ──────────────┤
[19] CSS Resets (parallel) ─────────────┤
                                        ▼
                                  [20] Integration Test
```

**Parallelizable groups:**
- Group A (can run in parallel): Tasks 1, 2
- Group B (after A): Tasks 3, 4, 5, 6
- Group C (after B): Tasks 7, 8, 9, 10, 12, 13, 14
- Group D (after C): Tasks 11, 15
- Group E (after D): Task 16
- Independent: Tasks 17, 18, 19 (can run anytime after Task 5)
- Final: Task 20 (after all)

---

## 10. Key Implementation Notes

### Konva + SSR
Konva requires the DOM. All canvas components must be loaded with `dynamic(() => import(...), { ssr: false })` in Next.js to avoid server-side rendering errors.

### Firestore Document ID Strategy
Use `addDoc` for object creation (Firestore auto-generates ID). The ID is stored in the `id` field of the document for convenience. Alternatively, use `doc(collection(...))` to pre-generate an ID for optimistic rendering before the write completes.

### Z-Index via createdAt
Objects render in `createdAt` order (earlier objects behind, later objects in front). During a drag, the dragged object should temporarily render on top (bring-to-front) by adjusting its Konva `zIndex`. On drag end, `updatedAt` is refreshed but `createdAt` stays fixed for consistent ordering.

### Grid Snapping Formula
```
snapToGrid(value) = Math.round(value / 20) * 20
```
Applied to both x and y on object creation and drag end. During drag, snapping is applied to the visual position but the raw position is tracked for smooth movement.

### Keyboard Shortcuts (Phase 2 subset)
| Key     | Action                          |
|---------|---------------------------------|
| Escape  | Return to Pan mode, deselect    |
| 1       | Pan mode                        |
| 2       | Select mode                     |
| 3       | Sticky Note create mode         |
| Delete  | Delete selected (with confirm)  |

### Performance Guards
- DotGrid: `listening={false}` on the layer, custom `sceneFunc` only draws visible dots
- BoardObjects: viewport culling — only render objects within `viewport bounds + 200px` padding
- Drag: zero Firestore writes during drag, only on `dragend`
- Cursor sync: 30 Hz throttle, 5px distance threshold (from Phase 1 RTDB spec)
