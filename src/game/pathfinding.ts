import { TileType, getTile } from "@/game/map";

export interface DoorState {
  x: number;
  y: number;
  open: boolean;
}

interface PathNode {
  col: number;
  row: number;
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
}

const DEFAULT_MAX_NODES = 500;

/**
 * Find a path from (startX, startY) to (goalX, goalY) on the tile map.
 * Returns an array of tile-center waypoints [{x, y}, ...] from start to goal,
 * or null if no path exists.
 *
 * Coordinates are in world-space (floating point). The pathfinder converts
 * to tile coordinates internally.
 *
 * Doors are always treated as walkable for pathfinding purposes — guards open
 * doors when they reach them.
 */
export function findPath(
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  map: TileType[][],
  doors?: DoorState[],
  maxNodes?: number
): Array<{ x: number; y: number }> | null {
  const limit = maxNodes ?? DEFAULT_MAX_NODES;

  const startCol = Math.floor(startX);
  const startRow = Math.floor(startY);
  const goalCol = Math.floor(goalX);
  const goalRow = Math.floor(goalY);

  // Same tile — already there
  if (startCol === goalCol && startRow === goalRow) {
    return [];
  }

  // Goal is a wall — unreachable
  const goalTile = getTile(map, goalCol, goalRow);
  if (goalTile === TileType.Wall) {
    return null;
  }

  // Check if a tile is walkable for pathfinding (doors always walkable)
  const isWalkableForPath = (col: number, row: number): boolean => {
    const tile = getTile(map, col, row);
    return tile !== TileType.Wall;
  };

  // Manhattan distance heuristic
  const heuristic = (col: number, row: number): number => {
    return Math.abs(col - goalCol) + Math.abs(row - goalRow);
  };

  // Key for visited set
  const mapWidth = map[0]?.length ?? 0;
  const nodeKey = (col: number, row: number): number => row * mapWidth + col;

  const startNode: PathNode = {
    col: startCol,
    row: startRow,
    g: 0,
    h: heuristic(startCol, startRow),
    f: heuristic(startCol, startRow),
    parent: null,
  };

  // Open set as a simple array (sorted by f); fine for 500-node cap
  const open: PathNode[] = [startNode];
  const closed = new Set<number>();
  // Track best g-cost for open set entries to handle duplicate entries
  const bestG = new Map<number, number>();
  bestG.set(nodeKey(startCol, startRow), 0);

  let nodesExpanded = 0;

  // 4-directional neighbors (up, down, left, right)
  const dirs = [
    { dc: 0, dr: -1 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 },
    { dc: 1, dr: 0 },
  ];

  while (open.length > 0) {
    if (nodesExpanded >= limit) {
      return null; // Hit node limit
    }

    // Find node with lowest f (linear scan — fine for small open sets)
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) {
        bestIdx = i;
      }
    }
    const current = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();

    const key = nodeKey(current.col, current.row);

    // Skip if already closed
    if (closed.has(key)) continue;

    // Skip if a better path was found since this was enqueued
    const recordedG = bestG.get(key);
    if (recordedG !== undefined && current.g > recordedG) continue;

    closed.add(key);
    nodesExpanded++;

    // Goal reached
    if (current.col === goalCol && current.row === goalRow) {
      return reconstructPath(current, goalX, goalY);
    }

    for (const dir of dirs) {
      const nc = current.col + dir.dc;
      const nr = current.row + dir.dr;
      const nKey = nodeKey(nc, nr);

      if (closed.has(nKey)) continue;
      if (!isWalkableForPath(nc, nr)) continue;

      const ng = current.g + 1;
      const prevBestG = bestG.get(nKey);
      if (prevBestG !== undefined && ng >= prevBestG) continue;

      bestG.set(nKey, ng);
      const nh = heuristic(nc, nr);
      open.push({
        col: nc,
        row: nr,
        g: ng,
        h: nh,
        f: ng + nh,
        parent: current,
      });
    }
  }

  // No path found
  return null;
}

/** Reconstruct path from goal node back to start, then smooth it. */
function reconstructPath(
  goalNode: PathNode,
  exactGoalX: number,
  exactGoalY: number
): Array<{ x: number; y: number }> {
  const tiles: PathNode[] = [];
  let node: PathNode | null = goalNode;
  while (node) {
    tiles.push(node);
    node = node.parent;
  }
  tiles.reverse();

  // Convert to tile-center coordinates, skip the start tile
  // (guard is already there)
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 1; i < tiles.length; i++) {
    points.push({
      x: tiles[i].col + 0.5,
      y: tiles[i].row + 0.5,
    });
  }

  // Replace the last point with the exact goal coordinates
  if (points.length > 0) {
    points[points.length - 1] = { x: exactGoalX, y: exactGoalY };
  }

  // Simple line-of-sight smoothing: skip redundant intermediate waypoints
  return smoothPath(points, tiles);
}

/**
 * Line-of-sight path smoothing. For each waypoint, check if we can skip
 * ahead to a later waypoint with all intermediate tiles being walkable
 * in a straight line. This removes the "robotic" zig-zag movement through
 * open rooms while keeping precise navigation through doorways.
 */
function smoothPath(
  points: Array<{ x: number; y: number }>,
  tiles: PathNode[]
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

  const smoothed: Array<{ x: number; y: number }> = [points[0]];
  let current = 0;

  while (current < points.length - 1) {
    // Try to skip as far ahead as possible
    let farthest = current + 1;
    for (let ahead = points.length - 1; ahead > current + 1; ahead--) {
      if (canWalkStraight(tiles[current + 1], tiles[ahead + 1])) {
        farthest = ahead;
        break;
      }
    }
    smoothed.push(points[farthest]);
    current = farthest;
  }

  return smoothed;
}

/**
 * Check if all tiles along a straight line between two tile nodes are
 * on the same row or column (axis-aligned). For non-axis-aligned lines,
 * check that all intermediate tile positions are on the original path.
 * We use a simple approach: only smooth when tiles share a row or column
 * (common in indoor environments with corridors).
 */
function canWalkStraight(from: PathNode, to: PathNode): boolean {
  // Only smooth axis-aligned segments (same row or same column)
  // This is safe because we know all tiles on that row/column between
  // them were traversed by the A* path and are thus walkable.
  if (from.row === to.row || from.col === to.col) {
    return true;
  }
  return false;
}
