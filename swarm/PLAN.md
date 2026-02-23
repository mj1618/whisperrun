# WhisperRun: Cozy Heist Hotline — Project Plan

## Project Overview

WhisperRun is a 2D top-down, browser-based, two-player co-op "micro-heist" game. Two players take asymmetric roles — the **Runner** (sneaking through a building) and the **Whisper** (guiding from a blueprint/camera view) — to steal a silly target item and escape. The tone is cozy-chaos: failure is funny, sessions are 6–12 minutes, and the whole experience is designed for friends, couples, and streamers who want quick, clip-able co-op moments.

**Tech Stack:** Next.js, TypeScript, Convex.dev (backend/realtime), Tailwind CSS, custom 2D game renderer (Canvas API — no Phaser), asset generation via NanoBanana API (`NANOBANANA_API_KEY` in `.env.local`).

## Goals & Success Criteria

**"Done" for MVP (Week 1 target):**
1. Two players can connect via invite link — no account required
2. Role selection (Runner / Whisper) works in a lobby
3. Runner sees a top-down 2D apartment map and can move, crouch, and hide
4. Whisper sees a blueprint view of the same map with camera feeds and guard patrol routes
5. Whisper can ping locations visible to the Runner
6. One guard type patrols on a simple route and can detect/catch the Runner
7. One target item to steal + one exit point = win condition
8. Game state is fully synced in real-time between both players via Convex

**"Done" for Week 2 polish:**
1. Procedural room stitching (8–12 room chunks compose each map)
2. 6–10 target items with funny names/descriptions
3. End-of-run highlight/recap system (event recording → playback)
4. Scoring: time, stealth rating, panic moments, style points
5. Basic cosmetic unlocks

## Scope

### In Scope (MVP)
- Next.js app with game canvas rendering (custom engine, no Phaser)
- Convex backend for room management, game state sync, and real-time updates
- Invite-link room creation (shareable URL, no auth required)
- Lobby screen: role pick (Runner/Whisper), start game
- **Runner view:** 2D top-down rendered apartment; movement (WASD/touch), crouch, interact with hide spots, pick up target item
- **Whisper view:** blueprint/map overlay showing full layout, camera cones, guard patrol paths; ping system to mark locations
- Guard AI: one guard type, simple waypoint patrol, vision cone detection, "polite consequences" on catch
- Tile-based map system: one handcrafted apartment tileset
- Win condition: grab item + reach exit
- Lose condition: caught by guard (funny "escorted out" animation/message)
- Basic game UI: timer, item indicator, role-specific HUD

### In Scope (Week 2)
- Procedural map generation from room chunks
- Multiple target items with silly descriptions
- Event recording system for highlight replays
- End-of-run score screen
- Daily seed system (same map for all players that day)

### Out of Scope (for now)
- Account system / persistent profiles
- Double Agent mode
- Speedrun Duo mode
- Cosmetic unlocks / progression system (beyond basic)
- Mobile-optimized touch controls (basic support only)
- Audio/sound effects
- WebRTC data channels (use Convex real-time; revisit if latency is an issue)
- Steam port
- Leaderboards

## Architecture

### Frontend (Next.js + Custom Canvas Engine)
```
/app
  /page.tsx              — Landing page, "Create Game" button
  /game/[roomId]/page.tsx — Main game page (lobby → gameplay → results)
/src
  /engine/               — Custom 2D game engine
    /renderer.ts         — Canvas 2D rendering pipeline
    /camera.ts           — Viewport/camera management
    /input.ts            — Keyboard + basic touch input handling
    /loop.ts             — Game loop (requestAnimationFrame)
    /sprites.ts          — Sprite loading and animation
  /game/                 — Game-specific logic
    /map.ts              — Tile map loading, collision, room definitions
    /entities.ts         — Runner, Guard, Item, HideSpot, Camera, Exit
    /guard-ai.ts         — Guard patrol + vision cone + detection logic
    /runner-view.ts      — Runner's limited-visibility renderer (fog of war)
    /whisper-view.ts     — Whisper's blueprint renderer (full map + overlays)
    /ping-system.ts      — Whisper ping creation + Runner ping display
    /game-state.ts       — Client-side game state manager, syncs with Convex
    /highlights.ts       — Event recorder for replay system
  /components/           — React UI components
    /Lobby.tsx           — Role select, ready up, start
    /GameCanvas.tsx      — Canvas wrapper, mounts engine
    /HUD.tsx             — In-game UI overlay (timer, item status, pings)
    /ResultsScreen.tsx   — Post-game score + highlight replay
    /InviteLink.tsx      — Copy-to-clipboard invite URL
  /lib/
    /convex.ts           — Convex client setup
    /utils.ts            — Shared utilities
```

### Backend (Convex)
```
/convex
  /schema.ts             — Tables: rooms, gameState, events
  /rooms.ts              — Create room, join room, role selection, room status
  /game.ts               — Game state mutations: start, player actions, guard updates, item pickup, win/lose
  /guards.ts             — Server-authoritative guard position updates (tick-based via scheduled functions or client-driven)
  /events.ts             — Record highlight events for replay
```

### Key Design Decisions
1. **Custom canvas renderer** — no Phaser. Use Canvas 2D API directly. Keep it simple: tile-based rendering, sprite sheets, basic animation.
2. **Convex for real-time sync** — Convex subscriptions give us real-time reactivity. Game state lives in Convex; both clients subscribe and render locally.
3. **Server-authoritative for key actions** — item pickup, guard detection, win/lose conditions validated server-side via Convex mutations. Movement can be client-predicted with server reconciliation.
4. **Tile-based maps** — 16x16 or 32x32 tile grid. Rooms are defined as tile arrays. Collision is tile-based.
5. **Asymmetric rendering** — Same game state, two different renderers. Runner gets fog-of-war (limited visibility radius). Whisper gets full map with overlays.
6. **No auth required** — Players identified by a session ID stored in localStorage. Room access via secret room code in URL.

### Real-Time Architecture
- Runner sends movement intents → Convex mutation updates position
- Convex scheduled function (or action) ticks guard AI at ~10Hz
- Both clients subscribe to game state → re-render each frame
- Whisper pings are mutations → appear on Runner's view via subscription
- Detection/win/lose resolved server-side

## Milestones

### Milestone 1: Project Scaffolding & Core Engine
- Initialize Next.js project with TypeScript, Tailwind
- Set up Convex (new project, schema, basic functions)
- Build core engine: game loop, canvas renderer, input handler, camera
- Render a static tile map on screen

### Milestone 2: Networking & Room System
- Convex schema for rooms (roomId, players, roles, status)
- Create room → get invite link
- Join room via link
- Lobby UI: see both players, pick roles, ready up
- Start game transition

### Milestone 3: Runner Gameplay
- Runner entity with movement (WASD), crouch, collision with walls
- Fog-of-war / limited visibility rendering
- Hide spots (Runner can enter, becomes invisible to guards)
- Target item entity (interact to pick up)
- Exit entity (interact with item to win)
- Runner HUD (timer, item status)

### Milestone 4: Whisper Gameplay
- Blueprint/map view renderer (full map, different art style — cleaner, schematic)
- Camera feed overlays (vision cones shown on map)
- Guard patrol route visualization
- Ping system: click to place ping → appears on Runner's screen with fadeout
- Whisper HUD

### Milestone 5: Guard AI & Detection
- Guard entity with waypoint patrol
- Vision cone calculation (direction + angle + range)
- Detection logic: Runner in vision cone + not hidden → alert
- Chase behavior (simple: move toward last known position)
- Catch resolution: "Polite Consequences" screen, game over
- Server-authoritative detection check

### Milestone 6: Game State Sync & Full Loop
- Wire everything through Convex: Runner position, guard positions, item state, pings
- Both views update in real-time from shared state
- Complete game loop: lobby → plan phase (30s, Whisper pings) → heist phase → win/lose → results
- Results screen with basic stats (time, caught count)

### Milestone 7: Map System & Content (Week 2)
- Procedural room stitching: define room chunks as tile arrays, stitch them into a connected map
- 8–12 room chunk templates
- Room types: hallway, office, storage, living room, kitchen, bathroom, etc.
- Spawn points for guards, items, cameras, hide spots placed per-chunk
- 6–10 target items with funny names

### Milestone 8: Polish & Highlight System (Week 2)
- Event recording: log key moments (near-miss, item grab, detection, escape)
- End-of-run highlight: pick best moment, show quick replay or summary
- Scoring system: time bonus, stealth rating, panic moments counter
- Daily seed: deterministic map generation from date-based seed
- Visual polish: better sprites, animations, UI styling

## Detailed Requirements

### Room/Lobby System
- `POST /api/create-room` or Convex mutation → returns roomId
- URL format: `/game/[roomId]`
- Room states: `waiting` → `playing` → `finished`
- Max 2 players per room
- Player can choose Runner or Whisper; if both want same role, first pick wins
- "Ready" button; game starts when both ready
- If a player disconnects during game, pause briefly then end game

### Runner Mechanics
- Movement speed: ~3 tiles/second walking, ~1.5 tiles/second crouching
- Crouch: smaller detection profile (guards detect at shorter range)
- Hide spots: press interact key near wardrobe/desk/plant → Runner hidden, cannot move until exiting
- Pick up item: press interact key near target item → item follows Runner
- Exit: interact with exit door while carrying item → win
- Runner sees: immediate surroundings (5-7 tile radius), walls block vision

### Whisper Mechanics
- Sees: entire map layout, all guard positions + patrol routes, all camera vision cones, item location, Runner position
- Cannot: move anything, interact with anything in the game world
- Pings: click anywhere on map → ping marker appears (visible to Runner for 5 seconds, max 3 active pings)
- Ping types (stretch): "danger" (red), "go here" (green), "item" (yellow)

### Guard AI
- Patrol: follow predefined waypoint loop, pause briefly at each waypoint
- Vision: cone-shaped, ~60° angle, ~5 tile range, blocked by walls
- States: `patrol` → `suspicious` (saw something, investigates) → `alert` (chasing) → `patrol` (lost Runner)
- Suspicious: heard noise or edge-of-vision trigger, moves to investigate spot
- Alert: moves toward Runner's last known position; if reaches it and Runner gone, returns to patrol
- Catch: overlaps Runner position while alert → game over
- Speed: slightly slower than Runner walking speed, so Runner can outrun but not by much

### Map / Tiles
- Tile size: 32x32 pixels
- Map size: ~20x20 to 30x30 tiles for MVP
- Tile types: floor, wall, door (open/closed), hide spot, camera, item spawn, exit, guard spawn
- Collision: walls and closed doors block movement
- Camera tiles: fixed position, rotating vision cone, Whisper can see feed, Runner must avoid

### Visual Style
- Warm, cozy color palette (soft browns, warm yellows, muted greens)
- Chunky pixel art style (32x32 tiles, 2-3 frame animations)
- Runner: small character sprite, visible outfit color
- Guards: slightly larger, friendly/goofy appearance
- Whisper blueprint view: dark background, light line-drawn style, colored overlays for threats
- UI: rounded corners, "sticky note" aesthetic for Whisper panels

### Convex Schema (initial)
```typescript
// rooms table
{
  roomId: string,          // short code for URL
  players: [{
    sessionId: string,
    role: "runner" | "whisper" | null,
    ready: boolean
  }],
  status: "waiting" | "playing" | "finished",
  mapSeed: number,
  createdAt: number
}

// gameState table
{
  roomId: string,
  runner: { x: number, y: number, crouching: boolean, hiding: boolean, hasItem: boolean },
  guards: [{ id: string, x: number, y: number, state: string, ... }],
  pings: [{ x: number, y: number, type: string, createdAt: number }],
  cameras: [{ x: number, y: number, angle: number, ... }],
  items: [{ id: string, x: number, y: number, pickedUp: boolean }],
  phase: "planning" | "heist" | "escaped" | "caught",
  startTime: number,
  events: [{ type: string, timestamp: number, data: any }]
}
```
