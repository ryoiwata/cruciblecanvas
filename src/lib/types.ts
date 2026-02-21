import { Timestamp } from "firebase/firestore";

// ---------------------------------------------------------------------------
// Object Types
// ---------------------------------------------------------------------------

export type ObjectType =
  | "stickyNote"
  | "rectangle"
  | "circle"
  | "frame"
  | "connector"
  | "colorLegend"
  | "line"
  | "text";

export type AnalyticalRole =
  | "critique"
  | "assumption"
  | "gap_flag"
  | "criterion"
  | "option"
  | "evaluation";

export type ConnectorStyle = "solid" | "dashed" | "dotted";

export type StickyFontFamily = "sans-serif" | "handwritten" | "monospace";

// ---- Properties Sidebar types ----

/** Decoration applied to the start or end of a line/connector. */
export type LineEffect = 'none' | 'arrow' | 'filled-arrow' | 'open-arrow' | 'dot';

/** Routing style for lines and connectors. */
export type LineType = 'straight' | 'elbow' | 'curved';

/** Horizontal text alignment. */
export type TextAlign = 'left' | 'center' | 'right';

/** Vertical text alignment within an object's bounding box. */
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';

export const FONT_FAMILY_MAP: Record<StickyFontFamily, string> = {
  "sans-serif": "sans-serif",
  handwritten: "Segoe Print, Comic Sans MS, cursive",
  monospace: "Courier New, monospace",
} as const;

// ---------------------------------------------------------------------------
// Board Object (Firestore: boards/{boardId}/objects/{objectId})
// ---------------------------------------------------------------------------

export interface LegendEntry {
  color: string;
  meaning: string;
}

export interface BoardObjectMetadata {
  analysisType?: "red_team" | "decision_map" | "gap_analysis";
  critiqueTarget?: string;
  severity?: "low" | "medium" | "high";
  decisionContext?: string;
  score?: number;
  persona?: "skeptic" | "investor" | "counsel";
  connectorStyle?: ConnectorStyle;
}

export interface BoardObject {
  // Core identification
  id: string;
  type: ObjectType;

  // Spatial properties
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;

  // Visual properties
  color: string;
  text?: string;
  opacity?: number; // 0-1, defaults to 1
  zIndex?: number;  // explicit layer order; higher = in front
  fontFamily?: StickyFontFamily; // font for text content
  fontSize?: number; // font size in canvas units; used by TextObject (default 16)
  thickness?: number; // stroke width in canvas units; 1–10; defaults to type-specific constant
  borderType?: 'solid' | 'dashed' | 'dotted'; // border/stroke style for shapes and lines

  // Extended visual properties (Properties Sidebar)
  strokeColor?: string;              // Separate border/stroke color distinct from fill (shapes, frames)
  textColor?: string;                // Text fill color independent of object color
  textAlign?: TextAlign;             // Horizontal text alignment
  textVerticalAlign?: TextVerticalAlign; // Vertical text alignment within bounding box
  lineType?: LineType;               // Connector/line routing style
  startEffect?: LineEffect;          // Decoration at start of line/connector
  endEffect?: LineEffect;            // Decoration at end of line/connector
  startEffectSize?: number;          // Start effect scale % (default 100)
  endEffectSize?: number;            // End effect scale % (default 100)

  // Ownership & timestamps
  createdBy: string;
  createdAt: Timestamp | number; // Timestamp from Firestore, number during optimistic create
  updatedAt: Timestamp | number;

  // AI attribution
  isAIGenerated?: boolean;
  aiCommandId?: string;
  isAIPending?: boolean; // true while AI command is streaming — renders at 50% opacity

  // Relationships
  parentFrame?: string;
  connectedTo?: string[];

  // AI-specific metadata
  role?: AnalyticalRole;
  metadata?: BoardObjectMetadata;

  // Color Legend specific (type: 'colorLegend')
  legendEntries?: LegendEntry[];
}

// ---------------------------------------------------------------------------
// Board Metadata (Firestore: boards/{boardId}/metadata/config)
// ---------------------------------------------------------------------------

export type AiPersona = "neutral" | "skeptical_investor" | "opposing_counsel";

export interface AnalysisRecord {
  timestamp: number;
  type: "red_team" | "decision_map" | "gap_analysis";
  objectCount: number;
  summary: string;
}

export interface BoardContext {
  mainTopics: string[];
  openQuestions: string[];
  keyDecisions: string[];
  executiveSummary: string;
  lastAnalyzed: Timestamp;
}

export interface BoardMetadata {
  title: string;
  createdAt: Timestamp | number;
  createdBy: string;

  // Visibility & access
  isPublic: boolean;
  invitedEmails: string[];

  // AI configuration
  aiPersona: AiPersona;

  // Rate limiting
  aiCommandsToday: number;
  aiCommandsResetAt: Timestamp | number;

  // Analysis history
  analysisHistory: AnalysisRecord[];

  // Board context / AI Lore (sidecar pattern)
  boardContext?: BoardContext;
}

// ---------------------------------------------------------------------------
// Chat message types (Firestore: boards/{boardId}/messages/{messageId})
// ---------------------------------------------------------------------------

export type ChatMessageType = 'group' | 'ai_command' | 'ai_response' | 'system';
export type AIStatus = 'streaming' | 'completed' | 'failed';

export interface ObjectReference {
  objectId: string;
  objectText: string;       // Snapshot of object text at reference time
  objectType: ObjectType;
}

export interface ChatMessage {
  id: string;
  boardId: string;

  // Sender
  senderId: string;
  senderName: string;
  senderPhotoURL?: string;

  // Content
  type: ChatMessageType;
  content: string;

  // Object references for group messages
  objectReferences?: ObjectReference[];

  // AI-specific fields
  aiCommandId?: string;
  aiPersona?: AiPersona;
  aiStatus?: AIStatus;
  aiError?: string;

  // Timestamps
  // null occurs when Firestore's serverTimestamp() is still pending on the optimistic snapshot
  createdAt: Timestamp | number | null;
}

// RTDB AI stream — /boards/{boardId}/aiStreams/{commandId}
export interface AIStream {
  requesterId: string;
  requesterName: string;
  content: string;
  status: 'streaming' | 'completed' | 'failed';
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Realtime Database types (use number timestamps, not Firestore Timestamp)
// ---------------------------------------------------------------------------

// RTDB: /boards/{boardId}/cursors/{userId}
export interface CursorData {
  x: number;
  y: number;
  name: string;
  color: string;
  timestamp: number;
}

// RTDB: /boards/{boardId}/presence/{userId}
export interface PresenceData {
  name: string;
  email?: string;
  photoURL?: string;
  color: string;
  online: boolean;
  lastSeen: number;
  isAnonymous: boolean;
}

// RTDB: /boards/{boardId}/locks/{objectId}
export interface ObjectLock {
  userId: string;
  userName: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STICKY_NOTE_COLORS = [
  "#FEFF9C", // Yellow
  "#FF7EB9", // Pink
  "#7AFCFF", // Cyan
  "#98FF98", // Mint
  "#DDA0DD", // Plum
  "#FFAB91", // Coral
] as const;

export const STICKY_NOTE_DEFAULT = {
  width: 200,
  height: 150,
  color: "#FEF3C7", // Light Yellow
} as const;

export const GRID_SIZE = 20;

export const MIN_DRAG_THRESHOLD = 5;

export const BORDER_ZONE = 8;
export const CORNER_ZONE = 16;

export type ResizeEdge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export interface BorderResizeState {
  objectId: string;
  edge: ResizeEdge;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  // Frozen anchor references captured at drag start.
  startRight: number;
  startBottom: number;
  objectType: ObjectType;
}

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 5.0;

// ---------------------------------------------------------------------------
// Frame z-index layering — frames always render below all non-frame objects.
// ---------------------------------------------------------------------------

/** Frames are always rendered below all other objects. */
export const FRAME_ZINDEX_MAX = 1000;
/** Non-frame objects always start above frames. */
export const OBJECT_ZINDEX_MIN = 1001;

// ---------------------------------------------------------------------------
// Level-of-detail (LOD) thresholds
// ---------------------------------------------------------------------------

/** Below this zoom level, render simplified shapes (no text, shadow, border). */
export const LOD_SIMPLE_THRESHOLD = 0.15;
/** Below this zoom level, skip rendering entirely (objects are sub-pixel). */
export const LOD_INVISIBLE_THRESHOLD = 0.05;

// ---------------------------------------------------------------------------
// Shape defaults & limits
// ---------------------------------------------------------------------------

export const SHAPE_DEFAULTS = {
  rectangle: { width: 100, height: 100, color: "#E3E8EF", cornerRadius: 4 },
  circle: { width: 100, height: 100, color: "#E3E8EF" },
} as const;

export const SHAPE_SIZE_LIMITS = {
  min: { width: 1, height: 1 },
  max: { width: 100000, height: 100000 },
} as const;

// ---------------------------------------------------------------------------
// Frame defaults & limits
// ---------------------------------------------------------------------------

export const FRAME_DEFAULTS = {
  width: 400,
  height: 300,
  color: "#6366f1",
  titleBarHeight: 40,
  backgroundOpacity: 0.1,
} as const;

export const FRAME_SIZE_LIMITS = {
  min: { width: 1, height: 1 },
  max: { width: 100000, height: 100000 },
} as const;

// ---------------------------------------------------------------------------
// Connector defaults
// ---------------------------------------------------------------------------

export const CONNECTOR_DEFAULTS = {
  color: "#6B7280",
  style: "solid" as ConnectorStyle,
  strokeWidth: 2.5,
} as const;

// ---------------------------------------------------------------------------
// Line defaults
// ---------------------------------------------------------------------------

export const LINE_DEFAULTS = {
  width: 120,
  height: 0,
  color: "#374151",
  thickness: 2,
} as const;

// ---------------------------------------------------------------------------
// Text object defaults
// ---------------------------------------------------------------------------

export const TEXT_DEFAULTS = {
  width: 250,
  height: 50,
  fontSize: 24,
  color: '#000000',
} as const;

// ---------------------------------------------------------------------------
// Sticky note size limits
// ---------------------------------------------------------------------------

export const STICKY_NOTE_SIZE_LIMITS = {
  min: { width: 1, height: 1 },
  max: { width: 100000, height: 100000 },
} as const;

// ---------------------------------------------------------------------------
// Color Legend defaults
// ---------------------------------------------------------------------------

export const COLOR_LEGEND_DEFAULTS = {
  width: 200,
  height: 160,
  color: "#FFFFFF",
} as const;

// ---------------------------------------------------------------------------
// Style Presets (Properties Sidebar — quick-apply fill + stroke combos)
// ---------------------------------------------------------------------------

export interface StylePreset {
  id: string;
  label: string;
  /** Fill/background color */
  color: string;
  /** Border/stroke color */
  strokeColor?: string;
  /** Text color */
  textColor?: string;
  /** Swatch background for the preview chip */
  previewBg: string;
  /** Swatch border for the preview chip */
  previewBorder?: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  // Neutrals
  { id: 'soft-white',      label: 'Soft White',      color: '#FFFFFF', strokeColor: '#D1D5DB', textColor: '#374151', previewBg: '#FFFFFF', previewBorder: '#D1D5DB' },
  { id: 'pale-cloud',      label: 'Pale Cloud',      color: '#F3F4F6', strokeColor: '#CBD5E1', textColor: '#374151', previewBg: '#F3F4F6', previewBorder: '#CBD5E1' },
  // Pinks & Reds
  { id: 'pastel-pink',     label: 'Pastel Pink',     color: '#FFD6E8', strokeColor: '#F9A8D4', textColor: '#9D174D', previewBg: '#FFD6E8', previewBorder: '#F9A8D4' },
  { id: 'pastel-rose',     label: 'Pastel Rose',     color: '#FFE4E6', strokeColor: '#FCA5A5', textColor: '#9F1239', previewBg: '#FFE4E6', previewBorder: '#FCA5A5' },
  // Oranges & Yellows
  { id: 'pastel-peach',    label: 'Pastel Peach',    color: '#FFECD2', strokeColor: '#FDBA74', textColor: '#9A3412', previewBg: '#FFECD2', previewBorder: '#FDBA74' },
  { id: 'pastel-yellow',   label: 'Pastel Yellow',   color: '#FEF9C3', strokeColor: '#FDE047', textColor: '#713F12', previewBg: '#FEF9C3', previewBorder: '#FDE047' },
  // Greens
  { id: 'pastel-mint',     label: 'Pastel Mint',     color: '#D1FAE5', strokeColor: '#6EE7B7', textColor: '#065F46', previewBg: '#D1FAE5', previewBorder: '#6EE7B7' },
  { id: 'pastel-sage',     label: 'Pastel Sage',     color: '#DCFCE7', strokeColor: '#86EFAC', textColor: '#14532D', previewBg: '#DCFCE7', previewBorder: '#86EFAC' },
  // Blues
  { id: 'pastel-sky',      label: 'Pastel Sky',      color: '#E0F2FE', strokeColor: '#7DD3FC', textColor: '#0C4A6E', previewBg: '#E0F2FE', previewBorder: '#7DD3FC' },
  { id: 'pastel-blue',     label: 'Pastel Blue',     color: '#DBEAFE', strokeColor: '#93C5FD', textColor: '#1E3A8A', previewBg: '#DBEAFE', previewBorder: '#93C5FD' },
  // Purples
  { id: 'pastel-lavender', label: 'Pastel Lavender', color: '#EDE9FE', strokeColor: '#C4B5FD', textColor: '#4C1D95', previewBg: '#EDE9FE', previewBorder: '#C4B5FD' },
  { id: 'pastel-lilac',    label: 'Pastel Lilac',    color: '#FAE8FF', strokeColor: '#E879F9', textColor: '#701A75', previewBg: '#FAE8FF', previewBorder: '#E879F9' },
] as const;

// ---------------------------------------------------------------------------
// Context menu types
// ---------------------------------------------------------------------------

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  /** Single-object target; null when the menu targets a group. */
  targetObjectId: string | null;
  /** Multi-object target ids; non-empty only when the right-clicked object is part of a multi-selection. */
  targetObjectIds: string[];
  nearbyFrames: { id: string; title: string }[];
}
