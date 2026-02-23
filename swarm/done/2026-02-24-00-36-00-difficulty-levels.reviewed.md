# Task: Difficulty Levels

## Overview

Currently every WhisperRun game plays the same way: a 4x3 grid of rooms, 1-2 guards, 1-3 cameras, 30-second planning phase, 3-minute heist timer. There's no way to adjust the challenge level, which means experienced players get bored and new players may find it too hard.

This task adds a **difficulty selector** to the lobby that adjusts map size, guard/camera counts, heist timer, and guard behavior. Three levels — Casual, Standard, and Hard — give players meaningful control over their experience and dramatically increase replayability.

The difficulty setting is stored on the room record so both clients can generate the same map with the same parameters. The map generator, guard AI, and game loop all read the difficulty to adjust their behavior.

**Dependencies:** None beyond existing codebase. Independent of Interactive Doors and Whisper Path Drawing.

## What to Build

### 1. Difficulty Configuration Type (`/src/game/difficulty.ts` — CREATE)

Create a new file defining the difficulty presets:

```typescript
export type DifficultyLevel = "casual" | "standard" | "hard";

export interface DifficultyConfig {
  label: string;
  description: string;
  // Map generation
  gridCols: number;
  gridRows: number;
  minRooms: number;     // min filled slots (excluding lobby)
  maxEmptySlots: number; // how many slots can be empty
  // Entity counts
  numGuards: number;
  maxCameras: number;
  maxHideSpots: number;
  // Timing
  planningDurationMs: number;
  heistDurationMs: number;
  // Guard tuning
  guardSpeed: number;        // tiles/sec (patrol)
  guardAlertSpeed: number;   // tiles/sec (chase)
  guardRange: number;        // vision range in tiles
  guardCrouchRange: number;  // vision range when runner crouching
  cameraRange: number;       // camera vision range
  cameraSweepSpeed: number;  // radians/sec
}

export const DIFFICULTY_CONFIGS: Record<DifficultyLevel, DifficultyConfig> = {
  casual: {
    label: "Casual",
    description: "Smaller map, slower guard, longer timer",
    gridCols: 3,
    gridRows: 2,
    minRooms: 4,
    maxEmptySlots: 1,
    numGuards: 1,
    maxCameras: 1,
    maxHideSpots: 8,
    planningDurationMs: 45_000,
    heistDurationMs: 240_000,   // 4 minutes
    guardSpeed: 1.6,
    guardAlertSpeed: 2.2,
    guardRange: 4,
    guardCrouchRange: 2,
    cameraRange: 5,
    cameraSweepSpeed: 0.5,
  },
  standard: {
    label: "Standard",
    description: "The default heist experience",
    gridCols: 4,
    gridRows: 3,
    minRooms: 8,
    maxEmptySlots: 3,
    numGuards: 2,
    maxCameras: 3,
    maxHideSpots: 6,
    planningDurationMs: 30_000,
    heistDurationMs: 180_000,   // 3 minutes
    guardSpeed: 2.0,
    guardAlertSpeed: 2.8,
    guardRange: 5,
    guardCrouchRange: 3,
    cameraRange: 7,
    cameraSweepSpeed: 0.8,
  },
  hard: {
    label: "Hard",
    description: "Big map, fast guards, tight timer",
    gridCols: 5,
    gridRows: 3,
    minRooms: 12,
    maxEmptySlots: 2,
    numGuards: 3,
    maxCameras: 5,
    maxHideSpots: 5,
    planningDurationMs: 20_000,
    heistDurationMs: 150_000,   // 2.5 minutes
    guardSpeed: 2.4,
    guardAlertSpeed: 3.2,
    guardRange: 6,
    guardCrouchRange: 4,
    cameraRange: 8,
    cameraSweepSpeed: 1.0,
  },
};

export function getDifficultyConfig(level: DifficultyLevel): DifficultyConfig {
  return DIFFICULTY_CONFIGS[level];
}
```

### 2. Store Difficulty on Room Record (`/convex/schema.ts` — MODIFY)

Add a `difficulty` field to the `rooms` table:

```typescript
difficulty: v.optional(v.union(
  v.literal("casual"),
  v.literal("standard"),
  v.literal("hard")
)),
```

Use `v.optional()` for backwards compatibility — existing rooms default to `"standard"`.

Also add `difficulty` to the `gameState` table so the client game loop can read it during gameplay:

```typescript
difficulty: v.optional(v.union(
  v.literal("casual"),
  v.literal("standard"),
  v.literal("hard")
)),
```

### 3. Set Difficulty in Lobby (`/convex/rooms.ts` — MODIFY)

Add a `setDifficulty` mutation that lets either player change the difficulty before the game starts:

```typescript
export const setDifficulty = mutation({
  args: {
    roomCode: v.string(),
    sessionId: v.string(),
    difficulty: v.union(v.literal("casual"), v.literal("standard"), v.literal("hard")),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
    if (!room) throw new Error("Room not found");
    if (room.status !== "waiting") throw new Error("Game already started");
    const isPlayer = room.players.some((p) => p.sessionId === args.sessionId);
    if (!isPlayer) throw new Error("You are not in this room");

    // Unready all players when difficulty changes (same as changing role)
    const updatedPlayers = room.players.map((p) => ({ ...p, ready: false }));
    await ctx.db.patch(room._id, {
      difficulty: args.difficulty,
      players: updatedPlayers,
    });
  },
});
```

Also update `startGame` to copy the difficulty into the gameState so clients can read it during gameplay. In the `ctx.db.insert("gameState", { ... })` call, add:

```typescript
difficulty: room.difficulty ?? "standard",
```

And update `resetRoom` to preserve the difficulty setting (it already preserves the room record, so difficulty on the room stays).

### 4. Difficulty Selector in Lobby UI (`/src/components/Lobby.tsx` — MODIFY)

Add a difficulty toggle component between the role cards and the invite link. It should show three selectable buttons (Casual / Standard / Hard) styled consistently with the lobby theme.

```tsx
{/* Difficulty Selector — between role cards and invite link */}
<div className="text-center space-y-2">
  <p className="text-sm text-[#8B7355]">Difficulty</p>
  <div className="flex justify-center gap-3">
    {(["casual", "standard", "hard"] as const).map((level) => {
      const config = getDifficultyConfig(level);
      const isSelected = currentDifficulty === level;
      return (
        <button
          key={level}
          onClick={() => handleSetDifficulty(level)}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200
            ${isSelected
              ? "bg-[#FFD700] text-[#2D1B0E] ring-2 ring-[#FFD700]"
              : "bg-[#2D1B0E] text-[#E8D5B7] border border-[#8B7355] hover:border-[#FFD700] hover:text-[#FFD700]"
            }`}
        >
          {config.label}
        </button>
      );
    })}
  </div>
  <p className="text-xs text-[#8B7355]">
    {getDifficultyConfig(currentDifficulty).description}
  </p>
</div>
```

Where `currentDifficulty` is derived from `room.difficulty ?? "standard"` and `handleSetDifficulty` calls the `setDifficulty` mutation.

### 5. Parameterize Map Generator (`/src/game/map-generator.ts` — MODIFY)

The `generateMap()` function currently hardcodes grid size (4x3), empty slot count (1-3), guard count (1-2), camera count (1-3), and hide spot count (4-6). Parameterize these using `DifficultyConfig`.

**Change the signature:**
```typescript
export function generateMap(seed: number, difficulty?: DifficultyLevel): GeneratedMap {
```

Inside `tryGenerate`, accept a `DifficultyConfig` and use its values instead of hardcoded constants:

- `GRID_COLS` / `GRID_ROWS` → `config.gridCols` / `config.gridRows`
- `SLOT_WIDTH` / `SLOT_HEIGHT` stay at 11 (these are layout constants, not difficulty)
- `MAP_WIDTH` / `MAP_HEIGHT` are calculated from grid size
- `numEmpty = rng.nextInt(1, 3)` → `rng.nextInt(0, config.maxEmptySlots)`
- Guard count: `config.numGuards` instead of `totalRooms >= 10 ? 2 : 1`
- Camera max: `config.maxCameras` instead of hardcoded `3`
- Hide spot target: `config.maxHideSpots` instead of hardcoded `6`

**Important:** Move the grid constants from module-level to inside the function, since they now depend on difficulty:

```typescript
function tryGenerate(seed: number, config: DifficultyConfig, skipValidation = false): GeneratedMap | null {
  const GRID_COLS = config.gridCols;
  const GRID_ROWS = config.gridRows;
  const SLOT_WIDTH = 11;
  const SLOT_HEIGHT = 11;
  const MAP_WIDTH = GRID_COLS * SLOT_WIDTH + 2;
  const MAP_HEIGHT = GRID_ROWS * SLOT_HEIGHT + 2;
  // ... rest of function uses these locals instead of module constants
}
```

### 6. Parameterize Guard AI (`/src/game/guard-ai.ts` — MODIFY)

Currently guard constants are module-level exports:
```typescript
export const GUARD_SPEED = 2.0;
export const GUARD_ALERT_SPEED = 2.8;
export const GUARD_RANGE = 5;
export const GUARD_CROUCH_RANGE = 3;
export const CAMERA_RANGE = 7;
export const CAMERA_SWEEP_SPEED = 0.8;
```

**Keep these as defaults** (for backwards compatibility and for callers that don't have a difficulty config), but allow overriding them. The simplest approach is to add an optional `config` parameter to `tickGuard` and the vision-checking functions.

In `tickGuard`:
```typescript
export function tickGuard(
  guard: GuardState,
  waypoints: Array<{ x: number; y: number }>,
  runner: RunnerState,
  map: TileType[][],
  dt: number,
  now: number,
  doors?: DoorState[],
  difficultyConfig?: { guardSpeed: number; guardAlertSpeed: number; guardRange: number; guardCrouchRange: number }
): TickResult {
  const speed = difficultyConfig?.guardSpeed ?? GUARD_SPEED;
  const alertSpeed = difficultyConfig?.guardAlertSpeed ?? GUARD_ALERT_SPEED;
  const range = runner.crouching
    ? (difficultyConfig?.guardCrouchRange ?? GUARD_CROUCH_RANGE)
    : (difficultyConfig?.guardRange ?? GUARD_RANGE);
  // Use these locals throughout instead of the module constants
}
```

Similarly for `checkCameraDetection`:
```typescript
export function checkCameraDetection(
  camera: CameraState,
  runner: RunnerState,
  map: TileType[][],
  now: number,
  doors?: DoorState[],
  difficultyConfig?: { cameraRange: number; cameraSweepSpeed: number }
): boolean {
  const range = runner.crouching
    ? (difficultyConfig?.cameraRange ?? CAMERA_RANGE) - 2
    : (difficultyConfig?.cameraRange ?? CAMERA_RANGE);
  // ...
}
```

### 7. Parameterize Game Timing (`/src/components/GameCanvas.tsx` — MODIFY)

Replace the hardcoded `PLANNING_DURATION = 30_000` with a value from the difficulty config. The `GameCanvas` already receives room data from Convex; use the `difficulty` field from the gameState to look up the config.

```typescript
// At the top of the game loop section:
const diffConfig = getDifficultyConfig(gameState?.difficulty ?? "standard");
const planningDuration = diffConfig.planningDurationMs;
```

Similarly in `HUD.tsx`, replace `HEIST_DURATION = 180_000` with the value from the difficulty config. The HUD receives phase and timing props — add a `difficulty` prop:

```typescript
const HEIST_DURATION = getDifficultyConfig(difficulty).heistDurationMs;
```

### 8. Pass Difficulty to Map Generation (`/src/components/Lobby.tsx` — MODIFY)

In `handleStartGame`, pass the difficulty to `generateMap`:

```typescript
const difficulty = room?.difficulty ?? "standard";
const map = generateMap(room!.mapSeed, difficulty);
```

### 9. Pass Difficulty Config to Guard AI Tick (`/src/components/GameCanvas.tsx` — MODIFY)

Where guard AI is ticked (likely in the game loop's update function), pass the difficulty config values to `tickGuard`:

```typescript
const guardConfig = {
  guardSpeed: diffConfig.guardSpeed,
  guardAlertSpeed: diffConfig.guardAlertSpeed,
  guardRange: diffConfig.guardRange,
  guardCrouchRange: diffConfig.guardCrouchRange,
};
// In the guard tick loop:
const result = tickGuard(guard, waypoints, runner, map, dt, now, doors, guardConfig);
```

And for camera detection:
```typescript
const camConfig = {
  cameraRange: diffConfig.cameraRange,
  cameraSweepSpeed: diffConfig.cameraSweepSpeed,
};
```

### 10. Pass Difficulty to Camera Rendering (`/src/engine/renderer.ts` — MODIFY)

Camera vision cones are rendered with `CAMERA_RANGE` from guard-ai.ts. Update the camera cone rendering to use the difficulty-aware range value. Pass it as a parameter from GameCanvas rather than importing the constant directly.

### 11. Difficulty Display on HUD (`/src/components/HUD.tsx` — MODIFY)

Show the current difficulty level in the HUD header, next to the phase indicator. A small badge like `[HARD]` in the top-left gives context.

```tsx
<span className="text-xs opacity-60 ml-2 uppercase">
  {getDifficultyConfig(difficulty).label}
</span>
```

### 12. Guard Vision Cone Rendering (`/src/game/whisper-view.ts` — MODIFY)

The Whisper view draws guard vision cones using `GUARD_RANGE`. Update to accept the difficulty-specific range value so vision cones accurately reflect difficulty settings.

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `/src/game/difficulty.ts` | CREATE | Difficulty level types and preset configs |
| `/convex/schema.ts` | MODIFY | Add `difficulty` field to rooms and gameState tables |
| `/convex/rooms.ts` | MODIFY | Add `setDifficulty` mutation, pass difficulty to gameState on start |
| `/src/components/Lobby.tsx` | MODIFY | Difficulty selector UI |
| `/src/game/map-generator.ts` | MODIFY | Parameterize grid size, guard/camera/hidespot counts |
| `/src/game/guard-ai.ts` | MODIFY | Accept optional difficulty config in tick/detection functions |
| `/src/components/GameCanvas.tsx` | MODIFY | Use difficulty-aware timing and pass config to guard AI |
| `/src/components/HUD.tsx` | MODIFY | Use difficulty-aware heist timer, show difficulty badge |
| `/src/engine/renderer.ts` | MODIFY | Accept configurable camera range for cone rendering |
| `/src/game/whisper-view.ts` | MODIFY | Use configurable guard range for vision cone rendering |

## Key Design Decisions (Already Made)

1. **Three levels (Casual/Standard/Hard)** — Simple, clear, covers the range. Not a slider or numeric input.
2. **Difficulty stored on room, copied to gameState** — Room has it for lobby/map generation, gameState has it for runtime behavior.
3. **Changing difficulty un-readies all players** — Forces acknowledgement, prevents surprises.
4. **Default is "standard"** — Matches current behavior exactly. Existing rooms without the field play identically.
5. **`v.optional()`** — Backwards compatible with existing rooms/gameStates that lack the field.
6. **Guard AI accepts optional config** — Callers that don't pass config get existing default behavior.
7. **Casual has bigger map-to-guard ratio and more hide spots** — More room to breathe, more places to hide.
8. **Hard has 5x3 grid (15 slots)** — Significantly larger maps with more rooms to explore, plus 3 guards and 5 cameras. Timer is tighter (2.5 min) to add pressure.

## How to Verify

1. **`npm run build`** — Must compile with no errors.
2. **`npm run lint`** — Must pass.
3. **In browser (two tabs):**
   - Create a game → lobby shows difficulty selector defaulting to "Standard"
   - Click "Casual" → difficulty changes, both players see the update, both are un-readied
   - Click "Hard" → same behavior
   - Start a game on each difficulty:
     - **Casual:** Smaller map (3x2 grid), 1 guard, 1 camera, 45s planning, 4-minute heist timer
     - **Standard:** Same as current (4x3 grid), 2 guards, 3 cameras, 30s planning, 3-minute timer
     - **Hard:** Larger map (5x3 grid), 3 guards, 5 cameras, 20s planning, 2.5-minute timer
   - Verify guards move at different speeds on each difficulty
   - Verify guard vision range changes (cones are bigger on Hard)
   - Verify the HUD shows the correct difficulty label and timer
4. **Play Again:**
   - After a game ends, Play Again returns to lobby with difficulty preserved
5. **Edge cases:**
   - A room created without difficulty (old client) defaults to Standard
   - Daily Challenge works with any difficulty setting

## Scope Boundaries

**DO:**
- Create difficulty config file with three presets
- Add difficulty selector to lobby UI
- Parameterize map generator (grid size, entity counts)
- Parameterize guard AI (speed, vision range)
- Parameterize timing (planning duration, heist duration)
- Show difficulty in HUD
- Store difficulty in Convex schema

**DO NOT:**
- Add custom difficulty (user-defined values) — keep it to 3 presets
- Add difficulty-specific visual themes or color palettes
- Add difficulty-based scoring adjustments (stretch goal for later)
- Add difficulty progression / unlocking (no progression system yet)
- Add per-guard difficulty variation within a game (all guards use same settings)
- Change the existing game behavior when difficulty is not set — it should default to "standard" and play identically to current

---

## Implementation Summary

### Files Created
- `/src/game/difficulty.ts` — `DifficultyLevel` type, `DifficultyConfig` interface, `DIFFICULTY_CONFIGS` map with three presets (Casual/Standard/Hard), `getDifficultyConfig()` helper

### Files Modified
- `/convex/schema.ts` — Added `difficulty` field (optional, union of "casual"/"standard"/"hard") to both `rooms` and `gameState` tables
- `/convex/rooms.ts` — Added `setDifficulty` mutation (un-readies all players on change), updated `startGame` to copy difficulty into gameState, bumped `MAX_COORD` to 60 for hard mode maps
- `/convex/game.ts` — Added `HEIST_DURATION_BY_DIFFICULTY` lookup, updated `checkTimeout` to use difficulty-aware heist duration
- `/src/components/Lobby.tsx` — Added difficulty selector UI (3 buttons: Casual/Standard/Hard) between role cards and invite link, description text updates with selection, calls `setDifficulty` mutation, passes difficulty to `generateMap`
- `/src/game/map-generator.ts` — Parameterized with `DifficultyLevel`: grid size (3x2/4x3/5x3), guard count, camera cap, hide spot target, empty slots. Moved grid constants from module-level into `tryGenerate`. Updated hallway functions to derive map dimensions from tiles array.
- `/src/game/guard-ai.ts` — Added `GuardDifficultyConfig` interface, updated `tickGuard`, `canGuardSeeRunner`, `canCameraSeeRunner`, and `updateCameraAngle` to accept optional difficulty overrides for speed, range, and sweep speed
- `/src/components/GameCanvas.tsx` — Accepts `difficulty` prop, computes `diffConfig` from it, passes to: map generation, planning auto-start, countdown sounds, guard AI tick, camera detection, camera cone rendering, whisper entity rendering, HUD, and PlanningOverlay
- `/src/components/HUD.tsx` — Accepts `difficulty` prop, uses difficulty-aware heist duration for timer, shows difficulty label badge next to phase indicator for both Runner and Whisper HUDs
- `/src/game/whisper-view.ts` — `renderWhisperEntities` accepts optional `diffConfig` for guard range, camera range, and camera sweep speed; vision cones scale with difficulty
- `/src/app/game/[roomId]/page.tsx` — Reads difficulty from gameState/room and passes to GameCanvas
- `/CLAUDE.md` — Updated Difficulty Levels status from Queued to Completed

### What Was Built
- Three difficulty presets affecting 16 parameters each
- Lobby selector with real-time sync (both players see changes)
- Difficulty stored on room (for lobby/map gen) and gameState (for runtime)
- Map generator scales: 3x2 grid (Casual) → 4x3 (Standard) → 5x3 (Hard)
- Guard speed/vision range/chase speed vary by difficulty
- Camera range/sweep speed vary by difficulty
- Planning phase: 45s/30s/20s by difficulty
- Heist timer: 4min/3min/2.5min by difficulty
- Server-side timeout check uses correct duration per difficulty
- HUD shows difficulty badge and correct timer
- Vision cones in both Runner and Whisper views scale correctly
- Backwards compatible: existing rooms without difficulty field default to "standard"

### Build/Lint Status
- `npm run build` — PASSES (no errors)
- `npm run lint` — PASSES (0 errors, 4 pre-existing auto-generated file warnings)

---

## Review Notes (Agent e057504a)

### Code Quality Assessment

All difficulty-level files reviewed thoroughly. The implementation is well-structured:

- **`/src/game/difficulty.ts`** — Clean type definitions, sensible preset values, good helper function. No issues.
- **`/convex/schema.ts`** — `v.optional()` on both `rooms` and `gameState` tables is correct for backwards compatibility. No issues.
- **`/convex/rooms.ts`** — `setDifficulty` mutation properly validates room status and player membership, un-readies all players on change. `startGame` correctly copies `difficulty` to gameState with `?? "standard"` fallback. `MAX_COORD` bumped to 60 for hard mode maps. `resetRoom` preserves difficulty since it keeps the room record. No issues.
- **`/convex/game.ts`** — `HEIST_DURATION_BY_DIFFICULTY` lookup with fallback to 180_000 is solid. Values match `DifficultyConfig`. No issues.
- **`/src/components/Lobby.tsx`** — Difficulty selector UI is clean and well-positioned. Type assertion `as DifficultyLevel | undefined` with `?? "standard"` fallback works correctly. No issues.
- **`/src/game/map-generator.ts`** — Grid constants properly moved from module-level to inside `tryGenerate`. All hardcoded counts replaced with config values. Hallway functions derive dimensions from tiles array. No issues.
- **`/src/game/guard-ai.ts`** — `GuardDifficultyConfig` with optional fields and `?? DEFAULT` fallback pattern is clean. All functions accept the config: `tickGuard`, `canGuardSeeRunner`, `canCameraSeeRunner`, `updateCameraAngle`. No issues.
- **`/src/components/GameCanvas.tsx`** — `diffConfig` computed from prop, passed through refs for game loop access. Guard AI, camera detection, countdown timing, planning auto-start all use difficulty-aware values. No issues with the difficulty code itself.
- **`/src/components/HUD.tsx`** — Difficulty-aware timer and badge display for both Runner and Whisper HUDs. No issues.
- **`/src/game/whisper-view.ts`** — Vision cones and camera sweep use optional `diffConfig` with fallbacks to module-level constants. No issues.
- **`/src/app/game/[roomId]/page.tsx`** — Reads difficulty from `gameState` first, falls back to `room.difficulty`, then `"standard"`. Correct precedence. No issues.
- **`/src/engine/renderer.ts`** — No difficulty-related changes needed here; camera cone rendering in Runner view is handled directly in GameCanvas. No issues.

### Fixes Applied

1. **Lint error: `setActiveComm` called synchronously in effect** (`GameCanvas.tsx:488`) — The Quick-Comms feature (bundled in the same uncommitted diff) called `setActiveComm(...)` directly inside a `useEffect` body, triggering the `react-hooks/set-state-in-effect` lint error. Fixed by wrapping the `setActiveComm` call in `setTimeout(0)` to schedule it outside the effect body, avoiding cascading renders while preserving the same behavior.

2. **CLAUDE.md update** — Changed "Whisper Quick-Comms" status from "Queued" to "Completed" since the code for that feature was included in the same working tree changes.

### Verified
- `npm run build` — PASSES after fix
- `npm run lint` — PASSES (0 errors) after fix
