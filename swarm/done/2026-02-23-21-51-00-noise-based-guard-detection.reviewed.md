# Task: Noise-Based Guard Detection

## Overview

PLAN.md explicitly calls for guards to become suspicious when they "heard noise or edge-of-vision trigger." Currently, nothing triggers the `suspicious` state from the Runner's side — guards only enter `alert` from direct vision (and `suspicious` from camera detections, once that task is complete). Crouching currently only reduces the guard's vision detection range, which means it's useful only when you're already in a guard's field of view. In a proper stealth game, crouching should also make you **quiet**.

This task adds noise-based detection: running (walking at normal speed) produces footstep noise that nearby guards can "hear," causing them to enter the `suspicious` state and investigate the noise source. Crouching produces no noise. This makes crouching a core stealth mechanic rather than a niche edge case, and creates more tense gameplay moments where the Runner must weigh speed vs stealth.

**Dependencies:** Milestones 1-8 complete. Guard AI already has the full `suspicious` state machine (investigate → wait → return to patrol). This task just adds a new trigger for it.

## What to Build

### 1. Noise Detection Constants & Function (`/src/game/guard-ai.ts` — MODIFY)

Add noise detection alongside the existing vision detection. Noise is simpler than vision — it's omnidirectional (no FOV check), but blocked by walls (sound doesn't travel through walls) and has a shorter range.

```typescript
// --- Noise Detection Constants ---
export const NOISE_RADIUS_RUNNING = 3.5;  // tiles — walking at normal speed
export const NOISE_RADIUS_CROUCHING = 0;  // tiles — crouching is silent
export const NOISE_COOLDOWN = 4000;       // ms — minimum time between noise alerts per guard
```

Add a noise detection function:

```typescript
/**
 * Check if a guard can hear the Runner's footsteps.
 * Noise is omnidirectional but blocked by walls.
 * Returns true if the Runner is within noise range and there's a
 * clear path for sound to travel (line of sight check reused as
 * "line of hearing" — walls block sound).
 */
export function canGuardHearRunner(
  guard: { x: number; y: number; state: GuardState },
  runner: RunnerData & { moving: boolean },
  map: TileType[][]
): boolean {
  // Runner must be moving to make noise
  if (!runner.moving) return false;
  // Crouching is silent
  if (runner.crouching) return false;
  // Hidden runners don't make noise
  if (runner.hiding) return false;
  // Only patrol and returning guards react to noise
  // (suspicious/alert guards are already investigating)
  if (guard.state !== "patrol" && guard.state !== "returning") return false;

  const dx = runner.x - guard.x;
  const dy = runner.y - guard.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > NOISE_RADIUS_RUNNING) return false;

  // Sound is blocked by walls (reuse isLineOfSightClear)
  if (!isLineOfSightClear(guard.x, guard.y, runner.x, runner.y, map)) {
    return false;
  }

  return true;
}
```

**Important:** `isLineOfSightClear` is currently a module-private function. It needs to be used by `canGuardHearRunner` which is in the same module, so no export needed — just make sure `canGuardHearRunner` is placed after `isLineOfSightClear` in the file (or move it above as needed). The function is already used by `canCameraSeeRunner` in the same file, so this is consistent.

### 2. Integrate Noise into Guard Tick (`/src/game/guard-ai.ts` — MODIFY `tickGuard`)

The `tickGuard` function needs to accept a `moving` flag for the runner and check noise alongside vision. Modify the `RunnerData` interface to include `moving`:

```typescript
export interface RunnerData {
  x: number;
  y: number;
  crouching: boolean;
  hiding: boolean;
  moving: boolean;  // <-- ADD THIS
}
```

In the `patrol` state handler inside `tickGuard`, after the existing vision check, add a noise check:

```typescript
case "patrol": {
  // If guard sees runner → go alert (existing code, keep as-is)
  if (canSee) { /* ... existing alert transition ... */ }

  // NEW: If guard hears runner → go suspicious (investigate noise source)
  const canHear = canGuardHearRunner(guard, runner, map);
  if (canHear) {
    return {
      x: guard.x,
      y: guard.y,
      angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
      state: "suspicious",
      targetWaypoint: guard.targetWaypoint,
      lastKnownX: runner.x,  // Investigate where the sound came from
      lastKnownY: runner.y,
      stateTimer: now,
    };
  }

  // ... rest of patrol waypoint logic (existing, keep as-is) ...
}
```

Also add noise detection to the `returning` state (a guard walking back to patrol should still hear things):

```typescript
case "returning": {
  // If guard sees runner → go alert (existing, keep as-is)
  if (canSee) { /* ... existing ... */ }

  // NEW: If guard hears runner → go suspicious
  const canHear = canGuardHearRunner(guard, runner, map);
  if (canHear) {
    return {
      x: guard.x,
      y: guard.y,
      angle: Math.atan2(runner.y - guard.y, runner.x - guard.x),
      state: "suspicious",
      targetWaypoint: guard.targetWaypoint,
      lastKnownX: runner.x,
      lastKnownY: runner.y,
      stateTimer: now,
    };
  }

  // ... rest of returning logic (existing, keep as-is) ...
}
```

Do **NOT** add noise detection to the `suspicious` or `alert` states — those guards are already investigating and shouldn't stack new noise triggers.

### 3. Pass `moving` Flag from GameCanvas (`/src/components/GameCanvas.tsx` — MODIFY)

The game loop in `GameCanvas.tsx` already tracks the Runner's movement input. You need to pass a `moving` flag to the `tickGuard` function call so noise detection works.

**a) Determine if the Runner is moving:**

Look for where the Runner's velocity/movement is computed each frame (the section that reads WASD/Arrow keys and computes `dx`/`dy`). The Runner is "moving" if `dx !== 0 || dy !== 0`. Store this:

```typescript
const isRunnerMoving = (dx !== 0 || dy !== 0);
```

**b) Pass it to `tickGuard`:**

Find the section that calls `tickGuard` for each guard. The `runner` object passed to it currently has `{ x, y, crouching, hiding }`. Add `moving`:

```typescript
const runnerForAI: RunnerData = {
  x: gsm.localRunnerX,
  y: gsm.localRunnerY,
  crouching: isCrouching,
  hiding: isHiding,
  moving: isRunnerMoving,  // <-- ADD THIS
};
```

This is the only change needed in GameCanvas — the existing `tickGuard` will now use the `moving` flag for noise detection.

### 4. Noise Alert Cooldown Per Guard (`/src/game/guard-ai.ts` — MODIFY)

To prevent noise from spamming guards into suspicious state every frame, add a cooldown tracked per guard. The simplest approach: add an optional `noiseCooldownUntil` field to `GuardData` and `GuardUpdate`:

```typescript
export interface GuardData {
  // ... existing fields ...
  noiseCooldownUntil?: number;  // timestamp — ignore noise until this time
}

export interface GuardUpdate {
  // ... existing fields ...
  noiseCooldownUntil?: number;
}
```

In the patrol/returning noise check, respect the cooldown:

```typescript
const canHear = canGuardHearRunner(guard, runner, map);
const noiseCooldownOk = !guard.noiseCooldownUntil || now >= guard.noiseCooldownUntil;
if (canHear && noiseCooldownOk) {
  return {
    // ... suspicious transition ...
    noiseCooldownUntil: now + NOISE_COOLDOWN,
  };
}
```

When a guard transitions away from suspicious/alert back to patrol/returning, preserve the cooldown:

```typescript
noiseCooldownUntil: guard.noiseCooldownUntil,
```

This ensures a guard can only be noise-alerted once every 4 seconds, which prevents the Runner from being permanently chased just by walking near a guard.

### 5. Event Recording for Noise Detection (`/src/game/events.ts` — MODIFY)

Add a `"noise_alert"` event type:

```typescript
export type GameEventType =
  | "heist_start"
  | "item_pickup"
  | "near_miss"
  | "guard_alert"
  | "guard_lost"
  | "hide_enter"
  | "hide_escape"
  | "ping_sent"
  | "crouching_sneak"
  | "camera_spotted"
  | "noise_alert"      // <-- ADD THIS
  | "escape"
  | "caught"
  | "timeout";
```

### 6. Record Noise Events in GameCanvas (`/src/components/GameCanvas.tsx` — MODIFY)

When a guard transitions to `suspicious` due to noise (you can detect this by checking if the guard was in `patrol`/`returning` before the tick and is now `suspicious` after), record a `noise_alert` event:

```typescript
// After tickGuard, check for noise-triggered suspicion:
if (
  (oldState === "patrol" || oldState === "returning") &&
  updatedGuard.state === "suspicious" &&
  !canGuardSeeRunner(guard, runner, map)  // It's noise, not vision
) {
  recorder.record("noise_alert", {
    guardId: guard.id,
    x: runner.x,
    y: runner.y,
  });
}
```

### 7. Noise Indicator in Runner View (OPTIONAL — `/src/game/runner-view.ts` or `/src/components/GameCanvas.tsx` — MODIFY)

Add a subtle visual indicator when the Runner is making noise. This teaches players that walking = noisy:

- When the Runner is moving and NOT crouching, show small concentric circles / sound wave lines emanating from the Runner's position (2-3 thin arcs, semi-transparent, ~1-2 tile radius)
- When crouching and moving, show nothing (reinforcing that crouching = silent)
- This should be drawn in the runner's rendering pass, after the player sprite

The visual can be very simple — just 2-3 arc segments drawn with `ctx.arc()`:

```typescript
// After drawing the Runner sprite:
if (isRunnerMoving && !isCrouching) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 200, 100, 0.25)";
  ctx.lineWidth = 1;
  // Pulse effect based on time
  const pulse = (Date.now() % 800) / 800; // 0..1 repeating
  for (let ring = 0; ring < 3; ring++) {
    const radius = (NOISE_RADIUS_RUNNING * TILE_SIZE * (0.3 + ring * 0.25 + pulse * 0.15));
    const alpha = 0.25 - ring * 0.08;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.beginPath();
    ctx.arc(runnerScreenX, runnerScreenY, radius, -0.3, 0.3); // Small arcs, not full circles
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(runnerScreenX, runnerScreenY, radius, Math.PI - 0.3, Math.PI + 0.3);
    ctx.stroke();
  }
  ctx.restore();
}
```

This is optional polish — if it adds too much complexity to the render pass, skip it. The core gameplay mechanic (noise detection) is more important.

### 8. Update Controls Tutorial (`/src/components/GameCanvas.tsx` — SMALL MODIFY)

The planning overlay controls tutorial (recently added) should mention that running creates noise. In the Runner tips section, add a tip:

```
• Running creates noise — crouch (Shift) near guards to stay silent
```

This helps players understand the mechanic from the start.

## Files to Modify

- `/src/game/guard-ai.ts` — Add `canGuardHearRunner`, noise constants, `moving` to `RunnerData`, noise cooldown fields, noise check in `patrol` and `returning` states
- `/src/game/events.ts` — Add `"noise_alert"` event type
- `/src/components/GameCanvas.tsx` — Pass `moving` flag to guard tick, record noise events, optional noise visual indicator, update tutorial tips
- `/src/game/runner-view.ts` — (Optional) Noise wave visual indicator near Runner sprite

## Files NOT to Touch

- `/convex/schema.ts` — No schema changes needed; noise is purely client-side detection logic (guard state changes flow through existing `tickGuards` mutation)
- `/convex/game.ts` — No backend changes
- `/src/engine/audio.ts` — Don't add new sound effects (that's a separate concern)
- `/src/game/whisper-view.ts` — Whisper doesn't need noise visualization
- `/src/game/map-generator.ts` — No map changes
- `/src/game/scoring.ts` — Don't change scoring (noise_alert events can be considered in a future scoring pass)

## Key Technical Details

### Why noise detection is client-side

Guard AI already runs client-side (the Runner's client ticks guards, then syncs via `tickGuards` Convex mutation). Noise detection fits naturally into this: the Runner's client checks if the runner is moving + not crouching + in range of a guard → triggers suspicious state → sends updated guard state to Convex. The Whisper's client receives the guard state change via subscription and sees the guard investigate.

### `moving` flag accuracy

The `moving` flag should be true if the Runner has nonzero velocity this frame (any WASD/Arrow key is held and the Runner is not blocked by a wall). It should NOT be true if the Runner is stationary. This ensures noise only triggers when actually moving, not when holding a key against a wall.

### Noise doesn't cause instant catch

This is important for the "cozy" tone. Noise only triggers `suspicious` state (investigate position), not `alert` (chase). If the guard arrives at the noise location and the Runner has moved away (or is hiding), the guard returns to patrol. The Runner gets a warning — the guard turns and walks toward them — and time to react by crouching or hiding. Only direct **vision** can trigger `alert` → `catch`.

### Interaction with camera detection

Once the camera task is complete, guards can become suspicious from both cameras and noise. These stack naturally: a camera alert and a noise alert both set `suspicious` state with `lastKnownX/Y`. If a guard is already suspicious from a camera alert, a noise trigger won't override it (the check for `guard.state !== "suspicious"` prevents this). This is correct behavior.

### Performance

One `Math.sqrt` + one `isLineOfSightClear` raycast per guard per frame, only when the Runner is moving and not crouching. With 1-3 guards, this adds ~1-3 raycasts per frame — negligible.

## How to Verify

1. `npm run build` succeeds with no type errors.
2. `npm run lint` passes.
3. Create a game and start as **Runner**:
   - Walk (normal speed) near a patrolling guard (within ~3.5 tiles, no wall between you)
   - The guard should turn toward your position and walk to investigate (suspicious state)
   - If you stop and crouch before the guard arrives, the guard should investigate the spot where you were, look around, then return to patrol
   - Walking in a different room (wall between you and guard) should NOT trigger the guard
4. **Crouching is silent:**
   - Crouch-walk right past a guard (within 3 tiles, behind them so they can't see you)
   - The guard should NOT react — crouching makes zero noise
   - This is the core stealth mechanic: crouch = slow but silent, walk = fast but noisy
5. **Noise cooldown:**
   - After a guard is alerted by noise, if the Runner keeps running near that guard, the guard should NOT spam back and forth between suspicious and patrol — the 4-second cooldown prevents re-triggering
6. **No double-alert:**
   - A guard already in `suspicious` or `alert` state should not be affected by noise
   - Only `patrol` and `returning` guards react to noise
7. **Noise indicator (if implemented):**
   - Small sound wave arcs should appear around the Runner when walking at normal speed
   - Arcs should disappear when crouching
   - Arcs should disappear when standing still
8. **Tutorial update:**
   - Planning overlay should mention that running creates noise near guards
9. **Event recording:**
   - Complete a heist where a guard was noise-alerted — check that the event log includes `noise_alert` events (visible in the results screen's highlight reel or event count)

---

## Implementation Summary

### Files Changed

1. **`/src/game/guard-ai.ts`** — Core noise detection logic
   - Added `NOISE_RADIUS_RUNNING` (3.5 tiles) and `NOISE_COOLDOWN` (4000ms) constants
   - Added `moving: boolean` to `RunnerData` interface
   - Added `noiseCooldownUntil?: number` to `GuardData` and `GuardUpdate` interfaces
   - Added `canGuardHearRunner()` function — checks distance, LOS (for wall occlusion), movement state, crouching, hiding, and guard state
   - Integrated noise detection into `patrol` and `returning` state handlers in `tickGuard()` — triggers `suspicious` state with cooldown
   - Preserved `noiseCooldownUntil` across all state transitions

2. **`/src/game/events.ts`** — Added `"noise_alert"` event type to `GameEventType` union

3. **`/src/components/GameCanvas.tsx`** — Game loop and rendering integration
   - Added `runnerMovingRef` to track movement state for render pass
   - Added noise event recording: when a guard transitions from patrol/returning to suspicious without vision contact, records `noise_alert` event
   - Added noise wave visual indicator: semi-transparent arc segments emanate from Runner when walking (not crouching), providing visual feedback about noise generation
   - Updated tutorial tips: "Running creates noise — crouch (Shift) near guards to stay silent"
   - Imported `canGuardSeeRunner` and `NOISE_RADIUS_RUNNING` for event detection and visual indicator

4. **`/src/app/game/[roomId]/page.tsx`** — Fixed build: passed `roomCode` prop to `GameCanvas` (required by concurrent heartbeat/disconnect changes)

### What Was Built
- **Noise-based guard detection**: Walking at normal speed within 3.5 tiles of a guard (with clear line of sight) triggers `suspicious` state. The guard investigates the noise source location.
- **Crouching is silent**: Crouching produces zero noise, making it a meaningful stealth mechanic beyond just reducing visual detection range.
- **Noise cooldown**: 4-second cooldown per guard prevents noise spam (guard won't repeatedly flip between suspicious/patrol).
- **Visual feedback**: Sound wave arcs appear around the Runner when walking, disappear when crouching or standing still.
- **Event recording**: `noise_alert` events logged for highlight reel / scoring.
- **Tutorial update**: Planning overlay now teaches players about the noise mechanic.

### Build Status
- `npm run build` — passes (no type errors)
- `npm run lint` — passes (0 errors, only warnings from generated Convex files)

---

## Review Notes (Reviewer: 53c2eb42)

### Items Reviewed (No Issues Found)

The noise-based guard detection implementation is clean and well-structured. All files reviewed:

1. **`guard-ai.ts` — Core logic**
   - `canGuardHearRunner()`: Correctly checks all preconditions (moving, not crouching, not hiding, guard in patrol/returning). Uses `isLineOfSightClear` for wall occlusion — consistent with how camera detection works.
   - Noise detection in `patrol` and `returning` states: Properly integrated after vision checks, with cooldown gating. Does NOT apply to `suspicious` or `alert` states (correct — no stacking).
   - `noiseCooldownUntil` preserved across ALL state transitions including the default case (good attention to detail).
   - `NOISE_RADIUS_RUNNING` (3.5 tiles) and `NOISE_COOLDOWN` (4000ms) are reasonable values for gameplay balance.

2. **`events.ts` — Event type**
   - `"noise_alert"` cleanly added to the `GameEventType` union.

3. **`GameCanvas.tsx` — Integration**
   - `runnerMovingRef` correctly tracks actual position delta (not just key presses), so pressing against a wall doesn't generate false noise.
   - Noise event recording correctly differentiates noise-triggered suspicion from vision-triggered by checking `!canGuardSeeRunner(guard, runnerForGuard, map.tiles)`.
   - Noise wave visual indicator uses proper `ctx.save()/restore()` and only renders when `runnerMovingRef.current && !crouching && !hiding`.
   - Tutorial tip correctly added for Runner role.
   - `moving` flag correctly passed to `runnerForGuard` object for guard AI.

4. **`page.tsx`** — `roomCode` prop addition was needed for concurrent disconnect handling work. Correctly wired.

### No Fixes Needed
The implementation is correct, well-integrated, and follows established patterns in the codebase.

---

## Review Notes (Reviewer: 4c316fdf)

### Issues Found & Fixed

1. **Bug: `runnerMoving` based on input, not actual movement** (`GameCanvas.tsx`)
   - `runnerMoving` was computed from input `dx`/`dy` values, meaning pressing a movement key against a wall would trigger noise detection and show noise wave visuals even though the runner wasn't actually moving.
   - **Fix:** Save `prevX`/`prevY` before movement, compute `runnerMoving` from actual position delta (`newX !== prevX || newY !== prevY`). This ensures walking into walls is silent and doesn't play walk animations.

2. **Lint error: `touchInputRef.current` accessed during render** (`GameCanvas.tsx`, pre-existing from touch controls)
   - React's `react-hooks/refs` rule flagged accessing `touchInputRef.current` in JSX.
   - **Fix:** Created a stable `touchInput` via `useMemo(() => new TouchInputManager(), [])` and pass that directly to `<TouchControls>` instead of `touchInputRef.current`.

3. **Lint error: `setState` called synchronously in effect** (`GameCanvas.tsx`, pre-existing from touch controls)
   - `setShowTouchControls(isTouchDevice())` inside a `useEffect` triggered the `react-hooks/set-state-in-effect` rule.
   - **Fix:** Changed to lazy initial state: `useState(() => isTouchDevice())`.

4. **CLAUDE.md: Mobile Touch Controls status updated** from "Queued" to "In Review" since code is partially in the codebase.

### Post-Review Build Status
- `npm run build` — passes
- `npm run lint` — 0 errors (4 warnings from generated Convex files)
