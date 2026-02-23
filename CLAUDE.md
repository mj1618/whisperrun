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
- **Queued:** Difficulty Levels — Casual/Standard/Hard selector in lobby, parameterizes map size, guard count/speed/vision, camera count, heist timer, planning duration
- **Queued:** Daily Challenge Leaderboard — Convex leaderboard table, auto-submit scores after daily challenge escapes, team name generator, leaderboard display on landing page and results screen
- See `swarm/PLAN.md` for full project plan and milestones
- See `swarm/todos/` and `swarm/done/` for task tracking
