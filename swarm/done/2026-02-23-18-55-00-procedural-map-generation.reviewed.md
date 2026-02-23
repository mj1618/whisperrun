# Task: Procedural Map Generation & Target Items (Milestone 7)

## Overview

Replace the static `TEST_MAP` with a seed-based procedural map generator. The generator stitches pre-defined room chunks into a connected apartment layout, places guards, items, hide spots, cameras, and exit/spawn points, and provides patrol waypoints for each guard. Both clients derive the same map from the same seed (stored in `room.mapSeed`), so no map data needs to be stored in Convex — just the seed.

After this milestone, every game session plays on a different procedurally-generated map, dramatically increasing replayability. The target item is randomly selected from a pool of silly items.

**Dependencies:** Milestones 1–6 should be complete. The map generator is a new module that replaces the hardcoded `TEST_MAP` import. All existing code uses `getTile`/`isWalkable`/`getMapWidth`/`getMapHeight` from `map.ts`, so the integration surface is well-defined.

## What to Build

### 1. Seeded Random Utility (`/src/lib/random.ts` — NEW FILE)

A simple, deterministic pseudo-random number generator (PRNG) so both clients generate identical maps from the same seed.

```typescript
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    // Mulberry32 — fast, good-enough PRNG
    this.state |= 0;
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Pick a random element from an array */
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Shuffle array in-place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
```

### 2. Room Chunk Templates (`/src/game/room-chunks.ts` — NEW FILE)

Define 8–12 room chunk templates as small tile arrays. Each chunk is a rectangular grid (e.g., 7x7, 9x7, 7x9) with walls on the perimeter but **designated openings** on specific edges where doors/connections can go.

#### Chunk structure

```typescript
import { TileType } from "@/game/map";

const W = TileType.Wall;
const F = TileType.Floor;
const H = TileType.HideSpot;
const C = TileType.Camera;

export interface RoomChunk {
  name: string;
  tiles: TileType[][];      // The tile grid (rows x cols)
  width: number;             // cols
  height: number;            // rows
  /** Edges that have an opening (door slot). "top"/"bottom" = column index, "left"/"right" = row index. */
  openings: {
    top?: number[];    // column indices where top wall has a door slot
    bottom?: number[]; // column indices where bottom wall has a door slot
    left?: number[];   // row indices where left wall has a door slot
    right?: number[];  // row indices where right wall has a door slot
  };
  /** Preferred entity spawn positions (tile-local coordinates). Generator picks from these. */
  guardSpawns?: Array<{ x: number; y: number }>;
  hideSpots?: Array<{ x: number; y: number }>;
  cameraSpots?: Array<{ x: number; y: number }>;
  itemSpots?: Array<{ x: number; y: number }>;
}
```

#### Room types to define (8 chunks minimum)

1. **Office** (9×7) — Desk rows, a hide spot (under desk), camera mount on one wall. Openings on left and right.
2. **Hallway Horizontal** (9×5) — Narrow corridor running left-right, doors on both ends and possibly one side. Good for connecting rooms.
3. **Hallway Vertical** (5×9) — Narrow corridor running top-bottom. Doors top and bottom, possibly one side.
4. **Storage Room** (7×7) — Shelving units (wall tiles inside creating aisles), two hide spots, one item spot. One or two openings.
5. **Living Room** (9×9) — Larger open room, a hide spot behind the couch (wall stub), camera in the corner. Multiple openings.
6. **Kitchen** (7×7) — Counter islands (wall stubs), one hide spot (pantry). Two openings.
7. **Bathroom** (5×5) — Smallest room, one hide spot (shower stall), one opening.
8. **Server Room** (7×7) — Rows of server racks (wall stubs), camera, restricted feel. Two openings.
9. **Lobby/Foyer** (9×7) — Open room near the exit. This is always the entry point for the Runner. Has the exit tile. One large opening + door to the rest of the map.
10. **Break Room** (7×7) — Tables, vending machine (wall stubs), one hide spot. Two openings.

**Important design rules for chunks:**
- The perimeter is all `Wall` tiles EXCEPT at openings, where the wall tile is replaced with `Floor` (the generator will place `Door` tiles at connection points).
- Interior features use `Wall` tiles for furniture/obstacles and `HideSpot`/`Camera`/`ItemSpawn` tiles for special spots.
- Keep at least a 1-tile-wide walkable path between all openings so the room is always traversable.
- Openings should be at consistent positions (e.g., centered on each edge, or at specific offsets) so rooms line up when stitched.

### 3. Map Generator (`/src/game/map-generator.ts` — NEW FILE)

The core procedural generation module. Takes a seed and produces a complete `GeneratedMap`.

```typescript
import { TileType } from "@/game/map";
import { RoomChunk } from "@/game/room-chunks";
import { SeededRandom } from "@/lib/random";

export interface MapEntity {
  type: "guard" | "item" | "camera" | "hideSpot" | "exit" | "runnerSpawn";
  x: number;  // tile coordinates in the full assembled map
  y: number;
  id?: string;  // for guards and items
  name?: string; // for items
}

export interface GuardPatrol {
  guardId: string;
  spawnX: number;
  spawnY: number;
  waypoints: Array<{ x: number; y: number }>;
}

export interface GeneratedMap {
  tiles: TileType[][];
  width: number;
  height: number;
  entities: MapEntity[];
  guardPatrols: GuardPatrol[];
  runnerSpawn: { x: number; y: number };
  exitPos: { x: number; y: number };
  targetItem: { x: number; y: number; name: string };
}
```

#### Generation algorithm

**Step 1: Room placement using a grid-based approach**

Use a coarse grid (e.g., 4 columns × 3 rows of "slots"). Each slot can hold one room chunk. Not all slots need to be filled — aim for 8–10 rooms total out of ~12 slots.

```
Slot grid (4×3):
[Room][Room][Room][Room]
[Room][Room][Room][Room]
[Room][    ][Room][Room]
```

1. Create a `SeededRandom` from the seed.
2. Define the slot grid dimensions: 4 columns × 3 rows.
3. Each slot is big enough for the largest room (9×9) plus 1-tile wall borders = 11×11 per slot. So the total map is about 44×33 tiles. Add a 1-tile border of walls around the entire map.
4. Pick which slots to fill: always fill at least 8 of the 12 slots. Use the RNG to decide which slots are empty (skip 0–4 slots, never leaving gaps that would isolate rooms).
5. For each filled slot, pick a random room chunk (without replacement if possible, with replacement once all chunks are used). Place the chunk centered in the slot.

**Step 2: Connect rooms with doors**

For each pair of adjacent filled slots (horizontal or vertical neighbors):
1. Find the closest openings on the shared edge between the two rooms.
2. Carve a short hallway (1–3 tiles of Floor) connecting those openings through the wall/gap between the rooms.
3. Place a `Door` tile at each connection point (where the hallway meets the room edge).

If two rooms' openings don't align, carve an L-shaped or straight hallway between them. Keep it simple — a straight horizontal or vertical corridor between the opening of room A and the opening of room B, with an L-bend if needed.

**Step 3: Place entities**

Using the RNG:
1. **Runner spawn:** Always in the Lobby/Foyer chunk. Place at a floor tile near the center.
2. **Exit:** Also in the Lobby/Foyer chunk, at the designated exit spot.
3. **Target item:** Pick one of the filled rooms that is far from the Lobby (use Manhattan distance between slots). Place the item at one of that room's `itemSpots`. Pick the item name from the TARGET_ITEMS list (see section 4).
4. **Guards:** Place 1–2 guards (RNG: 1 guard for ≤9 rooms, 2 for ≥10 rooms). Place each in a room with `guardSpawns`. Generate waypoints: the guard patrols through 3–5 connected rooms (pick a loop of adjacent slots). The waypoints are the center-floor tiles of each room in the loop.
5. **Hide spots:** Each room that has `hideSpots` defined in its chunk gets them placed. Total should be 4–8 hide spots.
6. **Cameras:** Place 1–3 cameras at `cameraSpots` in rooms that define them. Cameras are static (the vision cone rotation is handled by existing Whisper view code).

**Step 4: Fill remaining tiles**

Any tile in the full map grid that isn't covered by a room chunk or a carved hallway should be a `Wall` tile (solid filler).

**Step 5: Validate connectivity**

Run a simple flood-fill from the runner spawn position. If any placed entity (item, exit, guard) is unreachable, log a warning and try re-generating with `seed + 1` (up to 5 retries). This is a safety net — the grid-based approach with explicit hallway carving should produce connected maps consistently.

#### Export

```typescript
export function generateMap(seed: number): GeneratedMap
```

This is a pure function — same seed always returns the same map.

### 4. Target Items List (`/src/game/target-items.ts` — NEW FILE)

A pool of silly/funny target items. The generator picks one per map.

```typescript
export const TARGET_ITEMS: Array<{ name: string; description: string }> = [
  { name: "Golden Rubber Duck", description: "It squeaks when you squeeze it. Priceless." },
  { name: "Vintage Lava Lamp", description: "Still warm. Mesmerizing." },
  { name: "CEO's Secret Diary", description: "'Dear diary, today I ate two lunches.'" },
  { name: "Diamond-Encrusted Stapler", description: "The fanciest office supply ever made." },
  { name: "Prototype Toaster", description: "It toasts bread AND plays jazz." },
  { name: "Crystal Ball Paperweight", description: "It predicted you'd steal it." },
  { name: "Legendary Coffee Mug", description: "'World's Actual Best Boss'. One of a kind." },
  { name: "Solid Gold Pen", description: "Writes in 24-karat ink. Probably." },
  { name: "Ancient Floppy Disk", description: "Contains the original game of Pong." },
  { name: "Enchanted Snow Globe", description: "The snow inside falls upward." },
];
```

### 5. Update Map Module (`/src/game/map.ts` — MODIFY)

Keep the existing `TileType` enum, `getTile`, `isWalkable`, `getMapWidth`, `getMapHeight` functions — these are the public API that the rest of the codebase uses. They all take a `TileType[][]` parameter, so they work with any map.

**Remove or keep `TEST_MAP`:** Keep `TEST_MAP` as a fallback for now (rename to `FALLBACK_MAP`), but the primary path should use the generated map. The `TEST_MAP` constant is only imported in `GameCanvas.tsx`, so the main change is there.

### 6. Update Guard AI Waypoints (`/src/game/guard-ai.ts` — MODIFY)

Currently, `GUARD_WAYPOINTS` is a hardcoded record for `"guard-1"`. This needs to accept dynamic waypoints from the map generator.

**Changes:**
- Remove the hardcoded `GUARD_WAYPOINTS` constant.
- Modify `tickGuard` to accept waypoints as a parameter (or store them alongside guard data).
- Add a `waypoints` parameter to the tick function:

```typescript
export function tickGuard(
  guard: GuardData,
  runner: RunnerData,
  dt: number,
  map: TileType[][],
  now: number,
  waypoints: Array<{ x: number; y: number }>  // NEW param
): GuardUpdate
```

Update all call sites in `GameCanvas.tsx` to pass waypoints from the generated map's `guardPatrols`.

### 7. Update Game Initialization (`/convex/rooms.ts` — MODIFY)

The `startGame` mutation currently hardcodes the Runner spawn (1,1), guard position (9,12), item position (17,7), and exit position (6,14). These need to come from the map generator.

**However**, we can't run the map generator on the Convex server (it's a client-side module using canvas-related imports). Instead:

**Approach:** Pass the entity positions from the client to the `startGame` mutation. The client generates the map from the seed (already stored in `room.mapSeed`), extracts spawn positions, and sends them as mutation arguments.

Update `startGame` mutation:
```typescript
export const startGame = mutation({
  args: {
    roomCode: v.string(),
    sessionId: v.string(),
    // NEW: entity positions from the client-generated map
    runnerSpawn: v.object({ x: v.number(), y: v.number() }),
    guards: v.array(v.object({
      id: v.string(),
      x: v.number(),
      y: v.number(),
    })),
    items: v.array(v.object({
      id: v.string(),
      x: v.number(),
      y: v.number(),
      name: v.string(),
    })),
    exitX: v.number(),
    exitY: v.number(),
  },
  handler: async (ctx, args) => {
    // ... existing validation ...

    // Use client-provided positions (both clients derive the same map from the same seed)
    await ctx.db.insert("gameState", {
      roomId: room._id,
      runner: { x: args.runnerSpawn.x, y: args.runnerSpawn.y, crouching: false, hiding: false, hasItem: false },
      guards: args.guards.map(g => ({
        ...g,
        angle: 0,
        state: "patrol" as const,
        targetWaypoint: 0,
      })),
      items: args.items.map(i => ({ ...i, pickedUp: false })),
      exitX: args.exitX,
      exitY: args.exitY,
      pings: [],
      phase: "planning",
      startTime: Date.now(),
    });
  },
});
```

### 8. Update GameCanvas to Use Generated Maps (`/src/components/GameCanvas.tsx` — MODIFY)

This is the main integration point. Replace `TEST_MAP` usage with the generated map.

**Changes:**

1. Import `generateMap` from `map-generator.ts`.
2. When the game starts (room enters "playing" state), generate the map: `const generatedMap = generateMap(room.mapSeed)`.
3. Store `generatedMap` in a ref so it persists across renders.
4. Pass `generatedMap.tiles` to all rendering functions that currently receive `TEST_MAP`.
5. Pass `generatedMap.guardPatrols` to the guard tick driver (replaces `GUARD_WAYPOINTS`).
6. Use `generatedMap.tiles` for collision detection in the Runner movement code.

**Key change in the Lobby "Start Game" flow:**
- When the Lobby calls `startGame`, the client first generates the map from `room.mapSeed`, then passes the entity positions to the mutation:

```typescript
const map = generateMap(room.mapSeed);
await startGame({
  roomCode,
  sessionId,
  runnerSpawn: map.runnerSpawn,
  guards: map.guardPatrols.map(g => ({ id: g.guardId, x: g.spawnX, y: g.spawnY })),
  items: [{ id: "item-1", x: map.targetItem.x, y: map.targetItem.y, name: map.targetItem.name }],
  exitX: map.exitPos.x,
  exitY: map.exitPos.y,
});
```

### 9. Update Whisper View (`/src/game/whisper-view.ts` — MODIFY)

The whisper view renderer may reference `TEST_MAP` or use fixed map dimensions. Update to accept the generated map. Check the existing code — it likely already takes a `map: TileType[][]` parameter from GameCanvas, in which case no change is needed beyond what GameCanvas passes.

### 10. Guard Patrol Waypoint Storage

The guard patrol waypoints from the generator need to be available to the game loop. Since both clients generate the same map from the same seed, they both have access to the waypoints locally. Store them in a ref alongside the generated map:

```typescript
const guardWaypointsRef = useRef<Record<string, Array<{ x: number; y: number }>>>({});

// After generating the map:
const waypointMap: Record<string, Array<{ x: number; y: number }>> = {};
for (const patrol of generatedMap.guardPatrols) {
  waypointMap[patrol.guardId] = patrol.waypoints;
}
guardWaypointsRef.current = waypointMap;
```

## Key Technical Details

### Deterministic Generation

**Critical:** Both clients MUST generate the identical map from the same seed. This means:
- Use only the `SeededRandom` class for any randomness (never `Math.random()`).
- The generation algorithm must be fully deterministic — same inputs → same outputs.
- The seed is stored in `room.mapSeed` (already exists in the schema).

### Map Size

Target: approximately 30–40 tiles wide × 25–35 tiles tall. This is larger than the current 20×16 `TEST_MAP` but not overwhelmingly large. The cozy apartment feel should be maintained — it's a building, not a warehouse.

### Hallway Carving

When connecting rooms, carve hallways through the gap between room chunks:
- The gap between adjacent slots is filled with Wall tiles by default.
- Carving replaces Wall tiles with Floor tiles to create a passable corridor.
- Place Door tiles at the boundary where a hallway meets a room's edge.
- Hallways should be 1 tile wide (cozy, claustrophobic feel — good for stealth gameplay).

### Guard Patrol Waypoints

Generate waypoints as a loop through 3–5 rooms. The waypoints should be at floor tiles in the center of each room in the loop. The guard walks between waypoints in order, then loops. The generator should ensure the path between consecutive waypoints is actually walkable (connected via hallways).

A simple approach: use the grid adjacency. If a guard is assigned rooms at slots (1,0), (1,1), (2,1), (2,0), its waypoints are the center tiles of those rooms in order. Since adjacent slots are connected by hallways, the guard can walk between them.

### Backwards Compatibility

The `GameCanvas.tsx` currently imports `TEST_MAP` directly. The refactor replaces this with a call to `generateMap(seed)`. All downstream code (renderer, collision, fog of war, whisper view) already accepts `TileType[][]` as parameters, so they work unchanged.

The `guard-ai.ts` module needs its `tickGuard` function signature updated to accept waypoints as a parameter instead of looking them up from the hardcoded `GUARD_WAYPOINTS`.

## Files to Create
- `/src/lib/random.ts` — Seeded PRNG utility
- `/src/game/room-chunks.ts` — Room chunk template definitions (8–10 room types)
- `/src/game/map-generator.ts` — Procedural map generator (stitching, hallway carving, entity placement)
- `/src/game/target-items.ts` — Pool of silly target item names/descriptions

## Files to Modify
- `/src/game/map.ts` — Keep public API, rename `TEST_MAP` to `FALLBACK_MAP`
- `/src/game/guard-ai.ts` — Remove hardcoded `GUARD_WAYPOINTS`, add `waypoints` parameter to `tickGuard`
- `/convex/rooms.ts` — Update `startGame` to accept entity positions from client
- `/src/components/GameCanvas.tsx` — Use `generateMap(seed)` instead of `TEST_MAP`, pass entity data to `startGame`, pass waypoints to guard tick driver
- `/src/game/whisper-view.ts` — Verify it works with generated maps (likely no changes needed)

## How to Verify

1. `npm run build` succeeds with no type errors.
2. `npx convex dev` deploys without errors (updated `startGame` mutation).
3. Open two browser tabs. Create a game, join, pick roles.
4. **Different maps each game:** Start a game, note the layout. Go back to lobby (or create new room), start again — the map should be different (different seed).
5. **Same map for both players:** Both the Runner and Whisper see the same map layout (derived from the same `mapSeed`).
6. **Map is connected:** The Runner can reach the target item and the exit from the spawn point. There are no isolated rooms.
7. **Rooms are varied:** The map contains different room types (office, hallway, storage, etc.) stitched together with hallway connections.
8. **Guard patrols work:** The guard(s) patrol through their assigned rooms, following waypoints. They don't walk through walls or get stuck.
9. **Hide spots and cameras placed:** Hide spots (green tiles) and cameras (blue tiles) appear in appropriate rooms.
10. **Target item is funny:** The target item has a silly name from the `TARGET_ITEMS` pool, visible in the HUD.
11. **Whisper view shows full map:** The Whisper's blueprint view correctly renders the full generated map with all entities.
12. **Full game loop works:** Start game → plan → heist → grab item → reach exit → win screen. All on the new generated map.
13. **Map size is reasonable:** Maps are roughly 30–40 tiles wide and 25–35 tiles tall — bigger than the old test map but still cozy.

---

## Implementation Summary

### Files Created
- `/src/lib/random.ts` — Seeded PRNG utility (Mulberry32) with `next()`, `nextInt()`, `pick()`, `shuffle()`
- `/src/game/room-chunks.ts` — 10 room chunk templates (Office, Hallway H/V, Storage, Living Room, Kitchen, Bathroom, Server Room, Lobby, Break Room) with openings, guard/hide/camera/item spots
- `/src/game/target-items.ts` — Pool of 10 silly target items with names and descriptions
- `/src/game/map-generator.ts` — Core procedural map generator: grid-based room placement (4x3 slots), hallway carving, entity placement, connectivity validation via flood-fill, deterministic from seed

### Files Modified
- `/src/game/map.ts` — Renamed `TEST_MAP` to `FALLBACK_MAP` (kept as fallback)
- `/src/game/guard-ai.ts` — Added optional `waypoints` parameter to `tickGuard()`, renamed hardcoded waypoints to `DEFAULT_GUARD_WAYPOINTS`
- `/convex/rooms.ts` — Updated `startGame` to accept optional entity positions from client (`runnerSpawn`, `guards`, `items`, `exitX`, `exitY`); `resetRoom` now generates a new `mapSeed` for varied maps on replay
- `/src/components/GameCanvas.tsx` — Added `mapSeed` prop; generates map via `useMemo(generateMap(mapSeed))`; all rendering/collision/interaction uses generated map tiles; passes waypoints to guard AI
- `/src/components/Lobby.tsx` — Imports `generateMap`, generates map from `room.mapSeed` on start, passes entity positions to `startGame` mutation
- `/CLAUDE.md` — Updated milestone status

### Architecture
- Both clients derive the same map from `room.mapSeed` (stored in Convex), so no map data is synced — just the seed
- The Lobby generates the map client-side when starting the game, extracting spawn positions for the `startGame` mutation
- Maps are ~46x35 tiles (4 columns × 3 rows of 11×11 slots + border), bigger than the old 20×16 test map
- 8-11 rooms per map, connected via 1-tile-wide hallways with door tiles at boundaries
- Lobby chunk always placed at bottom-left; target item in the farthest room
- 1-2 guards with patrol routes through 3-5 adjacent rooms
- Flood-fill connectivity validation with up to 5 seed retries

### Build Status
- `npm run build` — passes with no errors
- `npm run lint` — no new errors introduced (3 pre-existing `prefer-const` warnings from event recording code)

---

## Review Notes (Reviewer: 8b4f96a6)

### Issues Found & Fixed

1. **`findFloorTileNear` inconsistent tile acceptance** (`map-generator.ts`): The initial check accepted any non-Wall tile (HideSpot, Camera, etc.) but the spiral search only accepted Floor tiles. Fixed to consistently require Floor tiles in the initial check, and extended the fallback search radius from 5 to 10 to handle edge cases.

2. **`stampChunk` missing bounds checks** (`map-generator.ts`): The function wrote tiles without verifying row/col were within map bounds. Added bounds guards to prevent potential out-of-bounds array writes.

3. **No server-side entity position validation** (`rooms.ts`): The `startGame` mutation accepted client-provided entity positions without any bounds checking. A malicious client could send arbitrary coordinates. Added basic bounds validation (0 to 50 for all coordinates).

4. **Race condition in `startGame`** (`rooms.ts`): Both players could call `startGame` simultaneously, potentially creating duplicate gameState records. Added a check for existing gameState before creating a new one — if one exists, the second call silently returns.

### Items Noted but Not Fixed (acceptable risk or pre-existing)

- **`SeededRandom.pick()` on empty array**: Returns `undefined` despite type signature. Low risk since all call sites pass non-empty arrays, and adding a runtime check would be over-engineering.

- **Door placement alignment**: When `connectHorizontal`/`connectVertical` average two different opening rows/columns, the door tile could end up slightly misaligned. In practice, the L-shaped carving handles this, and the door is decorative (walkable like Floor). No gameplay impact.

### Build Verification
- `npm run build` — passes with no errors
- `npm run lint` — clean (only pre-existing warnings in auto-generated Convex files)
