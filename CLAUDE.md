# WhisperRun — CLAUDE.md

## Project Overview

WhisperRun is a 2D top-down, browser-based, two-player co-op "micro-heist" game. Two players take asymmetric roles — the Runner (sneaking through a building) and the Whisper (guiding from a blueprint/camera view) — to steal a silly target item and escape.

## Tech Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS
- **Backend:** Convex.dev (real-time state sync, server logic)
- **Game Engine:** Custom Canvas 2D (no Phaser or similar frameworks)
- **Asset Generation:** NanoBanana API (`NANOBANANA_API_KEY` in `.env.local`)

## Project Structure

```
/src/app/             — Next.js App Router pages (using --src-dir)
/src/engine/          — Custom 2D game engine (loop, renderer, camera, input, sprites, audio)
/src/game/            — Game-specific logic (map, entities, guard AI, views)
/src/components/      — React UI components (Lobby, GameCanvas, HUD, etc.)
/src/lib/             — Shared utilities and Convex client setup
/convex/              — Convex backend (schema, mutations, queries)
/swarm/               — Swarm pipeline config, plan, and task tracking
```

Path alias: `@/*` maps to `./src/*` (configured in `tsconfig.json`).

## Key Conventions

- TypeScript strict mode — use proper types, avoid `any`
- Tailwind for all CSS — no separate CSS files except `globals.css`
- Tile-based maps: 32x32 pixel tiles
- All game state lives in Convex; clients subscribe and render locally
- Server-authoritative for key actions (item pickup, guard detection, win/lose)
- No authentication — players identified by sessionId in localStorage

## Commands

- `npm run dev` — Start Next.js dev server
- `npx convex dev` — Start Convex dev server (run alongside Next.js)
- `npm run build` — Production build
- `npm run lint` — Run ESLint

## Current Status

- **Completed:** Milestone 1 — Project Scaffolding & Core Engine
- **Completed:** Milestone 2 — Networking & Room System
- **Completed:** Milestone 3 — Runner Gameplay
- **Completed:** Milestone 4 — Whisper Gameplay
- **Completed:** Milestone 5 — Guard AI & Detection
- **Completed:** Milestone 6 — Game State Sync & Full Loop (planning countdown, heist timer, timeout, results screen, play again)
- **Completed:** Milestone 7 — Map System & Content (Procedural Generation) — seed-based map generator, room chunks, target items, guard patrol waypoints
- **Completed:** Milestone 8a — Event Recording, Scoring & Highlights — EventRecorder, scoring breakdown, highlight reel, daily seed, daily challenge button
- **Completed:** Milestone 8b — Visual Polish & Sprite System — procedural sprites for Runner/Guard/Items/Tiles, tile caching, walk animations, fog wobble, dust particles, scanline overlay, patrol route visualization
- **Completed:** Integration Review — all M7/M8 modules integrated, build passes, lint clean, end-to-end wiring verified
- **Completed:** Sound Effects & Ambient Audio — procedural Web Audio API sound engine, footsteps, guard alerts, item pickup jingle, ambient hum, countdown ticks, game over fanfares, mute button
- **Completed:** Controls Tutorial & Onboarding Overlay — role-specific controls during planning phase, in-game help popup (H/? toggle)
- **Completed:** Functional Security Cameras — sweeping vision cones, camera detection alerting nearest guard, Whisper/Runner cone rendering
- **Completed:** Noise-Based Guard Detection — running creates footstep noise that alerts nearby guards, crouching is silent, 4s cooldown, noise wave visual indicator
- **Completed:** Player Disconnect Handling — heartbeat-based presence detection (3s interval, 8s timeout), 5s grace period for reconnection, clean game ending on disconnect with "Partner Disconnected" results screen
- **Completed:** Mobile Touch Controls — floating virtual joystick for Runner, touch buttons for crouch/interact, 44px touch targets, viewport zoom prevention, touch-none CSS
- **Completed:** Interactive Doors — doors start closed and block movement/vision, Runner toggles with interact key (makes noise), guards open doors on patrol, closed doors block guard/camera LOS
- **Completed:** Whisper Path Drawing — Shift+drag to draw routes on blueprint, Runner sees glowing trail through fog of war, 15s fadeout during heist, mobile draw-mode toggle
- **Completed:** Difficulty Levels — Casual/Standard/Hard selector in lobby, parameterizes map size (3x2/4x3/5x3), guard count/speed/vision, camera count/range, heist timer, planning duration, difficulty badge in HUD
- **Completed:** Daily Challenge Leaderboard — Convex leaderboard table with date+score index, auto-submit scores after daily challenge escapes (Runner client, duplicate prevention via roomCode), deterministic team name generator, leaderboard display on landing page and results screen with highlighted current team entry, real-time updates via Convex subscription
- **Completed:** Whisper Quick-Comms — predefined short messages (STOP!, GO NOW!, BEHIND YOU!, HIDE!, You're safe, Nice move!) sent by Whisper to Runner, large overlay with sound cues, keyboard shortcuts (Q/W/E/R/T/Y), 1.5s cooldown, mobile touch buttons
- **Completed:** Visual Heist Replay Map — animated minimap on results screen showing Runner's path through the building with event markers (guard alerts, near misses, item pickup), 5s playback animation, blueprint aesthetic, position tracking via EventRecorder
- **Completed:** Share Results Card — "Share Score" button on results screen, generates formatted text snippet with emoji/stars/score and copies to clipboard (Web Share API on mobile), daily challenge variant with competitive CTA
- **Completed:** Runner Color Customization — 6 color presets (Classic, Midnight, Forest, Crimson, Violet, Ghost) selectable in lobby, stored in Convex room state, rendered via parameterized drawRunnerSprite, visible in both Runner and Whisper views
- **Completed:** Guard A* Pathfinding — tile-based A* navigation for guards (`/src/game/pathfinding.ts`), 4-directional, Manhattan heuristic, 500-node limit, path caching with 2s TTL, axis-aligned path smoothing, doors always walkable, cache invalidation on state transitions, fallback to direct movement for unreachable targets
- **In Progress:** Laser Tripwires — passive environmental hazard, on/off cycling red beams across corridors, Runner must time passage through off-windows, tripping alerts nearest guard (like cameras), 0/2/3 lasers by difficulty, phase-offset timing, visible in both views, zap-beep alarm sound, 4s trip cooldown, scoring integration as panic moments
- **Completed:** Guard Alert Escalation — when a guard spots the Runner (transitions to alert), nearby guards within radius become suspicious and investigate, creating cascading tension; radio chatter sound, expanding ring visual (Runner view), communication lines (Whisper view), difficulty-scaled radius (0/8/12 tiles), cooldown prevents spam, scoring integration as panic moments
- **Queued:** Throwable Distractions — Runner gets limited supply of coins (4/3/2 by difficulty) to right-click throw at floor tiles within 5-tile range, creating noise that lures nearby guards to investigate (suspicious state), arc animation + noise rings, coin clink sound, HUD counter, mobile throw button, style points for use, cannot throw while hiding/crouching, 2s cooldown, client-side only (no Convex changes)
- See `swarm/PLAN.md` for full project plan and milestones
- See `swarm/todos/` and `swarm/done/` for task tracking
