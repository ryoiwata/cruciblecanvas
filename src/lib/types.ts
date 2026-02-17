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

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 5.0;
