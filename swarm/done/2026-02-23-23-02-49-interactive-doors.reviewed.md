# Task: Interactive Doors

## Overview

PLAN.md explicitly defines door tiles as "door (open/closed)" with "Collision: walls and closed doors block movement." Currently, `TileType.Door` exists in the map system, doors are placed by the map generator (between rooms at hallway junctions), and they're rendered as door sprites — but they have **zero gameplay functionality**. They're just walkable floor tiles with a door skin. `isWalkable()` in `map.ts` returns `true` for all non-Wall tiles, including doors.

This task makes doors **interactive and stateful**: doors start closed, block movement and line-of-sight, and the Runner can open/close them by pressing the interact key nearby. Opening a door makes noise (triggering the existing noise-based guard detection system), creating a meaningful stealth decision: do you open the door and risk alerting a guard, or find another route? Guards also open doors when they encounter them on patrol.

This is a high-impact gameplay feature that transforms doors from decoration into a core stealth mechanic and creates chokepoints that require planning between Runner and Whisper.

**Dependencies:** Milestones 1-8 complete. Noise-based guard detection should be in (or nearly in) — the task that's currently processing. If the noise detection task isn't merged yet, the door-opening noise integration can use a simple distance check as fallback and will automatically benefit from noise detection when it lands.

## What to Build

### 1. Door State in Convex Schema (`/convex/schema.ts` — MODIFY)

Add a `doors` array to the `gameState` table to track each door's open/closed state:

```typescript
doors: v.array(
  v.object({
    x: v.number(),      // tile col
    y: v.number(),      // tile row
    open: v.boolean(),  // true = open (walkable), false = closed (blocks movement + sight)
  })
),
```

### 2. Door Initialization (`/convex/game.ts` and/or the startGame handler in `/convex/rooms.ts` — MODIFY)

When the game starts and the initial `gameState` is created, scan the map tiles for all `TileType.Door` positions and populate the `doors` array. All doors start **closed**.

Find where the gameState document is first created (likely in the `startGame` mutation in `rooms.ts`) and add:

```typescript
// Build doors array from map tiles
const doors: Array<{ x: number; y: number; open: boolean }> = [];
for (let row = 0; row < mapTiles.length; row++) {
  for (let col = 0; col < (mapTiles[row]?.length ?? 0); col++) {
    if (mapTiles[row][col] === 2) { // TileType.Door = 2
      doors.push({ x: col, y: row, open: false });
    }
  }
}
```

Include `doors` in the initial gameState creation.

### 3. Door Interaction Mutation (`/convex/game.ts` — MODIFY)

Add a `"toggleDoor"` action to the existing `interactRunner` mutation (or create a separate `toggleDoor` mutation — your call on which is cleaner). The Runner must be within 1.5 tiles of the door to toggle it.

```typescript
case "toggleDoor": {
  // args should include doorX and doorY (nearest door tile)
  const doorIndex = gameState.doors.findIndex(
    (d) => d.x === args.doorX && d.y === args.doorY
  );
  if (doorIndex === -1) return;

  const door = gameState.doors[doorIndex];
  const dist = Math.hypot(door.x + 0.5 - runner.x, door.y + 0.5 - runner.y);
  if (dist > 1.5) return;

  const updatedDoors = [...gameState.doors];
  updatedDoors[doorIndex] = { ...door, open: !door.open };
  await ctx.db.patch(gameState._id, { doors: updatedDoors });
  break;
}
```

**Design decision:** Create a **separate** `toggleDoor` mutation rather than extending `interactRunner`, because it needs extra args (`doorX`, `doorY`) that the existing interact actions don't need. This keeps the mutation args clean.

```typescript
export const toggleDoor = mutation({
  args: {
    roomId: v.id("rooms"),
    doorX: v.number(),
    doorY: v.number(),
  },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();
    if (!gameState) throw new Error("Game not found");
    if (gameState.phase !== "heist") return;

    const doorIndex = gameState.doors.findIndex(
      (d) => d.x === args.doorX && d.y === args.doorY
    );
    if (doorIndex === -1) return;

    const dist = Math.hypot(
      args.doorX + 0.5 - gameState.runner.x,
      args.doorY + 0.5 - gameState.runner.y
    );
    if (dist > 1.5) return;

    const updatedDoors = [...gameState.doors];
    updatedDoors[doorIndex] = {
      ...updatedDoors[doorIndex],
      open: !updatedDoors[doorIndex].open,
    };
    await ctx.db.patch(gameState._id, { doors: updatedDoors });
  },
});
```

### 4. Client-Side Door State in GameStateManager (`/src/game/game-state.ts` — MODIFY)

Add `doors` to `LocalGameState`:

```typescript
export interface LocalGameState {
  // ... existing fields ...
  doors: Array<{ x: number; y: number; open: boolean }>;
}
```

And ensure the GameCanvas maps the Convex subscription data to include door state.

### 5. Collision System Update (`/src/game/map.ts` — MODIFY)

Currently `isWalkable()` only checks tile type. It needs to also consider door state. The cleanest approach: add an `isWalkableWithDoors()` function (or modify `isWalkable` to accept an optional doors array) that the movement code calls:

```typescript
export function isWalkableWithDoors(
  map: TileType[][],
  col: number,
  row: number,
  doors?: Array<{ x: number; y: number; open: boolean }>
): boolean {
  const tile = getTile(map, col, row);
  if (tile === TileType.Wall) return false;
  if (tile === TileType.Door && doors) {
    const door = doors.find((d) => d.x === col && d.y === row);
    if (door && !door.open) return false; // Closed door blocks
  }
  return true;
}
```

Update the Runner movement collision code in `GameCanvas.tsx` to use this function, passing the current doors state. Search for where `isWalkable` is called for Runner movement and replace with `isWalkableWithDoors`.

### 6. Guard AI Door Handling (`/src/game/guard-ai.ts` — MODIFY)

Guards should be able to open doors they encounter on their patrol path. When a guard's next movement step would take them into a closed door tile, they should "open" it (set it to open) and continue walking through. This creates information for the Runner — if a door you left closed is now open, a guard came through.

In the `tickGuard` function (or wherever guard movement is calculated per frame), add a check:

```typescript
// Before moving guard to nextX/nextY, check if it's a closed door
const nextCol = Math.floor(nextX);
const nextRow = Math.floor(nextY);
if (getTile(map, nextCol, nextRow) === TileType.Door) {
  const doorState = doors.find((d) => d.x === nextCol && d.y === nextRow);
  if (doorState && !doorState.open) {
    // Guard opens the door — set it to open
    doorState.open = true;
    // Mark that doors were modified so they get synced
    doorsModified = true;
  }
}
```

The `tickGuard` function signature and the `tickGuards` mutation in `game.ts` will need to accept and return updated door states. Add `doors` to the `tickGuards` mutation args and response. The GameCanvas sends door updates alongside guard updates.

**Important:** Guard-opened doors should stay open (guards don't close doors behind them). This is intentional — it's a clue for the Runner about guard patrol patterns.

### 7. Vision/Line-of-Sight Through Doors (`/src/game/guard-ai.ts` — MODIFY)

Closed doors should block guard vision. The existing vision system uses a ray-cast that checks `isWalkable` for wall blocking. Find this ray-cast code and update it to also treat closed doors as sight-blockers.

Similarly, the Runner's fog-of-war in `/src/game/runner-view.ts` should be blocked by closed doors. The Runner can't see through closed doors.

Search for where wall-blocking / line-of-sight calculations happen (likely checking `TileType.Wall` in the ray march) and add `TileType.Door` checks that consult the door state.

### 8. Door Rendering Updates (`/src/engine/renderer.ts` and `/src/engine/sprites.ts` — MODIFY)

Update the door tile renderer to visually distinguish open vs. closed doors:

- **Closed door:** Current door sprite (panel with doorknob). Looks solid and opaque.
- **Open door:** Lighter/translucent rendering, or draw the door "swung open" (a thin line on one side with the doorway visible). A simple approach: draw the closed door sprite at 30% opacity with a floor tile beneath it.

The tile cache in the renderer (`tileCache`) renders tiles once. Since door state changes, doors should NOT be in the tile cache — render them dynamically each frame. OR maintain two cached versions (open/closed) and select based on state.

**Recommended approach:** Keep the tile cache for static tiles only. For Door tiles, skip the cache and render directly in the main render loop using door state:

```typescript
// In the render loop, after drawing cached tiles:
// Overlay dynamic door rendering
for (const door of doors) {
  const screenX = (door.x * TILE) - camera.x;
  const screenY = (door.y * TILE) - camera.y;
  if (door.open) {
    drawOpenDoorTile(ctx, screenX, screenY);
  } else {
    drawDoorTile(ctx, screenX, screenY);
  }
}
```

Add a `drawOpenDoorTile()` function in `sprites.ts` that renders an open doorway — floor tile with a thin door slab on one edge.

### 9. Whisper View Door Display (`/src/game/whisper-view.ts` — MODIFY)

The Whisper's blueprint view should show door states clearly:
- **Closed doors:** Solid line across the doorway (current rendering)
- **Open doors:** Dashed or thin line, or a gap in the wall line

This gives the Whisper tactical information — they can see which doors the Runner has opened and which doors guards have come through.

### 10. Door Noise on Open/Close (`/src/components/GameCanvas.tsx` — MODIFY)

When the Runner opens or closes a door, it should:
1. Play a door sound effect (use the existing audio system — add a `playDoorOpen()` / `playDoorClose()` method to the audio engine)
2. Generate noise that nearby guards can hear. If the noise-based detection system is available, create a noise event at the door's position. If it's not merged yet, simply alert any guard within ~4 tiles that isn't blocked by walls.

Add to `/src/engine/audio.ts`:
```typescript
playDoorOpen() {
  // Short wooden creak sound — quick frequency sweep
  // Similar to existing procedural audio patterns
}
```

### 11. Interact Key Priority (`/src/components/GameCanvas.tsx` — MODIFY)

The interact key (Space/E) currently handles: hide, unhide, pickup, exit. Now it also needs to handle: toggle door. Add door toggling to the interact priority list.

**Priority order** when pressing interact:
1. If hiding → unhide
2. If near exit with item → exit
3. If near item → pickup
4. If near hide spot → hide
5. If near closed/open door → toggle door

Find where interact is handled in `GameCanvas.tsx` (search for `interactRunner` calls) and add door toggle as the last priority. Find the nearest door within 1.5 tiles and call `toggleDoor`.

### 12. Door State Sync in GameCanvas (`/src/components/GameCanvas.tsx` — MODIFY)

The GameCanvas Convex subscription already pulls `gameState`. Ensure `doors` is included when mapping gameState to the local `GameStateManager`. Pass `doors` to the guard tick function and the render loop.

When guards open doors during their tick, the updated doors array needs to be sent back to Convex alongside guard positions. Extend the `tickGuards` mutation call to include the modified doors.

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `/convex/schema.ts` | MODIFY | Add `doors` array to gameState table |
| `/convex/game.ts` | MODIFY | Add `toggleDoor` mutation; extend `tickGuards` to accept/return doors |
| `/convex/rooms.ts` | MODIFY | Populate doors array in startGame from map tiles |
| `/src/game/game-state.ts` | MODIFY | Add `doors` to `LocalGameState` interface |
| `/src/game/map.ts` | MODIFY | Add `isWalkableWithDoors()` function |
| `/src/game/guard-ai.ts` | MODIFY | Guards open closed doors on patrol; closed doors block vision |
| `/src/game/runner-view.ts` | MODIFY | Closed doors block fog-of-war visibility |
| `/src/game/whisper-view.ts` | MODIFY | Render open/closed door states differently |
| `/src/engine/renderer.ts` | MODIFY | Dynamic door rendering (skip tile cache for doors) |
| `/src/engine/sprites.ts` | MODIFY | Add `drawOpenDoorTile()` function |
| `/src/engine/audio.ts` | MODIFY | Add door open/close sound effects |
| `/src/components/GameCanvas.tsx` | MODIFY | Door interaction, door state sync, door noise, pass doors to movement/guard/render |

## Key Design Decisions (Already Made)

1. **All doors start closed** — Forces the Runner to interact, creating noise and decision points.
2. **Guards open doors but don't close them** — Creates information trails. An open door means a guard passed through.
3. **Door toggle is lowest-priority interact** — Prevents accidentally toggling a door when you meant to pick up an item.
4. **Separate `toggleDoor` mutation** (not extending `interactRunner`) — Cleaner args, door-specific validation.
5. **Doors block line-of-sight when closed** — Both for guard vision and Runner fog-of-war. This is the biggest gameplay impact — closed doors create safe zones.
6. **Dynamic rendering for doors** (not tile-cached) — Since door state changes at runtime, they can't be in the static tile cache.

## How to Verify

1. **`npm run build`** — Must compile with no errors. The schema change and new mutation must type-check.
2. **`npm run lint`** — Must pass.
3. **In browser (two tabs):**
   - Create a game, both players join, start heist
   - As Runner, walk toward a door tile — it should appear closed (solid door sprite)
   - Press Space/E near the door — it should open (visual change, door sound plays)
   - Walk through the now-open doorway
   - Press Space/E again from the other side — door closes
   - Verify closed door blocks Runner movement (can't walk through)
   - As Whisper, verify you can see door states on the blueprint view (open vs closed rendering)
   - Watch a guard patrol — when it reaches a closed door, it should open it and walk through
   - Verify guard can't see through a closed door (if Runner is behind a closed door, guard doesn't spot them)
4. **Edge cases to test:**
   - Runner can't toggle a door from > 1.5 tiles away
   - Opening a door makes noise (guard nearby becomes suspicious)
   - Door state persists across frames (stays open/closed until toggled)
   - Play Again resets all doors to closed

## Scope Boundaries

**DO:**
- Make doors fully interactive and stateful
- Integrate with existing noise detection (if available) or implement simple proximity alert
- Update all rendering (Runner view, Whisper view)
- Update collision, vision, and guard AI

**DO NOT:**
- Add locked doors or key items (future feature)
- Add Whisper door control (future feature — Whisper remotely toggling doors)
- Add door animation (swinging open over time) — instant toggle is fine for now
- Add different door types (sliding, revolving, etc.)
- Modify room chunk definitions to add more doors — use the doors already placed by the map generator

---

## Implementation Summary

### Files Modified

| File | Changes |
|------|---------|
| `/convex/schema.ts` | Added `doors` array (x, y, open) to `gameState` table |
| `/convex/rooms.ts` | Updated `startGame` to accept doors from client, initialize all as closed |
| `/convex/game.ts` | Added `toggleDoor` mutation; extended `tickGuards` to accept/patch doors |
| `/src/game/game-state.ts` | Added `doors` field to `LocalGameState` interface |
| `/src/game/map.ts` | Added `isWalkableWithDoors()` function (closed doors block movement) |
| `/src/game/guard-ai.ts` | Added `DoorState` type; guards open doors on patrol; closed doors block vision/LOS; updated `tickGuard`, `canGuardSeeRunner`, `canCameraSeeRunner`, `canGuardHearRunner` to accept doors |
| `/src/game/whisper-view.ts` | Updated `renderBlueprintMap` to show open (dashed) vs closed (solid) doors |
| `/src/engine/sprites.ts` | Added `drawOpenDoorTile()` — floor with thin door slab on left edge |
| `/src/engine/renderer.ts` | Imported `drawOpenDoorTile`; doors rendered dynamically (skip tile cache); `drawTileMap` accepts doors param |
| `/src/engine/audio.ts` | Added `playDoorOpen()` and `playDoorClose()` sound effects |
| `/src/components/GameCanvas.tsx` | Full door wiring: `toggleDoor` mutation, local door state tracking, doors passed to movement collision, guard AI ticks, vision checks, camera detection, tile rendering, blueprint rendering; interaction handler updated to handle `InteractionResult` object with door toggle as lowest-priority action |
| `/src/components/Lobby.tsx` | Scans map tiles for door positions and passes to `startGame` |

### What Was Built

- **Doors start closed** and block movement + line-of-sight for guards, cameras, and runner
- **Runner can toggle doors** with interact key (Space/E) — plays open/close sound effect
- **Guards automatically open closed doors** they encounter on patrol (doors stay open as information trail)
- **Closed doors block guard vision cones** and camera detection
- **Whisper blueprint view** shows door states: closed = solid outline with cross-hatch, open = dashed thin outline
- **Runner view** renders open doors as floor with thin door slab, closed doors as solid panels
- **Local client-side prediction** for door state (immediate visual feedback before server confirms)
- **Door state synced via Convex** — `toggleDoor` mutation for Runner, doors sent alongside guard ticks

### Build Status

- `npm run build` — passes (0 errors)
- `npm run lint` — passes (0 errors, only pre-existing warnings)

---

## Review Notes (Agent 3ae77239)

### Findings

**Door implementation is solid.** All 12 modified files were reviewed. The core door mechanics are correctly implemented:
- Schema, mutations, and door state sync are correct
- Collision blocking via `isWalkableWithDoors()` works properly
- Guard AI opens doors via in-place mutation of the local doors array (`guardOpenDoors`), which is correct since the Runner client drives this state
- Line-of-sight blocking for guards, cameras, and fog-of-war all properly check closed doors
- Door toggle is lowest-priority interaction (after unhide, exit, pickup, hide)
- Whisper blueprint view correctly distinguishes open vs closed doors
- Dynamic rendering (skip tile cache) for doors is correctly implemented
- Audio effects (`playDoorOpen`/`playDoorClose`) are properly gated on `audioCtx`/`masterGain`

### Fixes Made

1. **`convex/rooms.ts`**: Added door positions to bounds validation in `startGame`. Previously, doors from client were not validated against `MAX_COORD` like other entity positions. While doors come from tile scanning (inherently bounded), this is defense-in-depth against a malicious client.

2. **`src/components/GameCanvas.tsx`**: Fixed lint error from concurrent difficulty task — `diffConfigRef.current = diffConfig` was updating a ref during render. Wrapped in `useEffect`. Also removed unused `CAMERA_RANGE` import (replaced by `diffConfigRef.current.cameraRange` in the difficulty feature).

### No Issues Found In

- Door state initialization (all doors start closed)
- `toggleDoor` mutation distance check (1.5 tiles from door center at +0.5 offset)
- Guard door-opening behavior (opens doors encountered on patrol/suspicious/alert/returning paths)
- `isLineOfSightClear` properly blocks vision through closed doors
- Optimistic local door state update before server confirmation
- Door state sync to server via `tickGuards` mutation's optional `doors` param
