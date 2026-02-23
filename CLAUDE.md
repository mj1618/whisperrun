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
/src/engine/          — Custom 2D game engine (loop, renderer, camera, input, sprites)
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
- **In Progress:** Milestone 5 — Guard AI & Detection
- See `swarm/PLAN.md` for full project plan and milestones
- See `swarm/todos/` and `swarm/done/` for task tracking
