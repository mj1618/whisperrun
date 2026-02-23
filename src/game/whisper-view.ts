/**
 * Whisper's blueprint-style map renderer and entity rendering.
 *
 * The Whisper sees a dark, schematic view of the entire map with full
 * visibility of all guards, vision cones, items, the Runner, and pings.
 */

import { TileType } from "@/game/map";
import { LocalGameState } from "@/game/game-state";
import { TILE_SIZE } from "@/engine/renderer";
import { getPingColor, PING_DURATION_MS } from "@/game/ping-system";
import { updateCameraAngle, CAMERA_RANGE, CAMERA_FOV, GUARD_RANGE } from "@/game/guard-ai";
import type { EscalationEvent } from "@/game/guard-ai";
import type { Distraction } from "@/game/distractions";
import { THROW_FLIGHT_TIME, NOISE_ATTRACT_RADIUS } from "@/game/distractions";

// Blueprint color palette
const BP_FLOOR = "#141e30";
const BP_GRID = "#1e3a5f";
const BP_WALL = "#1e3a5f";
const BP_WALL_OUTLINE = "#2a5a8f";
const BP_DOOR = "#2a5a8f";
const BP_HIDE = "#1a3a1a";
const BP_EXIT = "#1a3a1a";
const BP_EXIT_BORDER = "#4CAF50";
const BP_CAMERA_TILE = "#1a1a3a";

const BP_TILE_COLORS: Record<TileType, string> = {
  [TileType.Floor]: BP_FLOOR,
  [TileType.Wall]: BP_WALL,
  [TileType.Door]: BP_DOOR,
  [TileType.HideSpot]: BP_HIDE,
  [TileType.ItemSpawn]: BP_FLOOR,
  [TileType.Exit]: BP_EXIT,
  [TileType.GuardSpawn]: BP_FLOOR,
  [TileType.Camera]: BP_CAMERA_TILE,
};

/**
 * Render the tile map in blueprint style. Called inside the Whisper's
 * ctx.save/translate/scale block, so all coordinates are in world space.
 */
export function renderBlueprintMap(
  ctx: CanvasRenderingContext2D,
  map: TileType[][],
  doors?: Array<{ x: number; y: number; open: boolean }>
) {
  const rows = map.length;
  const cols = map[0]?.length ?? 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = map[row][col];
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;

      // Tile fill
      ctx.fillStyle = BP_TILE_COLORS[tile] ?? BP_FLOOR;
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

      // Grid lines (thin)
      ctx.strokeStyle = BP_GRID;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);

      // Wall outlines — draw slightly extended for solidity
      if (tile === TileType.Wall) {
        ctx.strokeStyle = BP_WALL_OUTLINE;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 0.5, y - 0.5, TILE_SIZE + 1, TILE_SIZE + 1);
      }

      // Door — render based on open/closed state
      if (tile === TileType.Door) {
        const doorState = doors?.find((d) => d.x === col && d.y === row);
        const isOpen = doorState?.open ?? false;
        ctx.save();
        if (isOpen) {
          // Open door: thin dashed line, floor-like background
          ctx.fillStyle = BP_FLOOR;
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = "rgba(42, 90, 143, 0.4)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        } else {
          // Closed door: solid outline, clearly blocked
          ctx.strokeStyle = "#4a8abf";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          // Cross-hatch to show it's solid/blocking
          ctx.beginPath();
          ctx.moveTo(x + 4, y + TILE_SIZE / 2);
          ctx.lineTo(x + TILE_SIZE - 4, y + TILE_SIZE / 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Hide spot — small icon
      if (tile === TileType.HideSpot) {
        ctx.fillStyle = "#2a5a2a";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("H", x + TILE_SIZE / 2, y + TILE_SIZE / 2);
      }

      // Exit tile — dashed green border
      if (tile === TileType.Exit) {
        ctx.save();
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = BP_EXIT_BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        ctx.restore();
      }
    }
  }

  // Scanline overlay for monitor feel
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.03)";
  const mapPixelH = rows * TILE_SIZE;
  const mapPixelW = cols * TILE_SIZE;
  for (let y = 0; y < mapPixelH; y += 3) {
    ctx.fillRect(0, y, mapPixelW, 1);
  }
  ctx.restore();
}

/**
 * Render all game entities on the blueprint.
 * Called inside the Whisper's transform block (world-space coords).
 */
export function renderWhisperEntities(
  ctx: CanvasRenderingContext2D,
  gameState: LocalGameState,
  time: number,
  guardPatrols?: Record<string, Array<{ x: number; y: number }>>,
  diffConfig?: { guardRange?: number; cameraRange?: number; cameraSweepSpeed?: number },
  runnerColor?: string
) {
  const { runner, guards, items, pings, exitX, exitY } = gameState;

  // -- Guard patrol routes (drawn underneath entities) --
  if (guardPatrols) {
    for (const [, waypoints] of Object.entries(guardPatrols)) {
      if (waypoints.length < 2) continue;

      // Dashed line connecting waypoints
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
      ctx.lineTo(
        waypoints[0].x * TILE_SIZE + TILE_SIZE / 2,
        waypoints[0].y * TILE_SIZE + TILE_SIZE / 2
      );
      ctx.stroke();
      ctx.restore();

      // Small dots at each waypoint
      for (const wp of waypoints) {
        ctx.fillStyle = "rgba(255, 100, 100, 0.2)";
        ctx.beginPath();
        ctx.arc(
          wp.x * TILE_SIZE + TILE_SIZE / 2,
          wp.y * TILE_SIZE + TILE_SIZE / 2,
          3,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }

  // -- Exit --
  {
    const cx = exitX * TILE_SIZE + TILE_SIZE / 2;
    const cy = exitY * TILE_SIZE + TILE_SIZE / 2;
    const s = TILE_SIZE * 0.4;

    // Outer border
    ctx.strokeStyle = BP_EXIT_BORDER;
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - s, cy - s, s * 2, s * 2);
    // Inner border
    ctx.strokeRect(cx - s + 4, cy - s + 4, (s - 4) * 2, (s - 4) * 2);

    ctx.fillStyle = BP_EXIT_BORDER;
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("EXIT", cx, cy);
  }

  // -- Items --
  for (const item of items) {
    if (item.pickedUp) {
      // Ghost at original position
      ctx.save();
      ctx.globalAlpha = 0.2;
      drawDiamond(ctx, item.x * TILE_SIZE + TILE_SIZE / 2, item.y * TILE_SIZE + TILE_SIZE / 2, 8, "#FFD700");
      ctx.restore();
      continue;
    }
    const pulse = 0.7 + 0.3 * Math.sin(time * 4);
    ctx.save();
    ctx.globalAlpha = pulse;
    drawDiamond(ctx, item.x * TILE_SIZE + TILE_SIZE / 2, item.y * TILE_SIZE + TILE_SIZE / 2, 10, "#FFD700");
    ctx.restore();
  }

  // -- Guards --
  for (const guard of guards) {
    const gx = guard.x * TILE_SIZE + TILE_SIZE / 2;
    const gy = guard.y * TILE_SIZE + TILE_SIZE / 2;
    const radius = 12;

    // State-based coloring
    let guardColor: string;
    let guardStroke: string;
    switch (guard.state) {
      case "alert":
        guardColor = "#FF2222";
        guardStroke = "#CC0000";
        break;
      case "suspicious":
        guardColor = "#FFaa33";
        guardStroke = "#CC8800";
        break;
      case "returning":
        guardColor = "#CC6666";
        guardStroke = "#994444";
        break;
      default:
        guardColor = "#FF4444";
        guardStroke = "#CC2222";
    }

    // Vision cone
    drawVisionCone(ctx, gx, gy, guard.angle, diffConfig?.guardRange ?? GUARD_RANGE, 60, guardColor);

    // Guard body
    ctx.beginPath();
    ctx.arc(gx, gy, radius, 0, Math.PI * 2);
    ctx.fillStyle = guardColor;
    ctx.fill();
    ctx.strokeStyle = guardStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Direction indicator (triangle wedge)
    const triLen = 8;
    const angle = guard.angle;
    const tipX = gx + Math.cos(angle) * (radius + triLen);
    const tipY = gy + Math.sin(angle) * (radius + triLen);
    const leftX = gx + Math.cos(angle + 0.5) * radius;
    const leftY = gy + Math.sin(angle + 0.5) * radius;
    const rightX = gx + Math.cos(angle - 0.5) * radius;
    const rightY = gy + Math.sin(angle - 0.5) * radius;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fillStyle = guardColor;
    ctx.fill();

    // State label for alert/suspicious
    if (guard.state === "alert") {
      // Pulsing glow for alert state
      const pulse = 0.5 + 0.5 * Math.sin(time * 8);
      ctx.save();
      ctx.globalAlpha = pulse * 0.4;
      ctx.beginPath();
      ctx.arc(gx, gy, radius + 8, 0, Math.PI * 2);
      ctx.fillStyle = "#FF0000";
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#FF2222";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("! ALERT", gx, gy - radius - 4);
    } else if (guard.state === "suspicious") {
      ctx.fillStyle = "#FFaa33";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("?", gx, gy - radius - 4);
    }
  }

  // -- Cameras --
  if (gameState.cameras && gameState.cameras.length > 0) {
    const elapsedSec = gameState.heistStartTime
      ? (Date.now() - gameState.heistStartTime) / 1000
      : 0; // During planning, show static cone at base angle
    for (const cam of gameState.cameras) {
      const cx = cam.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = cam.y * TILE_SIZE + TILE_SIZE / 2;
      const angle = updateCameraAngle(cam.baseAngle, elapsedSec, diffConfig?.cameraSweepSpeed);

      // Draw vision cone (cyan/blue, distinct from guard red)
      drawVisionCone(ctx, cx, cy, angle, diffConfig?.cameraRange ?? CAMERA_RANGE, CAMERA_FOV, "#44AAFF");

      // Camera icon (small circle with lens indicator)
      ctx.fillStyle = "#44AAFF";
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // -- Runner --
  {
    const rx = runner.x * TILE_SIZE + TILE_SIZE / 2;
    const ry = runner.y * TILE_SIZE + TILE_SIZE / 2;
    const radius = runner.crouching ? 8 : 10;
    const rColor = runnerColor ?? "#FF8C42";

    // Glow
    ctx.save();
    ctx.shadowColor = rColor;
    ctx.shadowBlur = 10 + 4 * Math.sin(time * 5);
    ctx.beginPath();
    ctx.arc(rx, ry, radius, 0, Math.PI * 2);

    if (runner.hiding) {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = rColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = rColor;
      ctx.fill();
    }
    ctx.restore();

    // Crouch label
    if (runner.crouching && !runner.hiding) {
      ctx.fillStyle = rColor;
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("C", rx, ry);
    }
  }

  // -- Pings --
  const now = Date.now();
  for (const ping of pings) {
    const elapsed = now - ping.createdAt;
    if (elapsed > PING_DURATION_MS) continue;

    const alpha = 1 - elapsed / PING_DURATION_MS;
    const color = getPingColor(ping.type);
    const px = ping.x * TILE_SIZE + TILE_SIZE / 2;
    const py = ping.y * TILE_SIZE + TILE_SIZE / 2;

    // Draw 2-3 expanding rings
    for (let i = 0; i < 3; i++) {
      const phase = ((elapsed / 1000) + i * 0.4) % 1.5;
      const ringRadius = 6 + phase * 20;
      const ringAlpha = alpha * Math.max(0, 1 - phase / 1.5);

      ctx.save();
      ctx.globalAlpha = ringAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Center dot
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

const PATH_DURATION_MS = 15000;
const PATH_COLOR = "#00E5FF";

export function renderPaths(
  ctx: CanvasRenderingContext2D,
  paths: Array<{ points: Array<{ x: number; y: number }>; createdAt: number }>,
  phase: string,
  time: number
) {
  const now = Date.now();

  for (const path of paths) {
    if (path.points.length < 2) continue;

    let alpha = 1;
    if (phase !== "planning") {
      const elapsed = now - path.createdAt;
      if (elapsed > PATH_DURATION_MS) continue;
      alpha = 1 - elapsed / PATH_DURATION_MS;
    }

    ctx.save();

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

    // Main stroke (bright, thinner, dashed)
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

    // Animated marching ants effect
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

    // Arrow head at the end of the path
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

const ESCALATION_LINE_DURATION = 1500; // ms

/**
 * Render dashed communication lines between guards during alert escalation.
 * Called inside the Whisper's transform block (world-space coords).
 */
export function renderEscalationLines(
  ctx: CanvasRenderingContext2D,
  events: Array<EscalationEvent & { fadeUntil: number }>,
  guards: Array<{ id: string; x: number; y: number }>,
  now: number
): void {
  for (const event of events) {
    const progress = 1 - (event.fadeUntil - now) / ESCALATION_LINE_DURATION;
    if (progress < 0 || progress > 1) continue;
    const alpha = 1 - progress;

    const source = guards.find((g) => g.id === event.sourceGuardId);
    const target = guards.find((g) => g.id === event.targetGuardId);
    if (!source || !target) continue;

    const sx = source.x * TILE_SIZE + TILE_SIZE / 2;
    const sy = source.y * TILE_SIZE + TILE_SIZE / 2;
    const tx = target.x * TILE_SIZE + TILE_SIZE / 2;
    const ty = target.y * TILE_SIZE + TILE_SIZE / 2;

    // Dashed orange line between source and target
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#FFB432";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // Small radio wave icon at midpoint
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    const ringRadius = 4 + progress * 8;
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = "#FFB432";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(mx, my, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}

/**
 * Render throwable distraction visuals on the Whisper blueprint.
 * Always visible (no fog-of-war). Called inside the transform block.
 */
export function renderWhisperDistractions(
  ctx: CanvasRenderingContext2D,
  distractions: Distraction[],
  now: number
): void {
  for (const d of distractions) {
    const elapsed = now - d.thrownAt;

    if (elapsed < THROW_FLIGHT_TIME) {
      // In-flight: show arc trajectory line
      const progress = elapsed / THROW_FLIGHT_TIME;
      const fromPx = d.fromX * TILE_SIZE + TILE_SIZE / 2;
      const fromPy = d.fromY * TILE_SIZE + TILE_SIZE / 2;
      const toPx = d.x * TILE_SIZE + TILE_SIZE / 2;
      const toPy = d.y * TILE_SIZE + TILE_SIZE / 2;

      // Dashed gold arc line
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255, 215, 0, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fromPx, fromPy);
      ctx.lineTo(toPx, toPy);
      ctx.stroke();
      ctx.restore();

      // Moving coin dot along the arc
      const cx = fromPx + (toPx - fromPx) * progress;
      const cy = fromPy + (toPy - fromPy) * progress;
      ctx.save();
      ctx.fillStyle = "#FFD700";
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (elapsed < THROW_FLIGHT_TIME + d.noiseDurationMs) {
      // Landed — gold dot with expanding dashed noise radius
      const noiseProgress = (elapsed - THROW_FLIGHT_TIME) / d.noiseDurationMs;
      const px = d.x * TILE_SIZE + TILE_SIZE / 2;
      const py = d.y * TILE_SIZE + TILE_SIZE / 2;

      // Gold dot
      ctx.save();
      ctx.fillStyle = "#FFD700";
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Expanding dashed noise circle
      const radius = noiseProgress * NOISE_ATTRACT_RADIUS * TILE_SIZE;
      const alpha = 0.5 * (1 - noiseProgress);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string
) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - size, cy);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#DAA520";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function drawVisionCone(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  angle: number,
  rangeTiles: number,
  fovDeg: number,
  color: string = "#FF4444"
) {
  const fov = (fovDeg * Math.PI) / 180;
  const rangePixels = rangeTiles * TILE_SIZE;

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.arc(gx, gy, rangePixels, angle - fov / 2, angle + fov / 2);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
