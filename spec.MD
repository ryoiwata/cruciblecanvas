# CrucibleCanvas Technical Specification

## Project Overview

**Project Name:** CrucibleCanvas  
**Tagline:** Strategic Thinking Canvas - A collaborative whiteboard that challenges your ideas  
**Timeline:** 7-day sprint with 24-hour MVP gate  
**Primary Goal:** Build production-scale collaborative whiteboard with AI-powered critical analysis capabilities

---

## 1. Product Vision

### Core Value Proposition
CrucibleCanvas is not a passive whiteboard—it's an AI-powered strategic thinking partner. While users collaborate visually, the AI agent actively challenges assumptions, identifies logical gaps, and structures complex decisions. The board doesn't just store ideas; it argues back.

### Target Use Cases
1. **Strategic Planning:** Teams mapping product roadmaps, go-to-market strategies, or business pivots
2. **Decision Making:** Evaluating options with structured frameworks (options matrices, tradeoff analysis)
3. **Risk Assessment:** Red-teaming plans to surface unstated assumptions and contradictions
4. **Workshop Facilitation:** Real-time collaborative sessions with AI as a critical thinking facilitator

### Differentiation
- **Miro/Figma:** Passive collaboration tools that store content
- **ChatGPT Canvas:** Single-user AI workspace without multiplayer or visual relationships
- **CrucibleCanvas:** Multiplayer whiteboard where AI reads board state and generates interconnected critical analysis

---

## 2. Technical Architecture

### 2.1 Technology Stack

**Frontend**
- Framework: Next.js 14+ (App Router)
- UI Library: React 18
- Canvas: Konva.js with react-konva wrapper
- State: Zustand (lightweight global state)
- Styling: TailwindCSS
- Language: TypeScript

**Backend**
- Database (Persistent): Firebase Firestore
- Database (Ephemeral): Firebase Realtime Database
- Auth: Firebase Auth (Google + GitHub OAuth)
- Deployment: Vercel
- Functions: Vercel Edge Functions (API routes)

**AI Layer**
- LLM: Anthropic Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- SDK: Vercel AI SDK
- Pattern: Function calling with tool schema

**Development Tools**
- AI Assistants: Claude Code, Cursor
- Version Control: Git + GitHub
- Testing: Manual multi-browser testing (Chrome DevTools)

### 2.2 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         USER LAYER                          │
│  Multiple users across browsers/devices                     │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                    FRONTEND (Next.js)                        │
│  ├─ Canvas Renderer (Konva.js)                              │
│  ├─ State Management (Zustand)                              │
│  ├─ Auth Context (Firebase Auth)                            │
│  └─ Real-time Listeners (Firestore + RTDB)                  │
└──────────────────┬──────────────────────────────────────────┘
                   │
      ┌────────────┼────────────┐
      │            │            │
      ▼            ▼            ▼
┌─────────┐  ┌─────────┐  ┌──────────────┐
│Firestore│  │Realtime │  │ Vercel Edge  │
│ (Board  │  │   DB    │  │  Functions   │
│ Objects)│  │(Cursors)│  │  (AI Route)  │
└─────────┘  └─────────┘  └──────┬───────┘
                                  │
                                  ▼
                          ┌──────────────┐
                          │   Anthropic  │
                          │Claude Sonnet │
                          │     4.5      │
                          └──────────────┘
```

---

## 3. Data Models

### 3.1 Firestore Schema

**Collection: `boards/{boardId}/objects/{objectId}`**

```typescript
interface BoardObject {
  // Core identification
  id: string                    // Auto-generated Firestore doc ID
  type: ObjectType             // 'stickyNote' | 'rectangle' | 'circle' | 'frame' | 'connector'
  
  // Spatial properties
  x: number                    // X coordinate in canvas space
  y: number                    // Y coordinate in canvas space
  width: number                // Width in pixels
  height: number               // Height in pixels
  rotation?: number            // Rotation in degrees (optional)
  
  // Visual properties
  color: string                // Hex color or named color
  text?: string                // Text content (sticky notes, frames)
  
  // Ownership & timestamps
  createdBy: string            // User ID from Firebase Auth
  createdAt: Timestamp         // Server timestamp
  updatedAt: Timestamp         // Server timestamp
  zIndex: number               // Render order (higher = front)
  
  // Relationships
  parentFrame?: string         // ID of containing frame (if nested)
  connectedTo?: string[]       // IDs of related objects (for connectors)
  
  // AI-specific metadata
  role?: AnalyticalRole        // 'critique' | 'assumption' | 'gap_flag' | 'criterion' | 'option' | 'evaluation'
  metadata?: {
    analysisType?: 'red_team' | 'decision_map' | 'gap_analysis'
    critiqueTarget?: string    // ID of object being critiqued
    severity?: 'low' | 'medium' | 'high'
    decisionContext?: string   // Associated decision statement
    score?: number             // Evaluation score (1-10)
    persona?: 'skeptic' | 'investor' | 'counsel'
  }
}

type ObjectType = 'stickyNote' | 'rectangle' | 'circle' | 'frame' | 'connector'
type AnalyticalRole = 'critique' | 'assumption' | 'gap_flag' | 'criterion' | 'option' | 'evaluation'
```

**Collection: `boards/{boardId}/metadata`**

```typescript
interface BoardMetadata {
  title: string
  createdAt: Timestamp
  createdBy: string            // User ID
  
  // AI configuration
  aiPersona: 'neutral' | 'skeptical_investor' | 'opposing_counsel'
  
  // Analysis history
  analysisHistory: AnalysisRecord[]
  
  // Board context (lore awareness)
  boardContext?: {
    mainTopics: string[]       // AI-extracted themes
    openQuestions: string[]    // Unanswered questions identified
    keyDecisions: string[]     // Major choices on board
    lastAnalyzed: Timestamp
  }
}

interface AnalysisRecord {
  timestamp: number
  type: 'red_team' | 'decision_map' | 'gap_analysis'
  objectCount: number
  summary: string
}
```

### 3.2 Realtime Database Schema

**Path: `/boards/{boardId}/cursors/{userId}`**

```typescript
interface Cursor {
  x: number                    // Cursor X position in canvas space
  y: number                    // Cursor Y position in canvas space
  name: string                 // User display name
  color: string                // Unique color per user
  timestamp: number            // Last update timestamp (ms)
}
```

**Path: `/boards/{boardId}/presence/{userId}`**

```typescript
interface Presence {
  name: string
  email: string
  photoURL?: string
  color: string                // Consistent with cursor color
  online: boolean
  lastSeen: number             // Unix timestamp (ms)
}
```

---

## 4. Core Features

### 4.1 Infinite Canvas

**Requirements:**
- Pan: Drag with mouse or Space + drag
- Zoom: Mouse wheel (center on cursor position)
- Grid background: Infinite repeating grid lines
- Viewport culling: Only render objects in visible area

**Technical Implementation:**
- Konva Stage with `draggable` prop
- Zoom calculation maintains cursor position as zoom center
- Grid rendered on static layer (no event listeners)
- Viewport bounds calculated from Stage transform

**Performance Targets:**
- 60 FPS during pan/zoom
- Smooth interactions with 200+ objects
- No jitter or lag during transforms

### 4.2 Board Objects

#### Sticky Notes
- Dimensions: 200×150px (default)
- Editable text: Double-click to edit via HTML textarea overlay
- Colors: Yellow (#FEFF9C), Pink (#FF7EB9), Cyan (#7AFCFF), Mint (#98FF98), Plum (#DDA0DD), Coral (#FFAB91)
- Font: Sans-serif, 14px
- Padding: 10px

#### Shapes
- **Rectangle:** Solid fill, rounded corners (4px)
- **Circle:** Solid fill, perfect circle
- Default dimensions: 100×100px
- Resizable with Transformer handles when selected

#### Frames
- Visual container for grouping objects
- Title bar: 40px height, bold text
- Semi-transparent background: 10% opacity
- Border: 2px solid
- Objects can be nested inside frames (parentFrame relationship)

#### Connectors
- Start/end object IDs stored in `connectedTo` array
- Styles: solid, dashed, dotted
- Colors: Used for semantic meaning (red = critique, blue = dependency)
- Label: Optional text at midpoint

### 4.3 Real-Time Collaboration

#### Multiplayer Cursors
- **Update Rate:** 30 Hz (33ms throttle)
- **Display:** Circle (12px radius) + name label below
- **Color:** Generated from user ID hash (consistent per user)
- **Optimization:** Only send updates if cursor moved >5px
- **Cleanup:** Automatic removal via onDisconnect() when user leaves

#### Object Synchronization
- **Pattern:** Optimistic updates + Firestore listeners
- **Flow:**
  1. User action → Immediate Zustand update (optimistic)
  2. Write to Firestore asynchronously
  3. Firestore listener triggers → Update Zustand (reconcile)
  4. React re-renders Konva canvas

- **Conflict Resolution:** Last-write-wins (Firestore server timestamp)
- **Latency Target:** <100ms from action to remote render

#### Presence System
- **Online Indicator:** User avatars in top-right corner
- **Detection:** onValue listener on `/presence/{userId}`
- **Offline Threshold:** 30 seconds of inactivity
- **Cleanup:** onDisconnect() removes presence record

### 4.4 Selection & Manipulation

**Selection:**
- Single-click: Select object (show Transformer handles)
- Shift + click: Multi-select (not MVP, optional)
- Drag rectangle: Multi-select (not MVP, optional)

**Operations:**
- **Move:** Click + drag
- **Resize:** Transformer handles when selected
- **Delete:** Select + Delete key or toolbar button
- **Duplicate:** Select + Cmd/Ctrl + D (optional)
- **Copy/Paste:** Select + Cmd/Ctrl + C/V (optional)

**Visual Feedback:**
- Selection border: 2px solid blue (#2196F3)
- Transformer handles: 8 resize anchors + rotation handle
- Hover state: Cursor changes to pointer

---

## 5. AI Agent Capabilities

### 5.1 Operating Modes

#### Execution Mode (Base MVP)
**Purpose:** Direct board manipulation via natural language  
**Input:** User command text  
**Output:** Firestore writes (create/move/delete objects)

**Example Commands:**
- "Create a yellow sticky note that says 'User Research'"
- "Move all pink sticky notes to the right"
- "Delete the rectangle in the top-left corner"
- "Change the sticky note color to green"

#### Analysis Mode (Red Team / Find Gaps)
**Purpose:** Critical analysis of board content  
**Input:** Board state snapshot + analytical directive  
**Output:** Critique frame with flagged notes + connectors

**Capabilities:**
1. **Red Team This:** Identify assumptions, contradictions, missing data, edge cases
2. **Find the Gaps:** Scan for unexplored topics, unanswered questions, missing dependencies

**Output Structure:**
- New frame titled "Red Team Analysis" or "Gap Analysis"
- Critique sticky notes (pink for high severity, coral for medium/low)
- Dashed connectors linking critique → original object
- Severity emojis: 🔴 Critical, 🟡 Important, 🟢 Minor

#### Synthesis Mode (Decision Mapping)
**Purpose:** Generate structured decision frameworks  
**Input:** Decision statement + framework type  
**Output:** Organized layout with criteria, options, evaluations

**Framework Types:**
1. **Options Matrix:** Rows = options, Columns = criteria, Cells = scores
2. **Tradeoff Analysis:** Two columns (Gains vs Losses)
3. **Pros/Cons Grid:** Classic argument structure

**Output Structure:**
- Main decision frame (cyan background)
- Criterion headers (green sticky notes, top row)
- Option labels (yellow sticky notes, left column)
- Evaluation cells (color-coded by score: red <4, yellow 4-7, green >7)

### 5.2 AI Tool Schema

**Base Manipulation Tools:**
```typescript
createStickyNote(text: string, x: number, y: number, color: string)
createShape(type: 'rectangle' | 'circle', x: number, y: number, width: number, height: number, color: string)
createFrame(title: string, x: number, y: number, width: number, height: number)
createConnector(startObjectId: string, endObjectId: string, style: 'solid' | 'dashed' | 'dotted', color: string, label?: string)
moveObject(objectId: string, x: number, y: number)
updateText(objectId: string, text: string)
changeColor(objectId: string, color: string)
deleteObject(objectId: string)
arrangeObjects(objectIds: string[], layout: 'grid' | 'horizontal' | 'vertical', spacing: number)
```

**Analytical Tools:**
```typescript
redTeamThis(
  targetObjectIds: string[],
  focusAreas: ('assumptions' | 'contradictions' | 'missing_data' | 'edge_cases')[],
  persona: 'skeptic' | 'investor' | 'counsel'
)

mapDecision(
  decisionStatement: string,
  frameworkType: 'options_matrix' | 'tradeoff_analysis' | 'pros_cons',
  options?: string[],
  criteria?: string[]
)

findGaps(
  scope: 'entire_board' | 'selected_frame' | 'selected_objects',
  targetIds?: string[],
  gapTypes: ('unexplored_topics' | 'unanswered_questions' | 'missing_dependencies')[]
)
```

**Context Tools:**
```typescript
getBoardState() → { objects: BoardObject[], frames: Frame[], objectCount: number }
getObjectsByFrame(frameId: string) → BoardObject[]
analyzeBoardSemantics() → { topics: string[], openQuestions: string[], themes: string[] }
```

### 5.3 System Prompts

**Base Context (Always Included):**
```
You are an AI assistant for CrucibleCanvas, a strategic thinking whiteboard.

Current board state:
- Total objects: ${objectCount}
- Frames: ${frameCount}
- Key topics: ${topics.join(', ')}
- Recent analyses: ${analysisHistory.map(a => a.type).join(', ')}

Your capabilities:
1. Create and manipulate visual objects (sticky notes, shapes, frames, connectors)
2. Analyze board content for logical consistency and gaps
3. Generate structured decision frameworks
4. Provide critical counter-arguments and identify assumptions
```

**Execution Mode:**
```
MODE: Direct Board Manipulation

Execute user commands literally and efficiently.
- Place new objects in visible viewport area
- Use color semantics: yellow=ideas, pink=critiques, green=approved, cyan=frameworks
- Create connectors to show relationships
- Keep sticky note text concise (2-3 sentences max)
```

**Analysis Mode:**
```
MODE: Critical Analysis (Red Team / Gap Finding)

Your role: Challenge the user's thinking systematically.

Critical thinking framework:
1. ASSUMPTIONS: What's taken for granted without evidence?
2. CONTRADICTIONS: Where do statements conflict?
3. MISSING DATA: What evidence is absent but necessary?
4. EDGE CASES: What scenarios break this logic?

Output structure:
- Create "Red Team Analysis" frame (pink background)
- Each critique = separate sticky note with severity indicator
- Link critiques to original claims via dashed red connectors
- Be specific and actionable (not generic doubts)

Severity levels:
🔴 Critical flaw (invalidates core assumption)
🟡 Important gap (weakens argument)
🟢 Minor consideration (for completeness)
```

**Synthesis Mode:**
```
MODE: Decision Framework Generation

Your role: Structure complex decisions visually.

Framework types available:
1. OPTIONS MATRIX: Grid layout (rows=options, cols=criteria, cells=scored evaluations)
2. TRADEOFF ANALYSIS: Two-column layout (Gains vs Losses)
3. PROS/CONS GRID: Classic structured argument map

Layout principles:
- Use frames to group related elements
- Color code consistently: green=positive, pink=negative, yellow=neutral, cyan=criteria
- Create visual hierarchy (headers larger than cells)
- Limit frameworks to 4-8 core elements for clarity
- Include rationale with every evaluation score
```

**Persona Variations:**
```typescript
const personas = {
  skeptical_investor: `
  You are a venture capitalist who has reviewed 1,000+ pitches.
  Focus: market validation, unit economics, competitive moats, scaling risks, burn rate.
  Tone: Direct, numbers-focused, skeptical of hand-waving and unvalidated assumptions.
  `,
  
  opposing_counsel: `
  You are a lawyer representing the opposing side in litigation.
  Focus: legal exposure, contractual gaps, liability, regulatory compliance, precedent.
  Tone: Adversarial but professional, evidence-focused, precedent-driven.
  `,
  
  neutral_critic: `
  You are a strategic advisor with no agenda or bias.
  Focus: logical consistency, evidence quality, alternative perspectives, blind spots.
  Tone: Balanced, constructive, intellectually honest, Socratic.
  `
}
```

### 5.4 AI Cost Projections

**Development Phase:**
- Estimated API calls: 200-400 commands during testing
- Token consumption: ~10K-20K tokens per command (varies by board size)
- Projected cost: $10-20

**Production Estimates:**

| User Scale | Commands/User/Month | Monthly Cost | Assumptions |
|------------|---------------------|--------------|-------------|
| 100 users  | 5                   | $2.50        | 500 commands × $0.005 avg |
| 1,000 users| 5                   | $25          | 5K commands × $0.005 avg |
| 10,000 users| 5                  | $250         | 50K commands × $0.005 avg (need context pruning) |
| 100,000 users| 5                 | $2,500       | 500K commands × $0.005 avg (need caching layer) |

**Cost Optimization Strategies:**
1. **Context Pruning:** Only include objects relevant to command (e.g., only pink notes for "move pink notes")
2. **Summarized State:** Send object count + bounding box instead of full object details for large boards
3. **Caching:** Cache analysis results for repeated queries on unchanged board state
4. **Batch Operations:** Single tool call for "create 10 sticky notes" instead of 10 separate calls

---

## 6. Voice-to-Visual Feature (Optional)

### 6.1 Architecture

**Browser Speech API Integration:**
- Use `SpeechRecognition` API (Chrome/Edge only)
- No backend changes required
- Voice → text → existing AI pipeline

**Implementation Flow:**
1. User clicks mic button in toolbar
2. `SpeechRecognition` starts listening
3. On utterance end, transcribed text sent to `/api/ai-command`
4. Claude processes as normal text command
5. Tool calls execute → Firestore writes → real-time sync

### 6.2 UI Components

**Mic Button:**
- Icon: 🎤 (microphone)
- States: inactive (gray), listening (red pulse animation), processing (blue)
- Position: Toolbar (next to AI chat button)

**Transcription Display:**
- Live text display above canvas
- Shows: "You said: [transcribed text]"
- Fades out after 3 seconds

**Error Handling:**
- No microphone access: Hide mic button
- Unsupported browser: Show tooltip "Voice input requires Chrome/Edge"
- Recognition error: Show "Couldn't hear you. Try again?"

### 6.3 Implementation Estimate

**Total Time:** 3-4 hours

- Hour 1: Mic button UI + SpeechRecognition setup
- Hour 2: Utterance handling + transcription display
- Hour 3: Integration with existing `/api/ai-command` endpoint
- Hour 4: Testing + error handling + browser compatibility

### 6.4 Graceful Degradation

- Feature hidden in unsupported browsers (Firefox, Safari)
- No impact on core functionality if disabled
- Optional enhancement, not MVP requirement

---

## 7. Performance Requirements

### 7.1 Targets

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Canvas FPS | 60 FPS | Chrome DevTools Performance profiler |
| Object Sync Latency | <100ms | Timestamp diff (write → remote render) |
| Cursor Sync Latency | <50ms | Timestamp diff (mousemove → remote cursor) |
| Initial Load Time | <2s | Lighthouse Performance score |
| AI Command Execution | <3s | Streaming response time to first token |
| Object Capacity | 500+ | Manual testing with object creation loop |
| Concurrent Users | 5+ | Manual testing with multiple browser windows |

### 7.2 Optimization Strategies

**Viewport Culling:**
```typescript
const isInViewport = (obj: BoardObject, viewport: Viewport): boolean => {
  const vpLeft = -viewport.x / viewport.scale
  const vpTop = -viewport.y / viewport.scale
  const vpRight = vpLeft + window.innerWidth / viewport.scale
  const vpBottom = vpTop + window.innerHeight / viewport.scale
  
  const padding = 200 // Buffer for smooth entry/exit
  
  return !(
    obj.x + obj.width < vpLeft - padding ||
    obj.x > vpRight + padding ||
    obj.y + obj.height < vpTop - padding ||
    obj.y > vpBottom + padding
  )
}
```

**Layer Splitting:**
- Layer 1 (Static): Grid background, no event listeners
- Layer 2 (Dynamic): Board objects, draggable
- Layer 3 (Cursors): Remote cursors, always on top
- Layer 4 (Selection UI): Transformer handles

**Debounced Sync:**
- Only write to Firestore on drag **end**, not during drag
- Local optimistic updates for instant feedback
- Rollback on Firestore write failure

**Throttled Cursor Updates:**
- Update rate: 30 Hz (33ms intervals)
- Distance threshold: Only send if cursor moved >5px
- Reduces Realtime DB bandwidth significantly

---

## 8. Testing Plan

### 8.1 Multiplayer Sync Tests

**Test 1: Simultaneous Object Creation**
- Setup: 2 users, different browsers
- Action: Both users create sticky notes rapidly (10 each)
- Expected: All 20 notes appear for both users within 100ms
- Pass Criteria: No missing objects, no duplicates

**Test 2: Simultaneous Editing**
- Setup: 2 users editing same sticky note text
- Action: User A types "Strategy", User B types "Plan"
- Expected: Last-write-wins (either "Strategy" or "Plan")
- Pass Criteria: No merge conflicts, consistent state across users

**Test 3: Network Disconnection**
- Setup: 1 user, stable connection
- Action: Create 5 objects → disable network → create 5 more → re-enable network
- Expected: Firestore offline cache persists all 10 objects, syncs on reconnect
- Pass Criteria: All objects appear after reconnect

**Test 4: Rapid Drag Operations**
- Setup: 2 users dragging different objects simultaneously
- Action: Each user drags 10 objects in quick succession
- Expected: Smooth dragging, no jitter, positions sync correctly
- Pass Criteria: 60 FPS maintained, <100ms sync latency

**Test 5: Cursor Sync Performance**
- Setup: 2 users moving cursors rapidly
- Action: Move cursor in circles/figure-8 patterns
- Expected: Remote cursor follows smoothly, no lag
- Pass Criteria: <50ms latency, 30 Hz update rate

### 8.2 AI Agent Tests

**Test 6: Basic Creation Commands**
- Input: "Create a yellow sticky note that says 'User Research'"
- Expected: Sticky note created with exact text and color
- Pass Criteria: Correct object type, position in viewport, accurate text

**Test 7: Multi-Step Layout Commands**
- Input: "Create a 2x3 grid of sticky notes for a SWOT analysis"
- Expected: 6 sticky notes arranged in grid (Strengths, Weaknesses, Opportunities, Threats, etc.)
- Pass Criteria: Correct layout, consistent spacing, appropriate labels

**Test 8: Red Team Analysis**
- Setup: Board with 3-4 sticky notes describing a product strategy
- Input: "Red team this strategy"
- Expected: Critique frame with 3-5 flagged assumptions/contradictions + connectors
- Pass Criteria: Specific critiques (not generic), correct connector targets, severity indicators

**Test 9: Decision Mapping**
- Input: "Map the decision: should we expand to Europe?"
- Expected: Options matrix with 3-4 options, 4-5 criteria, scored evaluations
- Pass Criteria: Correct framework structure, scores with rationales, color-coded cells

**Test 10: Find Gaps**
- Setup: Board with incomplete strategy (mentions "pricing" but no details)
- Input: "Find gaps in this board"
- Expected: Gap flags identifying missing content (e.g., "Pricing strategy mentioned but not detailed")
- Pass Criteria: Accurate gap identification, flags positioned near related content

### 8.3 Performance Tests

**Test 11: Object Capacity**
- Action: Create 500 sticky notes using AI batch command
- Expected: 60 FPS during pan/zoom
- Pass Criteria: No frame drops, smooth interactions

**Test 12: Concurrent Users**
- Setup: 5 users on same board
- Action: All users create/move objects simultaneously
- Expected: No degradation in sync latency or FPS
- Pass Criteria: <100ms sync, 60 FPS maintained

**Test 13: Network Throttling**
- Setup: Chrome DevTools → Network tab → Fast 3G
- Action: Create objects, move cursor, issue AI commands
- Expected: Sync still works, graceful degradation
- Pass Criteria: No crashes, eventual consistency

---

## 9. Deployment

### 9.1 Hosting

**Platform:** Vercel  
**Domain:** Custom domain (cruciblecanvas.app) or Vercel subdomain  
**Environment:** Production + Preview (automatic PR deployments)

**Configuration:**
```bash
# vercel.json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install"
}
```

**Environment Variables (Vercel Dashboard):**
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
ANTHROPIC_API_KEY=...
```

### 9.2 Firebase Configuration

**Firestore:**
- Database: `(default)` in `us-central1`
- Security rules deployed via Firebase CLI

**Realtime Database:**
- Database: `cruciblecanvas-default-rtdb` in `us-central1`
- Security rules deployed via Firebase CLI

**Authentication:**
- Providers: Google, GitHub OAuth
- Authorized domains: `cruciblecanvas.app`, `*.vercel.app`

**Security Rules (Firestore):**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() {
      return request.auth != null;
    }
    
    match /boards/{boardId}/metadata/{document=**} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update: if isAuthenticated();
    }
    
    match /boards/{boardId}/objects/{objectId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update: if isAuthenticated();
      allow delete: if isAuthenticated();
    }
  }
}
```

**Security Rules (Realtime DB):**
```json
{
  "rules": {
    "boards": {
      "$boardId": {
        "cursors": {
          "$userId": {
            ".read": "auth != null",
            ".write": "auth.uid == $userId"
          }
        },
        "presence": {
          "$userId": {
            ".read": "auth != null",
            ".write": "auth.uid == $userId"
          }
        }
      }
    }
  }
}
```

---

## 10. Implementation Phases

### Phase 1: Foundation (Hours 0-4)
- [ ] Next.js + Firebase project setup
- [ ] Firebase Auth with Google provider
- [ ] Realtime DB schema for cursors
- [ ] Cursor sync working between 2 browsers
- **Gate:** Two users see each other's cursors in real-time

### Phase 2: Core Objects (Hours 4-12)
- [ ] Firestore schema for board objects
- [ ] Sticky note creation with Zustand store
- [ ] Firestore listeners for real-time sync
- [ ] Drag-and-drop with optimistic updates
- [ ] Test simultaneous sticky note creation
- **Gate:** Two users can create and move sticky notes simultaneously

### Phase 3: Board Features (Hours 12-18)
- [ ] Rectangle and circle shapes
- [ ] Text editing (double-click → textarea overlay)
- [ ] Selection system (click to select)
- [ ] Color picker and delete operations
- [ ] Frames (grouping containers)
- **Gate:** Full CRUD operations work for all object types

### Phase 4: AI Integration (Hours 18-24)
- [ ] Vercel AI SDK + Claude Sonnet 4.5 setup
- [ ] Base manipulation tools (create, move, delete)
- [ ] `getBoardState()` context provider
- [ ] Red Team Analysis tool
- [ ] Decision Mapping tool
- [ ] Find Gaps tool
- [ ] Chat UI for AI commands
- **Gate:** AI executes 6+ command types including all 3 analytical modes

### Phase 5: Polish & Deployment (Hours 24-30)
- [ ] Loading states and error handling
- [ ] Presence indicators (user avatars)
- [ ] Deploy to Vercel
- [ ] End-to-end testing with 5 concurrent users
- [ ] Voice-to-Visual integration (optional)

---

## 11. Success Criteria

### MVP Requirements (24-Hour Gate)
- [ ] Infinite board with pan/zoom (60 FPS)
- [ ] Sticky notes with editable text
- [ ] At least one shape type (rectangle)
- [ ] Create, move, and edit objects
- [ ] Real-time sync between 2+ users (<100ms)
- [ ] Multiplayer cursors with name labels (<50ms)
- [ ] Presence awareness (who's online)
- [ ] User authentication (Google OAuth)
- [ ] Deployed and publicly accessible

### Full Feature Set (Day 4-7)
- [ ] All MVP requirements passed
- [ ] AI agent executes 6+ command types
- [ ] Red Team Analysis (critique frames with connectors)
- [ ] Decision Mapping (options matrix or tradeoff analysis)
- [ ] Find the Gaps (logical consistency checking)
- [ ] Voice-to-Visual (optional)
- [ ] Performance targets met (500+ objects, 5+ users)

### Demo Quality
- [ ] 3-5 minute demo video recorded
- [ ] Real-time collaboration demonstrated
- [ ] All 3 AI analytical modes shown
- [ ] Architecture explanation included
- [ ] Social post published (X or LinkedIn)

---

## 12. Known Limitations & Trade-offs

### Accepted Trade-offs
1. **Last-Write-Wins Conflict Resolution:** Simultaneous edits to same object result in one winning. No operational transforms or CRDTs (out of MVP scope).

2. **Firestore Vendor Lock-In:** Heavily dependent on Firebase. Migration would require significant refactoring. Accepted for speed-to-MVP.

3. **Cursor Sync Costs:** Realtime DB bandwidth scales linearly with users. Mitigated by 30 Hz throttling + distance threshold, but still expensive at scale.

4. **AI Token Costs:** Grows with board complexity. Need context pruning beyond 1,000 objects. Accepted for MVP, requires optimization post-launch.

5. **Single Board Per URL:** No workspace/folder hierarchy. Each board is isolated. Acceptable for MVP, can add later.

### Not Implemented (Out of Scope)
- Multi-select (Shift + click)
- Undo/redo
- Export to PDF/PNG
- Commenting system
- Granular permissions (owner vs editor vs viewer)
- Real-time text editing with field-level merge
- Mobile touch gestures (pan/zoom)
- Offline mode (beyond Firestore cache)

---

## 13. Open Questions for Interview

### Technical Implementation
- How should we handle object z-index conflicts when multiple users create objects simultaneously?
- Should connectors be auto-routed (avoid objects) or straight lines?
- How do we determine "viewport area" for placing new AI-generated objects when user is zoomed in/out?
- Should frames automatically resize to fit contents, or fixed size?

### UI/UX Design
- Should there be a dedicated AI chat panel (sidebar) or floating button?
- How do we visually distinguish AI-generated content from user-created content?
- Should critique connectors be editable/deletable by users, or locked?
- What happens if AI generates 20+ objects—do we auto-zoom out to fit everything?

### AI Behavior
- How specific should critique notes be? (e.g., "Assumes X" vs "Assumes X without evidence from Y")
- Should "Red Team This" analyze entire board by default, or require explicit selection?
- If board has 500 objects, how do we decide which ones to include in AI context?
- Should AI remember previous analyses when user reopens board (lore awareness)?

### Performance & Scaling
- At what object count should we warn users about performance degradation?
- Should we implement pagination/lazy loading for boards with 1,000+ objects?
- How do we test 5+ concurrent users without deploying to production first?
- Should cursor updates continue at 30 Hz when user is idle (no mouse movement)?

### Deployment & Operations
- Should we enable Firebase offline persistence (IndexedDB cache)?
- How do we monitor AI costs in production? Custom logging or rely on Anthropic dashboard?
- Should there be a free tier limit (e.g., 10 AI commands per day)?
- How do we handle abuse (spamming AI commands to rack up costs)?

---

This specification document is designed for iterative refinement through Claude Code's Plan mode interview process. All sections marked with "Open Questions" should be explored in-depth to finalize implementation details before coding begins.