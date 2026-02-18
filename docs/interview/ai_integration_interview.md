# AI Integration Interview — Questions & Answers

**Date:** 2026-02-18
**Context:** Interview to define the AI integration feature for CrucibleCanvas. The feature adds a group chat interface with AI agent capabilities to the collaborative whiteboard.

---

## Round 1: Chat Architecture & Message Lifecycle

### Q1: Message Persistence Model
**Question:** The existing spec says AI chat history is a 'rolling window of last 5 pairs, lost on page refresh.' But adding group chat fundamentally changes the persistence model. Should group messages (human-to-human) persist in Firestore so users who join later can see conversation history, while AI command/response pairs remain ephemeral? Or should everything be ephemeral and vanish on refresh?

**Options:**
- Group persists, AI ephemeral
- **Everything persists** ✅
- Everything ephemeral
- Everything persists, capped

**Answer:** Everything persists. Both group chat and AI interactions saved to Firestore. Full history available to anyone who opens the board.

---

### Q2: AI Response Visibility
**Question:** When the AI executes a board command (e.g., creates a SWOT analysis), should the AI's response message appear in the GROUP chat stream visible to all users, or only in a private AI response visible to the requester? This affects whether everyone passively learns what AI commands others are running.

**Options:**
- **AI responses in group** ✅
- AI responses private
- Hybrid: actions in group, details private

**Answer:** AI responses in group. When User A asks the AI to 'create SWOT analysis,' the request AND the AI's response/confirmation appear in the shared group chat. Everyone sees what the AI did and why.

---

### Q3: Concurrent AI Command Conflicts
**Question:** When two users simultaneously issue AI commands that conflict (e.g., User A says 'move all pink stickies left' while User B says 'move all pink stickies right'), how should the system handle this? The rubric requires 'multiple users can issue AI commands simultaneously without conflict.'

**Options:**
- **Independent snapshots, both execute** ✅
- Queue with board-level lock
- Object-level locking during AI

**Answer:** Independent snapshots, both execute. Each AI command gets its own board state snapshot at request time. Both commands execute independently. Last-write-wins on any object-level conflicts (consistent with existing sync strategy).

---

## Round 2: Chat UX & Toggle Mechanics

### Q4: Chat Layout — Unified vs Separate
**Question:** You said toggle between 'message group' and 'message AI.' Should this be a single unified chat timeline where AI messages are visually distinct (e.g., different background color, AI avatar), or two completely separate tabs/views — one for group conversation, one for AI commands? A unified timeline means AI results flow naturally into group discussion. Separate views keep AI commands from cluttering casual chat.

**Options:**
- **Unified timeline** ✅
- Two separate tabs
- Unified with AI filter

**Answer:** Unified timeline. One scrollable chat stream. Group messages and AI interactions interleaved chronologically. AI messages have distinct styling (avatar, background). Toggle controls who you're SENDING to, not what you SEE.

---

### Q5: AI Input UX
**Question:** When the toggle is set to 'Message AI,' should the input field change behavior? For example: should it show autocomplete suggestions for known commands (SWOT, retrospective, grid layout), show a '/' command palette, or stay as plain freeform text input that the AI interprets naturally?

**Options:**
- **Freeform only** ✅
- Slash command palette
- Freeform + smart suggestions

**Answer:** Freeform only. Plain text input. Users type natural language. No autocomplete, no command palette. The AI interprets everything. Simplest to build, most flexible.

---

### Q6: Rich Message Features
**Question:** For the group chat portion — should messages support any rich features beyond plain text? Think about what's actually useful for a collaborative whiteboard context.

**Options:**
- Plain text only
- **Text + object references** ✅
- Text + reactions + object refs

**Answer:** Text + object references. Plain text plus the ability to @-reference a board object (e.g., '@sticky-note-abc'). Clicking the reference pans the canvas to that object. Useful for 'look at this' conversations.

---

## Round 3: Data Model & Real-Time Delivery

### Q7: Chat Storage Layer
**Question:** Since everything persists and it's a unified timeline, chat messages need real-time delivery. You already use Firestore for persistent data and RTDB for ephemeral real-time data. For chat, which storage layer should drive the real-time experience? Firestore onSnapshot has ~200-500ms latency for new docs. RTDB onChildAdded is ~50-100ms. But persisting in RTDB means no query support (pagination, search).

**Options:**
- Firestore only
- Dual-write (RTDB + Firestore)
- **Firestore with optimistic UI** ✅

**Answer:** Firestore with optimistic UI. Write to Firestore but immediately render the message locally before server confirmation (optimistic update). Feels instant to the sender. Listeners pick up the message for other users at normal Firestore speed.

---

### Q8: AI Response Streaming
**Question:** When the AI is executing a multi-step command (e.g., building a SWOT analysis with 4 frames and 8 sticky notes), the spec mentions progressive skeleton loading. In the chat, should the AI's response stream in token-by-token (like ChatGPT), appear as one complete message when done, or show a progress indicator with object count?

**Options:**
- **Stream token-by-token** ✅
- Complete message on finish
- Progress updates

**Answer:** Stream token-by-token. AI response text streams into the chat bubble in real-time as Claude generates it. Tool calls execute as they arrive. Users see the AI 'thinking out loud.' Requires SSE/streaming from the API route.

---

### Q9: Dead Object References
**Question:** Object references in chat (@sticky-note) need to survive object deletion and renaming. If someone references a sticky note in chat, then that note gets deleted, what should the reference look like?

**Options:**
- **Strikethrough with tooltip** ✅
- Silent degradation
- Ghost reference

**Answer:** Strikethrough with tooltip. The reference renders with strikethrough text and a tooltip saying 'This object was deleted.' Still shows the original text/name. Non-clickable.

---

## Round 4: AI Agent Technical Design

### Q10: AI Context Scope (Multi-User Viewports)
**Question:** The AI needs getBoardState() to understand what's on the canvas before executing commands. The spec says viewport-only context. But in a group chat scenario, different users have different viewports. When User A asks the AI to 'arrange these sticky notes in a grid,' whose viewport determines which objects the AI sees? User A might see 10 sticky notes, User B might see 3.

**Options:**
- Requester's viewport
- Full board state
- **Requester's viewport + selected** ✅

**Answer:** Requester's viewport + selected. Send the requester's viewport objects plus any objects they have explicitly selected (even if partially off-screen). Best of both: context-aware but respects user intent via selection.

---

### Q11: Tool Call Execution Strategy
**Question:** For streaming tool calls — Claude will generate tool calls (createStickyNote, createFrame, etc.) as part of its response. Each tool call needs to write to Firestore. Should the API route execute tool calls one at a time as they stream in, or batch them and execute all at once when the full response is complete? One-at-a-time gives progressive rendering (objects appear one by one) but makes rollback harder if a later step fails.

**Options:**
- Execute as they stream
- Batch after completion
- **Execute as they stream, soft-commit** ✅

**Answer:** Execute as they stream, soft-commit. Execute tool calls as they arrive but mark objects as 'pending' (isAIPending: true, rendered with lower opacity). On full completion, flip them all to confirmed. On failure, delete all pending objects. Progressive rendering with visual distinction.

---

### Q12: AI Resize Validation
**Question:** The rubric requires 'resizeObject(objectId, width, height)' as a tool. But currently your resize logic uses Konva Transformer handles on the client side with complex aspect ratio and min/max constraints. When the AI resizes an object, should it just set raw width/height values (trusting the AI to respect constraints), or should the API route apply the same min/max clamping logic that the client-side Transformer uses?

**Options:**
- **Server-side clamping** ✅
- Trust the AI
- Client-side validation

**Answer:** Server-side clamping. The API route applies the same min/max constraints (e.g., sticky notes: 80-600px, shapes: 20-800px) before writing to Firestore. AI can request any size but it gets clamped. Prevents invalid states.

---

## Round 5: Multi-User AI & Chat Message Schema

### Q13: Parallel AI Stream Rendering
**Question:** Since AI responses stream token-by-token into the group chat and multiple users can issue AI commands simultaneously, you could have 2-3 AI responses streaming at once. How should interleaved AI streams render in the unified timeline? If User A's SWOT analysis is streaming and User B fires a 'create grid' command, do you see two separate AI bubbles streaming simultaneously?

**Options:**
- Separate bubbles, interleaved
- **Separate bubbles, stacked at bottom** ✅
- Collapse parallel into one

**Answer:** Separate bubbles, stacked at bottom. Each AI command gets its own bubble. New messages (including new AI streams) always append at the bottom. Older streams continue updating in-place above. Chat auto-scrolls for latest.

---

### Q14: AI Message-to-Object Linkage
**Question:** For the chat message data model, each message needs to store: sender, content, timestamp, type (human/ai), and potentially the objects it created. For AI messages specifically, should we store the list of created object IDs on the message document? This enables 'click to jump to objects' from any historical AI message, but means the message document grows and needs updating as the AI streams.

**Options:**
- Store object IDs on message
- **Use aiCommandId linkage** ✅
- Both

**Answer:** Use aiCommandId linkage. Don't store IDs on the message. Instead, the message stores its aiCommandId, and you query objects by that ID when the user clicks 'Jump.' No message updates needed during streaming, but requires a query.

---

### Q15: Group/AI Toggle Mechanism
**Question:** The toggle between 'Message Group' and 'Message AI' — should there be a keyboard shortcut or modifier key to quickly switch? In a fast-paced collaborative session, reaching for a toggle button might slow things down.

**Options:**
- Tab key toggles
- **@ prefix for AI** ✅
- Toggle button only

**Answer:** @ prefix for AI. No toggle at all. Messages go to group by default. Prefix with '@ai' to send to AI. Similar to Slack's @-mention pattern. One input mode, context from content.

---

## Round 6: AI Tool Implementation & Complex Commands

### Q16: Template vs Primitive Tools
**Question:** The rubric requires complex commands like 'Create a SWOT analysis template with four quadrants.' This means the AI needs to create ~13+ objects in a specific spatial layout. Should the AI calculate all coordinates itself via tool calls, or should you provide a higher-level 'createTemplate' tool that handles layout math server-side?

**Options:**
- AI calculates everything
- High-level template tools
- **Hybrid: primitives + arrangeInLayout** ✅

**Answer:** Hybrid: primitives + arrangeInLayout. AI uses primitives to create objects, then calls an arrangeInLayout(objectIds, layout, spacing) tool that repositions them into clean arrangements. AI creates content, server handles geometry.

---

### Q17: Selection Binding for AI Commands
**Question:** For the 'arrange these sticky notes in a grid' type command, the AI needs to know which objects to arrange. Should the user be able to select objects on canvas and then say '@ai arrange these in a grid' where 'these' automatically resolves to the selected object IDs? Or should the AI infer which objects to arrange from context?

**Options:**
- Selection = implicit context
- AI infers from text
- **Both: selection preferred, inference fallback** ✅

**Answer:** Both: selection preferred, inference fallback. If objects are selected, use those. If nothing is selected, AI infers from the text and board state. Explicit when you want precision, natural language when you're being casual.

---

### Q18: AI Connector Creation
**Question:** The rubric lists 'createConnector(fromId, toId, style)' but in your existing codebase, connectors use edge-to-edge anchor points calculated client-side. When the AI creates a connector, does it need to specify anchor positions?

**Options:**
- **IDs only, client computes anchors** ✅
- AI specifies anchor side

**Answer:** IDs only, client computes anchors. AI just specifies fromId and toId. The ConnectorObject component calculates the nearest-edge anchor points dynamically. Same as current behavior. AI doesn't need to understand geometry.

---

## Round 7: Streaming Architecture & Rate Limiting

### Q19: AI Stream Relay to Non-Requesting Users
**Question:** For streaming AI responses to the group chat: the API route streams from Claude via SSE, but only the requesting user's browser has the SSE connection. Other users need to see the streaming text too. How should non-requesting users receive the streaming AI response?

**Options:**
- Requester streams, others get final
- **RTDB relay for live stream** ✅
- Firestore stream doc

**Answer:** RTDB relay for live stream. Requester's client pushes stream chunks to RTDB (boards/{boardId}/aiStreams/{commandId}). All clients listen. Final message written to Firestore. Dual-write but real-time streaming for everyone.

---

### Q20: Rate Limiting in Group Chat Context
**Question:** Rate limiting: the spec says 20 commands/user/hour and 50 commands/board/day. With group chat, should a group message count against any limit? And should AI commands from anonymous/guest users be further restricted?

**Options:**
- AI commands only, same limits
- **AI commands only, guests reduced** ✅
- Everything counts, different rates

**Answer:** AI commands only, guests reduced. Only @ai messages count against rate limits. Group chat messages are unlimited. Anonymous/guest users get reduced AI limits (5/hr instead of 20/hr) to prevent abuse on public boards.

---

### Q21: Pending Object Visibility
**Question:** When the AI creates objects with the soft-commit pattern (isAIPending: true, lower opacity), other users will see these pending objects via Firestore sync. Should pending AI objects be visually distinct for ALL users, or only for the requester?

**Options:**
- **Pending for everyone** ✅
- Pending for requester only
- Pending for everyone with attribution

**Answer:** Pending for everyone. All users see AI-pending objects at lower opacity with a loading shimmer. Everyone knows the AI is actively modifying the board. Objects solidify when the command completes.

---

## Round 8: Sidebar Layout, Chat Behavior & Edge Cases

### Q22: Sidebar Behavior (Push vs Overlay)
**Question:** The existing spec says the AI sidebar pushes the canvas when opened. With the new group chat, users will keep the sidebar open more often. Should it still push the canvas, or overlay?

**Options:**
- **Still push canvas** ✅
- Overlay with transparency
- Resizable sidebar
- Detachable panel

**Answer:** Still push canvas. Keep the current spec behavior. Canvas resizes when sidebar opens. Users get less canvas space but nothing is hidden. Consistent with existing design.

---

### Q23: Object Reference Creation UX
**Question:** When a user sends a group message that references a board object (e.g., 'look at this @[Sticky: User Research]'), how should the reference be created?

**Options:**
- **Click object while typing** ✅
- Drag object to chat
- Type # to search objects

**Answer:** Click object while typing. While the chat input is focused, clicking an object on the canvas inserts a reference to it in the message. The input field shows a chip/tag with the object's text/type.

---

### Q24: Offline AI Commands
**Question:** If a user is offline and sends an @ai command, the API route is unreachable. Should the system prevent @ai commands while offline, or queue them?

**Options:**
- **Block with message** ✅
- Queue and execute on reconnect
- Block silently

**Answer:** Block with message. If offline, disable the @ai prefix and show a tooltip: 'AI commands require a connection.' Group messages still queue normally. Clear and honest.

---

## Round 9: AI Persona, Error Handling & Undo

### Q25: AI Persona Scope
**Question:** The spec has AI personas (Neutral, Skeptical Investor, Opposing Counsel). With group chat, should the persona be a board-level setting or per-user?

**Options:**
- Board-level (shared)
- **Per-user preference** ✅
- Per-command override

**Answer:** Per-user preference. Each user can set their own persona. User A talks to 'Skeptical Investor,' User B talks to 'Opposing Counsel' on the same board. More flexible.

---

### Q26: Multi-User AI Undo
**Question:** AI undo in the spec is single-level. In a group chat where multiple users issue AI commands, whose 'most recent' command does Ctrl+Z undo?

**Options:**
- Undo YOUR last AI command
- **Undo button per AI message** ✅
- Both

**Answer:** Undo button per AI message. Each AI response message in the chat has an inline 'Undo' button. Any user can click it to undo that specific AI command. Explicit, no ambiguity about what's being undone.

---

### Q27: AI Error Display in Chat
**Question:** When the AI fails mid-stream, what should the error message look like in the group chat?

**Options:**
- Error replaces AI message
- **Error appended to partial** ✅
- Error as separate message

**Answer:** Error appended to partial. The partial AI message stays visible (showing what the AI was saying before failure), with an error banner appended: 'Command failed mid-execution. All changes rolled back.' Preserves context.

---

## Round 10: API Route Design, Security & Cost

### Q28: API Architecture
**Question:** For the API route architecture: you need endpoints for AI commands and chat messages. How should this be structured?

**Options:**
- Single unified endpoint
- Separate endpoints
- **Client-side write + AI endpoint** ✅

**Answer:** Client-side write + AI endpoint. Group messages are written directly from client to Firestore (no API route needed, Firestore rules handle auth). Only AI commands go through /api/ai-command Edge Function. Reduces server hops for chat.

---

### Q29: AI SDK Choice
**Question:** For the AI endpoint, should you use the Vercel AI SDK's built-in tool calling or make direct Anthropic SDK calls?

**Options:**
- **Vercel AI SDK (streamText + useChat)** ✅
- Direct Anthropic SDK
- Vercel AI SDK for streaming, custom tool executor

**Answer:** Vercel AI SDK (streamText + useChat). Use @ai-sdk/anthropic provider with streamText(). Frontend uses useChat() hook for streaming state management. Built-in tool call handling.

---

### Q30: Chat Message Cleanup Strategy
**Question:** With everything persisting in Firestore, the chat subcollection will grow continuously. Should there be any auto-cleanup or archival strategy?

**Options:**
- Grow indefinitely
- Auto-prune after 30 days
- **Cap at N messages per board** ✅

**Answer:** Cap at 500 messages per board. When the cap is hit, oldest messages are deleted on the next write. Hard limit on storage per board. Predictable cost.

---

## Round 11: UI Details, Notifications & Edge Cases

### Q31: Notification When Sidebar is Closed
**Question:** When the sidebar is closed and a new group chat message arrives, how should the user be notified?

**Options:**
- Badge count on sidebar toggle
- Badge + toast for @mentions
- **Badge + brief preview** ✅

**Answer:** Badge + brief preview. Badge count on toggle, plus a small floating preview of the latest message that fades in near the sidebar edge and auto-dismisses after 3 seconds. Users can glance without opening the sidebar.

---

### Q32: @ai Misfire Handling
**Question:** What happens if a user accidentally starts a group message with '@ai' but intended it for humans? E.g., '@ai is broken today, anyone else seeing this?'

**Options:**
- **Accept the edge case** ✅
- Require '@ai ' with space
- Confirmation for ambiguous

**Answer:** Accept the edge case. If it starts with '@ai', it goes to the AI. Users learn quickly. The AI will likely respond with something harmless anyway. Simplest implementation.

---

### Q33: Message Cap Details
**Question:** The cap at N messages per board: what should N be, and should the cap apply equally to group messages and AI messages?

**Options:**
- **500 messages, equal** ✅
- 500 messages, AI weighted
- 1000 messages, equal

**Answer:** 500 messages, equal. 500 total messages regardless of type. Simple. At typical usage (20 messages/session, 2 sessions/week) this is ~6 months of history.

---

## Round 12: Final Details — Rubric Compliance & Testing

### Q34: getBoardState() as Callable Tool
**Question:** The rubric specifically requires getBoardState() as a tool. The board state is already sent as context with each AI command. Should getBoardState() still exist as a callable tool?

**Options:**
- Initial context only
- **Keep as callable tool** ✅
- Initial + lightweight refresh

**Answer:** Keep as callable tool. Include getBoardState() as a tool the AI can call mid-response. Useful if the AI wants to verify what it just created. Satisfies rubric literally.

---

### Q35: Grid Layout Algorithm
**Question:** For the arrangeInLayout tool, what grid algorithm should the server use? Objects might have different widths/heights.

**Options:**
- **Uniform cell size** ✅
- Auto-fit rows
- Fixed spacing, variable cells

**Answer:** Uniform cell size. Grid cells are sized to the largest object. All objects centered within their cell. Consistent spacing regardless of object sizes. Simple, clean.

---

### Q36: Latency Measurement
**Question:** The rubric evaluates 'Response latency <2 seconds.' Should this be measured as time-to-first-token in chat, or time-to-object-on-canvas?

**Options:**
- **Time to first token in chat** ✅
- Time to first object on canvas
- Time to chat acknowledgment

**Answer:** Time to first token in chat. Measure from when user sends @ai command to when the first streaming token appears in the chat bubble. This is what the user 'feels' as responsiveness.

---

### Q37: Template Labels
**Question:** When the AI creates a SWOT template, should labels be hardcoded standard or context-aware?

**Options:**
- **Standard labels always** ✅
- Context-aware labels
- Standard with context subtitle

**Answer:** Standard labels always. SWOT always uses 'Strengths, Weaknesses, Opportunities, Threats.' Retrospective always uses 'What Went Well, What Didn't, Action Items.' Predictable, matches rubric expectations exactly.

---

### Q38: Chat Message Loading Strategy
**Question:** The chat sidebar needs to load message history when opened. Should messages load eagerly or lazily?

**Options:**
- Eager on board load
- Lazy on first sidebar open
- **Eager but limited** ✅

**Answer:** Eager but limited. Subscribe to last 20 messages eagerly on board load (for badge count/preview). Full history loads lazily when sidebar opens. Balanced: notifications work, full history is deferred.

---

### Q39: Chat Focus Keyboard Shortcut
**Question:** Should there be a global keyboard shortcut to focus the chat input?

**Options:**
- **/ to focus chat** ✅
- Ctrl+/ to focus chat
- No shortcut, click only

**Answer:** / to focus chat. Pressing '/' when not editing text focuses the chat input and opens the sidebar if closed. Familiar pattern from Slack/Discord. Replaces old slash commands (now handled via @ai natural language).
