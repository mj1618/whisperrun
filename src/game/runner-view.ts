/**
 * Fog of war rendering for the Runner view.
 *
 * Draws a dark overlay with a circular visibility hole centered on the
 * Runner's screen position.  Uses a clip path with counter-clockwise arc
 * to punch the hole, plus a radial gradient for a soft edge.
 */

import { Camera } from "@/engine/camera";
import { TILE_SIZE } from "@/engine/renderer";
import { getPingColor, PING_DURATION_MS } from "@/game/ping-system";
import type { EscalationEvent } from "@/game/guard-ai";
import type { Distraction } from "@/game/distractions";
import { THROW_FLIGHT_TIME, NOISE_ATTRACT_RADIUS } from "@/game/distractions";

export function renderFogOfWar(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  runnerScreenX: number,
  runnerScreenY: number,
  radius: number,
  time: number = 0
) {
  // 1. Draw the hard-edged fog with a wobbling circular hole
  ctx.save();
  ctx.beginPath();
  // Outer rectangle (full canvas)
  ctx.rect(0, 0, canvasWidth, canvasHeight);
  // Inner wobbly circle (counter-clockwise = hole)
  const segments = 48;
  for (let i = segments; i >= 0; i--) {
    const a = (i / segments) * Math.PI * 2;
    const wobble = Math.sin(time * 2 + a * 3) * 4;
    const r = radius + wobble;
    const px = runnerScreenX + Math.cos(a) * r;
    const py = runnerScreenY + Math.sin(a) * r;
    if (i === segments) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
  ctx.fill();
  ctx.restore();

  // 2. Soft gradient edge around the visibility circle
  ctx.save();
  const gradient = ctx.createRadialGradient(
    runnerScreenX,
    runnerScreenY,
    radius * 0.7,
    runnerScreenX,
    runnerScreenY,
    radius
  );
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0.6)");

  ctx.beginPath();
  ctx.arc(runnerScreenX, runnerScreenY, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  // 3. Vignette effect (darkened screen edges)
  ctx.save();
  const vignette = ctx.createRadialGradient(
    runnerScreenX,
    runnerScreenY,
    radius * 0.5,
    runnerScreenX,
    runnerScreenY,
    Math.max(canvasWidth, canvasHeight) * 0.7
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();

  // 4. Ambient dust particles floating in the visibility radius
  for (let i = 0; i < 8; i++) {
    const particleX = runnerScreenX + Math.sin(time * 0.5 + i * 1.3) * radius * 0.6;
    const particleY = runnerScreenY + Math.cos(time * 0.4 + i * 1.7) * radius * 0.5;
    const alpha = 0.15 + 0.1 * Math.sin(time * 1.5 + i * 2);
    ctx.fillStyle = `rgba(255, 230, 180, ${alpha})`;
    ctx.beginPath();
    ctx.arc(particleX, particleY, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Render throwable distraction visuals in the Runner's view.
 * Shows in-flight arc animation, landed coin dot, and noise rings.
 */
export function renderDistractions(
  ctx: CanvasRenderingContext2D,
  distractions: Distraction[],
  now: number,
  camera: Camera,
  tileSize: number
): void {
  for (const d of distractions) {
    const elapsed = now - d.thrownAt;

    if (elapsed < THROW_FLIGHT_TIME) {
      // In-flight arc animation
      const progress = elapsed / THROW_FLIGHT_TIME;
      const arcX = d.fromX + (d.x - d.fromX) * progress;
      const arcY = d.fromY + (d.y - d.fromY) * progress;
      const arcHeight = Math.sin(progress * Math.PI) * 1.5;

      const screen = camera.worldToScreen(
        arcX * tileSize + tileSize / 2,
        (arcY - arcHeight) * tileSize + tileSize / 2
      );
      const shadow = camera.worldToScreen(
        arcX * tileSize + tileSize / 2,
        arcY * tileSize + tileSize / 2
      );

      // Shadow on ground
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${0.2 * (1 - progress)})`;
      ctx.beginPath();
      ctx.ellipse(shadow.x, shadow.y, 3, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Coin
      ctx.save();
      ctx.fillStyle = "#FFD700";
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (elapsed < THROW_FLIGHT_TIME + d.noiseDurationMs) {
      // Landed — noise rings
      const noiseProgress = (elapsed - THROW_FLIGHT_TIME) / d.noiseDurationMs;
      const screen = camera.worldToScreen(
        d.x * tileSize + tileSize / 2,
        d.y * tileSize + tileSize / 2
      );

      // Gold dot
      ctx.save();
      ctx.fillStyle = "#FFD700";
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Expanding noise rings
      for (let ring = 0; ring < 3; ring++) {
        const ringProgress = Math.max(0, noiseProgress - ring * 0.2);
        if (ringProgress <= 0) continue;
        const radius = ringProgress * NOISE_ATTRACT_RADIUS * tileSize * 0.4;
        const alpha = 0.4 * (1 - ringProgress);
        ctx.save();
        ctx.strokeStyle = `rgba(255, 200, 50, ${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

const PATH_DURATION_MS_RUNNER = 15000;

export function renderPathForRunner(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  paths: Array<{ points: Array<{ x: number; y: number }>; createdAt: number }>,
  phase: string
) {
  const now = Date.now();

  for (const path of paths) {
    if (path.points.length < 2) continue;

    let alpha = 1;
    if (phase !== "planning") {
      const elapsed = now - path.createdAt;
      if (elapsed > PATH_DURATION_MS_RUNNER) continue;
      alpha = 1 - elapsed / PATH_DURATION_MS_RUNNER;
    }

    const screenPoints = path.points.map((p) =>
      camera.worldToScreen(
        p.x * TILE_SIZE + TILE_SIZE / 2,
        p.y * TILE_SIZE + TILE_SIZE / 2
      )
    );

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

const ESCALATION_VISUAL_DURATION = 1500; // ms

/**
 * Render radio wave expanding rings at escalating guard positions.
 * Only visible if the guard is within the Runner's fog-of-war radius.
 */
export function renderEscalationWaves(
  ctx: CanvasRenderingContext2D,
  events: Array<EscalationEvent & { fadeUntil: number }>,
  guards: Array<{ id: string; x: number; y: number }>,
  now: number,
  camera: Camera,
  runnerX: number,
  runnerY: number,
  fogRadius: number
): void {
  for (const event of events) {
    const progress = 1 - (event.fadeUntil - now) / ESCALATION_VISUAL_DURATION;
    if (progress < 0 || progress > 1) continue;
    const alpha = 1 - progress;

    // Find source guard position
    const sourceGuard = guards.find((g) => g.id === event.sourceGuardId);
    if (!sourceGuard) continue;

    // Check if guard is within Runner's fog-of-war visibility
    const distToRunner = Math.hypot(sourceGuard.x - runnerX, sourceGuard.y - runnerY);
    if (distToRunner > fogRadius) continue;

    const screen = camera.worldToScreen(
      sourceGuard.x * TILE_SIZE + TILE_SIZE / 2,
      sourceGuard.y * TILE_SIZE + TILE_SIZE / 2
    );

    // Draw 2-3 expanding orange rings
    ctx.save();
    for (let ring = 0; ring < 3; ring++) {
      const ringProgress = Math.max(0, progress - ring * 0.15);
      const radius = ringProgress * 40;
      const ringAlpha = alpha * (1 - ring * 0.3);
      if (ringAlpha <= 0) continue;

      ctx.strokeStyle = `rgba(255, 180, 50, ${ringAlpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Render pings on the Runner's screen. Drawn ABOVE the fog of war so
 * they're always visible. Off-screen pings show as directional chevrons
 * at the screen edge.
 */
export function renderPings(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  pings: Array<{ x: number; y: number; type: string; createdAt: number }>,
  canvasWidth: number,
  canvasHeight: number
) {
  const now = Date.now();
  const edgePad = 30;

  for (const ping of pings) {
    const elapsed = now - ping.createdAt;
    if (elapsed > PING_DURATION_MS) continue;

    const alpha = 1 - elapsed / PING_DURATION_MS;
    const color = getPingColor(ping.type);

    // World position → screen position
    const worldPx = ping.x * TILE_SIZE + TILE_SIZE / 2;
    const worldPy = ping.y * TILE_SIZE + TILE_SIZE / 2;
    const screen = camera.worldToScreen(worldPx, worldPy);

    const onScreen =
      screen.x >= -10 &&
      screen.x <= canvasWidth + 10 &&
      screen.y >= -10 &&
      screen.y <= canvasHeight + 10;

    if (onScreen) {
      // On-screen: draw pulsing ring
      const phase = ((elapsed / 1000) % 1.0);
      const ringRadius = 8 + phase * 16;
      const ringAlpha = alpha * Math.max(0, 1 - phase);

      ctx.save();
      ctx.globalAlpha = ringAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Inner dot
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Off-screen: draw chevron at screen edge pointing toward ping
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      const angle = Math.atan2(screen.y - cy, screen.x - cx);

      // Clamp to screen edges with padding
      const clampedX = Math.max(edgePad, Math.min(canvasWidth - edgePad, screen.x));
      const clampedY = Math.max(edgePad, Math.min(canvasHeight - edgePad, screen.y));

      // Use ray intersection with screen rect for proper edge position
      let edgeX = clampedX;
      let edgeY = clampedY;

      // Project from center along angle to screen edge
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const tX =
        dx > 0
          ? (canvasWidth - edgePad - cx) / dx
          : dx < 0
            ? (edgePad - cx) / dx
            : Infinity;
      const tY =
        dy > 0
          ? (canvasHeight - edgePad - cy) / dy
          : dy < 0
            ? (edgePad - cy) / dy
            : Infinity;
      const t = Math.min(Math.abs(tX), Math.abs(tY));
      edgeX = cx + dx * t;
      edgeY = cy + dy * t;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(edgeX, edgeY);
      ctx.rotate(angle);

      // Draw chevron
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-5, -7);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-5, 7);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }
  }
}
