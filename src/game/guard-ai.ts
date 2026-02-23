import { TileType, getTile, isWalkable } from "@/game/map";

// --- Constants ---

export const GUARD_SPEED = 2.0; // tiles/sec (patrol / returning)
export const GUARD_ALERT_SPEED = 2.8; // tiles/sec (chasing)
export const GUARD_FOV = 60; // degrees
export const GUARD_RANGE = 5; // tiles
export const GUARD_CROUCH_RANGE = 3; // tiles (Runner crouching)
export const CATCH_DISTANCE = 0.6; // tiles — catch threshold
export const SUSPICIOUS_DURATION = 3000; // ms
export const ALERT_DURATION = 6000; // ms — chase timeout
export const WAYPOINT_PAUSE = 1000; // ms — pause at each waypoint
const GUARD_HITBOX_HALF = 0.3;

// --- Types ---

export type GuardState = "patrol" | "suspicious" | "alert" | "returning";

export interface GuardData {
  id: string;
  x: number;
  y: number;
  angle: number;
  state: GuardState;
  targetWaypoint: number;
  lastKnownX?: number;
  lastKnownY?: number;
  stateTimer?: number;
}

export interface RunnerData {
  x: number;
  y: number;
  crouching: boolean;
  hiding: boolean;
}

export interface GuardUpdate {
  x: number;
  y: number;
  angle: number;
  state: GuardState;
  targetWaypoint: number;
  lastKnownX?: number;
  lastKnownY?: number;
  stateTimer?: number;
  caught?: boolean;
}

// --- Default Patrol Waypoints (fallback for legacy maps) ---

export const DEFAULT_GUARD_WAYPOINTS: Record<string, Array<{ x: number; y: number }>> = {
  "guard-1": [
    { x: 3, y: 12 },
    { x: 3, y: 13 },
    { x: 16, y: 13 },
    { x: 16, y: 12 },
    { x: 9, y: 12 },
  ],
};

// --- Helpers ---

function angleDiff(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

function isLineOfSightClear(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  map: TileType[][]
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / 0.4);

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    const tile = getTile(map, Math.floor(cx), Math.floor(cy));
    if (tile === TileType.Wall) return false;
  }
  return true;
}

export function canGuardSeeRunner(
  guard: { x: number; y: number; angle: number },
  runner: RunnerData,
  map: TileType[][]
): boolean {
  // Hidden runners are invisible
  if (runner.hiding) return false;

  const dx = runner.x - guard.x;
  const dy = runner.y - guard.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Range check (reduced when crouching)
  const range = runner.crouching ? GUARD_CROUCH_RANGE : GUARD_RANGE;
  if (dist > range) return false;

  // FOV check
  const angleToRunner = Math.atan2(dy, dx);
  const diff = Math.abs(angleDiff(angleToRunner, guard.angle));
  const halfFovRad = ((GUARD_FOV * Math.PI) / 180) / 2;
  if (diff > halfFovRad) return false;

  // Wall occlusion check
  if (!isLineOfSightClear(guard.x, guard.y, runner.x, runner.y, map)) {
    return false;
  }

  return true;
}

// --- Movement ---

function canGuardMoveTo(x: number, y: number, map: TileType[][]): boolean {
  const corners = [
    { col: Math.floor(x - GUARD_HITBOX_HALF), row: Math.floor(y - GUARD_HITBOX_HALF) },
    { col: Math.floor(x + GUARD_HITBOX_HALF), row: Math.floor(y - GUARD_HITBOX_HALF) },
    { col: Math.floor(x - GUARD_HITBOX_HALF), row: Math.floor(y + GUARD_HITBOX_HALF) },
    { col: Math.floor(x + GUARD_HITBOX_HALF), row: Math.floor(y + GUARD_HITBOX_HALF) },
  ];
  return corners.every((c) => isWalkable(map, c.col, c.row));
}

function moveToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  speed: number,
  dt: number,
  map: TileType[][]
): { x: number; y: number; angle: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.01) {
    return { x: fromX, y: fromY, angle: Math.atan2(dy, dx) };
  }

  const nx = dx / dist;
  const ny = dy / dist;
  const step = Math.min(speed * dt, dist);

  let newX = fromX;
  let newY = fromY;

  // Axis-separated collision: try X first, then Y
  const tryX = fromX + nx * step;
  if (canGuardMoveTo(tryX, fromY, map)) {
    newX = tryX;
  }

  const tryY = fromY + ny * step;
  if (canGuardMoveTo(newX, tryY, map)) {
    newY = tryY;
  }

  const angle = Math.atan2(dy, dx);
  return { x: newX, y: newY, angle };
}

// --- State Machine ---

export function tickGuard(
  guard: GuardData,
  runner: RunnerData,
  dt: number,
  map: TileType[][],
  now: number,
  waypoints?: Array<{ x: number; y: number }>
): GuardUpdate {
  const wps = waypoints ?? DEFAULT_GUARD_WAYPOINTS[guard.id] ?? [];
  const canSee = canGuardSeeRunner(guard, runner, map);

  switch (guard.state) {
    case "patrol": {
      // If guard sees runner → go alert
      if (canSee) {
        return {
          x: guard.x,
          y: guard.y,
          angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
          state: "alert",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: runner.x,
          lastKnownY: runner.y,
          stateTimer: now,
        };
      }

      if (wps.length === 0) {
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "patrol",
          targetWaypoint: 0,
        };
      }

      const wp = wps[guard.targetWaypoint % wps.length];
      const distToWp = Math.hypot(wp.x - guard.x, wp.y - guard.y);

      if (distToWp < 0.3) {
        // At waypoint — check if we've paused long enough
        const timer = guard.stateTimer ?? now;
        if (now - timer >= WAYPOINT_PAUSE) {
          // Advance to next waypoint
          const nextWp = (guard.targetWaypoint + 1) % wps.length;
          return {
            x: guard.x,
            y: guard.y,
            angle: guard.angle,
            state: "patrol",
            targetWaypoint: nextWp,
            stateTimer: now,
          };
        }
        // Still pausing
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "patrol",
          targetWaypoint: guard.targetWaypoint,
          stateTimer: timer,
        };
      }

      // Move toward current waypoint
      const moved = moveToward(guard.x, guard.y, wp.x, wp.y, GUARD_SPEED, dt, map);
      return {
        x: moved.x,
        y: moved.y,
        angle: moved.angle,
        state: "patrol",
        targetWaypoint: guard.targetWaypoint,
        stateTimer: guard.stateTimer,
      };
    }

    case "suspicious": {
      // If guard sees runner → go alert
      if (canSee) {
        return {
          x: guard.x,
          y: guard.y,
          angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
          state: "alert",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: runner.x,
          lastKnownY: runner.y,
          stateTimer: now,
        };
      }

      const lkx = guard.lastKnownX ?? guard.x;
      const lky = guard.lastKnownY ?? guard.y;
      const distToLk = Math.hypot(lkx - guard.x, lky - guard.y);

      if (distToLk < 0.5) {
        // Arrived at suspicious spot — wait for duration, then return to patrol
        const timer = guard.stateTimer ?? now;
        if (now - timer >= SUSPICIOUS_DURATION) {
          return {
            x: guard.x,
            y: guard.y,
            angle: guard.angle,
            state: "returning",
            targetWaypoint: guard.targetWaypoint,
            stateTimer: now,
          };
        }
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "suspicious",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: lkx,
          lastKnownY: lky,
          stateTimer: timer,
        };
      }

      // Move toward last known position
      const moved = moveToward(guard.x, guard.y, lkx, lky, GUARD_SPEED, dt, map);
      return {
        x: moved.x,
        y: moved.y,
        angle: moved.angle,
        state: "suspicious",
        targetWaypoint: guard.targetWaypoint,
        lastKnownX: lkx,
        lastKnownY: lky,
        stateTimer: guard.stateTimer,
      };
    }

    case "alert": {
      // Continuously update last known if we can still see the runner
      let lkx = guard.lastKnownX ?? runner.x;
      let lky = guard.lastKnownY ?? runner.y;
      if (canSee) {
        lkx = runner.x;
        lky = runner.y;
      }

      const timer = guard.stateTimer ?? now;

      // Check catch
      const distToRunner = Math.hypot(runner.x - guard.x, runner.y - guard.y);
      if (distToRunner < CATCH_DISTANCE && !runner.hiding) {
        return {
          x: guard.x,
          y: guard.y,
          angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
          state: "alert",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: lkx,
          lastKnownY: lky,
          stateTimer: timer,
          caught: true,
        };
      }

      // Alert duration timeout → returning
      if (now - timer >= ALERT_DURATION) {
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "returning",
          targetWaypoint: guard.targetWaypoint,
          stateTimer: now,
        };
      }

      // Arrived at last known position and can't see runner → wait 2s then return
      const distToLk = Math.hypot(lkx - guard.x, lky - guard.y);
      if (distToLk < 0.5 && !canSee) {
        // Check if we've been at the spot for 2s
        // Use a heuristic: if stateTimer is well before now minus a buffer, transition
        if (now - timer >= ALERT_DURATION / 3) {
          return {
            x: guard.x,
            y: guard.y,
            angle: guard.angle,
            state: "returning",
            targetWaypoint: guard.targetWaypoint,
            stateTimer: now,
          };
        }
      }

      // Move toward last known position
      const moved = moveToward(guard.x, guard.y, lkx, lky, GUARD_ALERT_SPEED, dt, map);
      const faceAngle = canSee
        ? Math.atan2(runner.y - guard.y, runner.x - guard.x)
        : moved.angle;

      return {
        x: moved.x,
        y: moved.y,
        angle: faceAngle,
        state: "alert",
        targetWaypoint: guard.targetWaypoint,
        lastKnownX: lkx,
        lastKnownY: lky,
        stateTimer: timer,
      };
    }

    case "returning": {
      // If guard sees runner while returning → go alert
      if (canSee) {
        return {
          x: guard.x,
          y: guard.y,
          angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
          state: "alert",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: runner.x,
          lastKnownY: runner.y,
          stateTimer: now,
        };
      }

      // Find nearest waypoint to return to
      if (wps.length === 0) {
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "patrol",
          targetWaypoint: 0,
          stateTimer: now,
        };
      }

      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < wps.length; i++) {
        const d = Math.hypot(wps[i].x - guard.x, wps[i].y - guard.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }

      const wp = wps[nearestIdx];
      const distToWp = Math.hypot(wp.x - guard.x, wp.y - guard.y);

      if (distToWp < 0.3) {
        // Reached waypoint → resume patrol at next waypoint
        const nextWp = (nearestIdx + 1) % wps.length;
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "patrol",
          targetWaypoint: nextWp,
          stateTimer: now,
        };
      }

      const moved = moveToward(guard.x, guard.y, wp.x, wp.y, GUARD_SPEED, dt, map);
      return {
        x: moved.x,
        y: moved.y,
        angle: moved.angle,
        state: "returning",
        targetWaypoint: guard.targetWaypoint,
      };
    }

    default:
      return {
        x: guard.x,
        y: guard.y,
        angle: guard.angle,
        state: "patrol",
        targetWaypoint: guard.targetWaypoint,
      };
  }
}
