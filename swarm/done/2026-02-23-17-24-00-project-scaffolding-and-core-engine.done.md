# Task: Project Scaffolding & Core Engine (Milestone 1)

## Overview

Initialize the WhisperRun project from scratch and build the foundational game engine. After this task, we should have a working Next.js + Convex app that renders a static tile map on a canvas — proof that the core engine works.

## What to Build

### 1. Initialize Next.js Project

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

- Use the App Router (`/app` directory)
- Put game code in `/src`
- Make sure `tailwind.config.ts` is set up correctly
- Add a basic landing page at `/app/page.tsx` with a "Create Game" button (can be a placeholder link for now)
- Add the game route at `/app/game/[roomId]/page.tsx` (placeholder for now, but renders the GameCanvas component)

### 2. Initialize Convex

```bash
npm install convex
npx convex dev
```

This will prompt you to create a new Convex project. Follow the prompts — create a new project named "whisperrun" or similar. This sets up `/convex/` directory with `_generated/` etc.

After setup, create the initial schema in `/convex/schema.ts`:

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rooms: defineTable({
    roomCode: v.string(),         // short code for URL (e.g., "ABCD1234")
    players: v.array(v.object({
      sessionId: v.string(),
      name: v.optional(v.string()),
      role: v.union(v.literal("runner"), v.literal("whisper"), v.null()),
      ready: v.boolean(),
    })),
    status: v.union(v.literal("waiting"), v.literal("playing"), v.literal("finished")),
    mapSeed: v.number(),
    createdAt: v.number(),
  }).index("by_roomCode", ["roomCode"]),

  gameState: defineTable({
    roomId: v.id("rooms"),
    runner: v.object({
      x: v.number(),
      y: v.number(),
      crouching: v.boolean(),
      hiding: v.boolean(),
      hasItem: v.boolean(),
    }),
    guards: v.array(v.object({
      id: v.string(),
      x: v.number(),
      y: v.number(),
      angle: v.number(),
      state: v.union(
        v.literal("patrol"),
        v.literal("suspicious"),
        v.literal("alert"),
        v.literal("returning")
      ),
      targetWaypoint: v.number(),
    })),
    pings: v.array(v.object({
      x: v.number(),
      y: v.number(),
      type: v.union(v.literal("danger"), v.literal("go"), v.literal("item")),
      createdAt: v.number(),
    })),
    items: v.array(v.object({
      id: v.string(),
      x: v.number(),
      y: v.number(),
      pickedUp: v.boolean(),
      name: v.string(),
    })),
    exitX: v.number(),
    exitY: v.number(),
    phase: v.union(
      v.literal("planning"),
      v.literal("heist"),
      v.literal("escaped"),
      v.literal("caught")
    ),
    startTime: v.number(),
  }).index("by_roomId", ["roomId"]),
});
```

Also create a basic rooms mutation file (`/convex/rooms.ts`) with a placeholder `createRoom` mutation — this proves Convex is wired up correctly. It doesn't need to be fully implemented yet.

### 3. Set Up Convex Client in Next.js

Create `/src/lib/convex.ts` to set up the Convex React provider:

```typescript
"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export { convex, ConvexProvider };
```

Wrap the app layout (`/app/layout.tsx`) with the ConvexProvider.

The `NEXT_PUBLIC_CONVEX_URL` will be auto-populated in `.env.local` by `npx convex dev`.

### 4. Build Core Game Engine

Create these files under `/src/engine/`:

#### `/src/engine/loop.ts` — Game Loop
- `requestAnimationFrame`-based loop
- Calculates delta time
- Calls `update(dt)` and `render()` callbacks
- Provides `start()`, `stop()` methods
- Target: 60fps, but delta-time aware so it works at any frame rate

#### `/src/engine/renderer.ts` — Canvas 2D Renderer
- Takes a `<canvas>` element reference
- Manages the 2D rendering context
- `clear()` — clears the canvas
- `drawTile(x, y, tileType)` — draws a single tile at grid position
- `drawSprite(x, y, sprite)` — draws a sprite (for future use, can be a colored rect for now)
- Handles camera offset (so we can scroll the view)
- Tile rendering: for now, use colored rectangles for different tile types (wall = dark brown, floor = light tan, door = blue, exit = green, etc.)

#### `/src/engine/camera.ts` — Camera/Viewport
- Tracks camera position (which part of the map is visible)
- `follow(x, y)` — smoothly center on a target position
- `worldToScreen(x, y)` — convert world coords to screen coords
- `screenToWorld(x, y)` — convert screen coords to world coords
- Supports viewport size based on canvas dimensions

#### `/src/engine/input.ts` — Input Handler
- Keyboard input tracking (keydown/keyup state)
- Methods: `isKeyDown(key)`, `isKeyPressed(key)` (just pressed this frame)
- Register/unregister event listeners (cleanup for React)
- WASD + arrow keys + Space (interact) + Shift (crouch)

#### `/src/engine/sprites.ts` — Sprite System (minimal)
- For now, just a placeholder/stub
- Define a simple sprite interface: `{ width, height, color }` (we'll add image loading later)
- Helper to draw a colored rect as a "sprite"

### 5. Create a Tile Map System

Create `/src/game/map.ts`:
- Define tile types as an enum: `FLOOR`, `WALL`, `DOOR`, `HIDE_SPOT`, `ITEM_SPAWN`, `EXIT`, `GUARD_SPAWN`, `CAMERA`
- Define a hardcoded test map (around 20x15 tiles) — a simple apartment layout:
  - Outer walls
  - A few rooms with doorways
  - A hide spot (wardrobe)
  - An item spawn point
  - An exit door
  - A guard spawn point
- Export the map as a 2D number array + helper functions: `getTile(x, y)`, `isWalkable(x, y)`, `getMapWidth()`, `getMapHeight()`

### 6. Create the GameCanvas React Component

Create `/src/components/GameCanvas.tsx`:
- React component that renders a `<canvas>` element
- On mount: initializes the engine (renderer, camera, input, game loop)
- Each frame: clears canvas, renders the tile map using the renderer
- On unmount: cleans up (stops loop, removes event listeners)
- Canvas should fill the viewport (or a sensible game area)
- The camera should be centered on the map

### 7. Wire It Up

- `/app/page.tsx` — Landing page with game title "WhisperRun" and a "Play" or "Create Game" button styled with Tailwind. Use the cozy color palette (warm browns, soft yellows). The button links to `/game/test` for now.
- `/app/game/[roomId]/page.tsx` — Renders the `GameCanvas` component. For now just show the tile map.
- Make sure the page renders properly in the browser.

## Key Technical Details

- **Tile size:** 32x32 pixels
- **Color palette for tiles (temporary, until we have real sprites):**
  - Floor: `#E8D5B7` (warm tan)
  - Wall: `#5C4033` (dark brown)
  - Door: `#8B7355` (medium brown, slightly different from wall)
  - Hide spot: `#6B8E23` (olive green, with a small icon/marker)
  - Item spawn: `#FFD700` (gold)
  - Exit: `#4CAF50` (green)
  - Guard spawn: `#FF6B6B` (soft red)
  - Camera: `#87CEEB` (sky blue)
- **Canvas size:** Use `window.innerWidth` and `window.innerHeight` (or a reasonable game area) — handle resize
- **Game loop:** Use `requestAnimationFrame`, track delta time in seconds

## Test Map Layout (suggestion)

```
WWWWWWWWWWWWWWWWWWWW
W......W...W......W
W......W...W......W
W......D...D......W
W......W...W......W
WWWWDWWW...WWWDWWWW
W......W...W......W
W..H...W...W...I..W
W......W...W......W
W......D...D......W
WWWWWWWW...WWWWWWWW
W..................W
W........G.........W
W..................W
W.....E............W
WWWWWWWWWWWWWWWWWWWW
```

Where: W=wall, D=door, .=floor, H=hide spot, I=item spawn, G=guard spawn, E=exit

## Files to Create

- `/app/page.tsx` (modify from Next.js default)
- `/app/game/[roomId]/page.tsx`
- `/app/layout.tsx` (modify to add ConvexProvider + custom styling)
- `/app/globals.css` (modify for Tailwind + custom styles)
- `/src/lib/convex.ts`
- `/src/engine/loop.ts`
- `/src/engine/renderer.ts`
- `/src/engine/camera.ts`
- `/src/engine/input.ts`
- `/src/engine/sprites.ts`
- `/src/game/map.ts`
- `/src/components/GameCanvas.tsx`
- `/convex/schema.ts`
- `/convex/rooms.ts` (placeholder)

## How to Verify

1. `npm run dev` starts without errors
2. `npx convex dev` connects to the Convex backend without errors
3. Opening `http://localhost:3000` shows the landing page with "WhisperRun" title and a "Create Game" button
4. Clicking the button navigates to `/game/test`
5. The game page shows a canvas rendering the test tile map with colored rectangles for different tile types
6. The map is centered and properly visible — you can see rooms, walls, doors, the exit (green), item spawn (gold), hide spot (olive), and guard spawn (red)
7. No console errors in the browser
8. Resizing the browser window properly resizes the canvas

---

## Completion Summary

### What was built
All of Milestone 1 — Project Scaffolding & Core Engine is complete.

**Next.js app** initialized with TypeScript, Tailwind CSS v4, ESLint, App Router (`--src-dir` layout).

**Convex backend** configured as new project "whisperrun" (team: msj, deployment: trustworthy-herring-741). Schema with `rooms` and `gameState` tables deployed. Placeholder `createRoom` mutation and `getRoom` query implemented.

**Core game engine** built from scratch:
- `GameLoop` — requestAnimationFrame-based, delta-time-aware
- `Renderer` — Canvas 2D tile rendering with camera offset and offscreen culling
- `Camera` — viewport management with worldToScreen/screenToWorld conversion, smooth follow
- `InputHandler` — keyboard tracking with isKeyDown/isKeyPressed, proper cleanup
- `Sprite` — minimal interface + color rect helper

**Tile map system** with 8 tile types (Floor, Wall, Door, HideSpot, ItemSpawn, Exit, GuardSpawn, Camera) and a 20x16 hardcoded test apartment map.

**GameCanvas** React component mounts the engine, renders the tile map full-viewport, handles resize, and supports WASD/arrow-key camera scrolling.

**Landing page** at `/` with cozy styling (warm browns, gold accents) and "Create Game" button. **Game page** at `/game/[roomId]` renders the canvas.

### Files created/modified
- `src/app/page.tsx` — Landing page
- `src/app/layout.tsx` — ConvexProvider wrapper, metadata
- `src/app/globals.css` — Tailwind + cozy theme
- `src/app/game/[roomId]/page.tsx` — Game route
- `src/lib/convex.ts` — Convex client
- `src/lib/ConvexClientProvider.tsx` — Client component wrapper
- `src/engine/loop.ts` — Game loop
- `src/engine/renderer.ts` — Canvas renderer
- `src/engine/camera.ts` — Camera/viewport
- `src/engine/input.ts` — Input handler
- `src/engine/sprites.ts` — Sprite interface
- `src/game/map.ts` — Tile types, test map, helpers
- `src/components/GameCanvas.tsx` — Canvas component
- `convex/schema.ts` — Database schema
- `convex/rooms.ts` — Room mutations/queries
- `CLAUDE.md` — Updated project structure to reflect `src/app` and marked Milestone 1 complete

### Verification
- `npm run build` — succeeds, 0 errors
- `npm run lint` — 0 errors (4 warnings in auto-generated Convex files)
- `npm run dev` — serves landing page (200) and game route (200) without compilation errors
- `npx convex dev --once` — functions ready, schema deployed
