# Task: Visual Polish & Sprite System (Milestone 8b)

## Overview

Replace the placeholder geometric shapes (colored circles, rectangles, diamonds) with proper pixel-art-style sprites and visual enhancements. This transforms the game from a functional prototype into something that looks and feels like a cozy heist game.

The current state: tiles are flat colored rectangles, the Runner is an orange circle, guards are red circles, items are yellow diamonds, and the exit is a green square. There are no walking animations, no character details, no tile textures, and no visual personality.

**Dependencies:** Milestones 1–6 complete. Milestone 7 (Proc Gen) in progress but not needed — the renderer accepts any `TileType[][]` map. This task primarily modifies the engine renderer and view modules, which are independent of the event recording work in Milestone 8a.

## What to Build

### 1. Sprite Drawing System (`/src/engine/sprites.ts` — REWRITE)

The current `sprites.ts` is a near-empty placeholder (just a `drawColorRect` function). Replace it with a proper procedural sprite drawing system. We're NOT loading external sprite sheet images — instead, we'll draw rich pixel-art-style sprites procedurally on the canvas using the 2D API. This avoids asset loading complexity while still looking great.

```typescript
/**
 * Procedural sprite drawing library for WhisperRun.
 *
 * All sprites are drawn using Canvas 2D API calls — no external images.
 * This gives us pixel-art-style visuals with full control over colors,
 * animation frames, and rendering quality.
 */

const TILE = 32; // tile size

// ---- Runner Sprite ----

export function drawRunnerSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,  // screen center x
  sy: number,  // screen center y
  opts: {
    crouching: boolean;
    hiding: boolean;
    hasItem: boolean;
    walkFrame: number;  // 0-3 animation frame (cycles during movement)
    facingAngle: number; // radians, direction runner is moving
  }
): void {
  // Draw a chunky pixel-art character:
  // - Body: rounded rectangle torso in warm orange (#E39B32)
  // - Head: circle on top, slightly lighter
  // - Eyes: two small dark dots on the face
  // - Legs: two small rectangles below, offset per walkFrame for walking animation
  // - If crouching: squish vertically by 30%, lower the center
  // - If hiding: 40% opacity, dashed outline
  // - If hasItem: draw a small golden glow around one hand
  // - Subtle drop shadow beneath
}

// ---- Guard Sprite ----

export function drawGuardSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  opts: {
    state: "patrol" | "suspicious" | "alert" | "returning";
    angle: number;
    walkFrame: number;
    time: number;  // for pulsing/animation effects
  }
): void {
  // Draw a slightly larger, goofier character:
  // - Body: rounded rectangle, wider than runner, navy blue (#2C3E6B)
  // - Head: slightly larger circle, peaked cap on top (small triangle)
  // - Eyes: two dots, bigger than runner's
  // - State visual effects:
  //   - patrol: relaxed posture, normal colors
  //   - suspicious: yellow "?" above head, body slightly turned
  //   - alert: red glow, "!" above head, body leaning forward
  //   - returning: desaturated colors, walking back casually
  // - Badge: small gold dot on chest
  // - Legs: walking animation like runner but slightly different rhythm
}

// ---- Item Sprite ----

export function drawItemSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  opts: {
    time: number;  // for bob/glow animation
    pickedUp: boolean;
  }
): void {
  // Draw a treasure-like item:
  // - Gentle hovering bob (2px up and down, sinusoidal)
  // - Golden glow ring around it
  // - Diamond/gem shape with a highlight sparkle
  // - If pickedUp: ghost outline only (20% opacity)
}

// ---- Tile Sprites ----

export function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  variation: number  // 0-3, for visual variety (subtle pattern differences)
): void {
  // Warm wood-plank style floor:
  // - Base color: #E8D5B7 (existing warm beige)
  // - Subtle horizontal plank lines (thin darker lines at 1/3 and 2/3)
  // - Slight color variation per-tile (using variation param) for natural feel
  // - Small knot detail on some tiles (variation === 0)
}

export function drawWallTile(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  neighbors: { top: boolean; bottom: boolean; left: boolean; right: boolean }
): void {
  // Cozy brick/plaster wall:
  // - Base: dark brown (#5C4033)
  // - Top face highlight: slightly lighter strip at the top (3D effect)
  // - Edge handling: draw exposed edges differently depending on neighbors
  //   (a wall next to floor shows a clean face, wall-to-wall shows no border)
  // - Subtle brick pattern: small horizontal lines at 1/3 and 2/3
}

export function drawDoorTile(
  ctx: CanvasRenderingContext2D,
  x: number, y: number
): void {
  // Wooden door:
  // - Lighter brown (#A08060) rectangle with rounded corners
  // - Small doorknob circle on one side
  // - Panel lines (two small rectangles for door panels)
}

export function drawHideSpotTile(
  ctx: CanvasRenderingContext2D,
  x: number, y: number
): void {
  // Wardrobe/cabinet:
  // - Dark green-brown base (#4A5A3A) on floor tile background
  // - Two vertical lines creating a "cabinet doors" look
  // - Small handles (two dots)
  // - Slightly 3D with top highlight
}

export function drawExitTile(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  time: number
): void {
  // Exit door with sign:
  // - Green door (#4CAF50) with "EXIT" text above
  // - Pulsing green glow around the border
  // - Arrow pointing "out" (→ symbol)
  // - Brighter than other tiles to draw attention
}

export function drawCameraTile(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  time: number
): void {
  // Security camera mount:
  // - Small camera device on ceiling (dark rectangle with lens dot)
  // - Blinking red LED (small red dot that blinks using time param)
  // - Floor tile underneath
}
```

### 2. Enhanced Tile Map Renderer (`/src/engine/renderer.ts` — MODIFY)

Update `drawTileMap` to use the new sprite functions instead of flat colored rectangles. The key changes:

**a) Tile-level visual variety:**
Use the tile's position to generate a deterministic "variation" value (so the same tile always looks the same):
```typescript
const variation = (col * 7 + row * 13) % 4;
```

**b) Wall neighbor awareness:**
For each wall tile, check its 4 neighbors to determine which edges are exposed (adjacent to non-wall tiles). Pass this to `drawWallTile` for proper edge rendering.

**c) Replace flat fills with sprite functions:**
```typescript
switch (tile) {
  case TileType.Floor:
  case TileType.GuardSpawn:
    drawFloorTile(this.ctx, screen.x, screen.y, variation);
    break;
  case TileType.Wall:
    drawWallTile(this.ctx, screen.x, screen.y, neighbors);
    break;
  case TileType.Door:
    drawDoorTile(this.ctx, screen.x, screen.y);
    break;
  case TileType.HideSpot:
    drawHideSpotTile(this.ctx, screen.x, screen.y);
    break;
  case TileType.Exit:
    drawExitTile(this.ctx, screen.x, screen.y, time);
    break;
  case TileType.Camera:
    drawCameraTile(this.ctx, screen.x, screen.y, time);
    break;
  case TileType.ItemSpawn:
    drawFloorTile(this.ctx, screen.x, screen.y, variation);
    break;
}
```

**d) Add `time` parameter to `drawTileMap`:**
The method needs a `time` parameter (seconds since game start) for animated tiles (exit pulse, camera LED blink).

**e) Remove the letter labels:**
Delete the `TILE_LABELS` rendering that draws "H", "I", "E", "G", "C" on special tiles. These were developer aids; the sprite visuals replace them.

**f) Update entity drawing methods:**
Replace `drawRunner`, `drawGuard`, `drawItem`, `drawExit` with calls to the new sprite functions. The new sprite functions handle all the visual detail internally.

```typescript
drawRunner(worldX, worldY, crouching, hiding, hasItem, walkFrame, facingAngle) {
  const screen = this.camera.worldToScreen(
    worldX * TILE_SIZE + TILE_SIZE / 2,
    worldY * TILE_SIZE + TILE_SIZE / 2
  );
  drawRunnerSprite(this.ctx, screen.x, screen.y, {
    crouching, hiding, hasItem, walkFrame, facingAngle,
  });
}
```

### 3. Walk Animation State (`/src/components/GameCanvas.tsx` — SMALL MODIFY)

The renderer needs a `walkFrame` and `facingAngle` to animate the Runner and guards. Track this in the game loop.

**Runner walk animation:**
```typescript
// In the game loop, track runner movement for animation:
const runnerMoving = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
if (runnerMoving) {
  walkFrameAccum += dt * 8; // 8 frames per second walk cycle
  walkFrame = Math.floor(walkFrameAccum) % 4;
  facingAngle = Math.atan2(dy, dx);
} else {
  walkFrameAccum = 0;
  walkFrame = 0;
  // Keep last facingAngle
}
```

Store `walkFrame`, `facingAngle`, and `walkFrameAccum` in refs. Pass `walkFrame` and `facingAngle` to the renderer's `drawRunner` call.

**Guard walk animation:**
Guards already have position and angle from `tickGuard`. Add a simple walk frame counter that increments when a guard is moving:
```typescript
// Per guard, track walk frame
const guardMoving = guard.state !== "patrol" ||
  (Math.abs(guard.x - prevGuardX) > 0.001 || Math.abs(guard.y - prevGuardY) > 0.001);
```

This is a **small change** to GameCanvas — adding a few refs and passing extra params to renderer methods. It does NOT conflict with the event recording changes in 8a, which add callbacks and event tracking logic.

### 4. Enhanced Runner View (`/src/game/runner-view.ts` — MODIFY)

Improve the fog of war for a more atmospheric look:

**a) Animated fog edge:**
Add subtle noise/wobble to the fog-of-war radius so it feels more organic:
```typescript
// Instead of a perfect circle, add slight wobble
const wobble = Math.sin(time * 2 + angle * 3) * 4; // ±4 pixels
```

**b) Vignette effect:**
Add a subtle screen-edge vignette on top of the fog for more depth:
```typescript
// After fog, add a subtle vignette (darkened edges)
const vignette = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, Math.max(canvasWidth, canvasHeight) * 0.7);
vignette.addColorStop(0, "rgba(0,0,0,0)");
vignette.addColorStop(1, "rgba(0,0,0,0.3)");
```

**c) Ambient particles:**
Draw a few floating dust motes in the visibility radius for atmosphere. These are tiny (1-2px) semi-transparent circles that drift slowly:
```typescript
// Draw 5-10 ambient dust particles
for (let i = 0; i < 8; i++) {
  const particleX = runnerScreenX + Math.sin(time * 0.5 + i * 1.3) * radius * 0.6;
  const particleY = runnerScreenY + Math.cos(time * 0.4 + i * 1.7) * radius * 0.5;
  const alpha = 0.15 + 0.1 * Math.sin(time * 1.5 + i * 2);
  ctx.fillStyle = `rgba(255, 230, 180, ${alpha})`;
  ctx.beginPath();
  ctx.arc(particleX, particleY, 1.5, 0, Math.PI * 2);
  ctx.fill();
}
```

### 5. Enhanced Whisper Blueprint View (`/src/game/whisper-view.ts` — MODIFY)

Polish the blueprint view to feel more like an actual security monitor / blueprint:

**a) Scanline effect:**
Add faint horizontal scanlines over the entire blueprint for a "monitor" feel:
```typescript
// After all rendering, overlay faint scanlines
ctx.save();
ctx.fillStyle = "rgba(0, 0, 0, 0.03)";
for (let y = 0; y < mapHeight * TILE_SIZE; y += 3) {
  ctx.fillRect(0, y, mapWidth * TILE_SIZE, 1);
}
ctx.restore();
```

**b) Room labels:**
When the map has labeled rooms (from the chunk system), show faint room type names in the center of each room on the blueprint. This helps the Whisper communicate locations to the Runner. This requires reading room bounds — if that data isn't easily available, skip this sub-feature.

**c) Enhanced guard patrol route visualization:**
Currently guard routes aren't shown on the blueprint. Add faint dashed lines showing patrol waypoints (if waypoint data is available through gameState). This is the Whisper's most valuable intel.

Add an optional `guardPatrols` prop to `renderWhisperEntities`:
```typescript
export function renderWhisperEntities(
  ctx: CanvasRenderingContext2D,
  gameState: LocalGameState,
  time: number,
  guardPatrols?: Record<string, Array<{ x: number; y: number }>>
): void {
  // If patrol waypoints are available, draw them first (underneath entities)
  if (guardPatrols) {
    for (const [guardId, waypoints] of Object.entries(guardPatrols)) {
      // Draw faint dashed line connecting waypoints
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = "rgba(255, 100, 100, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < waypoints.length; i++) {
        const wx = waypoints[i].x * TILE_SIZE + TILE_SIZE / 2;
        const wy = waypoints[i].y * TILE_SIZE + TILE_SIZE / 2;
        if (i === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      // Close the loop
      if (waypoints.length > 1) {
        ctx.lineTo(waypoints[0].x * TILE_SIZE + TILE_SIZE / 2, waypoints[0].y * TILE_SIZE + TILE_SIZE / 2);
      }
      ctx.stroke();
      ctx.restore();

      // Small dots at each waypoint
      for (const wp of waypoints) {
        ctx.fillStyle = "rgba(255, 100, 100, 0.2)";
        ctx.beginPath();
        ctx.arc(wp.x * TILE_SIZE + TILE_SIZE / 2, wp.y * TILE_SIZE + TILE_SIZE / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // ... rest of entity rendering (existing code) ...
}
```

### 6. Landing Page Polish (`/src/app/page.tsx` — MODIFY)

Add some visual life to the landing page:

**a) Animated background:**
Add a subtle animated canvas or CSS gradient that evokes the game's warm/cozy feel. A simple approach: a slow-moving radial gradient using CSS animation.

```tsx
// Add behind the main content:
<div className="absolute inset-0 overflow-hidden">
  <div className="absolute w-[800px] h-[800px] rounded-full bg-[#FFD700]/5 blur-3xl
                  -top-40 -left-40 animate-pulse" style={{ animationDuration: "8s" }} />
  <div className="absolute w-[600px] h-[600px] rounded-full bg-[#E39B32]/5 blur-3xl
                  -bottom-40 -right-40 animate-pulse" style={{ animationDuration: "12s" }} />
</div>
```

**b) Subtitle animation:**
Animate the tagline text on mount with a staggered fade-in.

**c) Version/build info:**
Add a tiny "v0.1" label in the bottom corner for developer reference.

### 7. CSS Animations (`/src/app/globals.css` — MODIFY)

Add a few utility animations used across the UI:

```css
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 5px rgba(255, 215, 0, 0.3); }
  50% { box-shadow: 0 0 20px rgba(255, 215, 0, 0.6); }
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
```

## Key Technical Details

### Procedural Sprites, Not Image Assets

All sprites are drawn using Canvas 2D primitives (arcs, rects, lines, paths). This is intentional:
- No asset loading, no failed image requests, no loading screens
- Easy to tweak colors and proportions
- Consistent with the chunky pixel art style (32x32 tiles)
- The "programmer art" constraint becomes a design choice — clean, geometric shapes with character

### Performance: Tile Caching

Drawing complex tile sprites every frame for every visible tile could be expensive. Optimization: draw each unique tile variation to an offscreen canvas once, then use `drawImage` to stamp them.

```typescript
// Create a tile cache (one offscreen canvas per tile variant):
const tileCache = new Map<string, HTMLCanvasElement>();

function getCachedTile(type: TileType, variation: number, neighbors?: object): HTMLCanvasElement {
  const key = `${type}-${variation}-${JSON.stringify(neighbors ?? {})}`;
  if (tileCache.has(key)) return tileCache.get(key)!;

  const offscreen = document.createElement("canvas");
  offscreen.width = TILE_SIZE;
  offscreen.height = TILE_SIZE;
  const octx = offscreen.getContext("2d")!;

  // Draw the tile sprite onto the offscreen canvas
  switch (type) {
    case TileType.Floor: drawFloorTile(octx, 0, 0, variation); break;
    case TileType.Wall: drawWallTile(octx, 0, 0, neighbors!); break;
    // etc.
  }

  tileCache.set(key, offscreen);
  return offscreen;
}
```

Then in `drawTileMap`:
```typescript
const cached = getCachedTile(tile, variation, neighbors);
this.ctx.drawImage(cached, screen.x, screen.y);
```

**Note:** Animated tiles (Exit, Camera) should NOT be cached — they need to render fresh each frame.

### Walk Frame Conventions

- Runner walk cycle: 4 frames (0, 1, 2, 3). Frame 0 and 2 are neutral (legs together), 1 and 3 are extended (legs apart, mirrored). At 8fps, one full cycle = 0.5 seconds.
- Guard walk cycle: same 4 frames but at 6fps (slightly slower, lumbering gait).
- When stationary: frame 0 (neutral).

### No Changes to Game Logic

This task does NOT modify any game logic, Convex mutations, collision detection, or state management. It only changes how things are drawn. The rendering API (method names and signatures on the Renderer class) may add new parameters but should remain backwards-compatible.

### Color Palette (Reference)

Maintain the established cozy color palette:
- **Background:** #2D1B0E (dark warm brown), #1a1a2e (dark navy for game bg)
- **Floor tiles:** #E8D5B7 (warm beige) with slight variations
- **Walls:** #5C4033 (dark brown) with #4A3528 and #6B5040 for depth
- **Runner:** #E39B32 (warm orange) with #B47820 (darker)
- **Guards:** #2C3E6B (navy) for body, state colors: patrol #FF6B6B, alert #FF3333, suspicious #FFaa33
- **Items:** #FFD700 (gold) with #DAA520 (darker gold)
- **Exit:** #4CAF50 (green) with #2E7D32 (darker green)
- **Whisper blueprint:** #141e30 (dark navy bg), #1e3a5f (grid), #8BB8E8 (text)
- **UI accents:** #FFD700 (gold), #E8D5B7 (warm text)

## Files to Create
- None (all modifications to existing files)

## Files to Modify
- `/src/engine/sprites.ts` — Complete rewrite: procedural sprite drawing functions for Runner, Guard, Items, and all tile types
- `/src/engine/renderer.ts` — Update tile map rendering to use sprite functions, add time parameter, add tile caching, update entity draw methods to use new sprite functions
- `/src/game/runner-view.ts` — Add fog wobble, vignette, and ambient dust particles
- `/src/game/whisper-view.ts` — Add scanline effect, guard patrol route visualization
- `/src/components/GameCanvas.tsx` — Add walk animation state tracking (walkFrame, facingAngle refs), pass animation data to renderer (SMALL change, just a few refs and params)
- `/src/app/page.tsx` — Add animated background blobs, version label
- `/src/app/globals.css` — Add float, glow-pulse, and slide-up keyframe animations

## How to Verify

1. `npm run build` succeeds with no type errors.
2. Open the game in a browser. The landing page should have subtle animated background elements.
3. Create a game and start playing:
   - **Tiles look textured:** Floor tiles show subtle wood-plank lines and slight color variation. Wall tiles have brick-like patterns with 3D edge highlights. Door tiles look like actual doors with panels and knobs.
   - **Runner has character:** The Runner is a small humanoid figure (not just a circle) with a body, head, and animated legs when walking. Crouching squishes the sprite down. Hiding makes it translucent.
   - **Guards look distinct:** Guards are slightly larger humanoid figures with a peaked cap and navy color. Alert guards have a red glow and "!" icon.
   - **Item sparkles:** The target item has a golden glow and gentle bobbing animation.
   - **Exit pulses:** The exit tile has a green "EXIT" sign with pulsing glow.
   - **Camera blinks:** Camera tiles have a blinking red LED.
4. **Fog of war is atmospheric:** The Runner's visibility circle has a slightly wobbly edge and faint dust particles floating inside.
5. **Whisper view is enhanced:** The blueprint view has faint scanlines. Guard patrol routes are shown as dashed red lines connecting waypoints.
6. **Performance is smooth:** No frame drops on a normal laptop. Tile caching prevents expensive per-frame sprite drawing.
7. **Animations are subtle:** Walk animations are visible but not distracting. Effects are atmospheric, not flashy.
8. **Colors are consistent:** Everything uses the established warm/cozy palette. No jarring new colors.
9. **No gameplay changes:** Movement, collision, guard AI, pings, and all other mechanics work exactly as before.

---

## Completion Summary

### What was built

Replaced all placeholder geometric shapes with procedural pixel-art-style sprites drawn using the Canvas 2D API. Added atmospheric visual effects (fog wobble, dust particles, vignette, scanlines) and walking animations for both Runner and Guards. No external image assets needed — everything is drawn procedurally.

### Files modified

- **`/src/engine/sprites.ts`** — Complete rewrite: 7 procedural sprite drawing functions (Runner, Guard, Item, Floor, Wall, Door, HideSpot, Exit, Camera tiles). Each draws detailed pixel-art using Canvas 2D primitives with proper colors, animations, and state-based variations.

- **`/src/engine/renderer.ts`** — Updated `drawTileMap` to use sprite functions with tile caching (offscreen canvas for static tiles). Added `time` parameter for animated tiles. Updated `drawRunner`, `drawGuard`, `drawItem` to accept and pass animation params (walkFrame, facingAngle, time). Removed flat color fills and letter labels.

- **`/src/components/GameCanvas.tsx`** — Added walk animation state refs (walkFrame, facingAngle, accumulator) for Runner and per-guard walk animation tracking. Updated render calls to pass animation data. Passed guard patrol waypoints to whisper view.

- **`/src/game/runner-view.ts`** — Enhanced `renderFogOfWar` with: wobbly fog edge (sinusoidal displacement along circle), screen vignette effect, ambient floating dust particles. Added `time` parameter.

- **`/src/game/whisper-view.ts`** — Added scanline overlay to blueprint map. Added guard patrol route visualization (dashed lines connecting waypoints with dot markers). Added `guardPatrols` optional parameter to `renderWhisperEntities`.

- **`/src/app/page.tsx`** — Added animated background blobs (pulsing warm gradients), version label (v0.1).

- **`/src/app/globals.css`** — Added float, glow-pulse, and slide-up keyframe animations.

### Key design decisions

- **Tile caching**: Static tiles (floor, wall, door, hide spot) are drawn to offscreen canvases once and stamped via `drawImage`. Animated tiles (exit, camera) render fresh each frame.
- **Walk animation**: Runner at 8fps (4-frame cycle), Guards at 6fps (slightly slower, lumbering gait). Stationary = frame 0.
- **No gameplay changes**: All changes are purely visual — same collision, guard AI, game logic.
- **Color palette**: Maintained the established warm/cozy palette from CLAUDE.md.

### Verification

- `npm run build` — passes with no type errors
- `npm run lint` — clean (only auto-generated Convex warnings)

---

## Review Notes (Reviewer: f59e007e)

### Issues Found & Fixed

1. **Double-rendered Exit tile** (`GameCanvas.tsx`): The Runner rendering path called `renderer.drawExit(state.exitX, state.exitY, ...)` after `renderer.drawTileMap(...)`, but `drawTileMap` already handles Exit tiles directly (they're animated, not cached). This caused the exit to be drawn twice — doubling glow effects and producing a visual glitch. Removed the redundant `drawExit` call.

2. **Dead `drawExit` method** (`renderer.ts`): After removing the only call site, `Renderer.drawExit()` became dead code. Removed the method to keep the API clean.

3. **Tile cache memory management** (`renderer.ts`): The module-level `tileCache` Map held offscreen canvases indefinitely. Added `clearTileCache()` export and called it in GameCanvas's cleanup effect so canvases are freed on unmount (e.g., navigating away or "Play Again" re-mount).

4. **Redundant division by 1** (`sprites.ts:433`): `const panelW = (TILE - doorPad * 2 - 6) / 1` — removed the no-op `/ 1`.

### Review Observations (No Fix Needed)

- **Tile cache key design**: The cache key uses `type-variation-TTFF` format for walls, which produces a bounded number of entries (~300 max). Acceptable for this use case.
- **Fog winding rule**: The wobbly fog hole iterates counter-clockwise from `segments` to `0`, creating a properly wound hole via the nonzero rule against the clockwise outer rect. Correct.
- **Walk animation state lifecycle**: Animation refs (`walkFrameRef`, `guardWalkFrameRef`, etc.) are local to the effect closure and reset correctly on re-mount.
- **Sprite quality**: The procedural sprites are well-drawn with proper `save()`/`restore()` calls, correct use of `globalAlpha`, `shadowBlur` scoped properly, and `setLineDash` reset after use.
- **Scanline rendering**: Drawing individual 1px-high rects every 3 pixels is straightforward. For very large maps this could be many rects, but since it's inside the Whisper's scaled context (small actual pixel count), performance is fine.

### Build & Lint

- `npm run build` — PASSES (zero errors)
- `npm run lint` — PASSES (only 4 pre-existing Convex generated file warnings)
