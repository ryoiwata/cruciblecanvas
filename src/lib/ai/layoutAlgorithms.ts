/**
 * layoutAlgorithms.ts — pure spatial layout computation for the Mason AI agent.
 * No side effects — takes node/edge descriptions, returns pixel positions.
 * Used by the createFlowchart tool (server-side) to produce deterministic
 * BFS rank-based layouts without needing another LLM call.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface LayoutNode {
  /** Caller-supplied identifier (used for edge from/to resolution). */
  id: string;
  label: string;
  /** Shape hint. Diamond nodes are rendered taller (decision diamonds). */
  shape?: 'rectangle' | 'diamond' | 'roundedRect' | 'circle';
  width?: number;
  height?: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  label?: string;
  directed?: boolean;
}

export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  /** Map from LayoutNode.id to pixel position. */
  nodes: Map<string, NodeLayout>;
  totalWidth: number;
  totalHeight: number;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const GRID_SNAP = 20;

function snap(value: number): number {
  return Math.round(value / GRID_SNAP) * GRID_SNAP;
}

// ---------------------------------------------------------------------------
// Flowchart layout — BFS rank-based
// ---------------------------------------------------------------------------

/**
 * Computes a top-down flowchart layout using BFS rank assignment.
 *
 * Algorithm:
 * 1. Build in-degree map from edges.
 * 2. BFS from root nodes (in-degree === 0) → assign rank (layer index).
 * 3. Group nodes by rank; sort within rank by BFS discovery order.
 * 4. Center each rank horizontally around the widest rank.
 * 5. Assign Y by rank index × (nodeH + vGap).
 * 6. Snap all coordinates to 20px grid.
 *
 * Diamond nodes receive 1.5× height to accommodate the wider shape.
 */
export function computeFlowchartLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  originX: number,
  originY: number,
  nodeW = 160,
  nodeH = 80,
  hGap = 60,
  vGap = 80
): LayoutResult {
  if (nodes.length === 0) {
    return { nodes: new Map(), totalWidth: 0, totalHeight: 0 };
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // ── Step 1: in-degree count ───────────────────────────────────────────────
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // ── Step 2: adjacency list ────────────────────────────────────────────────
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
  }

  // ── Step 3: BFS rank assignment ───────────────────────────────────────────
  const rank = new Map<string, number>();
  const discoveryOrder = new Map<string, number>();
  let discoveryCtr = 0;
  const queue: string[] = [];

  // Roots: nodes with in-degree 0
  for (const n of nodes) {
    if (inDegree.get(n.id) === 0) {
      queue.push(n.id);
      rank.set(n.id, 0);
      discoveryOrder.set(n.id, discoveryCtr++);
    }
  }

  // If no roots exist (cycle), treat all nodes as rank 0
  if (queue.length === 0) {
    for (const n of nodes) {
      queue.push(n.id);
      rank.set(n.id, 0);
      discoveryOrder.set(n.id, discoveryCtr++);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentRank = rank.get(current) ?? 0;
    for (const neighbor of adj.get(current) ?? []) {
      const existingRank = rank.get(neighbor);
      const newRank = currentRank + 1;
      if (existingRank === undefined || newRank > existingRank) {
        rank.set(neighbor, newRank);
      }
      if (!discoveryOrder.has(neighbor)) {
        discoveryOrder.set(neighbor, discoveryCtr++);
        queue.push(neighbor);
      }
    }
  }

  // Assign any unvisited nodes (disconnected components) to rank 0
  for (const n of nodes) {
    if (!rank.has(n.id)) {
      rank.set(n.id, 0);
      discoveryOrder.set(n.id, discoveryCtr++);
    }
  }

  // ── Step 4: Group by rank ─────────────────────────────────────────────────
  const maxRank = Math.max(...Array.from(rank.values()));
  const rankGroups: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of nodes) {
    rankGroups[rank.get(n.id) ?? 0].push(n.id);
  }
  // Sort within rank by BFS discovery order for left-to-right stability
  for (const group of rankGroups) {
    group.sort((a, b) => (discoveryOrder.get(a) ?? 0) - (discoveryOrder.get(b) ?? 0));
  }

  // ── Step 5: Calculate widths and positions ────────────────────────────────
  // Per-node effective dimensions (diamonds are taller)
  function effectiveH(nodeId: string): number {
    const n = nodeMap.get(nodeId);
    const baseH = n?.height ?? nodeH;
    return n?.shape === 'diamond' ? Math.round(baseH * 1.5) : baseH;
  }
  function effectiveW(nodeId: string): number {
    return nodeMap.get(nodeId)?.width ?? nodeW;
  }

  // Max rank height (tallest node in rank determines row height)
  const rankH = rankGroups.map((group) => Math.max(...group.map(effectiveH), nodeH));

  // Total rank widths
  const rankWidths = rankGroups.map((group) => {
    const totalW = group.reduce((sum, id) => sum + effectiveW(id), 0);
    const gaps = (group.length - 1) * hGap;
    return totalW + gaps;
  });

  const maxRankWidth = Math.max(...rankWidths, nodeW);

  const result = new Map<string, NodeLayout>();
  let currentY = originY;

  for (let r = 0; r <= maxRank; r++) {
    const group = rankGroups[r];
    const rankWidth = rankWidths[r];
    // Center this rank horizontally around maxRankWidth midpoint
    let currentX = originX + Math.round((maxRankWidth - rankWidth) / 2);

    for (const id of group) {
      const w = effectiveW(id);
      const h = effectiveH(id);
      result.set(id, {
        x: snap(currentX),
        y: snap(currentY),
        width: snap(w),
        height: snap(h),
      });
      currentX += w + hGap;
    }

    currentY += rankH[r] + vGap;
  }

  const totalWidth = snap(maxRankWidth);
  const totalHeight = snap(currentY - originY - vGap); // subtract trailing gap

  return { nodes: result, totalWidth, totalHeight };
}

// ---------------------------------------------------------------------------
// Grid layout
// ---------------------------------------------------------------------------

/**
 * Arranges nodes in a uniform grid. Column count defaults to sqrt(N) rounded up.
 */
export function computeGridLayout(
  nodes: LayoutNode[],
  originX: number,
  originY: number,
  cols?: number,
  nodeW = 160,
  nodeH = 80,
  hGap = 40,
  vGap = 40
): LayoutResult {
  if (nodes.length === 0) {
    return { nodes: new Map(), totalWidth: 0, totalHeight: 0 };
  }

  const c = cols ?? Math.ceil(Math.sqrt(nodes.length));
  const result = new Map<string, NodeLayout>();

  for (let i = 0; i < nodes.length; i++) {
    const col = i % c;
    const row = Math.floor(i / c);
    const n = nodes[i];
    const w = n.width ?? nodeW;
    const h = n.height ?? nodeH;
    result.set(n.id, {
      x: snap(originX + col * (w + hGap)),
      y: snap(originY + row * (h + vGap)),
      width: snap(w),
      height: snap(h),
    });
  }

  const rows = Math.ceil(nodes.length / c);
  const totalWidth = snap(c * (nodeW + hGap) - hGap);
  const totalHeight = snap(rows * (nodeH + vGap) - vGap);

  return { nodes: result, totalWidth, totalHeight };
}
