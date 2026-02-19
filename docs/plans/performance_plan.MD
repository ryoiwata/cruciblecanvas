 Here is Claude's plan:                                                            
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 CrucibleCanvas Performance Plan                        

 Context

 The app must handle 500+ objects at 60 FPS with <100ms object sync and <50ms
 cursor sync across 5+ concurrent users. Exploration revealed several concrete
 bottlenecks:

 - Each Firestore docChange fires a separate upsertObject() store call → N
 re-renders per snapshot (with 5 users each moving objects, this can be 20+
 re-renders/sec)
 - BoardObjects and Canvas subscribe to the full objects map → any single-object
 change cascades through the entire render tree
 - Lock sync uses a full onValue listener → every lock acquire/release replaces
 the entire locks object and re-renders all subscribers
 - Pan/zoom calls setViewport() on every raw mousemove / wheel event → triggers
 viewport culling recalculation via useMemo at 120+ Hz
 - Connectors are never culled → all connectors render regardless of viewport
 position

 What already works well and must be preserved:
 - RAF-gated border resize (direct Konva mutation, no React)
 - Viewport culling with 200px padding in BoardObjects.useMemo
 - Granular child listeners for cursors and presence
 - locallyEditingIds echo prevention
 - React.memo on leaf components with custom comparators

 ---
 Implementation Plan

 Phase 1 — High-Impact Sync Fixes (biggest bang)

 1.1 Batch Firestore docChanges into a single store update

 File: src/hooks/useFirestoreSync.ts

 Problem: The snapshot callback loops over docChanges() and calls upsertObject()
 or removeObject() for each change individually. Each call replaces the objects
 map reference, triggering a re-render cycle. With 5 users, Firestore can batch
 10–30 changes into one snapshot delivery — causing 10–30 separate store
 mutations.

 Fix: Accumulate all adds/modifies into one array and all removes into another
 array, then call batchUpsert() and batchRemove() once after the loop. Both
 functions already exist in objectStore.ts (lines 76–83 and 67–74).

 - snapshot.docChanges().forEach((change) => {
 -   switch (change.type) {
 -     case "added":
 -     case "modified":
 -       if (!locallyEditingIds.has(change.doc.id)) upsertObject(obj);
 -       break;
 -     case "removed":
 -       removeObject(change.doc.id);
 -       break;
 -   }
 - });
 + const toUpsert: BoardObject[] = [];
 + const toRemove: string[] = [];
 + snapshot.docChanges().forEach((change) => {
 +   const obj = { ...change.doc.data(), id: change.doc.id } as BoardObject;
 +   if (change.type === "removed") {
 +     toRemove.push(change.doc.id);
 +   } else if (!locallyEditingIds.has(change.doc.id)) {
 +     toUpsert.push(obj);
 +   }
 + });
 + if (toUpsert.length) batchUpsert(toUpsert);
 + if (toRemove.length) batchRemove(toRemove);

 Impact: Reduces N re-renders per snapshot to at most 2 (one for upserts, one for
 removes).

 ---
 1.2 Replace lock onValue with granular child listeners

 Files: src/lib/firebase/rtdb.ts, src/hooks/useLockSync.ts,
 src/lib/store/objectStore.ts

 Problem: onLocksChange (rtdb.ts:393) uses onValue — the entire lock map is
 broadcast whenever any single lock changes. setLocks() replaces state.locks in
 the store, re-rendering every component subscribed to locks.

 Fix:
 1. Add onLockChildEvents() to rtdb.ts (same pattern as onCursorChildEvents and
 onPresenceChildEvents)
 2. Add upsertLock(id, lock) and removeLock(id) actions to objectStore.ts
 3. Rewrite useLockSync.ts to use child listeners

 New rtdb function:
 export function onLockChildEvents(
   boardId: string,
   callbacks: {
     onAdd: (objectId: string, lock: ObjectLock) => void;
     onChange: (objectId: string, lock: ObjectLock) => void;
     onRemove: (objectId: string) => void;
   }
 ): Unsubscribe {
   const locksRef = ref(rtdb, `boards/${boardId}/locks`);
   // ... same onChildAdded/Changed/Removed pattern
 }

 New store actions:
 upsertLock: (id, lock) => set((s) => ({ locks: { ...s.locks, [id]: lock } })),
 removeLock: (id) => set((s) => { const { [id]: _, ...rest } = s.locks; return {
 locks: rest }; }),

 Impact: Lock changes only update the specific lock entry. Components memoized on
 locks[obj.id] only re-render for their own object's lock.

 ---
 1.3 RAF-throttle viewport updates during pan and zoom

 File: src/components/canvas/Canvas.tsx

 Problem: handleWheel and handleMouseMove (pan mode) call setViewport()
 synchronously on every raw DOM event. Wheel events fire 10–15× per scroll
 gesture; mousemove fires every pixel of movement. Each call updates Zustand →
 BoardObjects.useMemo dependency changes → full O(N) viewport cull recalculates.

 Fix: Add a viewportRafRef (similar to the existing borderResizeRafRef) that
 coalesces viewport changes to one update per frame:

 const pendingViewport = useRef<{ x: number; y: number; scale: number } |
 null>(null);
 const viewportRafRef = useRef<number | null>(null);

 function flushViewport() {
   viewportRafRef.current = null;
   if (pendingViewport.current) {
     const { x, y, scale } = pendingViewport.current;
     pendingViewport.current = null;
     setViewport(x, y, scale);
   }
 }

 // In handleWheel / pan mousemove:
 pendingViewport.current = { x: newX, y: newY, scale: newScale };
 if (!viewportRafRef.current) {
   viewportRafRef.current = requestAnimationFrame(flushViewport);
 }

 Impact: Viewport culling runs at most 60×/sec regardless of input event rate.

 ---
 Phase 2 — Canvas Rendering Optimizations

 2.1 Connector viewport culling

 File: src/components/canvas/BoardObjects.tsx (line 76–82)

 Problem: Connectors skip the culling block entirely and are always pushed to the
 conns array. At low zoom, hundreds of connectors off-screen still render.

 Fix: Cull connectors based on their connectedTo endpoints. A connector is visible
  if at least one of its endpoint objects is visible, OR if its bounding box
 (derived from x, y, width, height stored on the connector object itself)
 intersects the viewport.

 if (obj.type === "connector") {
   // Use connector's own bounding box for culling
   if (obj.x + obj.width < vpLeft) { continue; }
   if (obj.x > vpRight) { continue; }
   if (obj.y + obj.height < vpTop) { continue; }
   if (obj.y > vpBottom) { continue; }
   conns.push(obj);
   continue;
 }

 Note: Confirm connectors have x, y, width, height stored in Firestore by checking
  ConnectorObject.tsx. If not, cull by checking both endpoint objects instead.

 Impact: Off-screen connectors eliminated from render tree.

 ---
 2.2 Narrow Canvas.tsx object subscription

 File: src/components/canvas/Canvas.tsx

 Problem: Canvas.tsx subscribes to the full objects map (useObjectStore((s) =>
 s.objects)). Inspect exactly what Canvas.tsx uses objects for — likely clipboard
 operations, keyboard shortcuts, frame selection helpers. Most uses can be
 replaced with useObjectStore.getState().objects (imperative read inside
 callbacks) rather than reactive subscriptions.

 Fix: Replace const objects = useObjectStore((s) => s.objects) with direct
 getState() calls inside event handlers where reactivity is not needed. Only keep
 reactive subscriptions for values actually used in JSX render output.

 ---
 2.3 Add useShallow for multi-value Zustand subscriptions

 Files: Components that select multiple scalar values from a store

 Where a component selects 3+ separate values from one store with individual
 calls, combine into one useShallow call to avoid subscribing separately:

 // Before (3 separate subscriptions):
 const stageX = useCanvasStore((s) => s.stageX);
 const stageY = useCanvasStore((s) => s.stageY);
 const stageScale = useCanvasStore((s) => s.stageScale);

 // After (one shallow-compared subscription):
 const { stageX, stageY, stageScale } = useCanvasStore(
   useShallow((s) => ({ stageX: s.stageX, stageY: s.stageY, stageScale:
 s.stageScale }))
 );

 Apply in BoardObjects.tsx (stageX, stageY, stageScale, mode, creationTool,
 connectorHoverTarget — 6 individual subscriptions).

 ---
 Phase 3 — Testing at Scale

 3.1 Seed script for 500+ objects

 File: scripts/seed-test-objects.ts (new file)

 Create a script using the Firebase Admin SDK to populate a test board with 500+
 objects of mixed types (sticky notes, shapes, frames, connectors). Distribute
 them across a large canvas area to test viewport culling.

 // scripts/seed-test-objects.ts
 import { initializeApp, cert } from 'firebase-admin/app';
 import { getFirestore, WriteBatch } from 'firebase-admin/firestore';

 const BOARD_ID = process.env.TEST_BOARD_ID!;
 const OBJECT_COUNT = 500;
 const CANVAS_SIZE = 10000; // 10k x 10k canvas

 // Create batches of 500 (Firestore batch limit)
 // Mix of types: 60% stickyNote, 20% rectangle, 10% circle, 5% frame, 5%
 connector

 Run via: npx ts-node scripts/seed-test-objects.ts

 3.2 Multi-user simulation

 For 5+ user simulation:
 1. Open 5 browser windows (or use different browser profiles to get different
 Firebase Auth sessions)
 2. All navigate to the same test board URL
 3. Have each user drag different objects simultaneously
 4. Monitor with Chrome DevTools Performance panel

 3.3 Performance measurement checklist

 FPS measurement (Chrome DevTools):
 - Open Performance panel → Record 5 seconds of pan + zoom → Check frame timing
 - Target: all frames ≤ 16.7ms (60 FPS)
 - Red flags: frames >50ms during pan, >100ms during zoom

 React re-render profiling (React DevTools Profiler):
 - Record interaction → check which components render and how often
 - Target: only affected leaf components re-render on Firestore updates
 - Red flags: Canvas re-rendering 10+ times/sec, BoardObjects re-rendering on
 cursor moves

 Firebase latency (Network tab + Firestore console):
 - Monitor WebSocket frames in Network tab → filter by wss://
 - Measure time from drag-end to Firestore ack
 - Cursor sync: check RTDB traffic frequency

 Lighthouse / Core Web Vitals (for initial load with 500 objects):
 - Target: onSnapshot first load <2s for 500 objects
 - Check: no layout shifts from async Firestore load

 ---
 Critical Files

 File: src/hooks/useFirestoreSync.ts
 Change: Batch docChanges → single batchUpsert + batchRemove
 ────────────────────────────────────────
 File: src/lib/firebase/rtdb.ts
 Change: Add onLockChildEvents()
 ────────────────────────────────────────
 File: src/hooks/useLockSync.ts
 Change: Switch to child listeners
 ────────────────────────────────────────
 File: src/lib/store/objectStore.ts
 Change: Add upsertLock() + removeLock() actions
 ────────────────────────────────────────
 File: src/components/canvas/Canvas.tsx
 Change: RAF-throttle setViewport, narrow objects subscription
 ────────────────────────────────────────
 File: src/components/canvas/BoardObjects.tsx
 Change: Connector culling, useShallow for viewport values
 ────────────────────────────────────────
 File: scripts/seed-test-objects.ts
 Change: New: 500-object seed script

 ---
 Verification

 1. Run seed script → board has 500+ mixed objects
 2. Open 5 browser windows on the same board
 3. Chrome DevTools Performance → record 5s of pan/zoom → confirm 60 FPS (≤16.7ms
 frames)
 4. React Profiler → confirm BoardObjects does not re-render when a different user
  moves an object that's off-screen
 5. Network tab → confirm single WebSocket write per drag-end (not N writes per
 snapshot)
 6. RTDB monitor → confirm cursor writes at ≤16ms throttle rate
 7. Console → zero "Firestore onSnapshot error" messages under concurrent load

 ---
 Explicitly Out of Scope

 - Spatial indexing (quadtree/octree) — O(N) culling is acceptable for 500 objects
  with memoization
 - Server-side Cloud Functions for lock TTL — current onDisconnect handles crash
 recovery adequately
 - Firebase regional configuration — network latency is outside client code
 - WebGL rendering — Konva's Canvas 2D is sufficient for 500 objects at 60 FPS