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
import type { ObjectType, ConnectorStyle } from '@/lib/types';
import { STICKY_NOTE_DEFAULT, FRAME_DEFAULTS, CONNECTOR_DEFAULTS } from '@/lib/types';

interface ToolContext {
  boardId: string;
  userId: string;
  aiCommandId: string;
  /** Firebase ID token used to authenticate Firestore REST API calls. */
  userToken: string;
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
      description: 'Create a sticky note on the board with text, position, and color.',
      inputSchema: zodSchema(
        z.object({
          text: z.string().describe('Text content of the sticky note'),
          x: z.number().describe('X coordinate (will be snapped to 20px grid)'),
          y: z.number().describe('Y coordinate (will be snapped to 20px grid)'),
          color: z.string().describe('Background color as hex (e.g. #FEFF9C) or named color'),
        })
      ),
      execute: async ({ text, x, y, color }: { text: string; x: number; y: number; color: string }) => {
        const coords = validateCoordinates(snapToGrid(x), snapToGrid(y));
        const id = uuidv4();
        await restCreateObject(boardId, {
          id,
          type: 'stickyNote',
          text,
          x: coords.x,
          y: coords.y,
          width: STICKY_NOTE_DEFAULT.width,
          height: STICKY_NOTE_DEFAULT.height,
          color,
          createdBy: userId,
          isAIGenerated: true,
          isAIPending: true,
          aiCommandId,
        }, userToken);
        return { success: true, objectId: id };
      },
    }),

    createShape: tool({
      description: 'Create a rectangle or circle shape on the board.',
      inputSchema: zodSchema(
        z.object({
          type: z.enum(['rectangle', 'circle']).describe('Shape type'),
          x: z.number().describe('X coordinate'),
          y: z.number().describe('Y coordinate'),
          width: z.number().optional().describe('Width in pixels (default 100)'),
          height: z.number().optional().describe('Height in pixels (default 100)'),
          color: z.string().describe('Fill color as hex'),
        })
      ),
      execute: async ({ type, x, y, width = 100, height = 100, color }: { type: 'rectangle' | 'circle'; x: number; y: number; width?: number; height?: number; color: string }) => {
        const coords = validateCoordinates(snapToGrid(x), snapToGrid(y));
        const clamped = clampSize(type as ObjectType, width, height);
        const id = uuidv4();
        await restCreateObject(boardId, {
          id,
          type,
          x: coords.x,
          y: coords.y,
          width: snapToGrid(clamped.width),
          height: snapToGrid(clamped.height),
          color,
          createdBy: userId,
          isAIGenerated: true,
          isAIPending: true,
          aiCommandId,
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
        })
      ),
      execute: async ({ fromObjectId, toObjectId, style = 'solid', color = CONNECTOR_DEFAULTS.color, label }: { fromObjectId: string; toObjectId: string; style?: string; color?: string; label?: string }) => {
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
  };
}
