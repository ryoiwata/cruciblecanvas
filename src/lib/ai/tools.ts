/**
 * tools.ts — Vercel AI SDK v6 tool definitions for the CrucibleCanvas AI board agent.
 * Each tool maps to a board manipulation operation backed by Firestore REST API writes.
 * Uses the requesting user's ID token so writes flow through Security Rules (BaaS pattern).
 * Tools are called as Claude streams its response — each execute() call writes to Firestore
 * with isAIPending: true for soft-commit rendering at 50% opacity.
 */

import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  restCreateObject,
  restUpdateObject,
  restDeleteObject,
  restGetObjects,
  restBatchUpdateObjects,
} from '@/lib/firebase/firestoreRest';
import {
  snapToGrid,
  clampSize,
  validateCoordinates,
  calculateUniformGrid,
  calculateHorizontalLayout,
  calculateVerticalLayout,
} from './validation';
import { serializeBoardState } from './context';
import { computeOccupiedZones, findClearRect, findContainingFrame, clampToFrame } from './spatialPlanning';
import { computeFlowchartLayout, computeGridLayout } from './layoutAlgorithms';
import type { LayoutNode, LayoutEdge } from './layoutAlgorithms';
import type { ObjectType, ConnectorStyle, BoardObject } from '@/lib/types';
import { STICKY_NOTE_DEFAULT, FRAME_DEFAULTS, CONNECTOR_DEFAULTS } from '@/lib/types';

interface ToolContext {
  boardId: string;
  userId: string;
  aiCommandId: string;
  /** Firebase ID token used to authenticate Firestore REST API calls. */
  userToken: string;
  /** Current board objects — used by spatial tools (findAvailableSpace, createFlowchart). */
  boardObjects?: Record<string, BoardObject>;
  /** Visible canvas viewport bounds in canvas coordinates. */
  viewportBounds?: { x: number; y: number; width: number; height: number };
}

/**
 * Text content longer than this threshold must use stickyNote/text instead of
 * rectangle or circle. Shapes with short labels (≤20 chars) are still permitted
 * as minimal decorative labels.
 */
const TEXT_BODY_THRESHOLD = 20;

/**
 * Resolves the parent frame for a newly-created object.
 *
 * If an explicit parentFrameId is provided the frame is looked up in boardObjects
 * and the (x, y) coordinates are clamped inside its bounds so the object can never
 * be placed outside the frame. Falls back to spatial detection via findContainingFrame
 * when no explicit ID is given (auto-frame by position).
 */
function resolveParentFrameId(
  boardObjects: Record<string, BoardObject>,
  x: number,
  y: number,
  width: number,
  height: number,
  explicitParentFrameId?: string
): { parentFrame: string | undefined; x: number; y: number } {
  if (explicitParentFrameId) {
    const frame = boardObjects[explicitParentFrameId];
    if (frame?.type === 'frame') {
      const clamped = clampToFrame(frame, x, y, width, height);
      return { parentFrame: explicitParentFrameId, x: clamped.x, y: clamped.y };
    }
    // Frame might have just been created in this same command — trust the ID as-is
    return { parentFrame: explicitParentFrameId, x, y };
  }
  const parentFrame = findContainingFrame(boardObjects, x, y, width, height);
  return { parentFrame, x, y };
}

/**
 * Creates the full set of AI tool definitions, each bound to a board context.
 * The context (boardId, userId, aiCommandId, userToken) is closed over by each execute() function.
 */
export function createAITools(ctx: ToolContext) {
  const { boardId, userId, aiCommandId, userToken } = ctx;

  return {
    // -------------------------------------------------------------------------
    // Creation tools
    // -------------------------------------------------------------------------

    createStickyNote: tool({
      description:
        'Create a sticky note on the board with text, position, and color. ' +
        'Use this (not rectangle/circle) for any content with body text. ' +
        'If the note belongs inside a frame, pass the frame\'s objectId as parentFrameId ' +
        '— coordinates will be auto-clamped to fit within that frame.',
      inputSchema: zodSchema(
        z.object({
          text: z.string().describe('Text content of the sticky note'),
          x: z.number().describe('X coordinate (will be snapped to 20px grid)'),
          y: z.number().describe('Y coordinate (will be snapped to 20px grid)'),
          color: z.string().describe('Background color as hex (e.g. #FEFF9C) or named color'),
          parentFrameId: z.string().optional().describe(
            'objectId of the frame this note belongs to. Coordinates are automatically clamped inside the frame.'
          ),
        })
      ),
      execute: async ({ text, x, y, color, parentFrameId }: { text: string; x: number; y: number; color: string; parentFrameId?: string }) => {
        const rawCoords = validateCoordinates(snapToGrid(x), snapToGrid(y));
        const id = uuidv4();
        const { parentFrame, x: finalX, y: finalY } = resolveParentFrameId(
          ctx.boardObjects ?? {},
          rawCoords.x,
          rawCoords.y,
          STICKY_NOTE_DEFAULT.width,
          STICKY_NOTE_DEFAULT.height,
          parentFrameId
        );
        await restCreateObject(boardId, {
          id,
          type: 'stickyNote',
          text,
          x: finalX,
          y: finalY,
          width: STICKY_NOTE_DEFAULT.width,
          height: STICKY_NOTE_DEFAULT.height,
          color,
          createdBy: userId,
          isAIGenerated: true,
          isAIPending: true,
          aiCommandId,
          ...(parentFrame ? { parentFrame } : {}),
        }, userToken);
        return { success: true, objectId: id };
      },
    }),

    createShape: tool({
      description:
        'Create a geometric shape on the board. rectangle and circle are purely structural/decorative — ' +
        'do NOT use them for items with body text (use createStickyNote instead). ' +
        'diamond is for flowchart decision nodes, roundedRect for process steps. ' +
        'Pass parentFrameId to bind the shape to an existing frame.',
      inputSchema: zodSchema(
        z.object({
          type: z.enum(['rectangle', 'circle', 'diamond', 'roundedRect']).describe(
            'Shape type. rectangle/circle: decorative only (no text body). diamond: decision node. roundedRect: process step.'
          ),
          x: z.number().describe('X coordinate'),
          y: z.number().describe('Y coordinate'),
          width: z.number().optional().describe('Width in pixels (default 100)'),
          height: z.number().optional().describe('Height in pixels (default 100)'),
          color: z.string().describe('Fill color as hex'),
          parentFrameId: z.string().optional().describe(
            'objectId of the frame this shape belongs to. Coordinates are automatically clamped inside the frame.'
          ),
        })
      ),
      execute: async ({ type, x, y, width = 100, height = 100, color, parentFrameId }: { type: 'rectangle' | 'circle' | 'diamond' | 'roundedRect'; x: number; y: number; width?: number; height?: number; color: string; parentFrameId?: string }) => {
        const rawCoords = validateCoordinates(snapToGrid(x), snapToGrid(y));
        const clamped = clampSize(type as ObjectType, width, height);
        const snappedW = snapToGrid(clamped.width);
        const snappedH = snapToGrid(clamped.height);
        const id = uuidv4();
        const { parentFrame, x: finalX, y: finalY } = resolveParentFrameId(
          ctx.boardObjects ?? {},
          rawCoords.x,
          rawCoords.y,
          snappedW,
          snappedH,
          parentFrameId
        );
        await restCreateObject(boardId, {
          id,
          type,
          x: finalX,
          y: finalY,
          width: snappedW,
          height: snappedH,
          color,
          createdBy: userId,
          isAIGenerated: true,
          isAIPending: true,
          aiCommandId,
          ...(parentFrame ? { parentFrame } : {}),
        }, userToken);
        return { success: true, objectId: id };
      },
    }),

    createFrame: tool({
      description: 'Create a labeled frame (container) on the board.',
      inputSchema: zodSchema(
        z.object({
          title: z.string().describe('Frame title text'),
          x: z.number().describe('X coordinate'),
          y: z.number().describe('Y coordinate'),
          width: z.number().optional().describe('Width in pixels (default 400)'),
          height: z.number().optional().describe('Height in pixels (default 300)'),
        })
      ),
      execute: async ({ title, x, y, width = FRAME_DEFAULTS.width, height = FRAME_DEFAULTS.height }: { title: string; x: number; y: number; width?: number; height?: number }) => {
        const coords = validateCoordinates(snapToGrid(x), snapToGrid(y));
        const clamped = clampSize('frame', width, height);
        const id = uuidv4();
        await restCreateObject(boardId, {
          id,
          type: 'frame',
          text: title,
          x: coords.x,
          y: coords.y,
          width: snapToGrid(clamped.width),
          height: snapToGrid(clamped.height),
          color: FRAME_DEFAULTS.color,
          createdBy: userId,
          isAIGenerated: true,
          isAIPending: true,
          aiCommandId,
        }, userToken);
        return { success: true, objectId: id };
      },
    }),

    createConnector: tool({
      description: 'Create a connector line between two existing objects.',
      inputSchema: zodSchema(
        z.object({
          fromObjectId: z.string().describe('ID of the source object'),
          toObjectId: z.string().describe('ID of the target object'),
          style: z.enum(['solid', 'dashed', 'dotted']).optional().describe('Line style (default solid)'),
          color: z.string().optional().describe('Connector color as hex'),
          label: z.string().optional().describe('Optional label text on the connector'),
          directed: z.boolean().optional().describe('Whether to show an arrowhead (default true)'),
        })
      ),
      execute: async ({ fromObjectId, toObjectId, style = 'solid', color = CONNECTOR_DEFAULTS.color, label, directed = true }: { fromObjectId: string; toObjectId: string; style?: string; color?: string; label?: string; directed?: boolean }) => {
        const id = uuidv4();
        await restCreateObject(boardId, {
          id,
          type: 'connector',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          color,
          connectedTo: [fromObjectId, toObjectId],
          metadata: { connectorStyle: style as ConnectorStyle },
          endEffect: directed ? 'arrow' : 'none',
          ...(label ? { text: label } : {}),
          createdBy: userId,
          isAIGenerated: true,
          isAIPending: true,
          aiCommandId,
        }, userToken);
        return { success: true, objectId: id };
      },
    }),

    // -------------------------------------------------------------------------
    // Manipulation tools
    // -------------------------------------------------------------------------

    moveObject: tool({
      description: 'Move an existing object to new coordinates.',
      inputSchema: zodSchema(
        z.object({
          objectId: z.string().describe('ID of the object to move'),
          x: z.number().describe('New X coordinate'),
          y: z.number().describe('New Y coordinate'),
        })
      ),
      execute: async ({ objectId, x, y }: { objectId: string; x: number; y: number }) => {
        const coords = validateCoordinates(snapToGrid(x), snapToGrid(y));
        await restUpdateObject(boardId, objectId, { x: coords.x, y: coords.y }, userToken);
        return { success: true };
      },
    }),

    resizeObject: tool({
      description: 'Resize an existing object to new dimensions.',
      inputSchema: zodSchema(
        z.object({
          objectId: z.string().describe('ID of the object to resize'),
          width: z.number().describe('New width in pixels'),
          height: z.number().describe('New height in pixels'),
        })
      ),
      execute: async ({ objectId, width, height }: { objectId: string; width: number; height: number }) => {
        const w = Math.max(1, Math.min(4000, snapToGrid(width)));
        const h = Math.max(1, Math.min(4000, snapToGrid(height)));
        await restUpdateObject(boardId, objectId, { width: w, height: h }, userToken);
        return { success: true };
      },
    }),

    updateText: tool({
      description: 'Update the text content of a sticky note or frame title.',
      inputSchema: zodSchema(
        z.object({
          objectId: z.string().describe('ID of the object to update'),
          newText: z.string().describe('New text content'),
        })
      ),
      execute: async ({ objectId, newText }: { objectId: string; newText: string }) => {
        await restUpdateObject(boardId, objectId, { text: newText }, userToken);
        return { success: true };
      },
    }),

    changeColor: tool({
      description: 'Change the color of any board object.',
      inputSchema: zodSchema(
        z.object({
          objectId: z.string().describe('ID of the object'),
          color: z.string().describe('New color as hex (e.g. #FF7EB9)'),
        })
      ),
      execute: async ({ objectId, color }: { objectId: string; color: string }) => {
        await restUpdateObject(boardId, objectId, { color }, userToken);
        return { success: true };
      },
    }),

    deleteObject: tool({
      description: 'Delete a single board object.',
      inputSchema: zodSchema(
        z.object({
          objectId: z.string().describe('ID of the object to delete'),
        })
      ),
      execute: async ({ objectId }: { objectId: string }) => {
        await restDeleteObject(boardId, objectId, userToken);
        return { success: true };
      },
    }),

    // -------------------------------------------------------------------------
    // Layout tool
    // -------------------------------------------------------------------------

    arrangeInLayout: tool({
      description: 'Arrange multiple objects in a grid, horizontal, or vertical layout.',
      inputSchema: zodSchema(
        z.object({
          objectIds: z.array(z.string()).describe('IDs of objects to arrange'),
          layout: z.enum(['grid', 'horizontal', 'vertical']).describe('Layout type'),
          columns: z.number().optional().describe('Columns for grid layout (default: auto)'),
          spacing: z.number().optional().describe('Spacing between objects in pixels (default: 20)'),
          originX: z.number().optional().describe('X coordinate of the layout origin (default: 0)'),
          originY: z.number().optional().describe('Y position for layout origin (default: 0)'),
        })
      ),
      execute: async ({ objectIds, layout, columns, spacing = 20, originX = 0, originY = 0 }: { objectIds: string[]; layout: 'grid' | 'horizontal' | 'vertical'; columns?: number; spacing?: number; originX?: number; originY?: number }) => {
        const allObjects = await restGetObjects(boardId, userToken);
        const targetObjects = allObjects
          .filter((o) => objectIds.includes(o.id as string))
          .map((o) => ({
            id: o.id as string,
            width: o.width as number,
            height: o.height as number,
          }));

        if (targetObjects.length === 0) {
          return { success: false, error: 'No matching objects found' };
        }

        let positions: { id: string; x: number; y: number }[];

        if (layout === 'grid') {
          positions = calculateUniformGrid(targetObjects, {
            columns: columns ?? Math.ceil(Math.sqrt(targetObjects.length)),
            spacing,
            originX: snapToGrid(originX),
            originY: snapToGrid(originY),
          });
        } else if (layout === 'horizontal') {
          positions = calculateHorizontalLayout(targetObjects, {
            spacing,
            originX: snapToGrid(originX),
            originY: snapToGrid(originY),
          });
        } else {
          positions = calculateVerticalLayout(targetObjects, {
            spacing,
            originX: snapToGrid(originX),
            originY: snapToGrid(originY),
          });
        }

        await restBatchUpdateObjects(
          boardId,
          positions.map(({ id, x, y }) => ({ id, data: { x, y } })),
          userToken
        );

        return { success: true, arranged: positions.length };
      },
    }),

    // -------------------------------------------------------------------------
    // Context tools
    // -------------------------------------------------------------------------

    getBoardState: tool({
      description: 'Get the current board state. Useful for verifying changes or planning complex operations.',
      inputSchema: zodSchema(z.object({})),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      execute: async (_args: Record<string, never>) => {
        const objects = await restGetObjects(boardId, userToken);
        const objectsMap = Object.fromEntries(objects.map((o) => [o.id as string, o]));
        // Wide viewport to capture all objects for full board context.
        // Cast through unknown because REST response is Record<string, unknown> at runtime.
        const context = serializeBoardState(
          objectsMap as unknown as Parameters<typeof serializeBoardState>[0],
          { x: -2000, y: -2000, width: 10000, height: 10000 },
          []
        );
        return { boardState: context };
      },
    }),

    getObjectsByFrame: tool({
      description: 'Get all objects contained within a specific frame.',
      inputSchema: zodSchema(
        z.object({
          frameId: z.string().describe('ID of the frame'),
        })
      ),
      execute: async ({ frameId }: { frameId: string }) => {
        const objects = await restGetObjects(boardId, userToken);
        const children = objects.filter((o) => o.parentFrame === frameId);
        return {
          frameId,
          objects: children.map((o) => ({
            id: o.id,
            type: o.type,
            text: o.text,
            x: Math.round(o.x as number),
            y: Math.round(o.y as number),
            width: Math.round(o.width as number),
            height: Math.round(o.height as number),
            color: o.color,
          })),
        };
      },
    }),

    // -------------------------------------------------------------------------
    // Analytical tools
    // -------------------------------------------------------------------------

    redTeamThis: tool({
      description: 'Analyze selected objects for weaknesses, contradictions, and assumptions. Creates critique sticky notes on the board.',
      inputSchema: zodSchema(
        z.object({
          targetObjectIds: z.array(z.string()).describe('IDs of objects to analyze'),
          focusAreas: z.array(z.enum(['assumptions', 'contradictions', 'missing_data', 'edge_cases'])).describe('What to look for'),
          outputX: z.number().optional().describe('X position for critique notes'),
          outputY: z.number().optional().describe('Y position for critique notes'),
        })
      ),
      execute: async ({ targetObjectIds, focusAreas, outputX = 600, outputY = 100 }: { targetObjectIds: string[]; focusAreas: string[]; outputX?: number; outputY?: number }) => {
        const objects = await restGetObjects(boardId, userToken);
        const targets = objects.filter((o) => targetObjectIds.includes(o.id as string));
        return {
          instruction: `Analyze the following ${targets.length} object(s) for: ${focusAreas.join(', ')}. Create pink (#FF7EB9) sticky notes at approximately (${outputX}, ${outputY}) with your critiques. Target objects: ${JSON.stringify(targets.map((t) => ({ id: t.id, text: t.text, type: t.type })))}`,
        };
      },
    }),

    mapDecision: tool({
      description: 'Create a decision framework (pros/cons, options matrix, or tradeoff analysis) on the board.',
      inputSchema: zodSchema(
        z.object({
          decisionStatement: z.string().describe('The decision to analyze'),
          frameworkType: z.enum(['options_matrix', 'tradeoff_analysis', 'pros_cons']).describe('Type of framework'),
          options: z.array(z.string()).optional().describe('List of options to compare'),
          criteria: z.array(z.string()).optional().describe('Evaluation criteria'),
          x: z.number().optional().describe('X position (default: 100)'),
          y: z.number().optional().describe('Y position (default: 100)'),
        })
      ),
      execute: async ({ decisionStatement, frameworkType, options, criteria, x = 100, y = 100 }: { decisionStatement: string; frameworkType: string; options?: string[]; criteria?: string[]; x?: number; y?: number }) => {
        return {
          instruction: `Create a ${frameworkType} decision framework for: "${decisionStatement}". Options: ${options?.join(', ') ?? 'derive from context'}. Criteria: ${criteria?.join(', ') ?? 'derive from context'}. Position at (${x}, ${y}). Use cyan (#7AFCFF) frames and yellow (#FEFF9C) sticky notes.`,
        };
      },
    }),

    findGaps: tool({
      description: 'Analyze the board content for missing topics, unanswered questions, or missing dependencies.',
      inputSchema: zodSchema(
        z.object({
          scope: z.enum(['entire_board', 'selected_frame', 'selected_objects']).describe('Scope of analysis'),
          targetIds: z.array(z.string()).optional().describe('Object/frame IDs if scope is not entire_board'),
          gapTypes: z.array(z.enum(['unexplored_topics', 'unanswered_questions', 'missing_dependencies'])).describe('Types of gaps to find'),
          outputX: z.number().optional().describe('X position for gap notes'),
          outputY: z.number().optional().describe('Y position for gap notes'),
        })
      ),
      execute: async ({ scope, targetIds, gapTypes, outputX = 800, outputY = 100 }: { scope: string; targetIds?: string[]; gapTypes: string[]; outputX?: number; outputY?: number }) => {
        const objects = await restGetObjects(boardId, userToken);
        const relevant =
          scope === 'entire_board'
            ? objects
            : objects.filter((o) => targetIds?.includes(o.id as string) || targetIds?.includes(o.parentFrame as string ?? ''));
        return {
          instruction: `Find gaps (${gapTypes.join(', ')}) in the following ${relevant.length} objects. Create coral (#FFAB91) sticky notes at (${outputX}, ${outputY}) for each gap found. Content: ${JSON.stringify(relevant.slice(0, 20).map((o) => ({ id: o.id, type: o.type, text: o.text })))}`,
        };
      },
    }),

    // -------------------------------------------------------------------------
    // Clarification tool (Mason-only)
    // -------------------------------------------------------------------------

    askClarification: tool({
      description:
        'Ask the user a clarifying question when the command is ambiguous. ' +
        'Call this ONLY when you cannot safely infer intent. ' +
        'This is a terminal action — do not create or modify any objects in the same turn after calling this.',
      inputSchema: zodSchema(
        z.object({
          question: z.string().describe('The specific clarifying question to ask the user'),
        })
      ),
      execute: async ({ question }: { question: string }) => {
        // Return the question so the AI echoes it in its text output using the
        // required sentinel format. The client detects the sentinel to set
        // clarificationPending state and halt the rollback timer.
        return { clarificationSent: true, question };
      },
    }),

    // -------------------------------------------------------------------------
    // Spatial planning tools (Tier 2)
    // -------------------------------------------------------------------------

    findAvailableSpace: tool({
      description:
        'Find a clear rectangular area on the board with no overlapping content. ' +
        'Call this BEFORE createFlowchart or createElementsBatch to get a safe starting position. ' +
        'Always returns a clear position even if the viewport is full (scans offscreen).',
      inputSchema: zodSchema(
        z.object({
          neededWidth: z.number().describe('Required width of the clear area in pixels'),
          neededHeight: z.number().describe('Required height of the clear area in pixels'),
          preferX: z.number().optional().describe('Preferred X search origin (defaults to viewport left)'),
          preferY: z.number().optional().describe('Preferred Y search origin (defaults to viewport top)'),
        })
      ),
      execute: async ({ neededWidth, neededHeight, preferX, preferY }: { neededWidth: number; neededHeight: number; preferX?: number; preferY?: number }) => {
        const occupied = computeOccupiedZones(ctx.boardObjects ?? {});
        const origin = {
          x: preferX ?? ctx.viewportBounds?.x ?? 0,
          y: preferY ?? ctx.viewportBounds?.y ?? 0,
        };
        const pos = findClearRect(occupied, neededWidth, neededHeight, origin);
        return { x: pos.x, y: pos.y, message: `Clear area found at (${pos.x}, ${pos.y})` };
      },
    }),

    createElementsBatch: tool({
      description:
        'Create multiple board objects in one operation. ' +
        'Use this for 4+ objects that are independent (no connectors needed). ' +
        'For flowcharts with connectors, use createFlowchart instead. ' +
        'NEVER use rectangle or circle for items with text body — use stickyNote instead. ' +
        'Pass parentFrameId on each element to bind it to a specific frame.',
      inputSchema: zodSchema(
        z.object({
          elements: z.array(
            z.object({
              type: z.enum(['stickyNote', 'rectangle', 'circle', 'diamond', 'roundedRect', 'text', 'frame']).describe(
                'Object type. stickyNote for any content with text. rectangle/circle: decorative only (no body text). diamond: decision. roundedRect: process step.'
              ),
              text: z.string().optional().describe('Text content. Any text longer than a 1–3 word label forces type to stickyNote automatically.'),
              x: z.number().describe('X coordinate'),
              y: z.number().describe('Y coordinate'),
              width: z.number().optional().describe('Width in pixels'),
              height: z.number().optional().describe('Height in pixels'),
              color: z.string().optional().describe('Fill color as hex'),
              parentFrameId: z.string().optional().describe(
                'objectId of the frame this element belongs to. Coordinates are automatically clamped inside the frame.'
              ),
            })
          ).describe('List of objects to create'),
        })
      ),
      execute: async ({ elements }: { elements: Array<{ type: string; text?: string; x: number; y: number; width?: number; height?: number; color?: string; parentFrameId?: string }> }) => {
        const createdIds: string[] = [];

        await Promise.all(
          elements.map(async (el) => {
            const id = uuidv4();
            const rawType = el.type as ObjectType;
            // Enforce text-body rule: rectangle/circle with text longer than the short-label
            // threshold must become a stickyNote so the content is always visible.
            const hasBodyText = (el.text?.trim().length ?? 0) > TEXT_BODY_THRESHOLD;
            const type: ObjectType =
              (rawType === 'rectangle' || rawType === 'circle') && hasBodyText
                ? 'stickyNote'
                : rawType;
            const defaults =
              type === 'stickyNote'
                ? { width: STICKY_NOTE_DEFAULT.width, height: STICKY_NOTE_DEFAULT.height, color: '#FEFF9C' }
                : type === 'frame'
                ? { width: FRAME_DEFAULTS.width, height: FRAME_DEFAULTS.height, color: FRAME_DEFAULTS.color }
                : type === 'diamond'
                ? { width: 160, height: 120, color: '#FEFF9C' }
                : type === 'roundedRect'
                ? { width: 160, height: 80, color: '#DBEAFE' }
                : type === 'circle'
                ? { width: 100, height: 100, color: '#98FF98' }
                // rectangle: visible light gray instead of invisible white
                : { width: 160, height: 80, color: '#F3F4F6' };

            const rawX = snapToGrid(el.x);
            const rawY = snapToGrid(el.y);
            const snappedW = snapToGrid(el.width ?? defaults.width);
            const snappedH = snapToGrid(el.height ?? defaults.height);

            const { parentFrame, x: finalX, y: finalY } = resolveParentFrameId(
              ctx.boardObjects ?? {},
              rawX,
              rawY,
              snappedW,
              snappedH,
              el.parentFrameId
            );

            await restCreateObject(
              boardId,
              {
                id,
                type,
                text: el.text ?? '',
                x: finalX,
                y: finalY,
                width: snappedW,
                height: snappedH,
                color: el.color ?? defaults.color,
                createdBy: userId,
                isAIGenerated: true,
                isAIPending: true,
                aiCommandId,
                ...(parentFrame ? { parentFrame } : {}),
              },
              userToken
            );
            createdIds.push(id);
          })
        );

        return { createdIds, count: createdIds.length };
      },
    }),

    createFlowchart: tool({
      description:
        'Create a complete flowchart with nodes and directed connectors. ' +
        'Handles BFS layout automatically. Call findAvailableSpace first to get startX/startY. ' +
        'Default node type is stickyNote (shows text). ' +
        'Use shape "diamond" for decisions (yellow #FEFF9C), shape "roundedRect" for process steps (light blue #DBEAFE). ' +
        'Always provide a color — never omit it.',
      inputSchema: zodSchema(
        z.object({
          nodes: z.array(
            z.object({
              id: z.string().describe('Local node id (used for edge from/to references)'),
              label: z.string().describe('Text displayed in the node'),
              shape: z.enum(['stickyNote', 'diamond', 'roundedRect', 'circle', 'rectangle']).optional().describe('Node type. Default: stickyNote. Use diamond for decisions, roundedRect for steps.'),
              color: z.string().optional().describe('Fill color as hex. Default: #FEFF9C for stickyNote/diamond, #DBEAFE for roundedRect, #F3F4F6 for rectangle.'),
            })
          ).describe('Nodes in the flowchart'),
          edges: z.array(
            z.object({
              from: z.string().describe('Source node id'),
              to: z.string().describe('Target node id'),
              label: z.string().optional().describe('Edge label text'),
              directed: z.boolean().optional().describe('Whether to show arrowhead (default true)'),
            })
          ).describe('Edges connecting nodes'),
          startX: z.number().describe('X origin for the layout (use findAvailableSpace result)'),
          startY: z.number().describe('Y origin for the layout (use findAvailableSpace result)'),
          wrapInFrame: z.boolean().optional().describe('Whether to create a frame around the entire flowchart'),
          title: z.string().optional().describe('Frame title if wrapInFrame is true'),
          layoutType: z.enum(['flowchart', 'grid']).optional().describe('Layout algorithm (default flowchart)'),
        })
      ),
      execute: async ({
        nodes,
        edges,
        startX,
        startY,
        wrapInFrame = false,
        title,
        layoutType = 'flowchart',
      }: {
        nodes: Array<{ id: string; label: string; shape?: string; color?: string }>;
        edges: Array<{ from: string; to: string; label?: string; directed?: boolean }>;
        startX: number;
        startY: number;
        wrapInFrame?: boolean;
        title?: string;
        layoutType?: 'flowchart' | 'grid';
      }) => {
        // ── Compute layout ──────────────────────────────────────────────────
        const layoutNodes: LayoutNode[] = nodes.map((n) => ({
          id: n.id,
          label: n.label,
          shape: (n.shape as LayoutNode['shape']) ?? 'rectangle',
        }));
        const layoutEdges: LayoutEdge[] = edges.map((e) => ({
          from: e.from,
          to: e.to,
          label: e.label,
          directed: e.directed ?? true,
        }));

        const layout =
          layoutType === 'grid'
            ? computeGridLayout(layoutNodes, startX, startY)
            : computeFlowchartLayout(layoutNodes, layoutEdges, startX, startY);

        // ── Optional frame FIRST — must exist before child nodes are written ──
        // Creating the frame first lets findContainingFrame (and the explicit
        // parentFrame assignment below) correctly bind nodes to it.
        let frameId: string | undefined;
        const framePad = 40;
        if (wrapInFrame) {
          frameId = uuidv4();
          await restCreateObject(
            boardId,
            {
              id: frameId,
              type: 'frame',
              text: title ?? 'Flowchart',
              x: startX - framePad,
              y: startY - framePad,
              width: layout.totalWidth + framePad * 2,
              height: layout.totalHeight + framePad * 2 + 20, // extra for title bar
              color: FRAME_DEFAULTS.color,
              createdBy: userId,
              isAIGenerated: true,
              isAIPending: true,
              aiCommandId,
            },
            userToken
          );
        }

        // ── Create shapes (parallel) ────────────────────────────────────────
        // Maps caller's local node id → Firestore object id
        const nodeIdMap = new Map<string, string>();

        await Promise.all(
          nodes.map(async (n) => {
            const pos = layout.nodes.get(n.id);
            if (!pos) return;

            const firestoreId = uuidv4();
            nodeIdMap.set(n.id, firestoreId);

            // Map shape hint to ObjectType.
            // Default to stickyNote so labeled nodes are always visible and show text.
            const shapeType: ObjectType =
              n.shape === 'diamond'
                ? 'diamond'
                : n.shape === 'roundedRect'
                ? 'roundedRect'
                : n.shape === 'circle'
                ? 'circle'
                : n.shape === 'rectangle'
                ? 'rectangle'
                : 'stickyNote';

            // Enforce text-body rule: rectangle/circle with labels exceeding the short-label
            // threshold are converted to stickyNote so the text is always rendered.
            const effectiveShapeType: ObjectType =
              (shapeType === 'rectangle' || shapeType === 'circle') &&
              (n.label?.trim().length ?? 0) > TEXT_BODY_THRESHOLD
                ? 'stickyNote'
                : shapeType;

            // Per-type sensible color defaults — white on a white board is invisible.
            const defaultColor =
              effectiveShapeType === 'diamond' ? '#FEFF9C'       // yellow decision
              : effectiveShapeType === 'roundedRect' ? '#DBEAFE' // light blue process step
              : effectiveShapeType === 'circle' ? '#98FF98'      // green terminal
              : effectiveShapeType === 'rectangle' ? '#F3F4F6'   // light gray
              : '#FEFF9C';                                         // stickyNote yellow

            // Use the just-created frameId directly so nodes are always bound to the
            // enclosing flowchart frame. Fall back to spatial detection when no frame.
            const parentFrame = frameId ?? findContainingFrame(ctx.boardObjects ?? {}, pos.x, pos.y, pos.width, pos.height);
            await restCreateObject(
              boardId,
              {
                id: firestoreId,
                type: effectiveShapeType,
                text: n.label,
                x: pos.x,
                y: pos.y,
                width: pos.width,
                height: pos.height,
                color: n.color ?? defaultColor,
                createdBy: userId,
                isAIGenerated: true,
                isAIPending: true,
                aiCommandId,
                ...(parentFrame ? { parentFrame } : {}),
              },
              userToken
            );
          })
        );

        // ── Create connectors (parallel, after shapes) ──────────────────────
        const edgeIds: string[] = [];

        await Promise.all(
          edges.map(async (e) => {
            const fromId = nodeIdMap.get(e.from);
            const toId = nodeIdMap.get(e.to);
            if (!fromId || !toId) return;

            const id = uuidv4();
            edgeIds.push(id);

            await restCreateObject(
              boardId,
              {
                id,
                type: 'connector',
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                color: CONNECTOR_DEFAULTS.color,
                connectedTo: [fromId, toId],
                endEffect: (e.directed ?? true) ? 'arrow' : 'none',
                ...(e.label ? { text: e.label } : {}),
                createdBy: userId,
                isAIGenerated: true,
                isAIPending: true,
                aiCommandId,
              },
              userToken
            );
          })
        );

        const nodeIds = Array.from(nodeIdMap.values());
        return {
          frameId,
          nodeIds,
          edgeIds,
          nodeCount: nodeIds.length,
          edgeCount: edgeIds.length,
          totalWidth: layout.totalWidth,
          totalHeight: layout.totalHeight,
        };
      },
    }),
  };
}

