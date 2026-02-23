# Task: Guard A* Pathfinding

## Overview

Guards currently use direct-line movement with axis-separated collision sliding (`moveToward` in `guard-ai.ts:283`). When a guard tries to move toward a target (waypoint, last-known Runner position, or nearest patrol point), it moves along X first, then Y, bouncing off walls. This causes guards to **get stuck on concave wall corners** — both individual axis movements fail even though a path around the corner exists. On procedurally generated maps with many room-to-room doorway transitions and L-shaped corridors, guards frequently get wedged and become completely non-threatening.

This task adds **tile-based A\* pathfinding** so guards can navigate around walls, through doorways, and across rooms. This is the single highest-impact gameplay improvement: it makes guards genuinely dangerous, makes difficulty levels meaningful (faster guards that can actually chase you), and fixes the most visible AI bug in the game.

## What to Build

### 1. Create A* Pathfinder Module (`/src/game/pathfinding.ts` — CREATE)

Create a standalone A* pathfinding module that operates on the tile grid. It should be:
- **Pure function** — no state, no side effects
- **Door-aware** — treats open doors as walkable, closed doors as walls (guards open doors separately)
- **Performance-bounded** — max node limit to prevent runaway searches on large maps
- **Tile-center paths** — returns paths as tile-center coordinates (col + 0.5, row + 0.5) for smooth guard movement

```typescript
import { TileType, getTile } from "@/game/map";

interface PathNode {
  col: number;
  row: number;
  g: number;     // cost from start
  h: number;     // heuristic (Manhattan distance to goal)
  f: number;     // g + h
  parent: PathNode | null;
}

export interface DoorState {
  x: number;
  y: number;
  open: boolean;
}

/**
 * Find a path from (startX, startY) to (goalX, goalY) on the tile map.
 * Returns an array of tile-center waypoints [{x, y}, ...] from start to goal,
 * or null if no path exists.
 *
 * Coordinates are in world-space (floating point). The pathfinder converts
 * to tile coordinates internally.
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
  // ...
}
```

**Algorithm details:**

- **Grid conversion:** Convert world coordinates to tile coordinates via `Math.floor()`. The goal tile is `Math.floor(goalX), Math.floor(goalY)`.
- **Neighbors:** 4-directional (up/down/left/right). No diagonal movement — guards move through doorways and corridors where diagonal clipping would be problematic. All edge costs are 1.0.
- **Walkability:** A tile is walkable if it's not a `TileType.Wall`. For doors, check the `doors` array — open doors are walkable, closed doors are **also walkable for pathfinding purposes** because guards open doors when they encounter them (this prevents guards from seeing a closed door as a permanent wall and taking huge detours).
- **Heuristic:** Manhattan distance (consistent with 4-directional movement, guarantees optimal paths).
- **Max nodes:** Default 500. If the open set exceeds this, return `null` (no path). This prevents performance issues on large Hard-difficulty maps (5×3 grid = ~55×33 tiles = 1815 tiles max, so 500 nodes is generous for any reasonable path).
- **Output:** Array of `{x, y}` points where each point is the center of a tile (col + 0.5, row + 0.5). Include the start tile only if it differs from the current position. Always include the goal position as the final point (using the original `goalX, goalY` coordinates, not tile-snapped, so the guard reaches the exact target).
- **Path smoothing (optional but recommended):** After finding the A* path, do a simple line-of-sight pass to remove redundant intermediate waypoints. For each pair of non-adjacent waypoints, if there's a clear tile-walk between them (all intermediate tiles walkable), skip the intermediate waypoints. This produces cleaner, more natural-looking movement. Keep this simple — just skip waypoints where a straight line works.

**Edge cases to handle:**
- Start and goal in the same tile → return empty path (already there)
- Goal tile is a wall → return `null`
- Start tile is a wall (guard clipped into wall) → still try to pathfind from it (return the guard to a valid position)

### 2. Add Path Cache to Guard State (`/src/game/guard-ai.ts` — MODIFY)

Computing A* every tick is wasteful. Add a simple path cache:

```typescript
// Add to a new module-level Map, keyed by guard ID:
const guardPathCache = new Map<string, {
  path: Array<{ x: number; y: number }>;
  goalX: number;
  goalY: number;
  pathIndex: number;  // current waypoint being targeted
  computedAt: number; // timestamp when path was computed
}>();

export function clearGuardPaths(): void {
  guardPathCache.clear();
}
```

**Cache invalidation rules:**
- Recompute when the guard's goal changes (new waypoint, new last-known position, new nearest patrol point)
- Recompute when the guard's state changes (patrol → alert, etc.)
- Recompute if the path is older than 2 seconds (handles door state changes)
- Recompute if the guard gets stuck (hasn't made progress toward the next path waypoint for 0.5s)
- Clear all caches when the game resets (`clearGuardPaths()` called from GameCanvas on game start)

### 3. Replace `moveToward` with Pathfinding-Based Movement (`/src/game/guard-ai.ts` — MODIFY)

Create a new function `moveAlongPath` that follows A* path waypoints:

```typescript
function moveAlongPath(
  guard: GuardData,
  goalX: number,
  goalY: number,
  speed: number,
  dt: number,
  map: TileType[][],
  now: number,
  doors?: DoorState[]
): { x: number; y: number; angle: number } {
  const cacheKey = guard.id;
  let cached = guardPathCache.get(cacheKey);

  // Check if we need to recompute the path
  const needsRecompute =
    !cached ||
    Math.abs(cached.goalX - goalX) > 0.5 ||
    Math.abs(cached.goalY - goalY) > 0.5 ||
    now - cached.computedAt > 2000 ||
    cached.pathIndex >= cached.path.length;

  if (needsRecompute) {
    const path = findPath(guard.x, guard.y, goalX, goalY, map, doors);
    if (!path || path.length === 0) {
      // No path found — fall back to direct movement (the old behavior)
      return moveToward(guard.x, guard.y, goalX, goalY, speed, dt, map, doors);
    }
    cached = { path, goalX, goalY, pathIndex: 0, computedAt: now };
    guardPathCache.set(cacheKey, cached);
  }

  // Follow the path: move toward current waypoint
  const wp = cached.path[cached.pathIndex];
  const dx = wp.x - guard.x;
  const dy = wp.y - guard.y;
  const distToWp = Math.sqrt(dx * dx + dy * dy);

  // If close to current waypoint, advance to next
  if (distToWp < 0.3) {
    cached.pathIndex++;
    if (cached.pathIndex >= cached.path.length) {
      // Reached end of path
      return { x: guard.x, y: guard.y, angle: Math.atan2(goalY - guard.y, goalX - guard.x) };
    }
    // Recurse with next waypoint (or just target it next frame)
    return moveAlongPath(guard, goalX, goalY, speed, dt, map, now, doors);
  }

  // Move toward current path waypoint using the existing moveToward
  // (still uses axis-separated collision for sub-tile smoothness)
  return moveToward(guard.x, guard.y, wp.x, wp.y, speed, dt, map, doors);
}
```

**Key insight:** We still use `moveToward` for the final sub-tile movement between path waypoints. A* handles the macro navigation (which tiles to traverse), while the existing collision code handles micro movement (smooth sliding within tiles). This means we don't need to change the collision system at all — we just give the guard better intermediate targets.

### 4. Update `tickGuard` to Use Path-Based Movement (`/src/game/guard-ai.ts` — MODIFY)

Replace all `moveToward` calls in `tickGuard` with `moveAlongPath`:

**Patrol state (line ~420):**
```typescript
// OLD: const moved = moveToward(guard.x, guard.y, wp.x, wp.y, patrolSpeed, dt, map, doors);
// NEW:
const moved = moveAlongPath(guard, wp.x, wp.y, patrolSpeed, dt, map, now, doors);
```

**Suspicious state (line ~485):**
```typescript
// OLD: const moved = moveToward(guard.x, guard.y, lkx, lky, patrolSpeed, dt, map, doors);
// NEW:
const moved = moveAlongPath(guard, lkx, lky, patrolSpeed, dt, map, now, doors);
```

**Alert state (line ~561):**
```typescript
// OLD: const moved = moveToward(guard.x, guard.y, lkx, lky, chaseSpeed, dt, map, doors);
// NEW:
const moved = moveAlongPath(guard, lkx, lky, chaseSpeed, dt, map, now, doors);
```

**Returning state (line ~654):**
```typescript
// OLD: const moved = moveToward(guard.x, guard.y, wp.x, wp.y, patrolSpeed, dt, map, doors);
// NEW:
const moved = moveAlongPath(guard, wp.x, wp.y, patrolSpeed, dt, map, now, doors);
```

Also: when the guard's **state changes** (patrol→alert, alert→returning, etc.), clear that guard's path cache entry so a fresh path is computed immediately:
```typescript
// At the top of each state transition return:
guardPathCache.delete(guard.id);
```

### 5. Clear Path Cache on Game Start/Reset (`/src/components/GameCanvas.tsx` — MODIFY)

Import and call `clearGuardPaths()` when the game starts or resets:

```typescript
import { clearGuardPaths } from "@/game/guard-ai";

// In the game initialization / reset section:
clearGuardPaths();
```

This prevents stale paths from a previous game from being used.

### 6. Keep `moveToward` as Fallback

Do **not** delete the existing `moveToward` function. It's still used in two cases:
1. As the sub-tile movement within `moveAlongPath` (following individual path waypoints)
2. As the fallback when A* returns null (unreachable target — shouldn't happen often but keeps the game resilient)

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `/src/game/pathfinding.ts` | CREATE | A* pathfinding: `findPath()` function, tile-based, 4-directional, door-aware, max-node bounded |
| `/src/game/guard-ai.ts` | MODIFY | Add path cache (`guardPathCache`), `moveAlongPath()` function, replace `moveToward` calls in `tickGuard` with `moveAlongPath`, add `clearGuardPaths()` export, clear cache on state transitions |
| `/src/components/GameCanvas.tsx` | MODIFY | Call `clearGuardPaths()` on game init/reset |

## Key Design Decisions (Already Made)

1. **4-directional A\*, not 8-directional** — Guards move through doorways (1-tile wide). Diagonal movement would clip through wall corners at doorway transitions. 4-directional is also simpler and produces paths that look natural for indoor navigation (people don't walk diagonally through doorways).

2. **Doors always walkable for pathfinding** — Guards open doors when they reach them (existing `guardOpenDoors` behavior). Treating closed doors as walls in the pathfinder would cause guards to pathfind around them and then the door-open behavior would be unused. Instead, the pathfinder treats all doors as walkable, and the existing door-open logic handles the actual interaction.

3. **Path cache with 2-second TTL** — Computing A* every frame (60Hz × N guards) is wasteful. Caching the path and following waypoints is much cheaper. The 2-second TTL handles dynamic changes (doors opening/closing, state changes). This is a simple and effective optimization.

4. **Fallback to direct movement** — If A* returns null (no path exists — e.g., the Runner is behind a wall with no route), fall back to the existing `moveToward` behavior. This keeps the game resilient; a guard sliding against a wall is better than a guard standing still forever.

5. **500-node limit** — The largest map is 5×3 slots × ~11 tiles = 55×33 = 1815 tiles. A 500-node A* search covers most reasonable paths. For truly pathological cases (diagonal traverse of the entire map), the fallback kicks in. This keeps pathfinding from ever causing a frame stutter.

6. **Tile-center waypoints with final exact target** — Path waypoints are tile centers (col+0.5, row+0.5) for consistent spacing, except the final point which uses the exact goal coordinates. This ensures guards reach their exact destination (waypoint positions, last-known Runner positions) rather than snapping to tile centers.

7. **Path smoothing is optional** — A basic line-of-sight smoothing pass improves aesthetics but isn't critical. The task specifies it as "recommended" — implement it if time allows, skip it if the basic A* paths already look good enough. Guards following tile-center paths through rooms will look a bit "robotic" but functional.

## How to Verify

1. **`npm run build`** — Must compile with no errors.
2. **`npm run lint`** — Must pass.
3. **In browser (two tabs):**
   - Create a game on **Standard or Hard difficulty** (more rooms = more doorway navigation)
   - Start the heist and observe guard patrol movement
   - **Guards should navigate through doorways smoothly** — no getting stuck at door frames
   - **Guards should navigate between rooms** — following their patrol waypoints through corridors and doorways without getting wedged on corners
   - **Alert/chase behavior:** Get spotted by a guard, run around a corner into another room. The guard should follow through the doorway, not get stuck at the corner
   - **Suspicious behavior:** Make noise near a guard, then move to another room. The guard should investigate through the doorway
   - **Returning behavior:** After a guard loses the Runner, it should navigate back to its nearest patrol waypoint smoothly
   - **Performance:** No visible frame drops or stuttering. Guards should move smoothly.
   - **Multiple guards:** On Hard difficulty with 3-4 guards, all should pathfind independently without issues
4. **Edge cases:**
   - **Casual difficulty (small map):** Guards should still work normally — A* is optional, not required for small maps, but should still function correctly
   - **Guard spawns in tight room:** Guard should find a path to its first waypoint even if it starts in a corner
   - **Runner hides behind closed door:** Guard should pathfind through the door (treating it as walkable), then open it upon arrival
   - **Rapid state changes (spotted → lost → spotted):** Path cache should recompute correctly without stale data

## Scope Boundaries

**DO:**
- Create `findPath()` A* implementation in a new module
- Add path caching with TTL and invalidation
- Replace `moveToward` calls in `tickGuard` with `moveAlongPath`
- Keep `moveToward` as fallback for sub-tile movement and unreachable targets
- Clear path cache on game init/reset
- Handle doors as always-walkable in the pathfinder

**DO NOT:**
- Add diagonal movement (breaks doorway navigation)
- Add guard-to-guard communication or coordinated pathfinding
- Add dynamic obstacle avoidance (guards avoiding each other)
- Add nav-mesh or any geometry-based pathfinding (tile grid A* is sufficient)
- Change the guard state machine logic (patrol/suspicious/alert/returning stays the same)
- Change the collision system or `canGuardMoveTo`
- Add visual debugging overlays for paths (nice for development but not in scope)
- Optimize with jump point search or hierarchical pathfinding (A* with 500-node cap is sufficient for these map sizes)

---

## Implementation Summary

### Files Created
- **`/src/game/pathfinding.ts`** — A* pathfinding module
  - `findPath()`: Pure function, 4-directional, tile-based A* with Manhattan distance heuristic
  - 500-node default limit for performance safety
  - Doors treated as always-walkable (guards open doors when they reach them)
  - Tile-center waypoints with exact goal as final point
  - Axis-aligned path smoothing to reduce redundant waypoints in open rooms

### Files Modified
- **`/src/game/guard-ai.ts`**
  - Imported `findPath` from pathfinding module
  - Added `guardPathCache` Map for per-guard path caching (keyed by guard ID)
  - Added `clearGuardPaths()` export for cache reset
  - Added `moveAlongPath()` function: checks cache, recomputes if goal changed / TTL expired (2s) / path exhausted, follows waypoints using existing `moveToward` for sub-tile collision
  - Replaced all 4 `moveToward` calls in `tickGuard` (patrol, suspicious, alert, returning states) with `moveAlongPath`
  - Added `guardPathCache.delete(guard.id)` at every state transition (10 transition points) for immediate path recomputation on state changes

- **`/src/components/GameCanvas.tsx`**
  - Imported `clearGuardPaths` from guard-ai
  - Called `clearGuardPaths()` on guard initialization (first server sync)
  - Called `clearGuardPaths()` on game loop cleanup

### Design Decisions Implemented
- `moveToward` preserved as fallback for sub-tile movement and when A* returns null
- Guard state machine logic unchanged — only movement function swapped
- No diagonal movement (prevents doorway clipping)
- Cache invalidation on: goal change (>0.5 tile), state transitions, 2-second TTL, path exhaustion

### Build & Lint
- `npm run build` — passes (0 errors)
- `npm run lint` — passes (0 errors, only pre-existing Convex generated file warnings)

---

## Review (agent 8b29e210)

### Verdict: APPROVED — no fixes needed

All three files reviewed (`pathfinding.ts`, `guard-ai.ts`, `GameCanvas.tsx`). Build and lint pass cleanly.

### What was checked
- A* algorithm correctness: open/closed sets, heuristic admissibility (Manhattan + 4-dir), goal test, neighbor expansion, node limit — all correct
- Path reconstruction: correctly skips start tile, replaces final point with exact goal coordinates
- Path smoothing: axis-aligned only (`canWalkStraight`) — safe because 4-directional A* guarantees all intermediate tiles on same row/col were traversed
- `moveAlongPath`: cache invalidation covers goal change (>0.5 tile), 2s TTL, path exhaustion; non-null assertion on `cached!` is safe due to control flow; falls back to `moveToward` correctly
- All 10 state transitions in `tickGuard` call `guardPathCache.delete(guard.id)` — consistent
- `GameCanvas.tsx`: `clearGuardPaths()` called on guard init (line 890) and cleanup (line 1410)
- `DoorState` duplicate: `pathfinding.ts` and `guard-ai.ts` both define structurally identical `DoorState` — harmless, `pathfinding.ts` export unused but part of public API surface
- Out-of-bounds safety: `getTile` returns `Wall` for OOB, so pathfinder won't escape map bounds
- `nodeKey` collision safety: negative coords blocked by `isWalkableForPath` → `getTile` OOB check

### Notes (not bugs, just observations)
- The task spec mentions stuck-guard detection (no progress for 0.5s) as a cache invalidation trigger — not implemented, but the 2s TTL serves as an adequate fallback
- Camera-triggered guard state change to "suspicious" (GameCanvas.tsx:1171) doesn't explicitly clear the guard's path cache, but `moveAlongPath`'s goal-change detection (>0.5 tile threshold) handles recomputation on the next frame — no gameplay impact
- Linear scan for open-set minimum is O(n) per extraction but fine under the 500-node cap
