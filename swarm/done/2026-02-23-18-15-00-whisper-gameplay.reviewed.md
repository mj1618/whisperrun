# Task: Whisper Gameplay (Milestone 4)

## Overview

Build the Whisper player's complete gameplay experience. The Whisper sees a bird's-eye blueprint view of the entire map — a dark, schematic-style rendering that shows the full layout, all guard positions and patrol routes, camera vision cones, the Runner's position, and the target item. The Whisper's primary tool is the **ping system**: click anywhere on the map to place a marker that the Runner can see for 5 seconds.

This milestone turns the game from a single-player Runner demo into a true two-player co-op experience. The Whisper can't move or interact with the game world directly — their entire value comes from information and communication via pings.

**Dependency:** This task assumes Milestone 3 (Runner Gameplay) is complete — the Runner can move, the game state has real-time position updates via Convex, and GameCanvas renders entities (Runner circle, items, guards, exit).

## What to Build

### 1. Ping Mutations (`/convex/game.ts` — MODIFY)

Add two new functions to the existing game.ts:

#### `addPing` (mutation)
- Args: `{ roomId: v.id("rooms"), x: v.number(), y: v.number(), type: v.union(v.literal("danger"), v.literal("go"), v.literal("item")) }`
- Validate: game phase is `"planning"` or `"heist"` (no pings after game ends)
- Count current active pings (where `Date.now() - createdAt < 5000`). Max 3 active pings. If already 3, remove the oldest before adding the new one.
- Add ping to `gameState.pings` array: `{ x, y, type, createdAt: Date.now() }`

#### `cleanupPings` (mutation)
- Args: `{ roomId: v.id("rooms") }`
- Remove all pings where `Date.now() - createdAt > 5000`
- The client will call this periodically (every second or so) to keep the pings array tidy. Alternatively, the Whisper client can call it before adding a new ping. Keep it simple — no Convex scheduled functions needed for this.

### 2. Whisper View Renderer (`/src/game/whisper-view.ts` — NEW FILE)

The Whisper sees a completely different visual style from the Runner. Instead of the warm, cozy tile colors, the Whisper sees a dark blueprint/schematic view.

#### Blueprint Tile Rendering

Export a function `renderBlueprintMap(ctx, camera, map, canvasWidth, canvasHeight)` that draws the map in blueprint style:

**Color palette (blueprint/tactical theme):**
- Background: `#0a0e1a` (very dark navy)
- Floor tiles: `#141e30` (dark blue-gray) with thin `#1e3a5f` (blue) grid lines
- Wall tiles: `#1e3a5f` (blue) with lighter `#2a5a8f` outline — walls should be visually prominent
- Door tiles: `#2a5a8f` with a dashed outline or a gap in the wall
- HideSpot: `#1a3a1a` (dark green) — subtle, just a slightly different floor shade with a small icon/symbol
- ItemSpawn: empty (the item entity will be rendered separately)
- Exit: `#1a3a1a` (dark green) with a brighter `#4CAF50` dashed border
- GuardSpawn: empty (guard entity rendered separately)
- Camera tile: `#1a1a3a` (dark purple tint)

**Style details:**
- Thinner grid lines than Runner view (0.5px instead of 1px)
- Walls drawn slightly larger (extend 1px past tile boundaries) so they feel solid
- No tile labels (H/I/E/G/C) — entities are rendered as proper icons instead

#### Entity Rendering for Whisper

Export a function `renderWhisperEntities(ctx, camera, gameState)` that draws all game entities on the blueprint:

**Runner (always visible to Whisper):**
- Draw as a small filled circle (radius ~10px) in warm orange `#FF8C42` with a pulsing glow effect (use `shadowBlur`)
- If Runner is crouching, draw slightly smaller with a "C" label
- If Runner is hiding, draw as a hollow circle (outline only) with lower opacity
- The Whisper always knows where the Runner is

**Guards:**
- Draw as red circles (radius ~12px) in `#FF4444`
- Draw a direction indicator: a small triangle/wedge pointing in the guard's facing direction (use the `angle` field)
- Draw the vision cone: a transparent wedge extending from the guard, 60° angle, 5 tiles range. Use `#FF444420` fill with `#FF444440` stroke. Use `ctx.beginPath()`, `ctx.moveTo()`, `ctx.arc()`, `ctx.closePath()`.
- **Patrol route visualization:** For now, draw a small dotted circle around the guard's position indicating they patrol (actual routes come in Milestone 5). Just show the guard as a red dot with its vision cone.

**Items:**
- Draw non-picked-up items as a gold `#FFD700` diamond shape (rotated square) with a subtle pulse animation
- If picked up, skip rendering (or show a faded ghost at the original position)

**Exit:**
- Draw as a green `#4CAF50` double-border square (inner and outer borders) with "EXIT" label in small text

**Pings (Whisper sees their own pings):**
- Danger pings: red `#FF4444` expanding ring animation
- Go pings: green `#44FF44` expanding ring animation
- Item pings: gold `#FFD700` expanding ring animation
- All pings fade out over their 5-second lifetime (reduce alpha from 1.0 to 0.0)
- Draw as concentric rings that expand outward (2-3 rings, each animating outward and fading)

### 3. Whisper Camera Setup

The Whisper's camera should show the **entire map** at once, zoomed out to fit the full layout within the viewport.

In the Whisper's rendering setup (inside GameCanvas or a new WhisperCanvas component — see section 5):
- Calculate the zoom needed to fit the full 20x16 map within the canvas
- The map is 640x512 pixels (20 tiles × 32px, 16 tiles × 32px)
- Camera should center the map in the viewport
- **Approach:** Instead of modifying the Camera class to support zoom (which would affect the Runner), use a `ctx.scale()` transform before rendering. Calculate `scale = Math.min(canvasWidth / mapPixelWidth, canvasHeight / mapPixelHeight) * 0.9` (the 0.9 gives a small margin). Apply `ctx.save()`, `ctx.translate(offsetX, offsetY)`, `ctx.scale(scale, scale)`, render, `ctx.restore()`.
- The Whisper can also scroll/pan if the map is larger than expected, but for the MVP test map, it should all fit on screen.

### 4. Ping Interaction System (`/src/game/ping-system.ts` — NEW FILE)

Handle the Whisper's click-to-ping interaction.

```typescript
export interface PingConfig {
  type: "danger" | "go" | "item";
  color: string;
  label: string;
}

export const PING_TYPES: PingConfig[] = [
  { type: "go", color: "#44FF44", label: "Go Here" },
  { type: "danger", color: "#FF4444", label: "Danger" },
  { type: "item", color: "#FFD700", label: "Item" },
];
```

**Interaction flow:**
1. Whisper clicks on the canvas
2. Convert screen coords → world coords (accounting for the blueprint zoom/offset)
3. Convert world coords → tile coords (divide by TILE_SIZE)
4. Only allow pings on walkable tiles (no pinging inside walls)
5. Call `addPing` mutation with the tile coordinates and currently selected ping type
6. Default ping type is "go" (green). Whisper can switch with keyboard: 1=go, 2=danger, 3=item

**Ping type selector UI:** A small toolbar at the bottom of the Whisper's screen showing three ping type buttons. The active one is highlighted. Keyboard shortcuts 1/2/3 also switch.

### 5. Render Pings on Runner's View (`/src/game/runner-view.ts` — MODIFY)

After the fog of war is drawn, render active pings on the Runner's screen:

- Each ping appears as a directional indicator if off-screen, or a marker if on-screen
- **On-screen ping:** Draw a colored ring at the ping's world position (converted to screen coords). The ring pulses/expands. Show a small icon matching the ping type (or just the colored ring — keep it simple).
- **Off-screen ping:** Draw an arrow/chevron at the edge of the screen pointing toward the ping location. Color matches ping type. This is critical — pings are useless if the Runner can't see them because they're off-camera.
- Ping fade: pings start fully opaque and linearly fade to 0 over 5 seconds (`alpha = 1 - (elapsed / 5000)`)
- Render pings ABOVE the fog of war so they're always visible (even in dark areas)

Export: `renderPings(ctx, camera, pings, canvasWidth, canvasHeight, currentTime)`

### 6. Refactor GameCanvas for Role-Based Rendering (`/src/components/GameCanvas.tsx` — MODIFY)

After Milestone 3, GameCanvas handles the Runner view. Now it needs to also handle the Whisper view based on the player's role.

**Option A (simpler — recommended):** Keep one GameCanvas component with role-based branching:
- The `role` prop (already passed from the game page) determines the rendering path
- In the render function of the game loop:
  - If role is `"runner"`: use existing Runner rendering (tile map with warm colors, fog of war, entity rendering, ping display)
  - If role is `"whisper"`: use blueprint rendering (dark map, full entity visibility, no fog of war, vision cones, ping type selector)
- In the update function:
  - If role is `"runner"`: handle WASD movement, interactions (existing)
  - If role is `"whisper"`: handle click-to-ping, ping type switching (1/2/3 keys), no movement
- Camera setup:
  - Runner: camera follows Runner position (existing)
  - Whisper: camera shows full map (zoomed out, centered)

**Key change:** Add a `canvas.addEventListener('click', ...)` (or `'pointerdown'`) for the Whisper's ping interaction. Convert the click coordinates using the inverse of the blueprint zoom transform to get world tile coordinates.

### 7. Whisper HUD (`/src/components/HUD.tsx` — MODIFY)

The existing HUD (from Milestone 3) shows Runner info. Add Whisper-specific HUD:

**Whisper HUD elements:**
- **Timer** (top-center): same as Runner — elapsed time since game start
- **Phase indicator** (top-left): "PLANNING" or "HEIST IN PROGRESS"
- **Ping type selector** (bottom-center): three buttons for Go/Danger/Item, showing which is active. Display the keyboard shortcuts (1/2/3).
- **Active pings count** (bottom-right): "Pings: 2/3" showing how many active pings are placed
- **Runner status** (top-right): show "Runner is crouching" / "Runner is hiding" / "Runner has the item!" — the Whisper needs to know what the Runner is doing
- **Item status**: show whether the target item has been picked up

**Props for Whisper HUD:** `phase: string`, `startTime: number`, `activePingCount: number`, `selectedPingType: string`, `runnerState: { crouching: boolean; hiding: boolean; hasItem: boolean }`, `itemName: string`

The HUD component should accept a `role` prop and render the appropriate variant.

## Key Technical Details

### Blueprint Zoom Transform

The Whisper's full-map view needs a zoom transform. Here's the exact approach:

```typescript
// In the Whisper render path:
const mapPixelW = getMapWidth(TEST_MAP) * TILE_SIZE; // 640
const mapPixelH = getMapHeight(TEST_MAP) * TILE_SIZE; // 512
const scale = Math.min(canvasWidth / mapPixelW, canvasHeight / mapPixelH) * 0.9;
const offsetX = (canvasWidth - mapPixelW * scale) / 2;
const offsetY = (canvasHeight - mapPixelH * scale) / 2;

ctx.save();
ctx.translate(offsetX, offsetY);
ctx.scale(scale, scale);

// Render blueprint map and entities here — all coordinates in world space
renderBlueprintMap(ctx, map);  // Note: no camera offset needed since we're in world space
renderWhisperEntities(ctx, gameState);

ctx.restore();
```

For click-to-world conversion (ping placement):
```typescript
function screenToWorldWhisper(screenX: number, screenY: number): { x: number; y: number } {
  const worldX = (screenX - offsetX) / scale;
  const worldY = (screenY - offsetY) / scale;
  return { x: worldX / TILE_SIZE, y: worldY / TILE_SIZE }; // Returns tile coords
}
```

### Vision Cone Rendering

Guards have an `angle` field (radians, 0 = right, π/2 = down). Draw the vision cone:

```typescript
function drawVisionCone(ctx, guardScreenX, guardScreenY, angle, range, fovDeg) {
  const fov = (fovDeg * Math.PI) / 180; // 60° = ~1.047 rad
  const rangePixels = range * TILE_SIZE; // 5 tiles = 160px

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = "#FF4444";
  ctx.beginPath();
  ctx.moveTo(guardScreenX, guardScreenY);
  ctx.arc(guardScreenX, guardScreenY, rangePixels, angle - fov / 2, angle + fov / 2);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = "#FF4444";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
```

### Ping Lifecycle

- Pings live for 5 seconds (5000ms)
- Both Runner and Whisper see pings
- Runner sees pings as colored markers + off-screen indicators
- Whisper sees pings as expanding ring animations on the blueprint
- `cleanupPings` is called by the Whisper client every ~2 seconds to remove expired pings
- Max 3 active pings at once. Adding a 4th removes the oldest.

### Convex Integration

- Whisper subscribes to same `getGameState` query as Runner
- Whisper calls `addPing` mutation on click
- Whisper calls `cleanupPings` periodically (setInterval in useEffect, every 2 seconds)
- No new queries needed — the existing gameState subscription includes pings, guards, runner position, items

## Files to Create
- `/src/game/whisper-view.ts` — Blueprint map renderer + entity rendering for Whisper
- `/src/game/ping-system.ts` — Ping type definitions + coordinate conversion utilities

## Files to Modify
- `/convex/game.ts` — Add `addPing` and `cleanupPings` mutations
- `/src/components/GameCanvas.tsx` — Add role-based rendering (Runner vs Whisper paths), add Whisper click-to-ping handler
- `/src/game/runner-view.ts` — Add ping rendering on Runner's screen (on-screen markers + off-screen indicators)
- `/src/components/HUD.tsx` — Add Whisper HUD variant (ping selector, runner status, active ping count)

## How to Verify

1. `npx convex dev` runs without errors (new mutations deploy)
2. `npm run build` succeeds
3. Open two browser tabs. Create a game, have both players join.
4. Player 1 selects Runner, Player 2 selects Whisper. Start game.
5. **Whisper view:** The Whisper player sees a dark blueprint-style map showing the full layout zoomed to fit the screen. All walls, doors, and rooms are visible in blue/navy tones.
6. **Entities on blueprint:** The Whisper sees the Runner as an orange dot, the guard as a red dot with a vision cone wedge, the item as a gold diamond, and the exit as a green bordered square.
7. **Runner movement visible:** As the Runner moves (in the other tab), the Whisper sees the orange dot move in real-time on the blueprint.
8. **Ping placement:** The Whisper clicks on the map → a green "go" ping appears at that location. It shows as an expanding ring on the Whisper's view.
9. **Ping on Runner:** The Runner sees the ping as a colored marker on their screen. If the ping is off-screen, an arrow/chevron at the screen edge points toward it.
10. **Ping types:** Press 1/2/3 on the Whisper's keyboard to switch ping types. Place a red "danger" ping and a gold "item" ping — each has the correct color.
11. **Ping expiry:** After 5 seconds, pings fade out and disappear from both views.
12. **Max pings:** Place 4 pings quickly — only the 3 most recent remain.
13. **Whisper HUD:** Shows timer, phase, ping type selector buttons, active ping count, and Runner status (crouching/hiding/has item).
14. **Runner HUD unchanged:** Runner still sees their own HUD (timer, item status, crouch indicator).
15. **Game phases:** Pings work during both planning and heist phases. After the Runner escapes, pinging is disabled.

---

## Completion Summary

### What was built

Complete Whisper gameplay experience for Milestone 4 — the game is now a true two-player co-op experience with asymmetric views.

**Whisper Blueprint View:**
- Dark navy/blue schematic-style map renderer showing the full level zoomed to fit viewport
- All entities visible: Runner (orange pulsing dot with glow), guards (red circles with direction indicators and 60° vision cones), items (gold diamonds with pulse animation), exit (green double-border with EXIT label)
- Pings shown as animated expanding concentric rings with fade-out over 5 seconds

**Ping System:**
- Whisper clicks on map to place pings (screen→world coordinate conversion via blueprint zoom transform)
- Three ping types: Go (green), Danger (red), Item (gold) — switchable via keyboard (1/2/3) or HUD buttons
- Max 3 active pings; adding a 4th removes the oldest
- Pings live for 5 seconds with linear fade-out
- Runner sees pings as colored markers on-screen, or directional chevrons at screen edge when off-screen
- Pings render above fog of war so Runner always sees them
- `cleanupPings` runs every 2 seconds on Whisper client to remove expired pings

**Whisper HUD:**
- Blueprint-themed dark UI with blue border styling
- Timer (top-center), phase indicator (top-left), Runner status (top-right)
- Ping type selector toolbar (bottom-center) with keyboard shortcuts
- Active ping count display (bottom-right)
- Controls hint overlay

**Convex Backend:**
- `addPing` mutation: validates game phase, enforces max 3 active pings, adds ping to gameState
- `cleanupPings` mutation: removes expired pings (>5s old), only writes if something changed

### Files created
- `/src/game/whisper-view.ts` — Blueprint map renderer (`renderBlueprintMap`) + entity/ping renderer (`renderWhisperEntities`) + vision cone drawing
- `/src/game/ping-system.ts` — Ping type definitions (`PING_TYPES`), color lookup, screen→tile coordinate conversion for blueprint view

### Files modified
- `/convex/game.ts` — Added `addPing` and `cleanupPings` mutations
- `/src/components/GameCanvas.tsx` — Role-based rendering (Runner vs Whisper paths), Whisper click-to-ping handler, blueprint zoom transform, ping type keyboard shortcuts, periodic ping cleanup
- `/src/game/runner-view.ts` — Added `renderPings()` function for on-screen markers + off-screen directional chevrons
- `/src/components/HUD.tsx` — Added `role` prop, Whisper HUD variant with ping selector, runner status, active ping count, blueprint-themed styling

### Verification
- `npm run build` — passes cleanly
- `npm run lint` — 0 errors (4 warnings from Convex generated files only)

---

## Review Notes (agent: 8c7a54be)

### Issues Found & Fixed

1. **HUD timer uses heist start time** (`GameCanvas.tsx`): Changed `startTime` prop to prefer `heistStartTime` over `startTime` so the timer counts from when the heist actually starts, not from room creation.

2. **Missing timeout overlay** (`GameCanvas.tsx`): The schema includes a `timeout` phase but there was no end-game overlay for it. Added a "Time's Up!" overlay matching the style of the escaped/caught overlays.

3. **HUD hidden during caught/timeout phases** (`HUD.tsx`): The HUD component returned `null` for `caught` and `timeout` phases, so players lost the timer display at game end. Updated the phase filter to include all active game phases.

### No Issues Found In
- `convex/game.ts` — `addPing` and `cleanupPings` mutations are correct. Server-side ping expiry filtering and max-3 limit work properly. `addPing` validates game phase correctly.
- `src/game/whisper-view.ts` — Blueprint renderer is clean. Blueprint color palette, vision cone rendering, entity drawing, and ping ring animations all look correct. Canvas state is properly saved/restored.
- `src/game/ping-system.ts` — Types, constants, and `screenToTileWhisper` coordinate conversion are correct.
- `src/game/runner-view.ts` — Fog of war implementation and ping rendering (on-screen markers + off-screen chevrons) are well-implemented. Edge detection math for off-screen chevrons is correct.
- `src/components/HUD.tsx` — Whisper HUD variant properly shows ping selector, runner status, and active ping count with blueprint-themed styling.

4. **Missing end-game overlays** (`GameCanvas.tsx`): Another concurrent agent removed the escaped/caught/timeout overlays while refactoring the planning overlay. Restored all three end-game overlays so players see feedback when the game ends.

5. **Missing `heistStartTime` prop in HUD** (`HUD.tsx`): The `GameCanvas` was passing `heistStartTime` as a separate prop but the HUD interface didn't accept it. Added the prop and updated the timer to use `heistStartTime` when available during heist and end phases.

### Build Verification
- `npm run build` — passes cleanly, 0 errors
- `npm run lint` — 0 errors (4 warnings from auto-generated Convex files only)
