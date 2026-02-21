# CollabBoard — Requirements & Features Checklist

## Deadlines

| Checkpoint | Deadline | Focus |
|------------|----------|-------|
| Pre-Search | Monday (1 hour in) | Architecture, Planning |
| MVP | Tuesday (24 hours) | Collaborative infrastructure |
| Early Submission | Friday (4 days) | Full feature set |
| Final | Sunday (7 days) | Polish, documentation, deployment |

---

## MVP Requirements *(Hard Gate — All Required)*

- [x] Infinite board with pan/zoom
- [x] Sticky notes with editable text
- [x] At least one shape type (rectangle, circle, or line)
- [x] Create, move, and edit objects
- [x] Real-time sync between 2+ users
- [x] Multiplayer cursors with name labels
- [x] Presence awareness (who's online)
- [x] User authentication
- [x] Deployed and publicly accessible

---

## Core Whiteboard Features

### Board

- [x] Infinite board with smooth pan/zoom
- [x] Sticky notes — create, edit text, change colors
- [x] Shapes — rectangles, circles, lines with solid colors
  - [x] Make a line shape. Make the connect tool icon two boxes connected by a line. 
  - [ ] Add line styles
- [x] Connectors — lines/arrows connecting objects
  - [x] Make it easier to drag, just click on object to drag
- [ ] Standalone text elements
- [ ] Frames — group and organize content areas
  - [x] Make drag into frame more obvious. Make it glow of something. 
  - [ ] Clicking on one item in the frame will select that item. Option to deframe it.
  - [x] Dragging a frame onto object will put it into frame
- [x] Move, resize, and rotate objects
- [ ] Single and multi-select (shift-click, drag-to-select)
  - [x] Frame should move things together in preview
  - [x] Group resize, 
  - [x] group rotatoe
  - [ ] Make group select right click reference the group, not the single item
  - [ ] Make frame always at the bottom stack
- [x] Delete, duplicate, copy/paste
  - [x] Make copy paste more obvious, also include buttons on the bottom
    - [x] Make short cuts two rows? 

Others
- [x] Clicking on an object will change default color in the tool bar
- [ ] Include a tutorial mode?
- [x] Ctrl automatically shifts back to pointer. 
- [ ] Make shift be able tophave this option too. 
- [x] Change the tool bar so that opacity isn't sticking out(maybe pop out?)
- [x] Add recent colors used that were items previkouslty selected
- [x] Connector dots should increase in size to scale with view
- [x] Make frame text size easier to read
  - [x] Frame border should adjust with pan size
- [x] Frame should carry things in preview
- [ ] Right click on item in frame will select that item only
- [x] Clicking on item in frame will always click on item instead of frame
- [x] Framed items should have different indicator 
  - [ ] Framed items should have more bolder lines indicating it's being framed
- [x] Tool bar should have the name of the tool
- [x] Ctrl + A in bottom description
- [x] copy/paste and delete in short cut legend too
- [] Ctrl or shift always goes back to pointer tool
- [] Line thickness and type
- [] Border thickness and types
- [] Fix up short cut on bottom, move out of chat's way?
  - [x] 2 rows for short cuts?
- [] Connector should be able to connect to things in frame()
- [] Sticky note should have more clearer lines
- [] Framed items should be able to move around in frame, but stay in frame when it is being dragged it goes out of edge
- Make lines thicker by default, have option to change line style and thickness
- [] Make an option to make an account to save
- Framed objects bolder line indicator
- Still not working
  - deframe one thing in frame
  - Make connector line and framed lines thicker
  - Still not able to move item in frame within frame
  - Group select right click still only goes to single item
  - Opacity slide still sticks out
  - Make short cut legend 2 rows
  - PRevent short cut legend collision with aI achat
  - Default text should be in settings?
  - Coordinates of items
  - Change size of items
  - Change AI assistant to be robot logo instead
  - Group select should still highlight everything even when right clicking
  - Preview of resize, rotate, or drag on mouse

Maybe TODOs



REAL TODOs
- [FIX] Fix drag item within frame
- [x] Remove layers from legend
- [x] Remove duplicate from legend
- [x] Remove copy and delete text preview
- [ ] Remove shape outline changer as an option for any item
- [] Fix group select when right clicking one item highlight
- [] Fix AI agent logo in chat to robot instead of sparkle
- [] Change the chat icon on the top from robot to a chat bubble with the word Chat next to it 
- [x] Move main tool bar to top
- [ ] Font should be edited when clicking on sticky note for that whole sticky
- [ ] Frames should adjust size and not overlap items inside. Frame should be big enough to accomodate all items put in. Shapes should be adjusted to all fit in.
- [ ] Make sure that items in frame can move within the frame no matter what
- [ ] If item in frame is taken out, then it actually is deframed
- [x] Items in frames should be allowed to freely move within the frame
- [x] Change presets to something more meaningful
- [ ] Default line size should be bigger
- [ ] Line types need to be fixed
  - [ ] ie straight, curvy, etc.
- [x] Properties should only reflect the item type being selected or was previously selected ie shape types shouldn't have any text options
- [x] Text edit should change text in real time
- [ ] Group select then right click should still highlight the entier group
- [x] Text should be on the lines within the sticky
- [x] Standalone text should default to black and be bigger by default (unless previously selected standalone text was a different color or a certain size)
- [ ] Standalone text should be bigger by default (unless previously selected standalone text was a different certain size)
- [x] There should be a size dimension toggle for height and width of shapes
- [ ] Sticky should have a height and width option
- [x] Cursor should have coordinates
- [x] Make undo and redo button work
- [ ] Make it more clear that free form text is being selected 
- [ ] - Fix ordering of tool shorcut numbers, have number next to tool label
- [x] Fix sticky text editing
- [x] Make presets more pastel colors
- [ ] Keep properties tabs minimal to what's being done only, ie only show shape properties when selecting shapes
- [ ] Properties fill and stroke input boxes should not  cut off
- [ ] Sticky note h and v align are not working
- [ ] Redudant text color option for sticky note
- [ ] Lines should adjust for sticky notes with increase text size
- [ ] Free form text shows double when adding text
- [ ] Free form text has double box when selected
- [ ] Text disappears when rotated
- [ ] Separate rectangle and circle item on item list. Not put them in shape category
- [ ] Line dash type and shape outline need to be fixed so that it actually changes to dashed
- [ ] Properties tab should be closed via the side, not the top
- [ ] Make black one of the preset colors in the front(Use a white font for the text inside it)



Biorender edits
- [x] Keep properties out, unless minimized or item is selected
- [ ] Keep text box within sticky when typing
- [x] Keep Chat under the tool bar
- [] Change top AI button with Chat icon and word chat
- [x] Don't make text box stick out when editing text. Make it stay on the item that contains the text in line.
- [x] Fix shape tool drop down to make it show options
- Keep previous properties window open when clicking out of selecting an item.
- [x] Remove recent colors from top part of properties tab
- [x] Fix text tool to have free form text
- - When changing properties in sticky text, it should apply those changes
- - 
- [x] Include more colors in recent 


- 

### Real-Time Collaboration

- [ ] Multiplayer cursors with names and real-time movement
  - [ ] Make it smoother with interpolation
- [ ] Object creation/modification appears instantly for all users
- [x] Clear presence indicator (who's currently on the board)
- [ ] Conflict handling for simultaneous edits (document your approach)
- [ ] Graceful disconnect/reconnect handling
  - [ ] Zoom out when coming back in to all items?
- [ ] Board state persists after all users leave and return

### Performance Targets

- [ ] 60 FPS during pan, zoom, and object manipulation
- [ ] Object sync latency < 100ms
- [ ] Cursor sync latency < 50ms
- [ ] 500+ objects without performance drops
- [ ] 5+ concurrent users without degradation

---

## AI Board Agent

### Minimum 6 Commands Required

**Creation**
- [ ] Add a sticky note with specified text and color
- [ ] Create a shape at a specified position
- [ ] Add a labeled frame
  - [ ] Make a operational ai agent that just does the thing without saying anything

**Manipulation**
- [ ] Move objects (by type, color, or selection)
- [ ] Resize an object or frame
- [ ] Change an object's color

**Layout**
- [ ] Arrange objects in a grid
- [ ] Space elements evenly

**Complex / Multi-step**
- [ ] Generate a SWOT analysis template (4 labeled quadrants)
- [ ] Build a user journey map
- [ ] Set up a retrospective board with columns

### Minimum Tool Schema

- [ ] `createStickyNote(text, x, y, color)`
- [ ] `createShape(type, x, y, width, height, color)`
- [ ] `createFrame(title, x, y, width, height)`
- [ ] `createConnector(fromId, toId, style)`
- [ ] `moveObject(objectId, x, y)`
- [ ] `resizeObject(objectId, width, height)`
- [ ] `updateText(objectId, newText)`
- [ ] `changeColor(objectId, color)`
- [ ] `getBoardState()` — returns current board objects for AI context

### Shared AI State

- [ ] All users see AI-generated results in real-time
- [ ] Multiple users can issue AI commands simultaneously without conflict

### AI Performance Targets

- [ ] Response latency < 2 seconds for single-step commands
- [ ] 6+ distinct command types supported
- [ ] Multi-step operation execution works correctly
- [ ] Consistent, accurate command execution

---

## AI-First Development Requirements

### Tools *(Use at least 2)*

- [ ] Claude Code
- [ ] Cursor
- [ ] Codex
- [ ] MCP integrations

### AI Development Log *(1 page, required)*

- [ ] Tools & workflow — which AI coding tools used and how
- [ ] MCP usage — which MCPs used and what they enabled
- [ ] 3–5 effective prompts (include the actual prompt text)
- [ ] Rough % of AI-generated vs. hand-written code
- [ ] Strengths & limitations of AI assistance
- [ ] Key learnings from working with coding agents

### AI Cost Analysis *(Required)*

**Development & Testing**
- [ ] LLM API costs tracked (OpenAI, Anthropic, etc.)
- [ ] Total tokens consumed (input/output breakdown)
- [ ] Number of API calls made
- [ ] Any other AI-related costs (embeddings, hosting, etc.)

**Production Cost Projections**
- [ ] Estimated monthly cost at 100 users
- [ ] Estimated monthly cost at 1,000 users
- [ ] Estimated monthly cost at 10,000 users
- [ ] Estimated monthly cost at 100,000 users
- [ ] Assumptions documented (commands/session, sessions/month, tokens/command)

---

## Submission Requirements *(Due Sunday 10:59 PM CT)*

- [ ] **GitHub Repository** — setup guide, architecture overview, deployed link
- [ ] **Demo Video** (3–5 min) — real-time collaboration, AI commands, architecture walkthrough
- [ ] **Pre-Search Document** — completed Phase 1–3 checklist
- [ ] **AI Development Log** — 1-page breakdown
- [ ] **AI Cost Analysis** — dev spend + projections for all 4 user scales
- [ ] **Deployed Application** — publicly accessible, supports 5+ users with auth
- [ ] **Social Post** — published on X or LinkedIn with description, features, demo/screenshots, tag @GauntletAI

---

## Pre-Search Checklist *(Complete Before Writing Any Code)*

### Phase 1 — Define Your Constraints

- [ ] Scale & load profile (launch users, 6-month projection, traffic pattern)
- [ ] Real-time requirements confirmed (WebSockets / live updates)
- [ ] Cold start tolerance determined
- [ ] Monthly budget ceiling set
- [ ] Pay-per-use vs. fixed cost decision made
- [ ] MVP timeline confirmed
- [ ] Speed-to-market vs. maintainability priority documented
- [ ] Compliance needs assessed (HIPAA, GDPR, SOC 2, data residency)
- [ ] Team size and skill constraints documented
- [ ] Learning appetite vs. shipping speed preference noted

### Phase 2 — Architecture Discovery

- [ ] Hosting model decided (serverless / containers / edge / VPS)
- [ ] CI/CD requirements documented
- [ ] Auth approach chosen (social login, magic links, email/password, SSO)
- [ ] RBAC and multi-tenancy needs assessed
- [ ] Database type selected (relational, document, key-value, graph)
- [ ] Real-time sync, search, vector, and caching needs mapped
- [ ] Read/write ratio estimated
- [ ] Backend architecture decided (monolith vs. microservices)
- [ ] API pattern chosen (REST / GraphQL / tRPC / gRPC)
- [ ] Background job and queue requirements noted
- [ ] Frontend framework and rendering strategy decided
- [ ] SEO, offline/PWA, and SPA vs. SSR needs assessed
- [ ] Third-party integrations identified (payments, email, analytics, AI APIs)
- [ ] Pricing cliffs, rate limits, and vendor lock-in risks reviewed

### Phase 3 — Post-Stack Refinement

- [ ] Known security vulnerabilities and misconfigurations reviewed
- [ ] Dependency risks assessed
- [ ] Standard folder structure documented
- [ ] Monorepo vs. polyrepo decision made
- [ ] Naming conventions and linter/formatter configs set
- [ ] Testing strategy defined (unit, integration, e2e tools + coverage target)
- [ ] Mocking patterns documented
- [ ] Recommended tooling selected (VS Code extensions, CLI tools, debugging setup)