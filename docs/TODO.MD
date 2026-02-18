MVP Requirements (24 Hours)
Hard gate. All items required to pass:
[x] Infinite board with pan/zoom
[x] Sticky notes with editable text
[x] At least one shape type (rectangle, circle, or line)
[x] Create, move, and edit objects
[x] Real-time sync between 2+ users
[x] Multiplayer cursors with name labels
[x] Presence awareness (who's online)
[x] User authentication
[x] Deployed and publicly accessible
A simple whiteboard with bulletproof multiplayer beats a feature-rich board with broken sync

## 🟢 Phase 1: High-Priority UI & Interaction

* [ ] **Toolbar Relocation:** Move the floating toolbar to the bottom-center with `backdrop-blur` and `shadow-md`.
* [ ] **Pop-up Reorientation:** Ensure "Align," "Arrange," and "Color Picker" menus pop **upwards** from the bottom toolbar.
* [ ] **Shortcuts Legend:** Add a text/icon legend bar just above the toolbar (e.g., `Ctrl + Drag` to select).
* [ ] **Sticky Note Affordance:** Add subtle horizontal "notepad lines" to editable sticky notes.
* [ ] **Selection Counter:** Display "X items selected" in the bottom-left corner when a marquee or multi-select is active.

## 🔵 Phase 2: AI Integration & Rubric Requirements

* [ ] **AI Group Chat Interface:** Implement the sidebar chat with a toggle to switch between "Message Group" and "Message AI".
* [ ] **Multi-User AI Support:** Ensure the backend handles simultaneous AI commands by assigning a unique `aiCommandId` to each batch of generated objects.
* [ ] **Implementation of Core Tool Schema:**
* [ ] `createStickyNote`, `createShape`, `createFrame`, `createConnector`.
* [ ] `moveObject`, `resizeObject`, `updateText`, `changeColor`.
* [ ] `arrangeObjects` (Grid, Horizontal, Vertical layouts).


* [ ] **Complex AI Templates:** Script the logic for the AI to generate a **SWOT Analysis** (4 quadrants) and **Retrospective** layouts.
* [ ] **AI Attribution:** Add a small sparkle icon badge to any object with `isAIGenerated: true`.

## 🟡 Phase 3: Persistence & Collaboration

* [ ] **Board Persistence:** Ensure all canvas state is saved to Firestore/RTDB so users can return to boards via the dashboard.
* [ ] **Guest Routing:** Update the auth flow so guests following a link land directly on that specific board.
* [ ] **Creator-Only Controls:** Disable the Public/Private (👀/🥸) toggle for non-creators.
* [ ] **Title Logic:** Update board metadata to allow titles with spaces and special characters.

## 🔴 Phase 4: Maintenance & Deployment

* [ ] **Firebase Deployment:** Run `firebase login --reauth` and `firebase deploy --only database` to apply the updated security rules.
* [ ] **Playwright Testing:** Implement a multi-user E2E test to verify cursor sync and name labels across two browser contexts.
* [ ] **Vercel Deployment Fix:** Update the "Commit or Branch Reference" in the Vercel UI to use a branch name (e.g., `main`) instead of a full GitHub URL.

---

**Next Step:** Would you like me to generate the **Zustand store logic** for the "Message Group vs. Message AI" chat toggle?