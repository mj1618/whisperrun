import { TileType, getTile, isWalkableWithDoors } from "@/game/map";
import { findPath } from "@/game/pathfinding";

export type DoorState = { x: number; y: number; open: boolean };

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

// --- Noise Detection Constants ---
export const NOISE_RADIUS_RUNNING = 3.5; // tiles — walking at normal speed
export const NOISE_COOLDOWN = 4000; // ms — minimum time between noise alerts per guard

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
  noiseCooldownUntil?: number;
}

export interface RunnerData {
  x: number;
  y: number;
  crouching: boolean;
  hiding: boolean;
  moving: boolean;
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
  noiseCooldownUntil?: number;
}

// --- Alert Escalation Constants ---

export const GUARD_ALERT_RADIUS = 8; // tiles — how far a guard's alert carries
export const GUARD_ESCALATION_COOLDOWN = 8000; // ms — prevent repeated cascading from same source

export interface EscalationEvent {
  sourceGuardId: string;
  targetGuardId: string;
  alertX: number;
  alertY: number;
  timestamp: number;
}

/**
 * After ticking all guards individually, check for alert escalation:
 * If any guard just transitioned to "alert" state this tick, nearby guards
 * in "patrol" or "returning" state become "suspicious" toward the alert location.
 *
 * Returns a list of escalation events (for visual/audio feedback).
 */
export function processAlertEscalation(
  previousStates: Map<string, GuardState>,
  currentGuards: GuardData[],
  now: number,
  escalationCooldowns: Map<string, number>,
  alertRadius?: number
): EscalationEvent[] {
  const radius = alertRadius ?? GUARD_ALERT_RADIUS;
  if (radius <= 0) return [];

  const events: EscalationEvent[] = [];

  for (const guard of currentGuards) {
    const prevState = previousStates.get(guard.id);

    // Check if this guard just became alert (transition from non-alert → alert)
    const justBecameAlert = guard.state === "alert" && prevState !== "alert";
    if (!justBecameAlert) continue;

    // This guard raised the alarm — check nearby guards
    for (const other of currentGuards) {
      if (other.id === guard.id) continue;

      // Only escalate to guards that are currently patrolling or returning
      if (other.state !== "patrol" && other.state !== "returning") continue;

      // Check cooldown — don't repeatedly escalate to the same guard
      const cooldownKey = `${guard.id}->${other.id}`;
      const cooldownUntil = escalationCooldowns.get(cooldownKey);
      if (cooldownUntil && now < cooldownUntil) continue;

      // Distance check (in tiles)
      const dx = other.x - guard.x;
      const dy = other.y - guard.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      // Escalate! Make the other guard suspicious toward the alert location
      const alertX = guard.lastKnownX ?? guard.x;
      const alertY = guard.lastKnownY ?? guard.y;

      other.state = "suspicious";
      other.lastKnownX = alertX;
      other.lastKnownY = alertY;
      other.stateTimer = now;

      // Set cooldown
      escalationCooldowns.set(cooldownKey, now + GUARD_ESCALATION_COOLDOWN);

      events.push({
        sourceGuardId: guard.id,
        targetGuardId: other.id,
        alertX,
        alertY,
        timestamp: now,
      });
    }
  }

  return events;
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

// --- Camera Constants ---

export const CAMERA_FOV = 90; // degrees — wider than guards
export const CAMERA_RANGE = 7; // tiles
export const CAMERA_CROUCH_RANGE = 5; // tiles — cameras less affected by crouching
export const CAMERA_SWEEP_SPEED = 0.8; // radians per second
export const CAMERA_SWEEP_ARC = Math.PI / 2; // ±45° from base angle
export const CAMERA_ALERT_COOLDOWN = 5000; // ms between alerts from the same camera

export interface CameraData {
  id: string;
  x: number;
  y: number;
  baseAngle: number;
}

/** Optional difficulty-based overrides for guard AI behavior */
export interface GuardDifficultyConfig {
  guardSpeed?: number;
  guardAlertSpeed?: number;
  guardRange?: number;
  guardCrouchRange?: number;
  cameraRange?: number;
  cameraSweepSpeed?: number;
}

/** Compute camera sweep angle. Cameras oscillate back and forth (sinusoidal). */
export function updateCameraAngle(
  baseAngle: number,
  elapsed: number, // total elapsed time in seconds since heist start
  sweepSpeed?: number
): number {
  return baseAngle + Math.sin(elapsed * (sweepSpeed ?? CAMERA_SWEEP_SPEED)) * CAMERA_SWEEP_ARC;
}

/** Check if a camera can see the Runner */
export function canCameraSeeRunner(
  camera: { x: number; y: number; angle: number },
  runner: RunnerData,
  map: TileType[][],
  doors?: DoorState[],
  diffConfig?: GuardDifficultyConfig
): boolean {
  if (runner.hiding) return false;

  const dx = runner.x - camera.x;
  const dy = runner.y - camera.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const camRange = diffConfig?.cameraRange ?? CAMERA_RANGE;
  const range = runner.crouching ? camRange - 2 : camRange;
  if (dist > range) return false;

  const angleToRunner = Math.atan2(dy, dx);
  const diff = Math.abs(angleDiff(angleToRunner, camera.angle));
  const halfFovRad = ((CAMERA_FOV * Math.PI) / 180) / 2;
  if (diff > halfFovRad) return false;

  if (!isLineOfSightClear(camera.x, camera.y, runner.x, runner.y, map, doors)) {
    return false;
  }

  return true;
}

/** Convert a facing direction string to radians */
export function facingToAngle(facing?: "up" | "down" | "left" | "right"): number {
  switch (facing) {
    case "up": return -Math.PI / 2;
    case "down": return Math.PI / 2;
    case "left": return Math.PI;
    case "right": return 0;
    default: return 0;
  }
}

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
  map: TileType[][],
  doors?: DoorState[]
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / 0.4);

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    const col = Math.floor(cx);
    const row = Math.floor(cy);
    const tile = getTile(map, col, row);
    if (tile === TileType.Wall) return false;
    if (tile === TileType.Door && doors) {
      const door = doors.find((d) => d.x === col && d.y === row);
      if (door && !door.open) return false;
    }
  }
  return true;
}

export function canGuardSeeRunner(
  guard: { x: number; y: number; angle: number },
  runner: RunnerData,
  map: TileType[][],
  doors?: DoorState[],
  diffConfig?: GuardDifficultyConfig
): boolean {
  // Hidden runners are invisible
  if (runner.hiding) return false;

  const dx = runner.x - guard.x;
  const dy = runner.y - guard.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Range check (reduced when crouching)
  const range = runner.crouching
    ? (diffConfig?.guardCrouchRange ?? GUARD_CROUCH_RANGE)
    : (diffConfig?.guardRange ?? GUARD_RANGE);
  if (dist > range) return false;

  // FOV check
  const angleToRunner = Math.atan2(dy, dx);
  const diff = Math.abs(angleDiff(angleToRunner, guard.angle));
  const halfFovRad = ((GUARD_FOV * Math.PI) / 180) / 2;
  if (diff > halfFovRad) return false;

  // Wall and closed-door occlusion check
  if (!isLineOfSightClear(guard.x, guard.y, runner.x, runner.y, map, doors)) {
    return false;
  }

  return true;
}

/**
 * Check if a guard can hear the Runner's footsteps.
 * Noise is omnidirectional but blocked by walls.
 * Only triggers for moving, non-crouching, non-hiding runners.
 */
export function canGuardHearRunner(
  guard: { x: number; y: number; state: GuardState },
  runner: RunnerData,
  map: TileType[][],
  doors?: DoorState[]
): boolean {
  if (!runner.moving) return false;
  if (runner.crouching) return false;
  if (runner.hiding) return false;
  if (guard.state !== "patrol" && guard.state !== "returning") return false;

  const dx = runner.x - guard.x;
  const dy = runner.y - guard.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > NOISE_RADIUS_RUNNING) return false;

  if (!isLineOfSightClear(guard.x, guard.y, runner.x, runner.y, map, doors)) {
    return false;
  }

  return true;
}

// --- Movement ---

function canGuardMoveTo(x: number, y: number, map: TileType[][], doors?: DoorState[]): boolean {
  const corners = [
    { col: Math.floor(x - GUARD_HITBOX_HALF), row: Math.floor(y - GUARD_HITBOX_HALF) },
    { col: Math.floor(x + GUARD_HITBOX_HALF), row: Math.floor(y - GUARD_HITBOX_HALF) },
    { col: Math.floor(x - GUARD_HITBOX_HALF), row: Math.floor(y + GUARD_HITBOX_HALF) },
    { col: Math.floor(x + GUARD_HITBOX_HALF), row: Math.floor(y + GUARD_HITBOX_HALF) },
  ];
  return corners.every((c) => isWalkableWithDoors(map, c.col, c.row, doors));
}

/** Check if guard's next position would enter a closed door tile, and if so, open it */
function guardOpenDoors(x: number, y: number, doors: DoorState[], map: TileType[][]): boolean {
  let opened = false;
  // Check the tiles the guard's hitbox touches
  const corners = [
    { col: Math.floor(x - GUARD_HITBOX_HALF), row: Math.floor(y - GUARD_HITBOX_HALF) },
    { col: Math.floor(x + GUARD_HITBOX_HALF), row: Math.floor(y - GUARD_HITBOX_HALF) },
    { col: Math.floor(x - GUARD_HITBOX_HALF), row: Math.floor(y + GUARD_HITBOX_HALF) },
    { col: Math.floor(x + GUARD_HITBOX_HALF), row: Math.floor(y + GUARD_HITBOX_HALF) },
  ];
  for (const c of corners) {
    if (getTile(map, c.col, c.row) === TileType.Door) {
      const door = doors.find((d) => d.x === c.col && d.y === c.row);
      if (door && !door.open) {
        door.open = true;
        opened = true;
      }
    }
  }
  return opened;
}

function moveToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  speed: number,
  dt: number,
  map: TileType[][],
  doors?: DoorState[]
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
  if (canGuardMoveTo(tryX, fromY, map, doors)) {
    newX = tryX;
  }

  const tryY = fromY + ny * step;
  if (canGuardMoveTo(newX, tryY, map, doors)) {
    newY = tryY;
  }

  const angle = Math.atan2(dy, dx);
  return { x: newX, y: newY, angle };
}

// --- A* Path Cache ---

const guardPathCache = new Map<string, {
  path: Array<{ x: number; y: number }>;
  goalX: number;
  goalY: number;
  pathIndex: number;
  computedAt: number;
}>();

export function clearGuardPaths(): void {
  guardPathCache.clear();
}

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

  const needsRecompute =
    !cached ||
    Math.abs(cached.goalX - goalX) > 0.5 ||
    Math.abs(cached.goalY - goalY) > 0.5 ||
    now - cached.computedAt > 2000 ||
    cached.pathIndex >= cached.path.length;

  if (needsRecompute) {
    const path = findPath(guard.x, guard.y, goalX, goalY, map, doors);
    if (!path || path.length === 0) {
      // No path found or already at goal — fall back to direct movement
      return moveToward(guard.x, guard.y, goalX, goalY, speed, dt, map, doors);
    }
    cached = { path, goalX, goalY, pathIndex: 0, computedAt: now };
    guardPathCache.set(cacheKey, cached);
  }

  // After the recompute block, cached is guaranteed to be defined
  // (if it was undefined, needsRecompute was true and we either returned or assigned)
  const entry = cached!;

  // Follow the path: move toward current waypoint
  const wp = entry.path[entry.pathIndex];
  const dx = wp.x - guard.x;
  const dy = wp.y - guard.y;
  const distToWp = Math.sqrt(dx * dx + dy * dy);

  // If close to current waypoint, advance to next
  if (distToWp < 0.3) {
    entry.pathIndex++;
    if (entry.pathIndex >= entry.path.length) {
      // Reached end of path
      return { x: guard.x, y: guard.y, angle: Math.atan2(goalY - guard.y, goalX - guard.x) };
    }
    // Target next waypoint this frame
    const nextWp = entry.path[entry.pathIndex];
    return moveToward(guard.x, guard.y, nextWp.x, nextWp.y, speed, dt, map, doors);
  }

  // Move toward current path waypoint using existing collision logic
  return moveToward(guard.x, guard.y, wp.x, wp.y, speed, dt, map, doors);
}

// --- State Machine ---

export function tickGuard(
  guard: GuardData,
  runner: RunnerData,
  dt: number,
  map: TileType[][],
  now: number,
  waypoints?: Array<{ x: number; y: number }>,
  doors?: DoorState[],
  diffConfig?: GuardDifficultyConfig
): GuardUpdate {
  const wps = waypoints ?? DEFAULT_GUARD_WAYPOINTS[guard.id] ?? [];
  const canSee = canGuardSeeRunner(guard, runner, map, doors, diffConfig);
  const patrolSpeed = diffConfig?.guardSpeed ?? GUARD_SPEED;
  const chaseSpeed = diffConfig?.guardAlertSpeed ?? GUARD_ALERT_SPEED;

  switch (guard.state) {
    case "patrol": {
      // If guard sees runner → go alert
      if (canSee) {
        guardPathCache.delete(guard.id);
        return {
          x: guard.x,
          y: guard.y,
          angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
          state: "alert",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: runner.x,
          lastKnownY: runner.y,
          stateTimer: now,
          noiseCooldownUntil: guard.noiseCooldownUntil,
        };
      }

      // If guard hears runner → go suspicious (investigate noise source)
      const canHearPatrol = canGuardHearRunner(guard, runner, map, doors);
      const noiseCooldownOkPatrol = !guard.noiseCooldownUntil || now >= guard.noiseCooldownUntil;
      if (canHearPatrol && noiseCooldownOkPatrol) {
        guardPathCache.delete(guard.id);
        return {
          x: guard.x,
          y: guard.y,
          angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
          state: "suspicious",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: runner.x,
          lastKnownY: runner.y,
          stateTimer: now,
          noiseCooldownUntil: now + NOISE_COOLDOWN,
        };
      }

      if (wps.length === 0) {
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "patrol",
          targetWaypoint: 0,
          noiseCooldownUntil: guard.noiseCooldownUntil,
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
            noiseCooldownUntil: guard.noiseCooldownUntil,
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
          noiseCooldownUntil: guard.noiseCooldownUntil,
        };
      }

      // Guard opens closed doors in its path before moving
      if (doors) guardOpenDoors(guard.x, guard.y, doors, map);

      // Move toward current waypoint using A* pathfinding
      const moved = moveAlongPath(guard, wp.x, wp.y, patrolSpeed, dt, map, now, doors);

      // Open any door the guard enters
      if (doors) guardOpenDoors(moved.x, moved.y, doors, map);

      return {
        x: moved.x,
        y: moved.y,
        angle: moved.angle,
        state: "patrol",
        targetWaypoint: guard.targetWaypoint,
        stateTimer: guard.stateTimer,
        noiseCooldownUntil: guard.noiseCooldownUntil,
      };
    }

    case "suspicious": {
      // If guard sees runner → go alert
      if (canSee) {
        guardPathCache.delete(guard.id);
        return {
          x: guard.x,
          y: guard.y,
          angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
          state: "alert",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: runner.x,
          lastKnownY: runner.y,
          stateTimer: now,
          noiseCooldownUntil: guard.noiseCooldownUntil,
        };
      }

      const lkx = guard.lastKnownX ?? guard.x;
      const lky = guard.lastKnownY ?? guard.y;
      const distToLk = Math.hypot(lkx - guard.x, lky - guard.y);

      if (distToLk < 0.5) {
        // Arrived at suspicious spot — wait for duration, then return to patrol
        const timer = guard.stateTimer ?? now;
        if (now - timer >= SUSPICIOUS_DURATION) {
          guardPathCache.delete(guard.id);
          return {
            x: guard.x,
            y: guard.y,
            angle: guard.angle,
            state: "returning",
            targetWaypoint: guard.targetWaypoint,
            stateTimer: now,
            noiseCooldownUntil: guard.noiseCooldownUntil,
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
          noiseCooldownUntil: guard.noiseCooldownUntil,
        };
      }

      // Move toward last known position using A* pathfinding
      if (doors) guardOpenDoors(guard.x, guard.y, doors, map);
      const moved = moveAlongPath(guard, lkx, lky, patrolSpeed, dt, map, now, doors);
      if (doors) guardOpenDoors(moved.x, moved.y, doors, map);
      return {
        x: moved.x,
        y: moved.y,
        angle: moved.angle,
        state: "suspicious",
        targetWaypoint: guard.targetWaypoint,
        lastKnownX: lkx,
        lastKnownY: lky,
        stateTimer: guard.stateTimer,
        noiseCooldownUntil: guard.noiseCooldownUntil,
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
          noiseCooldownUntil: guard.noiseCooldownUntil,
        };
      }

      // Alert duration timeout → returning
      if (now - timer >= ALERT_DURATION) {
        guardPathCache.delete(guard.id);
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "returning",
          targetWaypoint: guard.targetWaypoint,
          stateTimer: now,
          noiseCooldownUntil: guard.noiseCooldownUntil,
        };
      }

      // Arrived at last known position and can't see runner → wait 2s then return
      const distToLk = Math.hypot(lkx - guard.x, lky - guard.y);
      if (distToLk < 0.5 && !canSee) {
        // Check if we've been at the spot for 2s
        // Use a heuristic: if stateTimer is well before now minus a buffer, transition
        if (now - timer >= ALERT_DURATION / 3) {
          guardPathCache.delete(guard.id);
          return {
            x: guard.x,
            y: guard.y,
            angle: guard.angle,
            state: "returning",
            targetWaypoint: guard.targetWaypoint,
            stateTimer: now,
            noiseCooldownUntil: guard.noiseCooldownUntil,
          };
        }
      }

      // Move toward last known position using A* pathfinding
      if (doors) guardOpenDoors(guard.x, guard.y, doors, map);
      const moved = moveAlongPath(guard, lkx, lky, chaseSpeed, dt, map, now, doors);
      if (doors) guardOpenDoors(moved.x, moved.y, doors, map);
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
        noiseCooldownUntil: guard.noiseCooldownUntil,
      };
    }

    case "returning": {
      // If guard sees runner while returning → go alert
      if (canSee) {
        guardPathCache.delete(guard.id);
        return {
          x: guard.x,
          y: guard.y,
          angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
          state: "alert",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: runner.x,
          lastKnownY: runner.y,
          stateTimer: now,
          noiseCooldownUntil: guard.noiseCooldownUntil,
        };
      }

      // If guard hears runner → go suspicious
      const canHearReturning = canGuardHearRunner(guard, runner, map, doors);
      const noiseCooldownOkReturning = !guard.noiseCooldownUntil || now >= guard.noiseCooldownUntil;
      if (canHearReturning && noiseCooldownOkReturning) {
        guardPathCache.delete(guard.id);
        return {
          x: guard.x,
          y: guard.y,
          angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
          state: "suspicious",
          targetWaypoint: guard.targetWaypoint,
          lastKnownX: runner.x,
          lastKnownY: runner.y,
          stateTimer: now,
          noiseCooldownUntil: now + NOISE_COOLDOWN,
        };
      }

      // Find nearest waypoint to return to
      if (wps.length === 0) {
        guardPathCache.delete(guard.id);
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "patrol",
          targetWaypoint: 0,
          stateTimer: now,
          noiseCooldownUntil: guard.noiseCooldownUntil,
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
        guardPathCache.delete(guard.id);
        const nextWp = (nearestIdx + 1) % wps.length;
        return {
          x: guard.x,
          y: guard.y,
          angle: guard.angle,
          state: "patrol",
          targetWaypoint: nextWp,
          stateTimer: now,
          noiseCooldownUntil: guard.noiseCooldownUntil,
        };
      }

      if (doors) guardOpenDoors(guard.x, guard.y, doors, map);
      const moved = moveAlongPath(guard, wp.x, wp.y, patrolSpeed, dt, map, now, doors);
      if (doors) guardOpenDoors(moved.x, moved.y, doors, map);
      return {
        x: moved.x,
        y: moved.y,
        angle: moved.angle,
        state: "returning",
        targetWaypoint: guard.targetWaypoint,
        noiseCooldownUntil: guard.noiseCooldownUntil,
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
