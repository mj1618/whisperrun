# Task: Integration Review — Milestones 7 & 8 (Map Gen + Events + Visuals)

## Overview

Three parallel agents have been working on Milestone 7 (Procedural Map Generation), Milestone 8a (Event Recording, Scoring & Highlights), and Milestone 8b (Visual Polish & Sprite System). These tasks all touch overlapping files — especially `GameCanvas.tsx`, `guard-ai.ts`, `whisper-view.ts`, `rooms.ts`, and `map.ts`. This review task ensures everything integrates cleanly, the build passes, and the game works end-to-end.

**Dependencies:** All three processing tasks must be complete (`.processing.md` → `.done.md`).

## What to Do

### 1. Fix Build Breaks

Run `npm run build` and fix all TypeScript errors. Common issues to expect:

- **Conflicting edits to `GameCanvas.tsx`**: M7 replaces `FALLBACK_MAP` with `generateMap(seed)`, M8a adds event recording hooks, M8b changes rendering calls to use new sprite functions. All three modify the same component — likely merge conflicts or missing imports.
- **`guard-ai.ts` signature changes**: M7 adds a `waypoints` parameter to `tickGuard()`. M8b may have also modified guard rendering. Ensure the call site in `GameCanvas.tsx` passes waypoints correctly.
- **`whisper-view.ts` changes**: M7 may change how the map is passed; M8b adds new sprite rendering. Make sure both sets of changes coexist.
- **`rooms.ts` changes**: M8a adds `daily` flag to `createRoom`. M7 updated `startGame` to accept entity positions. Both modify the same file.
- **Import conflicts**: Multiple files may have duplicate or missing imports after parallel edits.

### 2. Verify Procedural Map Integration

Ensure the procedural map generator is actually wired up end-to-end:

- `GameCanvas.tsx` should call `generateMap(seed)` where `seed` comes from `room.mapSeed` (via the Convex room query)
- The generated map's tiles should be used for:
  - Collision detection (`canMoveTo` function)
  - Runner view rendering (`renderer.drawTileMap`)
  - Whisper blueprint rendering (`renderBlueprintMap`)
  - Guard AI tick (`tickGuard` should receive waypoints from the generated map)
  - Ping system (checking walkable tiles for Whisper clicks)
  - Fog of war rendering
- `FALLBACK_MAP` should only be used as a fallback when `generateMap` hasn't run yet (or if seed is missing)
- The `startGame` mutation receives entity positions from the client-generated map
- `getInteraction` uses the generated map (not `FALLBACK_MAP`) for hide spot detection

### 3. Verify Event Recording Integration

Ensure the event recorder works with the new procedural maps:

- `EventRecorder` is initialized and started when the heist phase begins
- Events are recorded during gameplay (guard alerts, near misses, item pickups, etc.)
- The `onGameEnd` callback passes events from `GameCanvas` to the game page
- `ResultsScreen` receives events and displays the scoring breakdown + highlight reel
- Daily seed button exists on the landing page and creates rooms with deterministic seeds

### 4. Verify Visual Sprite System

Ensure the new sprite rendering works with generated maps:

- New sprite drawing functions (`drawRunnerSprite`, `drawGuardSprite`, etc.) are called by the renderer
- Tile rendering uses new textured tile drawing (not just flat colored rectangles)
- Sprites work at the right scale with both Runner view (zoomed in) and Whisper blueprint view (zoomed out)
- Animation frame tracking works with the game loop's delta time
- Guard state visualization (patrol/suspicious/alert) uses the new sprites
- The overall visual look is cohesive — warm cozy palette, pixel-art feel

### 5. End-to-End Game Loop Test

Walk through the complete game flow mentally (or describe what to test):

1. Landing page → "Create Game" button works
2. Landing page → "Daily Challenge" button works (creates room with daily seed)
3. Lobby: both players join, pick roles, ready up
4. Start game → procedural map generates from seed
5. Planning phase: Whisper sees full blueprint of generated map, can ping
6. Heist phase: Runner moves through generated map, guards patrol waypoints
7. Runner interacts: hide spots, pick up item, exit
8. Events recorded throughout
9. Game ends → Results screen shows score, highlight reel, play style title
10. "Play Again" → room resets, new game starts

### 6. Cleanup

- Remove any dead code or unused imports
- Fix any `eslint` warnings (`npm run lint`)
- Ensure no `any` types leaked in
- Verify `CLAUDE.md` "Current Status" section is accurate — update milestone completion status

## Files Likely Needing Attention

- `/src/components/GameCanvas.tsx` — Main integration point (all three tasks touch this)
- `/src/game/guard-ai.ts` — Waypoints parameter + any rendering changes
- `/src/game/whisper-view.ts` — Blueprint rendering with generated maps + sprites
- `/src/game/runner-view.ts` — Fog of war with generated maps + sprites
- `/src/engine/renderer.ts` — Sprite-based rendering
- `/src/engine/sprites.ts` — New sprite drawing system
- `/convex/rooms.ts` — Daily seed + entity positions
- `/src/app/page.tsx` — Daily challenge button
- `/src/app/game/[roomId]/page.tsx` — Event threading from GameCanvas → ResultsScreen
- `/src/components/ResultsScreen.tsx` — Scoring + highlights display
- `/src/game/map.ts` — FALLBACK_MAP vs generated map usage
- `CLAUDE.md` — Update status

## How to Verify

1. `npm run build` succeeds with zero errors.
2. `npm run lint` passes (or only has pre-existing warnings).
3. `npx convex dev` deploys without errors.
4. Open two browser tabs. Create a game → both players see the same procedurally generated map.
5. The map is clearly different from the old 20×16 test map — bigger, varied rooms connected by hallways.
6. Play a full game: plan → heist → grab item → escape. Everything works on the new map.
7. Results screen shows score breakdown, play style title, and highlight reel.
8. Visual sprites render correctly — Runner, guards, tiles, items all look like pixel art (not plain circles/rectangles).
9. Guard patrols work on the generated map (guards follow waypoints through rooms, don't get stuck).
10. "Daily Challenge" creates a room with the same seed as another "Daily Challenge" room created the same day.
11. "Play Again" works correctly — new game starts, events reset, scoring works for the new session.

---

## Completion Summary

### Build & Lint Status
- `npm run build` — **PASSES** (zero errors)
- `npm run lint` — **PASSES** (zero errors; 4 pre-existing warnings in Convex generated files only)

### Issues Found & Fixed
1. **`drawTileMap` missing `time` argument** (GameCanvas.tsx:645) — The M8b sprite system added a required `time` parameter to `drawTileMap` for animated tiles (exit pulse, camera blink). The M7 integration hadn't included this. Fixed by passing `timeRef.current`.
2. **`drawRunner` missing new sprite params** — M8b extended `drawRunner` to accept `hasItem`, `walkFrame`, `facingAngle`. Updated the render call to pass these from the walk animation refs.
3. **`drawGuard` missing new sprite params** — M8b extended `drawGuard` to accept `walkFrame` and `time`. Updated to pass `guardWalkFrameRef.current[guard.id]` and `timeRef.current`.
4. **`drawItem` missing `time` param** — M8b's item sprite has bob/glow animation. Updated to pass `timeRef.current`.
5. **`renderFogOfWar` missing `time` param** — M8b added fog wobble and dust particles. Updated to pass `timeRef.current`.
6. **`renderWhisperEntities` missing `guardPatrols` param** — M8b added patrol route visualization. Updated to pass `guardWaypointsRef.current`.
7. **Unused `GuardState` import** — Removed from GameCanvas imports.
8. **`let` → `const` lint errors** — Three Record objects (`lastNearMissTime`, `wasNearGuardWhileCrouching`, `prevDistToGuard`) were declared with `let` but never reassigned (only mutated). Changed to `const`.

### Integration Verification
All integration points verified:

**Procedural Map (M7):**
- `generateMap(mapSeed)` called via `useMemo` in GameCanvas — deterministic, both clients get same map
- `map.tiles` used for: collision (`canMoveTo`), rendering (`drawTileMap`), blueprint (`renderBlueprintMap`), guard AI (`tickGuard`), ping validation (`isWalkable`), fog of war, interactions (`getInteraction`)
- `Lobby.tsx` calls `startGame` with entity positions from `generateMap(room.mapSeed)` — runner spawn, guards, items, exit
- `FALLBACK_MAP` kept as safety net in `map.ts` but not used in the main code path

**Event Recording (M8a):**
- `EventRecorder` created in ref, `start()` called on heist phase transition
- Events recorded: guard_alert, guard_lost, near_miss (debounced per guard), crouching_sneak, hide_enter, hide_escape, item_pickup, escape, caught, timeout, ping_sent
- `onGameEnd` callback passes events from GameCanvas → game page → ResultsScreen
- ResultsScreen computes `calculateScore()` and `generateHighlights()` from events
- Daily challenge button on landing page calls `createRoom({ daily: true })`
- Daily seed uses djb2 hash of date string — deterministic

**Visual Sprites (M8b):**
- Procedural sprites: `drawRunnerSprite` (body, head, eyes, legs, walk animation, crouching, hiding, item glow), `drawGuardSprite` (cap, badge, state indicators, direction triangle), `drawItemSprite` (gem with glow/bob), all tile types (floor planks, brick walls, doors with panels, hide spot cabinets, exit with pulse, camera with blinking LED)
- Tile caching via offscreen canvases (static tiles only; animated tiles drawn fresh)
- Walk animation tracking: `walkFrameRef` / `facingAngleRef` for Runner, `guardWalkFrameRef` per guard
- Fog of war: wobbly edge, soft gradient, vignette, ambient dust particles
- Whisper view: scanline overlay, guard patrol route dashed lines with waypoint dots

### Files Changed
- `/src/components/GameCanvas.tsx` — Fixed render call signatures, removed unused import, `let` → `const` fixes
- `/CLAUDE.md` — Updated milestone status to reflect all completed milestones

---

## Second Review (fb9e855d)

### Build & Lint Status
- `npm run build` — **PASSES** (zero errors)
- `npm run lint` — **PASSES** (zero errors; 4 pre-existing warnings in Convex generated files only)

### Issues Found & Fixed
1. **`Lobby.tsx` missing error handling on `handleStartGame`** — Both players see the "Start Heist" button simultaneously when both are ready. If both press it, the second call would throw "Game already started". Added try/catch to silently handle this race condition.
2. **Dead code: `src/game/daily-seed.ts`** — The `dailySeed()` function duplicates the djb2 hash logic already inlined in `convex/rooms.ts:createRoom`. It was never imported anywhere. Deleted.

### Code Quality Assessment
The integration review (first pass) was thorough and correctly identified all the cross-module wiring issues from the three parallel agents. After the first review's fixes:

- **Server-authoritative model is correct**: Catch detection runs both client-side (for immediate feedback via the `caught` flag in `GuardUpdate`) and server-side (in `tickGuards` mutation, line 206-221). The server is the authority.
- **Map determinism is sound**: Both clients generate the same map via `useMemo(() => generateMap(mapSeed))` — same seed, same RNG (Mulberry32), same map.
- **Event recording is well-integrated**: EventRecorder lifecycle (start on heist, record during play, pass events on game end) is clean. Events flow from GameCanvas → game page → ResultsScreen correctly.
- **Tile cache is bounded**: The module-level `tileCache` Map grows per unique tile type + variation + neighbor combo, which is bounded by the number of tile types (8) × 4 variations × 16 neighbor combos for walls. No leak risk.
- **Ref pattern in GameCanvas is correct**: The main `useEffect` game loop only depends on `[roomId, role, sessionId]` and accesses everything else via refs. This prevents the loop from being torn down and recreated on every state change.

### Files Changed
- `/src/components/Lobby.tsx` — Added try/catch to `handleStartGame` for race condition between players
- `/src/game/daily-seed.ts` — Deleted (dead code)
