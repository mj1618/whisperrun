# Task: Guard AI & Detection (Milestone 5)

## Overview

Build the guard AI system — the core threat that makes the game tense and fun. Guards patrol waypoint loops, have vision cones that detect the Runner, chase when alerted, and catch the Runner on overlap. Detection is **server-authoritative** (validated in Convex) so neither client can cheat.

After this milestone, the game has real stakes: the Runner must sneak past moving guards with vision cones, hide to avoid detection, and escape before getting caught. The Whisper's guidance (pings) becomes essential because they can see guard positions and patrol routes the Runner can't.

**Dependencies:** Milestone 3 (Runner Gameplay) must be complete — Runner movement, game state sync, and basic entity rendering are needed. This task is independent of Milestone 4 (Whisper Gameplay) — guards work regardless of whether the Whisper view is implemented yet.

## What to Build

### 1. Schema Update (`/convex/schema.ts` — MODIFY)

Add fields to the guard object in the gameState table to support chase behavior:

```typescript
guards: v.array(v.object({
  id: v.string(),
  x: v.number(),
  y: v.number(),
  angle: v.number(),
  state: v.union(
    v.literal("patrol"),
    v.literal("suspicious"),
    v.literal("alert"),
    v.literal("returning")
  ),
  targetWaypoint: v.number(),
  // NEW fields:
  lastKnownX: v.optional(v.number()),  // Where guard last saw the Runner
  lastKnownY: v.optional(v.number()),
  stateTimer: v.optional(v.number()),   // Timestamp when current state started (for timeouts)
})),
```

Also update the `startGame` mutation in `rooms.ts` to include the new fields in the initial guard data.

### 2. Guard AI Logic (`/src/game/guard-ai.ts` — NEW FILE)

This is the core AI module. It runs on the client that drives guard updates (see section 4 for the tick mechanism), computes new guard positions and states, and sends the results to Convex.

#### Constants

```typescript
export const GUARD_SPEED = 2.0;        // tiles/sec (slightly slower than Runner walk of 3)
export const GUARD_ALERT_SPEED = 2.8;  // tiles/sec when chasing (still slower than Runner walk)
export const GUARD_FOV = 60;           // degrees
export const GUARD_RANGE = 5;          // tiles
export const GUARD_CROUCH_RANGE = 3;   // tiles (reduced when Runner is crouching)
export const CATCH_DISTANCE = 0.6;     // tiles — if guard is this close while alert, Runner is caught
export const SUSPICIOUS_DURATION = 3000; // ms — how long guard investigates
export const ALERT_DURATION = 6000;     // ms — how long guard chases before giving up
export const WAYPOINT_PAUSE = 1000;     // ms — pause at each waypoint
```

#### Patrol Waypoints

Define waypoints for the test map guard. The guard at (9, 12) should patrol the bottom corridor:

```typescript
export const GUARD_WAYPOINTS: Record<string, Array<{ x: number; y: number }>> = {
  "guard-1": [
    { x: 3, y: 12 },   // Left side of corridor
    { x: 3, y: 13 },   // Bottom-left
    { x: 16, y: 13 },  // Bottom-right
    { x: 16, y: 12 },  // Right side
    { x: 9, y: 12 },   // Back to center
  ],
};
```

The guard walks from waypoint to waypoint in order, then loops back to the start.

#### Vision Cone Check

```typescript
export function canGuardSeeRunner(
  guard: { x: number; y: number; angle: number },
  runner: { x: number; y: number; crouching: boolean; hiding: boolean },
  map: TileType[][]
): boolean
```

Logic:
1. If Runner is hiding → **always false** (hidden runners are invisible)
2. Calculate distance from guard to Runner
3. If distance > GUARD_RANGE (or GUARD_CROUCH_RANGE if Runner is crouching) → false
4. Calculate angle from guard to Runner: `Math.atan2(runner.y - guard.y, runner.x - guard.x)`
5. Check if this angle is within ±(GUARD_FOV/2) of the guard's facing angle (handle wraparound!)
6. **Wall occlusion**: Cast a ray from guard to Runner. Step along the ray in small increments (~0.5 tiles). At each step, check if the tile is a Wall. If any wall tile is hit before reaching the Runner → false (wall blocks vision). Use `getTile()` from the map module.
7. If all checks pass → **true**, guard can see the Runner

#### Guard State Machine

```typescript
export interface GuardUpdate {
  x: number;
  y: number;
  angle: number;
  state: "patrol" | "suspicious" | "alert" | "returning";
  targetWaypoint: number;
  lastKnownX?: number;
  lastKnownY?: number;
  stateTimer?: number;
}

export function tickGuard(
  guard: GuardState,
  runner: RunnerState,
  dt: number,  // seconds
  map: TileType[][],
  now: number  // Date.now()
): GuardUpdate
```

State transitions:

**patrol:**
- Move toward current target waypoint at `GUARD_SPEED`
- Face the direction of movement (update `angle`)
- When within 0.3 tiles of waypoint AND `stateTimer` indicates enough pause time has passed, advance `targetWaypoint` (modulo waypoint count)
- If `canGuardSeeRunner()` → transition to **alert**, record `lastKnownX/Y` as Runner's position, set `stateTimer = now`

**suspicious:** (heard something or edge-of-vision — for MVP, we skip this state and go directly from patrol to alert. Include the state for future use but don't trigger it yet.)
- Move toward `lastKnownX/Y` at `GUARD_SPEED`
- When arriving at the spot (within 0.5 tiles), wait for `SUSPICIOUS_DURATION` then return to **patrol**
- If `canGuardSeeRunner()` → transition to **alert**

**alert:**
- **Continuously update `lastKnownX/Y`** if guard can still see the Runner (track the Runner in real-time)
- Move toward `lastKnownX/Y` at `GUARD_ALERT_SPEED`
- Face toward the Runner (or last known position)
- If guard reaches `lastKnownX/Y` (within 0.5 tiles) AND cannot see Runner → wait 2 seconds, then transition to **returning**
- If `ALERT_DURATION` has elapsed since entering alert state → transition to **returning**
- **Catch check**: if distance to Runner < `CATCH_DISTANCE` → Runner is caught (return a special signal or let the server mutation handle it)

**returning:**
- Move back toward the nearest waypoint at `GUARD_SPEED`
- When reaching the waypoint (within 0.3 tiles), transition to **patrol** with `targetWaypoint` set to the next one in the loop
- If `canGuardSeeRunner()` → transition to **alert** again

#### Movement Helper

```typescript
function moveToward(
  fromX: number, fromY: number,
  toX: number, toY: number,
  speed: number, dt: number,
  map: TileType[][]
): { x: number; y: number; angle: number }
```

- Calculate direction vector, normalize it
- Move `speed * dt` tiles in that direction
- Use axis-separated collision (same as Runner): try X, then Y. Guards use a similar hitbox (~0.3 tile half-width).
- If blocked, try sliding along the axis that isn't blocked
- Return new position and facing angle

### 3. Guard Tick Mutation (`/convex/game.ts` — MODIFY)

Add a new mutation for updating guard positions:

#### `tickGuards` (mutation)
- Args: `{ roomId: v.id("rooms"), guards: v.array(guardObjectValidator) }`
- The client computes new guard positions locally and sends them to the server
- Server validates and stores the new guard state
- **Detection check (server-authoritative):** After updating guard positions, the server runs its OWN catch check:
  - For each guard in "alert" state, check if distance to runner < `CATCH_DISTANCE`
  - If caught AND Runner is not hiding: set `phase = "caught"`, update room status to `"finished"`
  - This double-check ensures the server is the authority on catch, even if the client AI is slightly out of sync

Also add a `catchRunner` check at the end of `tickGuards`:
```typescript
// Server-authoritative catch check
const runner = gameState.runner;
if (!runner.hiding) {
  for (const guard of args.guards) {
    if (guard.state === "alert") {
      const dist = Math.hypot(guard.x - runner.x, guard.y - runner.y);
      if (dist < 0.6) {
        await ctx.db.patch(gameState._id, { phase: "caught" });
        const room = await ctx.db.get(args.roomId);
        if (room) {
          await ctx.db.patch(args.roomId, { status: "finished" });
        }
        return;
      }
    }
  }
}
```

### 4. Client-Side Guard Tick Driver (`/src/components/GameCanvas.tsx` — MODIFY)

One client needs to drive the guard AI. The simplest approach: **the Runner client ticks the guards.**

Why the Runner? The Runner has the most up-to-date local position (client-predicted), and guard detection depends on Runner position. This avoids an extra round-trip where the Whisper would need to read Runner position from Convex before ticking guards.

**Implementation:**

In the GameCanvas `update()` function, when `role === "runner"` and `phase === "heist"`:

1. Import `tickGuard` and `GUARD_WAYPOINTS` from `guard-ai.ts`
2. Maintain a local copy of guard state (initialized from Convex subscription, then updated locally each frame)
3. Each frame, call `tickGuard()` for each guard, passing the Runner's local position
4. Render guards at their locally-computed positions (for smooth movement)
5. Every 100ms (throttled, same as Runner position updates), send the computed guard states to Convex via the `tickGuards` mutation

```typescript
// In the game loop (inside update function):
if (role === "runner" && state.phase === "heist") {
  // Update each guard locally
  for (let i = 0; i < localGuards.length; i++) {
    const result = tickGuard(
      localGuards[i],
      { x: gsm.localRunnerX, y: gsm.localRunnerY, crouching: gsm.localCrouching, hiding: state.runner.hiding },
      dt,
      TEST_MAP,
      Date.now()
    );
    localGuards[i] = { ...localGuards[i], ...result };
  }

  // Throttled send to server
  if (now - lastGuardSendTime > GUARD_SEND_INTERVAL) {
    lastGuardSendTime = now;
    tickGuardsRef.current({ roomId, guards: localGuards });
  }
}
```

**Important:** Initialize `localGuards` from the Convex subscription when the game starts, but then update them locally each frame. Don't overwrite local guards with server state every subscription update (that would cause stuttering). Only re-sync from server if local state diverges significantly (for MVP, just trust local computation).

### 5. Render Guard with Vision Cone (`/src/engine/renderer.ts` — MODIFY)

Update the existing `drawGuard()` method to also render:
- A direction indicator (small triangle pointing in `guard.angle` direction)
- Visual state: different colors/styles for patrol (normal red), alert (bright red + pulsing), returning (dim red)

Add a new method:
```typescript
drawGuardVisionCone(guardX: number, guardY: number, angle: number, range: number, fov: number, state: string): void
```
- Draw a semi-transparent cone from the guard position
- Color: red for patrol, bright red for alert
- This is only visible for the Whisper (the GameCanvas render path will call this only for the Whisper role). But implement the renderer method now — the Whisper view task can use it.
- For the Runner, guards are just red circles (no cone visible — the Runner doesn't know where guards are looking, which adds to the tension!)

### 6. Caught Screen (`/src/components/GameCanvas.tsx` — MODIFY)

Add a "caught" overlay similar to the "escaped" overlay:

```tsx
{phase === "caught" && (
  <div className="absolute inset-0 flex items-center justify-center z-20">
    <div className="bg-black/70 rounded-2xl p-8 text-center space-y-4 max-w-sm">
      <h2 className="text-3xl font-bold text-[#FF6B6B]">
        Busted!
      </h2>
      <p className="text-[#E8D5B7]/70">
        The guard politely escorted you out of the building. Better luck next time!
      </p>
      <a
        href="/"
        className="inline-block px-6 py-2 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                   hover:bg-[#FFC107] transition-colors"
      >
        Back to Home
      </a>
    </div>
  </div>
)}
```

Also stop the game loop updates when phase is "caught" (guards stop moving, no more Runner input).

### 7. Guard State in HUD (`/src/components/HUD.tsx` — MODIFY)

Add an alert indicator to the Runner HUD:
- When any guard is in "alert" state, show a red flashing "! ALERT !" indicator at the top of the screen
- When any guard is in "suspicious" state, show a yellow "? Suspicious" indicator
- This gives the Runner feedback that they've been spotted without needing to see the vision cone

## Key Technical Details

### Wall-Occluded Raycasting

The vision cone check needs to handle walls blocking line of sight. Use a simple DDA (Digital Differential Analyzer) ray march:

```typescript
function isLineOfSightClear(
  x0: number, y0: number,
  x1: number, y1: number,
  map: TileType[][]
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / 0.4); // Check every 0.4 tiles

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    const tile = getTile(map, Math.floor(cx), Math.floor(cy));
    if (tile === TileType.Wall) return false;
  }
  return true;
}
```

### Angle Wraparound

When checking if the Runner is within the guard's FOV, handle the -PI to PI wraparound:

```typescript
function angleDiff(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

// Runner is visible if:
const angleToRunner = Math.atan2(runner.y - guard.y, runner.x - guard.x);
const diff = Math.abs(angleDiff(angleToRunner, guard.angle));
const isInFOV = diff < (GUARD_FOV * Math.PI / 180) / 2;
```

### Guard Collision with Walls

Guards should not walk through walls. Use the same `canMoveTo` style check as the Runner, but with the guard's own hitbox. When a guard's path is blocked, it should try to slide along the wall (axis-separated movement). If completely stuck, the guard stays in place. This keeps the AI simple and prevents guards from phasing through walls.

### Throttling Guard Updates

The guard tick runs every frame (~60Hz) on the client for smooth local rendering, but updates are only sent to Convex every 100ms (~10Hz). This matches the Runner position send rate and keeps Convex write volume reasonable.

### Guard Initialization

When the game starts (via `startGame` mutation in `rooms.ts`), the guard is initialized at position (9, 12) with `angle: 0`, `state: "patrol"`, `targetWaypoint: 0`. The GameCanvas should initialize `localGuards` from the first Convex subscription update, then take over local computation.

## Files to Create
- `/src/game/guard-ai.ts` — Guard AI state machine, vision cone check, patrol waypoints, movement

## Files to Modify
- `/convex/schema.ts` — Add `lastKnownX`, `lastKnownY`, `stateTimer` optional fields to guard object
- `/convex/game.ts` — Add `tickGuards` mutation with server-authoritative catch check
- `/convex/rooms.ts` — Update `startGame` to include new guard fields in initial data
- `/src/components/GameCanvas.tsx` — Add guard tick driver in Runner's update loop, add local guard state, add "caught" overlay, add guard alert rendering
- `/src/engine/renderer.ts` — Enhance `drawGuard()` with direction indicator and state coloring, add `drawGuardVisionCone()` method
- `/src/components/HUD.tsx` — Add alert/suspicious indicator for Runner

## How to Verify

1. `npx convex dev` runs without errors (schema changes and new mutation deploy)
2. `npm run build` succeeds
3. Open two browser tabs. Create a game, join, pick roles, start game.
4. **Guard patrols:** After pressing "Start Heist!", the guard (red circle) visibly moves around the bottom corridor in a loop, pausing briefly at each waypoint. The guard faces its direction of movement.
5. **Guard sees Runner:** Move the Runner into the guard's vision cone (approach from in front while the guard faces you). The HUD flashes "! ALERT !" and the guard starts chasing the Runner.
6. **Guard chases:** The guard moves toward the Runner at increased speed. It follows the Runner around corners (updating last known position when it has line of sight).
7. **Catch:** Let the guard reach the Runner — the "Busted!" overlay appears. The game ends.
8. **Wall occlusion:** Stand behind a wall from the guard — the guard does NOT detect you even if you're within range, because the wall blocks line of sight.
9. **Hiding:** Enter a hide spot (Space at tile 3,7) while a guard is nearby. The guard cannot see you while hidden. Wait for the guard to give up and return to patrol.
10. **Crouching reduces range:** Crouch (Shift) near the guard — the detection range is shorter (3 tiles instead of 5), making it easier to sneak past.
11. **Guard gives up:** After the guard loses sight of the Runner, it moves to the last known position, waits briefly, then returns to its patrol route.
12. **Full game loop:** Successfully sneak past the guard, grab the Golden Rubber Duck, and escape to the exit — "You Escaped!" appears. Then try again and get caught — "Busted!" appears.
13. **Both players see guards:** The Whisper tab also sees the guard moving in real-time (synced via Convex subscription). Guard positions update smoothly for both players.

---

## Completion Summary

### What was built
- **Guard AI state machine** with full patrol → alert → returning cycle
- **Vision cone detection** with FOV check, range check (reduced for crouching), wall occlusion raycasting
- **Chase behavior** — guards track Runner's last known position, chase at increased speed
- **Server-authoritative catch check** — double validation on both client and Convex
- **Caught screen** — "Busted!" overlay when guard catches the Runner
- **Guard state visuals** — different colors for patrol/alert/suspicious/returning, direction indicator triangle
- **HUD alert indicator** — red flashing "! ALERT !" and yellow "? Suspicious" for the Runner
- **Whisper view** — guards show state-colored bodies, vision cones, and "!" label when alert
- **Waypoint patrol** — guard loops through corridor waypoints, pauses briefly at each

### Files created
- `/src/game/guard-ai.ts` — Guard AI module (constants, vision check, state machine, movement, collision)

### Files modified
- `/convex/schema.ts` — Added `lastKnownX`, `lastKnownY`, `stateTimer` optional fields to guard object
- `/convex/game.ts` — Added `tickGuards` mutation with server-authoritative catch check
- `/convex/rooms.ts` — Updated `startGame` to include new guard fields
- `/src/game/game-state.ts` — Extended guard type in `LocalGameState` with new fields
- `/src/components/GameCanvas.tsx` — Added guard tick driver (Runner client drives guard AI), local guard state, caught overlay, guard alert rendering, `tickGuards` mutation integration
- `/src/engine/renderer.ts` — Enhanced `drawGuard()` with angle/state params, direction indicator, state coloring; added `drawGuardVisionCone()` method
- `/src/components/HUD.tsx` — Added `guardAlertState` prop, alert/suspicious indicators for Runner
- `/src/game/whisper-view.ts` — Added state-based guard coloring, "!" alert label, color-parameterized vision cone

### Build status
- `npm run build` — passes
- `npm run lint` — 0 errors (4 warnings from auto-generated Convex files only)

---

## Review Notes (Reviewer: 81595f46)

### Issues Found & Fixed

1. **Missing `heistStartTime` prop on HUD** — `GameCanvas.tsx` was not passing `heistStartTime` to the HUD component, causing the heist countdown timer to always show 3:00 (full duration) instead of counting down. Fixed by adding `heistStartTime={gameState?.heistStartTime}` to the HUD props.

2. **Explicit `undefined` in Convex optional fields** — `rooms.ts` `startGame` mutation set `lastKnownX: undefined`, `lastKnownY: undefined`, `stateTimer: undefined` on the initial guard data. For `v.optional()` fields in Convex, it's better to omit them entirely. Fixed by removing the explicit undefined assignments.

3. **Weak types in `LocalGameState`** — `game-state.ts` used `string` for `guard.state`, `phase`, and ping `type` fields instead of proper union types. This allowed invalid state values to pass type checking. Fixed by using the correct union literals (`"patrol" | "suspicious" | "alert" | "returning"`, `"planning" | "heist" | "escaped" | "caught" | "timeout"`, `"danger" | "go" | "item"`).

4. **Unnecessary type casts in `GameCanvas.tsx`** — With the improved `LocalGameState` types, removed `as GuardData["state"]` and `as "patrol" | "suspicious" | "alert" | "returning"` casts that were compensating for the weak types.

5. **Renderer `drawGuard` state param** — Changed from `string` to the proper union type `"patrol" | "suspicious" | "alert" | "returning"` for type safety.

6. **Enhanced whisper-view alert labels** — Added pulsing glow for alert state guards and "? Suspicious" label for suspicious guards (was only showing "!" for alert).

### No Issues (Code Quality Notes)

- Guard AI state machine in `guard-ai.ts` is well-structured with clean state transitions
- Vision cone check properly handles FOV wraparound, wall occlusion, crouching range reduction, and hiding
- Server-authoritative catch check in `tickGuards` mutation correctly double-validates catches
- Guard movement uses axis-separated collision matching the Runner's approach
- Throttled guard updates (100ms) match Runner position send rate

### Post-Fix Build Status
- `npm run build` — passes
- `npm run lint` — 0 errors (4 warnings from auto-generated Convex files only)
