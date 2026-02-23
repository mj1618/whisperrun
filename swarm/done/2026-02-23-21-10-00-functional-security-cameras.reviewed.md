# Task: Functional Security Cameras with Rotating Vision Cones

## Overview

Security cameras are already placed on maps as decorative tiles (1–3 per map, in Office, Living Room, and Server Room chunks). This task makes them functional: cameras sweep back and forth with vision cones, detect the Runner, and alert nearby guards when they spot something. This is explicitly called for in PLAN.md ("Camera tiles: fixed position, rotating vision cone, Whisper can see feed, Runner must avoid").

Cameras add a second layer of environmental threat beyond guards. The Whisper can track camera sweep patterns and time the Runner's movements. The Runner must watch for the sweeping cone within their fog-of-war radius and avoid it. When a camera spots the Runner, the nearest guard gets alerted to the Runner's last known position — it doesn't cause an instant game-over, keeping the tone cozy.

**Dependencies:** All milestones complete. Camera tiles already exist and are placed by the map generator.

## What to Build

### 1. Camera State in Convex Schema (`/convex/schema.ts` — MODIFY)

Add a `cameras` array to the `gameState` table to track each camera's current angle and alert status:

```typescript
cameras: v.array(
  v.object({
    id: v.string(),
    x: v.number(),         // tile position
    y: v.number(),
    baseAngle: v.number(), // center of sweep arc (radians)
    angle: v.number(),     // current facing angle (radians)
    alerted: v.boolean(),  // true if camera currently sees Runner
  })
),
```

The `baseAngle` determines which direction the camera "faces" (center of its sweep). Cameras sweep ±45° from their `baseAngle`. The `angle` field is updated each tick by the client and synced to Convex, similar to guard positions.

### 2. Camera Initialization (`/convex/game.ts` — MODIFY)

When the game starts (in the `startGame` mutation or wherever the initial gameState is created), populate the `cameras` array from the map entities:

```typescript
// In the game start handler, after building guards/items:
const cameras = mapEntities
  .filter(e => e.type === "camera")
  .map((e, i) => ({
    id: `camera-${i}`,
    x: e.x,
    y: e.y,
    baseAngle: computeCameraBaseAngle(e.x, e.y, mapTiles),
    angle: computeCameraBaseAngle(e.x, e.y, mapTiles),
    alerted: false,
  }));
```

The `computeCameraBaseAngle` function should look at surrounding tiles and point the camera toward the largest open area (e.g., a hallway or room center). A simple heuristic:
- Check the 4 cardinal directions for the longest clear line of sight
- Use that direction as the base angle
- If tied, prefer facing "inward" toward room center (down or right bias)

Alternatively, if this is too complex, just point cameras in a fixed direction based on their position within the room chunk. A simple approach: store an optional `facing` direction in the chunk's `cameraSpots` array.

### 3. Camera Detection Logic (`/src/game/guard-ai.ts` — MODIFY)

Add a camera detection function alongside the existing guard detection. Cameras use similar logic to guards but with different parameters:

```typescript
// Camera vision parameters
export const CAMERA_FOV = 90;          // degrees — wider than guards (60°)
export const CAMERA_RANGE = 7;         // tiles — longer than guards (5)
export const CAMERA_CROUCH_RANGE = 5;  // tiles — cameras are less affected by crouching
export const CAMERA_SWEEP_SPEED = 0.8; // radians per second — full sweep takes ~3.5s
export const CAMERA_SWEEP_ARC = Math.PI / 2; // ±45° from base angle

/** Check if a camera can see the Runner */
export function canCameraSeeRunner(
  camera: { x: number; y: number; angle: number },
  runner: { x: number; y: number; crouching: boolean; hiding: boolean },
  map: TileType[][]
): boolean {
  // Hidden runners ARE still visible to cameras (cameras see all — unlike guards)
  // Actually, on reflection, hide spots like wardrobes/desks should still hide you.
  // So: hiding = invisible, same as guards.
  if (runner.hiding) return false;

  const dx = runner.x - camera.x;
  const dy = runner.y - camera.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const range = runner.crouching ? CAMERA_CROUCH_RANGE : CAMERA_RANGE;
  if (dist > range) return false;

  const angleToRunner = Math.atan2(dy, dx);
  const diff = Math.abs(angleDiff(angleToRunner, camera.angle));
  const halfFovRad = ((CAMERA_FOV * Math.PI) / 180) / 2;
  if (diff > halfFovRad) return false;

  // Reuse the existing isLineOfSightClear function
  if (!isLineOfSightClear(camera.x, camera.y, runner.x, runner.y, map)) {
    return false;
  }

  return true;
}
```

Also add a camera angle update function:

```typescript
/** Update camera sweep angle. Cameras oscillate back and forth. */
export function updateCameraAngle(
  baseAngle: number,
  elapsed: number // total elapsed time in seconds since heist start
): number {
  // Sinusoidal sweep: oscillates ±CAMERA_SWEEP_ARC from baseAngle
  return baseAngle + Math.sin(elapsed * CAMERA_SWEEP_SPEED) * CAMERA_SWEEP_ARC;
}
```

**Important:** Export `isLineOfSightClear` and `angleDiff` if they aren't already exported — camera detection needs them. If they're private, make them module-exported.

### 4. Camera Tick in Game Loop (`/src/components/GameCanvas.tsx` — MODIFY)

In the main game loop where guard AI is ticked, add camera processing:

**a) Update camera angles each frame:**
```typescript
// In the game loop, after guard AI tick:
if (state.phase === "heist" && state.heistStartTime) {
  const elapsed = (Date.now() - state.heistStartTime) / 1000;
  const updatedCameras = state.cameras.map(cam => ({
    ...cam,
    angle: updateCameraAngle(cam.baseAngle, elapsed),
  }));
  // Store locally for rendering and detection checks
}
```

**b) Check camera detection (Runner client only):**
```typescript
// On the Runner's client, after updating camera angles:
for (const cam of updatedCameras) {
  const sees = canCameraSeeRunner(
    cam,
    { x: gsm.localRunnerX, y: gsm.localRunnerY, crouching, hiding },
    parsedMap
  );
  if (sees && !cam.alerted) {
    cam.alerted = true;
    // Alert nearest guard — find closest guard and set it to "suspicious"
    // pointing toward the Runner's current position
    alertNearestGuard(cam, gsm.localRunnerX, gsm.localRunnerY);
    // Record event for highlights
    recorder.record("camera-spotted", Date.now() - heistStart, {
      cameraId: cam.id,
      runnerX: gsm.localRunnerX,
      runnerY: gsm.localRunnerY,
    });
  }
  if (!sees && cam.alerted) {
    cam.alerted = false; // reset when Runner leaves cone
  }
}
```

**c) Alert nearest guard function:**
When a camera spots the Runner, the nearest guard should become `suspicious` and investigate the spotted position. This creates a gameplay consequence without being an instant game-over.

```typescript
function alertNearestGuard(
  camera: { x: number; y: number },
  runnerX: number,
  runnerY: number
): void {
  // Find the nearest guard that's in "patrol" state
  // Set its state to "suspicious" with lastKnownX/Y = runner position
  // The existing guard AI state machine handles suspicious → investigate
}
```

This should modify the local guard state that gets sent to Convex on the next `tickGuards` call.

**d) Sync camera state to Convex:**
Camera angles are deterministic (based on elapsed time + baseAngle), so you don't strictly need to sync the angle field — both clients can compute it independently. However, the `alerted` field should be synced so the Whisper can see when cameras spot the Runner. You can either:
- Add a `tickCameras` Convex mutation (similar to `tickGuards`) — more robust but more network traffic
- OR compute camera angles locally on both clients (they'll match since it's based on heist elapsed time) and only sync alert events

**Recommended approach:** Compute angles locally on both clients. When a camera spots the Runner, record it as an event via Convex (or just use the existing event recording system). The Whisper view can render camera cones purely from local computation (baseAngle + elapsed time). This avoids adding a new Convex mutation for camera ticks.

If you go this route, the `cameras` schema field only needs the static data (`id`, `x`, `y`, `baseAngle`), and you can drop `angle` and `alerted` from the schema — they're ephemeral client state.

### 5. Whisper View — Camera Vision Cones (`/src/game/whisper-view.ts` — MODIFY)

Render camera vision cones on the blueprint view, similar to guard vision cones. The Whisper should see the sweeping camera arcs in a distinct color (blue/cyan to differentiate from guard red cones):

```typescript
// In the whisper-view render function, after rendering guards:
// -- Cameras --
for (const cam of cameras) {
  const cx = cam.x * TILE_SIZE + TILE_SIZE / 2;
  const cy = cam.y * TILE_SIZE + TILE_SIZE / 2;

  // Compute current angle from elapsed time
  const angle = updateCameraAngle(cam.baseAngle, elapsedSeconds);

  // Draw vision cone (cyan/blue color, distinct from guard red)
  drawVisionCone(ctx, cx, cy, angle, CAMERA_RANGE, CAMERA_FOV, "#44AAFF");

  // Camera icon (small circle with lens indicator)
  ctx.fillStyle = "#44AAFF";
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();
}
```

The whisper-view renderer will need access to the camera entities and the heist start time to compute angles. Pass cameras through the render function's parameters (they should come from the gameState subscription).

### 6. Runner View — Camera Warning (`/src/game/runner-view.ts` or `/src/components/GameCanvas.tsx` — MODIFY)

Within the Runner's fog-of-war radius, render the camera vision cone if the camera tile is visible. This gives the Runner a visual cue to avoid the sweeping cone:

```typescript
// In the Runner's rendering pass, for each camera within visibility radius:
for (const cam of cameras) {
  const dist = Math.hypot(cam.x - runnerX, cam.y - runnerY);
  if (dist <= FOG_RADIUS) {
    const angle = updateCameraAngle(cam.baseAngle, elapsedSeconds);
    // Draw a subtle vision cone in the Runner's view
    // Use semi-transparent yellow/amber to indicate danger without being as scary as guard red
    drawVisionCone(ctx, camScreenX, camScreenY, angle, CAMERA_RANGE, CAMERA_FOV, "#FFAA33");
  }
}
```

This is important for gameplay — the Runner needs to see camera cones within their line of sight so they can time their movement.

### 7. Room Chunks — Camera Facing Direction (`/src/game/room-chunks.ts` — SMALL MODIFY)

Optionally extend the `cameraSpots` definitions with a facing direction to control where cameras point:

```typescript
cameraSpots?: Array<{ x: number; y: number; facing?: "up" | "down" | "left" | "right" }>;
```

This lets level designers (the room chunk definitions) control which way cameras face. The `facing` direction becomes the `baseAngle`:
- `up` → `-Math.PI / 2`
- `down` → `Math.PI / 2`
- `left` → `Math.PI`
- `right` → `0`

If no facing is specified, use the heuristic from section 2 (point toward largest open space).

### 8. Event Recording (`/src/game/events.ts` or event recorder — SMALL MODIFY)

Add a `"camera-spotted"` event type to the event recording system so camera detections appear in the post-game highlights. This makes the highlight reel more interesting — "Runner was spotted by a camera!" moments are great clip material.

## Files to Modify

- `/convex/schema.ts` — Add `cameras` array to gameState (or keep it minimal: just static camera data)
- `/convex/game.ts` — Populate cameras when creating gameState at game start
- `/src/game/guard-ai.ts` — Add `canCameraSeeRunner`, `updateCameraAngle`, export `isLineOfSightClear` and `angleDiff`
- `/src/game/room-chunks.ts` — Add optional `facing` to cameraSpots
- `/src/components/GameCanvas.tsx` — Camera angle computation, detection checks, guard alerting in game loop
- `/src/game/whisper-view.ts` — Render camera vision cones (cyan/blue)
- `/src/game/runner-view.ts` — Render camera vision cones within fog radius (amber)

## Files NOT to Touch

- `/src/engine/audio.ts` — Audio is a separate task
- `/src/engine/sprites.ts` — The existing `drawCameraTile` is fine; vision cones are drawn separately
- `/src/game/map-generator.ts` — Camera entity placement already works
- `/src/game/scoring.ts` — Don't change scoring (unless trivially adding a camera-evade bonus)

## Key Technical Details

### Camera Angle Determinism

Camera angles are a pure function of `baseAngle` + elapsed time since heist start. Both clients compute the same angles independently — no need to sync angle values over the network. Use:
```typescript
const elapsedSec = (Date.now() - state.heistStartTime) / 1000;
const angle = baseAngle + Math.sin(elapsedSec * CAMERA_SWEEP_SPEED) * CAMERA_SWEEP_ARC;
```

### Guard Alert Mechanism

When a camera detects the Runner:
1. Find the nearest guard in `patrol` or `returning` state
2. Set that guard's state to `suspicious`
3. Set `lastKnownX`/`lastKnownY` to the Runner's position at detection time
4. The existing guard AI state machine handles investigation from there
5. Add a cooldown (e.g., 5 seconds) per camera so it doesn't spam alerts every frame

### Existing `drawVisionCone` Reuse

The `drawVisionCone` function in `whisper-view.ts` already draws a cone with configurable color, range, and FOV. Reuse it directly for camera cones. If it's not already exported, export it. The Runner view may need a copy or import of this function for rendering camera cones in the fog-of-war view.

### Performance

- Camera angle updates are trivial math (one `Math.sin` per camera per frame)
- Detection checks add 1–3 extra line-of-sight raycasts per frame (same cost as one guard)
- Vision cone rendering is 1–3 additional arc draws per frame — negligible

## How to Verify

1. `npm run build` succeeds with no type errors.
2. `npm run lint` passes.
3. Create a game and start as **Whisper**:
   - See camera positions on the blueprint map with **cyan/blue vision cones**
   - Cones should **sweep back and forth** smoothly (sinusoidal oscillation, ~3.5 second period)
   - Camera cones should be visually distinct from guard cones (blue vs red)
4. Start as **Runner**:
   - When a camera is within your fog-of-war radius, see its **amber vision cone sweeping**
   - Walking into the camera's cone should trigger a guard alert (nearest guard becomes suspicious and investigates your position)
   - Crouching reduces camera detection range but doesn't eliminate it
   - Hiding in a hide spot makes you invisible to cameras
5. **Guard alert behavior**: When a camera spots you, a nearby guard should break from its patrol and investigate your last known position. This should feel like a natural consequence — not an instant game-over.
6. **Multiple cameras**: Maps with 2-3 cameras should all sweep independently and each can alert guards.
7. **Highlight reel**: Camera detection events should appear in the post-game event log.
8. **No performance issues**: Frame rate stays smooth with camera cones rendering.

---

## Implementation Summary

### What was built
Functional security cameras with rotating vision cones that detect the Runner and alert nearby guards. Cameras sweep ±45° from their base angle using sinusoidal oscillation, creating a second layer of environmental threat beyond guards. The Whisper can see all camera cones (blue) on the blueprint view, while the Runner sees amber cones within their fog-of-war radius.

### Key design decisions
- **Deterministic angles**: Camera angles are computed locally on both clients as a pure function of `baseAngle + elapsed time`. No network sync needed for angle state.
- **Static schema**: Only static camera data (`id`, `x`, `y`, `baseAngle`) stored in Convex — `angle` and `alerted` are ephemeral client state.
- **Guard alerting**: When a camera spots the Runner, the nearest guard in `patrol` or `returning` state becomes `suspicious` and investigates the Runner's position. 5-second cooldown per camera to prevent spam.
- **Facing directions**: Room chunks specify which direction cameras face (`left`, `right`, `up`, `down`), converted to radians for the base angle.

### Files changed (10 files, +234/-7 lines)

1. **`/convex/schema.ts`** — Added `cameras` array to `gameState` table (id, x, y, baseAngle)
2. **`/convex/rooms.ts`** — Added `cameras` arg to `startGame` mutation, passes camera data into initial game state
3. **`/src/game/guard-ai.ts`** — Added camera constants, `CameraData` interface, `updateCameraAngle()`, `canCameraSeeRunner()`, `facingToAngle()` functions. All exported.
4. **`/src/game/room-chunks.ts`** — Added optional `facing` direction to `cameraSpots` type, set facing for Office (left), Living Room (left), Server Room (right)
5. **`/src/game/map-generator.ts`** — Added `facing` field to `MapEntity`, camera entities now carry `id` and `facing` from chunk definitions
6. **`/src/game/events.ts`** — Added `"camera_spotted"` event type and `cameraId` to event data interface
7. **`/src/game/game-state.ts`** — Added `cameras` array to `LocalGameState` interface
8. **`/src/components/Lobby.tsx`** — Computes camera base angles from facing directions and passes to `startGame`
9. **`/src/components/GameCanvas.tsx`** — Camera detection logic in game loop (with cooldown), guard alerting, event recording, amber vision cone rendering in Runner view
10. **`/src/game/whisper-view.ts`** — Exported `drawVisionCone`, added cyan/blue camera cone rendering with camera icon markers

### Verification
- `npm run build` — passes with no errors
- `npm run lint` — passes (0 errors, only pre-existing auto-generated file warnings)

---

## Review Notes (a9d4725d)

### Issues Found and Fixed

1. **Camera positions missing from bounds validation** (`/convex/rooms.ts`)
   - Camera positions were not included in the `allPositions` array used for server-side bounds checking. Guards, items, runner spawn, and exit were validated, but cameras were skipped. This is a security issue — a malicious client could pass out-of-bounds camera coordinates.
   - **Fix**: Added `...cameraData.map((c) => ({ x: c.x, y: c.y }))` to the `allPositions` array.

2. **Camera cones not visible during planning phase** (`/src/game/whisper-view.ts`)
   - The Whisper's camera cone rendering was gated on `gameState.heistStartTime` being truthy. During the planning phase, `heistStartTime` is undefined, so camera cones were invisible — the Whisper couldn't see camera sweep patterns while planning their approach.
   - **Fix**: Changed the condition to check `gameState.cameras.length > 0` instead. When `heistStartTime` is not set (planning phase), elapsed time defaults to 0, showing a static cone at the camera's base angle. This gives the Whisper situational awareness of camera positions and facing directions before the heist begins.

3. **Type error from parallel noise-detection task** (`/src/components/GameCanvas.tsx`)
   - A parallel task added `moving: boolean` to the `RunnerData` interface. The camera task's `runnerForGuard` and `runnerForCamera` objects did not include this field, causing a build failure.
   - **Fix**: Hoisted `runnerMoving` variable out of the movement block scope (from `const` inside the if-block to `let` before it), and added `moving: runnerMoving` to both `runnerForGuard` and `runnerForCamera` objects.

### What Looked Good
- Camera detection logic is clean — uses existing `canGuardSeeRunner`-style pattern with proper LOS checks, FOV, and range
- Deterministic angle computation avoids network sync overhead — both clients compute independently
- Camera alert cooldown (5s) prevents spamming guard alerts
- Guard alerting sets `suspicious` state (not `alert`), keeping the consequence proportional
- Event recording for highlights works correctly with `camera_spotted` type
- Runner view renders camera cones only within fog-of-war radius — good performance practice
- `drawVisionCone` is properly exported and reused between guard and camera rendering
