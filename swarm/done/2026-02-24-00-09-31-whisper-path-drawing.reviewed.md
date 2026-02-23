# Task: Whisper Path Drawing

## Overview

The Whisper's role right now is limited to placing up to 3 pings with a 5-second fadeout. That's functional but thin — the "one sneaks, one guides" promise requires the Whisper to feel like an actual guide, not just a ping machine. This task adds a **path drawing system** where the Whisper can click-and-drag on the blueprint map to draw a glowing route that the Runner sees as a luminous trail through the fog of war.

This is the single highest-impact feature for improving the core co-op experience. It transforms the Whisper from a passive observer into an active navigator — drawing safe routes around guards, marking escape paths, and adapting guidance in real-time as the situation changes.

**Design:** The Whisper holds Shift and drags on the blueprint map to draw a path. The path is a series of connected waypoints (tile coordinates) that get synced to Convex and rendered as a glowing trail on both views. Paths fade out after 15 seconds (longer than pings since they represent routes, not points). Max 1 active path at a time — drawing a new path replaces the old one. During the planning phase, paths persist until the heist starts (no auto-fade), giving the Whisper time to plan the initial route.

**Why Shift+drag instead of just drag?** Plain click is already used for pings. We need to differentiate. Shift+drag is a natural "drawing" gesture. On mobile, a two-finger drag or a dedicated "draw path" toggle button in the HUD can serve the same purpose.

## What to Build

### 1. Path Schema in Convex (`/convex/schema.ts` — MODIFY)

Add a `paths` array to the `gameState` table. A path is a sequence of points drawn by the Whisper:

```typescript
paths: v.array(
  v.object({
    points: v.array(v.object({ x: v.number(), y: v.number() })),
    createdAt: v.number(),
  })
),
```

Keep it simple — one path entry per drawn stroke. Max 1 active path. The `createdAt` timestamp controls fadeout.

### 2. Path Mutations in Convex (`/convex/game.ts` — MODIFY)

Add two mutations:

#### `drawPath` mutation

```typescript
export const drawPath = mutation({
  args: {
    roomId: v.id("rooms"),
    points: v.array(v.object({ x: v.number(), y: v.number() })),
  },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();
    if (!gameState) throw new Error("Game not found");
    if (gameState.phase !== "planning" && gameState.phase !== "heist") return;

    // Limit points array size to prevent abuse (max 50 points per path)
    const points = args.points.slice(0, 50);
    if (points.length < 2) return; // Need at least 2 points for a path

    // Replace all existing paths with the new one (max 1 active path)
    await ctx.db.patch(gameState._id, {
      paths: [{ points, createdAt: Date.now() }],
    });
  },
});
```

#### `cleanupPaths` mutation

```typescript
export const cleanupPaths = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();
    if (!gameState) return;

    // During planning phase, paths don't expire
    if (gameState.phase === "planning") return;

    const now = Date.now();
    const PATH_DURATION = 15000; // 15 seconds during heist
    const activePaths = gameState.paths.filter((p) => now - p.createdAt < PATH_DURATION);

    if (activePaths.length !== gameState.paths.length) {
      await ctx.db.patch(gameState._id, { paths: activePaths });
    }
  },
});
```

### 3. Initialize Paths in Game Start (`/convex/rooms.ts` — MODIFY)

In the `startGame` mutation where the initial `gameState` is created, add `paths: []` to the initial state. Find the `ctx.db.insert("gameState", { ... })` call and add paths.

### 4. Path State in LocalGameState (`/src/game/game-state.ts` — MODIFY)

Add `paths` to the `LocalGameState` interface:

```typescript
paths: Array<{ points: Array<{ x: number; y: number }>; createdAt: number }>;
```

And map it from the Convex subscription data in the GameStateManager's sync method (same place where pings, guards, etc. are mapped). Default to `[]` if not present (for backwards compatibility with existing game sessions).

### 5. Whisper Path Drawing Input (`/src/components/GameCanvas.tsx` — MODIFY)

Add a Shift+drag drawing system for the Whisper. This runs alongside the existing click-to-ping handler.

**State needed:**
- `isDrawingPath` ref (boolean) — true while Shift is held and mouse/touch is dragging
- `currentPathPoints` ref (array of `{x, y}`) — accumulated points during the current stroke
- `drawPathRef` — ref to the `drawPath` mutation

**Event handling:**

Add a second `useEffect` for Whisper path drawing (separate from the ping handler):

```typescript
useEffect(() => {
  if (role !== "whisper") return;
  const canvas = canvasRef.current;
  if (!canvas) return;

  const isDrawing = { current: false };
  const pathPoints: Array<{ x: number; y: number }> = [];
  const MIN_POINT_DISTANCE = 0.5; // Min distance between sampled points (tiles)

  const screenToTile = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const screenX = (clientX - rect.left) * (canvas.width / rect.width);
    const screenY = (clientY - rect.top) * (canvas.height / rect.height);
    const { offsetX, offsetY, scale } = blueprintTransformRef.current;
    return screenToTileWhisper(screenX, screenY, offsetX, offsetY, scale);
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (!e.shiftKey) return; // Only draw path when Shift is held
    const state = gameStateManagerRef.current.getState();
    if (!state) return;
    if (state.phase !== "planning" && state.phase !== "heist") return;

    e.preventDefault(); // Prevent the ping handler from also firing
    isDrawing.current = true;
    pathPoints.length = 0;

    const tile = screenToTile(e.clientX, e.clientY);
    pathPoints.push({ x: tile.x, y: tile.y });

    canvas.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDrawing.current) return;

    const tile = screenToTile(e.clientX, e.clientY);
    const last = pathPoints[pathPoints.length - 1];
    const dist = Math.hypot(tile.x - last.x, tile.y - last.y);

    // Only add point if far enough from last (prevents too many points)
    if (dist >= MIN_POINT_DISTANCE) {
      pathPoints.push({ x: tile.x, y: tile.y });
    }
  };

  const handlePointerUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;

    if (pathPoints.length >= 2) {
      drawPathRef.current({
        roomId,
        points: [...pathPoints],
      });

      // Play a subtle draw sound
      if (isAudioReady()) {
        playPingSound("go"); // Reuse the "go" ping sound as a confirmation
      }
    }

    pathPoints.length = 0;
  };

  // Use pointerdown (same as ping handler) but check shiftKey
  // IMPORTANT: This handler must be added BEFORE the ping handler
  // so it can preventDefault when shift is held
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);

  return () => {
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", handlePointerUp);
  };
}, [role, roomId]);
```

**Important coordination with the ping handler:** The existing ping handler fires on `pointerdown`. When the Whisper is Shift+dragging, we need to suppress the ping. The simplest approach is to modify the existing ping handler to check `!e.shiftKey`:

```typescript
// In the existing ping handler:
const handleClick = (e: MouseEvent) => {
  if (e.shiftKey) return; // Shift+click = path drawing, not ping
  // ... rest of existing ping logic
};
```

**Drawing preview:** While the Whisper is actively drawing (Shift+drag), render the path-in-progress as a preview on the Whisper's canvas. Store the current `pathPoints` in a ref that the render loop can read:

```typescript
// In the Whisper render path of the game loop:
const drawingPoints = drawingPathPointsRef.current;
if (drawingPoints.length >= 2) {
  renderPathPreview(ctx, drawingPoints, blueprintTransform);
}
```

### 6. Path Rendering on Whisper Blueprint (`/src/game/whisper-view.ts` — MODIFY)

Add a `renderPaths()` function that draws synced paths on the Whisper's blueprint view. Paths appear as glowing dotted lines in a distinct color (cyan/teal to distinguish from pings).

```typescript
const PATH_DURATION_MS = 15000;
const PATH_COLOR = "#00E5FF"; // Bright cyan — distinct from pings and guard colors

export function renderPaths(
  ctx: CanvasRenderingContext2D,
  paths: Array<{ points: Array<{ x: number; y: number }>; createdAt: number }>,
  phase: string,
  time: number
) {
  const now = Date.now();

  for (const path of paths) {
    if (path.points.length < 2) continue;

    // Calculate alpha (fade during heist, no fade during planning)
    let alpha = 1;
    if (phase !== "planning") {
      const elapsed = now - path.createdAt;
      if (elapsed > PATH_DURATION_MS) continue;
      alpha = 1 - elapsed / PATH_DURATION_MS;
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    // Glow effect (wider, semi-transparent stroke underneath)
    ctx.strokeStyle = PATH_COLOR;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath();
    for (let i = 0; i < path.points.length; i++) {
      const px = path.points[i].x * TILE_SIZE + TILE_SIZE / 2;
      const py = path.points[i].y * TILE_SIZE + TILE_SIZE / 2;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Main stroke (bright, thinner, dashed for "drawn" feel)
    ctx.globalAlpha = alpha * 0.8;
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = PATH_COLOR;
    ctx.beginPath();
    for (let i = 0; i < path.points.length; i++) {
      const px = path.points[i].x * TILE_SIZE + TILE_SIZE / 2;
      const py = path.points[i].y * TILE_SIZE + TILE_SIZE / 2;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Animated "marching ants" effect — the dash offset scrolls over time
    ctx.lineDashOffset = -time * 30;
    ctx.globalAlpha = alpha * 0.5;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 12]);
    ctx.strokeStyle = "#FFFFFF";
    ctx.beginPath();
    for (let i = 0; i < path.points.length; i++) {
      const px = path.points[i].x * TILE_SIZE + TILE_SIZE / 2;
      const py = path.points[i].y * TILE_SIZE + TILE_SIZE / 2;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Arrow head at the end of the path (shows direction)
    if (path.points.length >= 2) {
      const last = path.points[path.points.length - 1];
      const prev = path.points[path.points.length - 2];
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      const tipX = last.x * TILE_SIZE + TILE_SIZE / 2;
      const tipY = last.y * TILE_SIZE + TILE_SIZE / 2;
      const arrowSize = 8;

      ctx.setLineDash([]);
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = PATH_COLOR;
      ctx.beginPath();
      ctx.moveTo(
        tipX + Math.cos(angle) * arrowSize,
        tipY + Math.sin(angle) * arrowSize
      );
      ctx.lineTo(
        tipX + Math.cos(angle + 2.5) * arrowSize,
        tipY + Math.sin(angle + 2.5) * arrowSize
      );
      ctx.lineTo(
        tipX + Math.cos(angle - 2.5) * arrowSize,
        tipY + Math.sin(angle - 2.5) * arrowSize
      );
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}
```

Also add a `renderPathPreview()` function for the in-progress drawing (same visual but using a temporary array of points not yet synced to Convex):

```typescript
export function renderPathPreview(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  time: number
) {
  if (points.length < 2) return;

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = PATH_COLOR;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([6, 4]);
  ctx.lineDashOffset = -time * 20;

  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const px = points[i].x * TILE_SIZE + TILE_SIZE / 2;
    const py = points[i].y * TILE_SIZE + TILE_SIZE / 2;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}
```

### 7. Path Rendering on Runner's View (`/src/game/runner-view.ts` — MODIFY)

Add a `renderPathForRunner()` function. The Runner sees the Whisper's drawn path as a glowing trail on the ground, rendered BELOW the fog of war (so only the visible portion shows). This makes it feel like a "projected route" on the ground.

```typescript
export function renderPathForRunner(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  paths: Array<{ points: Array<{ x: number; y: number }>; createdAt: number }>,
  phase: string
) {
  const now = Date.now();
  const PATH_DURATION_MS = 15000;

  for (const path of paths) {
    if (path.points.length < 2) continue;

    let alpha = 1;
    if (phase !== "planning") {
      const elapsed = now - path.createdAt;
      if (elapsed > PATH_DURATION_MS) continue;
      alpha = 1 - elapsed / PATH_DURATION_MS;
    }

    // Convert world coords to screen coords
    const screenPoints = path.points.map((p) => {
      return camera.worldToScreen(
        p.x * TILE_SIZE + TILE_SIZE / 2,
        p.y * TILE_SIZE + TILE_SIZE / 2
      );
    });

    // Glow layer
    ctx.save();
    ctx.globalAlpha = alpha * 0.25;
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < screenPoints.length; i++) {
      if (i === 0) ctx.moveTo(screenPoints[i].x, screenPoints[i].y);
      else ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // Main path (dashed, bright)
    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    for (let i = 0; i < screenPoints.length; i++) {
      if (i === 0) ctx.moveTo(screenPoints[i].x, screenPoints[i].y);
      else ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // Directional arrow at endpoint
    if (screenPoints.length >= 2) {
      const last = screenPoints[screenPoints.length - 1];
      const prev = screenPoints[screenPoints.length - 2];
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);

      ctx.save();
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = "#00E5FF";
      ctx.beginPath();
      ctx.moveTo(
        last.x + Math.cos(angle) * 10,
        last.y + Math.sin(angle) * 10
      );
      ctx.lineTo(
        last.x + Math.cos(angle + 2.5) * 10,
        last.y + Math.sin(angle + 2.5) * 10
      );
      ctx.lineTo(
        last.x + Math.cos(angle - 2.5) * 10,
        last.y + Math.sin(angle - 2.5) * 10
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
```

**Render order in the Runner view:** The path should be drawn AFTER tile rendering but BEFORE fog of war. This way the path is visible on the ground within the Runner's visibility radius but hidden in the dark. In the Runner's render section of GameCanvas.tsx, insert the path rendering call between the entity rendering and the fog of war rendering.

### 8. Path Cleanup in Game Loop (`/src/components/GameCanvas.tsx` — MODIFY)

Add periodic cleanup calls for expired paths, similar to the existing `cleanupPings` pattern. The Whisper client already runs periodic cleanup — add `cleanupPaths` alongside it:

```typescript
// In the existing cleanup interval (find where cleanupPings is called):
cleanupPathsRef.current({ roomId });
```

This should run every 2-3 seconds, same as ping cleanup.

### 9. HUD Updates (`/src/components/HUD.tsx` — MODIFY)

Add a visual indicator for the Whisper showing the path drawing mode. When Shift is held, show a small "Drawing Path..." indicator. Also add a hint in the Whisper's controls area:

```
Shift+Drag: Draw route
```

If a path is currently active, show a small "Path active" indicator with remaining time.

For mobile Whisper, add a "Draw" toggle button alongside the ping type buttons. When toggled on, touch-drag draws a path instead of being a no-op. This is simpler than requiring two-finger gestures.

### 10. Mobile Touch Path Drawing (`/src/components/TouchControls.tsx` — MODIFY)

For mobile Whisper users, add a "DRAW" toggle button that enables path drawing mode. When the toggle is active, touch-dragging on the blueprint draws a path instead of placing pings.

This requires the TouchControls component to be rendered for Whisper role (currently it only renders for Runner). Add a Whisper variant:

```tsx
if (role === "whisper" && (phase === "planning" || phase === "heist")) {
  return (
    <div className="fixed inset-0 z-20 pointer-events-none">
      <div className="absolute right-4 bottom-8 pointer-events-auto">
        <button
          className={`w-16 h-16 rounded-full border-2 text-xs font-bold
            ${drawModeActive
              ? "bg-[#00E5FF]/30 border-[#00E5FF] text-[#00E5FF]"
              : "bg-[#2D1B0E]/70 border-[#00E5FF]/50 text-[#00E5FF]/70"
            }`}
          onTouchStart={() => toggleDrawMode()}
        >
          DRAW
        </button>
      </div>
    </div>
  );
}
```

The draw mode state should be communicated back to GameCanvas via a callback or ref so the pointer handler knows whether to treat touch as pings or path drawing.

### 11. Reset Paths on Play Again (`/convex/rooms.ts` — MODIFY)

In the `resetRoom` mutation (used for Play Again), ensure `paths: []` is set in the new game state, just like pings are reset. Find where the gameState is re-created on reset and add `paths: []`.

### 12. Controls Tutorial Update (`/src/components/HUD.tsx` — MODIFY)

The controls tutorial/onboarding overlay (toggled with H/?) should include the path drawing instruction for Whisper:
- "Shift+Drag: Draw a route for the Runner"
- "Routes fade after 15s during heist"
- "Drawing a new route replaces the old one"

Find the controls overlay rendering in HUD.tsx and add these lines to the Whisper section.

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `/convex/schema.ts` | MODIFY | Add `paths` array to gameState table |
| `/convex/game.ts` | MODIFY | Add `drawPath` and `cleanupPaths` mutations |
| `/convex/rooms.ts` | MODIFY | Add `paths: []` to initial gameState and resetRoom |
| `/src/game/game-state.ts` | MODIFY | Add `paths` to `LocalGameState` interface |
| `/src/game/whisper-view.ts` | MODIFY | Add `renderPaths()` and `renderPathPreview()` functions |
| `/src/game/runner-view.ts` | MODIFY | Add `renderPathForRunner()` function |
| `/src/components/GameCanvas.tsx` | MODIFY | Add Shift+drag path drawing for Whisper, path rendering in both views, cleanup calls, drawPath mutation wiring |
| `/src/components/HUD.tsx` | MODIFY | Path drawing hint for Whisper, active path indicator, controls tutorial update |
| `/src/components/TouchControls.tsx` | MODIFY | Add Whisper draw-mode toggle button for mobile |

## Key Design Decisions (Already Made)

1. **Max 1 active path** — Keeps the screen clean. Drawing a new path replaces the old one.
2. **Shift+drag to draw** — Differentiates from click-to-ping. Natural "drawing" gesture.
3. **15-second fadeout during heist** — Long enough to be useful, short enough that stale paths don't linger and mislead.
4. **No fadeout during planning** — Whisper has 30 seconds to draw the initial plan. Paths persist through planning.
5. **Path rendered BELOW fog of war for Runner** — Only visible in the Runner's visibility radius, feeling like a "projected route on the ground."
6. **Cyan/teal color (#00E5FF)** — Distinct from pings (green/red/gold), guards (red), cameras (blue), and the Runner (orange).
7. **Max 50 points per path** — Prevents abuse/massive arrays. With 0.5 tile min distance between samples, 50 points covers a very long route.
8. **Mobile: toggle button** — Simpler than two-finger gestures. One tap toggles draw mode on/off.

## How to Verify

1. **`npm run build`** — Must compile with no errors. Schema change and new mutations must type-check.
2. **`npm run lint`** — Must pass.
3. **In browser (two tabs):**
   - Create a game, both players join, start with planning phase
   - **As Whisper:** Hold Shift and drag on the blueprint map → a cyan dashed line appears along the drag path
   - **As Runner:** The drawn route appears as a glowing cyan trail on the ground, visible within the fog-of-war radius
   - Release mouse → path is committed (sent to Convex and visible on both screens)
   - Verify the path persists during the planning phase (no fadeout)
   - Start the heist → path begins a 15-second fadeout
   - Draw a new path → old path is replaced
   - **As Whisper:** Click normally (no Shift) → still places pings as before
   - Verify the path has a directional arrowhead at the endpoint
4. **Mobile testing (or DevTools device emulation):**
   - As Whisper on mobile, see a "DRAW" button
   - Tap DRAW to toggle drawing mode on
   - Drag on the map → path is drawn
   - Tap DRAW again to toggle off → taps place pings normally
5. **Edge cases:**
   - Drawing a very short path (less than 2 points) → should not send to server
   - Drawing outside the map bounds → path points should still work (let the rendering clip)
   - Play Again → paths should be reset
   - Path fadeout timing is correct (~15 seconds during heist)
6. **Controls tutorial:**
   - Press H/? as Whisper → "Shift+Drag: Draw a route" is shown

## Scope Boundaries

**DO:**
- Add path drawing with Shift+drag for Whisper (keyboard)
- Add draw-mode toggle for mobile Whisper
- Sync paths through Convex (same pattern as pings)
- Render paths on both Whisper blueprint and Runner view
- Auto-fade paths during heist (15s), persist during planning
- Add controls hint and tutorial update

**DO NOT:**
- Add path waypoint editing or undo (just draw a new one)
- Add path snapping to tiles or pathfinding (freeform drawing is fine)
- Add multiple simultaneous paths (keep it at max 1)
- Add path sharing between rooms or saving paths
- Modify the existing ping system — it works as-is alongside paths
- Add a path-following AI for the Runner (the human follows it visually)

---

## Implementation Summary

### What was built
Whisper Path Drawing — a complete path drawing system that transforms the Whisper from a ping-only guide into an active route planner. The Whisper can Shift+drag on the blueprint map to draw freeform routes that the Runner sees as a glowing cyan trail through the fog of war.

### Files modified
| File | Changes |
|------|---------|
| `convex/schema.ts` | Added `paths` array to gameState table |
| `convex/game.ts` | Added `drawPath` and `cleanupPaths` mutations |
| `convex/rooms.ts` | Added `paths: []` to initial game state in `startGame` |
| `src/game/game-state.ts` | Added `paths` field to `LocalGameState` interface |
| `src/game/whisper-view.ts` | Added `renderPaths()` (synced paths with glow + dash + marching ants + arrow) and `renderPathPreview()` (in-progress drawing) |
| `src/game/runner-view.ts` | Added `renderPathForRunner()` (screen-space glow trail rendered below fog of war) |
| `src/components/GameCanvas.tsx` | Added Shift+drag path drawing input, drawPath mutation wiring, path rendering in both views, cleanup interval, draw mode support, planning overlay hints |
| `src/components/HUD.tsx` | Added "Shift+Drag: Draw route" to controls help popup, 15s fadeout note |
| `src/components/TouchControls.tsx` | Added Whisper draw-mode toggle button for mobile (cyan DRAW button) |
| `CLAUDE.md` | Updated status from Queued to Completed |

### Key design decisions
- Max 1 active path (drawing a new one replaces the old)
- Shift+drag differentiates from click-to-ping
- 15s fadeout during heist, no fadeout during planning
- Path rendered BELOW fog of war for Runner (only visible in visibility radius)
- Cyan (#00E5FF) color distinct from all other game elements
- Mobile: toggle DRAW button instead of multi-finger gestures
- Max 50 points per path, 0.5 tile minimum distance between samples

### Build status
- `npm run build` — passes (0 errors)
- `npm run lint` — passes (0 errors, only pre-existing warnings)

---

## Review (74ae4058)

### Files reviewed
All 9 modified files listed above were read and analyzed.

### Build & lint verification
- `npm run build` — passes (0 errors, 0 warnings)
- `npm run lint` — passes clean

### Findings

**No bugs or issues requiring fixes.** The implementation is solid:

1. **Schema** (`convex/schema.ts`): `paths` array added correctly with proper nested validators.
2. **Mutations** (`convex/game.ts`): `drawPath` properly validates phase, limits points to 50, requires ≥2 points, replaces all existing paths. `cleanupPaths` correctly skips during planning phase and only writes when paths actually changed (avoids unnecessary DB writes).
3. **Game start** (`convex/rooms.ts`): `paths: []` initialized in `startGame`. `resetRoom` deletes the entire gameState document, so paths are implicitly cleaned up.
4. **State bridge** (`game-state.ts`): `paths` field typed correctly in `LocalGameState` interface.
5. **Whisper view** (`whisper-view.ts`): `renderPaths` with glow + dashed main stroke + marching ants + directional arrowhead. All canvas state properly saved/restored. `renderPathPreview` for in-progress drawing works correctly.
6. **Runner view** (`runner-view.ts`): `renderPathForRunner` converts tile coords → screen coords via camera, renders glow + dashed line + arrowhead. Properly handles fade during heist and persistence during planning.
7. **GameCanvas** (`GameCanvas.tsx`): Path drawing input uses Shift+drag (desktop) or draw mode toggle (mobile). Ping handler correctly early-returns on `e.shiftKey || drawModeRef.current`. Path rendered before fog of war (Runner) so fog correctly masks it. Cleanup runs every 2s from Whisper client only. Mutation refs properly synced.
8. **HUD** (`HUD.tsx`): "Shift+Drag: Draw route" added to both PlanningOverlay controls and ControlsPopup. Whisper tips updated with path info.
9. **TouchControls** (`TouchControls.tsx`): Whisper draw-mode toggle button with proper visual state (active/inactive), uses `onTouchStart` with `preventDefault` to avoid double-firing.

### Edge cases verified
- Drawing with <2 points: handled (no mutation sent)
- Point accumulation respects 50-point limit (checked in both client `handlePointerMove` and server `drawPath`)
- Path cleanup only from Whisper client (no duplicate writes)
- Planning → heist transition doesn't prematurely clear paths (cleanup skips planning phase)
- Both pointer handlers coexist correctly (stopPropagation + shiftKey guard)

### No fixes needed
Clean implementation — all code approved as-is.
