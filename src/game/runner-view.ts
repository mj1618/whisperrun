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
