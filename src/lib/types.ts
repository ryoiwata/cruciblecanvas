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
  | "colorLegend";

export type AnalyticalRole =
  | "critique"
  | "assumption"
  | "gap_flag"
  | "criterion"
  | "option"
  | "evaluation";

export type ConnectorStyle = "solid" | "dashed" | "dotted";

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

  // Ownership & timestamps
  createdBy: string;
  createdAt: Timestamp | number; // Timestamp from Firestore, number during optimistic create
  updatedAt: Timestamp | number;

  // AI attribution
  isAIGenerated?: boolean;
  aiCommandId?: string;

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
  color: "#FEFF9C", // Yellow
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
  objectType: ObjectType;
}

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 5.0;

// ---------------------------------------------------------------------------
// Shape defaults & limits
// ---------------------------------------------------------------------------

export const SHAPE_DEFAULTS = {
  rectangle: { width: 100, height: 100, color: "#E3E8EF", cornerRadius: 4 },
  circle: { width: 100, height: 100, color: "#E3E8EF" },
} as const;

export const SHAPE_SIZE_LIMITS = {
  min: { width: 20, height: 20 },
  max: { width: 800, height: 800 },
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
  min: { width: 150, height: 100 },
  max: { width: 4000, height: 4000 },
} as const;

// ---------------------------------------------------------------------------
// Connector defaults
// ---------------------------------------------------------------------------

export const CONNECTOR_DEFAULTS = {
  color: "#6B7280",
  style: "solid" as ConnectorStyle,
  strokeWidth: 2,
} as const;

// ---------------------------------------------------------------------------
// Sticky note size limits
// ---------------------------------------------------------------------------

export const STICKY_NOTE_SIZE_LIMITS = {
  min: { width: 80, height: 60 },
  max: { width: 600, height: 600 },
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
// Context menu types
// ---------------------------------------------------------------------------

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetObjectId: string | null;
  nearbyFrames: { id: string; title: string }[];
}
