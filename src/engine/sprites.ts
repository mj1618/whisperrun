/**
 * Procedural sprite drawing library for WhisperRun.
 *
 * All sprites are drawn using Canvas 2D API calls — no external images.
 * This gives us pixel-art-style visuals with full control over colors,
 * animation frames, and rendering quality.
 */

const TILE = 32;

// ---- Runner Sprite ----

export function drawRunnerSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  opts: {
    crouching: boolean;
    hiding: boolean;
    hasItem: boolean;
    walkFrame: number;
    facingAngle: number;
    colors?: {
      body: string;
      bodyOutline: string;
      head: string;
      legs: string;
      hidingOutline: string;
    };
  }
): void {
  const { crouching, hiding, hasItem, walkFrame, facingAngle, colors } = opts;

  ctx.save();

  if (hiding) {
    ctx.globalAlpha = 0.4;
  }

  // Determine facing direction for leg offset
  const facingRight = Math.cos(facingAngle) >= 0;
  const legOffset = walkFrame % 2 === 1 ? 3 : 0;

  // Squish if crouching
  const scaleY = crouching ? 0.7 : 1;
  const yShift = crouching ? 4 : 0;

  // Drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + 12 + yShift, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  const legY = sy + 4 * scaleY + yShift;
  const legW = 4;
  const legH = 6 * scaleY;
  ctx.fillStyle = colors?.legs ?? "#8B6914";

  // Left leg
  const leftLegOff = walkFrame === 1 ? -legOffset : walkFrame === 3 ? legOffset : 0;
  ctx.fillRect(sx - 5, legY + leftLegOff, legW, legH);

  // Right leg
  const rightLegOff = walkFrame === 1 ? legOffset : walkFrame === 3 ? -legOffset : 0;
  ctx.fillRect(sx + 1, legY + rightLegOff, legW, legH);

  // Body (rounded rect torso)
  const bodyW = 14;
  const bodyH = 12 * scaleY;
  const bodyX = sx - bodyW / 2;
  const bodyY = sy - 6 * scaleY + yShift;
  ctx.fillStyle = colors?.body ?? "#E39B32";
  ctx.beginPath();
  ctx.roundRect(bodyX, bodyY, bodyW, bodyH, 3);
  ctx.fill();
  ctx.strokeStyle = colors?.bodyOutline ?? "#B47820";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Head
  const headRadius = 6 * (crouching ? 0.9 : 1);
  const headY = bodyY - headRadius + 1;
  ctx.fillStyle = colors?.head ?? "#F0B050";
  ctx.beginPath();
  ctx.arc(sx, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors?.bodyOutline ?? "#B47820";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Eyes
  const eyeOffX = facingRight ? 2 : -2;
  ctx.fillStyle = "#2D1B0E";
  ctx.beginPath();
  ctx.arc(sx + eyeOffX - 2, headY - 1, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + eyeOffX + 2, headY - 1, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Item glow on hand
  if (hasItem) {
    ctx.save();
    ctx.shadowColor = "#FFD700";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#FFD700";
    ctx.beginPath();
    ctx.arc(sx + (facingRight ? 8 : -8), bodyY + bodyH / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Hiding dashed outline
  if (hiding) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = colors?.hidingOutline ?? "rgba(227, 155, 50, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy + yShift - 2, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
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
    time: number;
  }
): void {
  const { state, angle, walkFrame, time } = opts;
  const facingRight = Math.cos(angle) >= 0;

  ctx.save();

  // Returning guards are desaturated
  if (state === "returning") {
    ctx.globalAlpha = 0.75;
  }

  // Alert red glow
  if (state === "alert") {
    const pulse = 0.3 + 0.2 * Math.sin(time * 8);
    ctx.save();
    ctx.shadowColor = "#FF3333";
    ctx.shadowBlur = 12;
    ctx.fillStyle = `rgba(255, 50, 50, ${pulse})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + 13, 10, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  const legY = sy + 5;
  const legW = 5;
  const legH = 7;
  ctx.fillStyle = "#1A2540";
  const legOff = walkFrame % 2 === 1 ? 2.5 : 0;

  ctx.fillRect(sx - 6, legY + (walkFrame === 1 ? -legOff : walkFrame === 3 ? legOff : 0), legW, legH);
  ctx.fillRect(sx + 1, legY + (walkFrame === 1 ? legOff : walkFrame === 3 ? -legOff : 0), legW, legH);

  // Body (wider than runner)
  const bodyW = 18;
  const bodyH = 14;
  const bodyX = sx - bodyW / 2;
  const bodyY = sy - 7;
  ctx.fillStyle = "#2C3E6B";
  ctx.beginPath();
  ctx.roundRect(bodyX, bodyY, bodyW, bodyH, 3);
  ctx.fill();
  ctx.strokeStyle = "#1A2540";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Badge
  ctx.fillStyle = "#DAA520";
  ctx.beginPath();
  ctx.arc(sx + (facingRight ? 4 : -4), bodyY + 5, 2, 0, Math.PI * 2);
  ctx.fill();

  // Head
  const headRadius = 7;
  const headY = bodyY - headRadius + 2;
  ctx.fillStyle = "#D4A574";
  ctx.beginPath();
  ctx.arc(sx, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1A2540";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Cap (peaked)
  ctx.fillStyle = "#1A2540";
  ctx.beginPath();
  ctx.moveTo(sx - 8, headY - 3);
  ctx.lineTo(sx + 8, headY - 3);
  ctx.lineTo(sx + (facingRight ? 10 : 6), headY - 5);
  ctx.lineTo(sx + 4, headY - 8);
  ctx.lineTo(sx - 4, headY - 8);
  ctx.lineTo(sx + (facingRight ? -6 : -10), headY - 5);
  ctx.closePath();
  ctx.fill();

  // Eyes
  const eyeOffX = facingRight ? 2 : -2;
  ctx.fillStyle = "#1A1A2E";
  ctx.beginPath();
  ctx.arc(sx + eyeOffX - 2, headY, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx + eyeOffX + 2, headY, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // State indicators above head
  if (state === "alert") {
    ctx.fillStyle = "#FF3333";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("!", sx, headY - headRadius - 4);
  } else if (state === "suspicious") {
    ctx.fillStyle = "#FFaa33";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("?", sx, headY - headRadius - 4);
  }

  // Direction indicator (small triangle)
  const triDist = 16;
  const triSize = 5;
  const tipX = sx + Math.cos(angle) * triDist;
  const tipY = sy + Math.sin(angle) * triDist;
  const baseAngle1 = angle + Math.PI * 0.75;
  const baseAngle2 = angle - Math.PI * 0.75;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + Math.cos(baseAngle1) * triSize, tipY + Math.sin(baseAngle1) * triSize);
  ctx.lineTo(tipX + Math.cos(baseAngle2) * triSize, tipY + Math.sin(baseAngle2) * triSize);
  ctx.closePath();
  ctx.fillStyle = state === "alert" ? "#FF3333" : state === "suspicious" ? "#FFaa33" : "#2C3E6B";
  ctx.fill();

  ctx.restore();
}

// ---- Item Sprite ----

export function drawItemSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  opts: {
    time: number;
    pickedUp: boolean;
  }
): void {
  const { time, pickedUp } = opts;

  ctx.save();

  if (pickedUp) {
    ctx.globalAlpha = 0.2;
  }

  // Bob animation
  const bob = Math.sin(time * 3) * 2;
  const cy = sy + bob;

  // Glow ring
  const glowPulse = 0.3 + 0.2 * Math.sin(time * 4);
  ctx.save();
  ctx.shadowColor = "#FFD700";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = `rgba(255, 215, 0, ${glowPulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, cy, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Diamond/gem shape
  const size = 8;
  ctx.beginPath();
  ctx.moveTo(sx, cy - size);
  ctx.lineTo(sx + size, cy);
  ctx.lineTo(sx, cy + size);
  ctx.lineTo(sx - size, cy);
  ctx.closePath();

  // Gradient fill
  const grad = ctx.createLinearGradient(sx - size, cy - size, sx + size, cy + size);
  grad.addColorStop(0, "#FFE55C");
  grad.addColorStop(0.5, "#FFD700");
  grad.addColorStop(1, "#DAA520");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#DAA520";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Highlight sparkle
  const sparklePhase = (time * 2) % 1;
  if (sparklePhase < 0.3 && !pickedUp) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.beginPath();
    ctx.arc(sx - 2, cy - 3, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ---- Tile Sprites ----

export function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  variation: number
): void {
  // Base color with slight variation
  const baseColors = ["#E8D5B7", "#E5D2B4", "#EBDABD", "#E2CFB0"];
  ctx.fillStyle = baseColors[variation % 4];
  ctx.fillRect(x, y, TILE, TILE);

  // Subtle horizontal plank lines
  ctx.strokeStyle = "rgba(140, 110, 70, 0.2)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y + Math.floor(TILE / 3));
  ctx.lineTo(x + TILE, y + Math.floor(TILE / 3));
  ctx.moveTo(x, y + Math.floor((TILE * 2) / 3));
  ctx.lineTo(x + TILE, y + Math.floor((TILE * 2) / 3));
  ctx.stroke();

  // Small knot on some tiles
  if (variation === 0) {
    ctx.fillStyle = "rgba(140, 110, 70, 0.15)";
    ctx.beginPath();
    ctx.arc(x + 10, y + 16, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle grid line
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, TILE, TILE);
}

export function drawWallTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  neighbors: { top: boolean; bottom: boolean; left: boolean; right: boolean }
): void {
  // Base dark brown
  ctx.fillStyle = "#5C4033";
  ctx.fillRect(x, y, TILE, TILE);

  // Brick pattern: horizontal lines
  ctx.strokeStyle = "rgba(80, 55, 35, 0.5)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y + 10);
  ctx.lineTo(x + TILE, y + 10);
  ctx.moveTo(x, y + 21);
  ctx.lineTo(x + TILE, y + 21);
  // Offset vertical lines for brick pattern
  ctx.moveTo(x + 16, y);
  ctx.lineTo(x + 16, y + 10);
  ctx.moveTo(x + 8, y + 10);
  ctx.lineTo(x + 8, y + 21);
  ctx.moveTo(x + 24, y + 10);
  ctx.lineTo(x + 24, y + 21);
  ctx.moveTo(x + 16, y + 21);
  ctx.lineTo(x + 16, y + TILE);
  ctx.stroke();

  // Top highlight (3D effect) only if top neighbor is not a wall
  if (!neighbors.top) {
    ctx.fillStyle = "#6B5040";
    ctx.fillRect(x, y, TILE, 3);
  }

  // Exposed edges: lighter face toward open areas
  if (!neighbors.bottom) {
    ctx.fillStyle = "rgba(90, 70, 50, 0.5)";
    ctx.fillRect(x, y + TILE - 2, TILE, 2);
  }
  if (!neighbors.left) {
    ctx.fillStyle = "rgba(100, 78, 55, 0.3)";
    ctx.fillRect(x, y, 2, TILE);
  }
  if (!neighbors.right) {
    ctx.fillStyle = "rgba(70, 50, 35, 0.3)";
    ctx.fillRect(x + TILE - 2, y, 2, TILE);
  }
}

export function drawDoorTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
): void {
  // Floor underneath
  ctx.fillStyle = "#E8D5B7";
  ctx.fillRect(x, y, TILE, TILE);

  // Door body
  const doorPad = 4;
  ctx.fillStyle = "#A08060";
  ctx.beginPath();
  ctx.roundRect(x + doorPad, y + doorPad, TILE - doorPad * 2, TILE - doorPad * 2, 2);
  ctx.fill();
  ctx.strokeStyle = "#8B6B4A";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Panel lines
  const panelW = TILE - doorPad * 2 - 6;
  const panelH = (TILE - doorPad * 2 - 6) / 2 - 1;
  ctx.strokeStyle = "rgba(100, 70, 40, 0.4)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + doorPad + 3, y + doorPad + 3, panelW, panelH);
  ctx.strokeRect(x + doorPad + 3, y + doorPad + panelH + 5, panelW, panelH);

  // Doorknob
  ctx.fillStyle = "#DAA520";
  ctx.beginPath();
  ctx.arc(x + TILE - doorPad - 5, y + TILE / 2, 2, 0, Math.PI * 2);
  ctx.fill();
}

export function drawOpenDoorTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
): void {
  // Floor underneath (same as regular floor)
  ctx.fillStyle = "#E8D5B7";
  ctx.fillRect(x, y, TILE, TILE);

  // Subtle plank lines
  ctx.strokeStyle = "rgba(140, 110, 70, 0.2)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y + Math.floor(TILE / 3));
  ctx.lineTo(x + TILE, y + Math.floor(TILE / 3));
  ctx.moveTo(x, y + Math.floor((TILE * 2) / 3));
  ctx.lineTo(x + TILE, y + Math.floor((TILE * 2) / 3));
  ctx.stroke();

  // Door "swung open" — thin slab on the left edge
  ctx.fillStyle = "rgba(160, 128, 96, 0.5)";
  ctx.fillRect(x, y + 2, 4, TILE - 4);
  ctx.strokeStyle = "rgba(139, 107, 74, 0.5)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y + 2, 4, TILE - 4);

  // Doorknob on the swung-open slab
  ctx.fillStyle = "rgba(218, 165, 32, 0.6)";
  ctx.beginPath();
  ctx.arc(x + 2, y + TILE / 2, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Subtle grid line
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, TILE, TILE);
}

export function drawHideSpotTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
): void {
  // Floor background
  ctx.fillStyle = "#E8D5B7";
  ctx.fillRect(x, y, TILE, TILE);

  // Cabinet/wardrobe
  const pad = 2;
  ctx.fillStyle = "#4A5A3A";
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, TILE - pad * 2, TILE - pad * 2, 2);
  ctx.fill();

  // Top highlight
  ctx.fillStyle = "#5A6A4A";
  ctx.fillRect(x + pad, y + pad, TILE - pad * 2, 3);

  // Two vertical lines (cabinet doors)
  ctx.strokeStyle = "rgba(30, 40, 20, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + TILE / 2, y + pad + 4);
  ctx.lineTo(x + TILE / 2, y + TILE - pad - 2);
  ctx.stroke();

  // Small handles
  ctx.fillStyle = "#8B7355";
  ctx.beginPath();
  ctx.arc(x + TILE / 2 - 4, y + TILE / 2, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + TILE / 2 + 4, y + TILE / 2, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

export function drawExitTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number
): void {
  // Floor background
  ctx.fillStyle = "#E8D5B7";
  ctx.fillRect(x, y, TILE, TILE);

  // Green door
  const pulse = 0.6 + 0.4 * Math.sin(time * 3);
  ctx.fillStyle = `rgba(76, 175, 80, ${pulse})`;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, TILE - 4, TILE - 4, 3);
  ctx.fill();

  // Pulsing border glow
  ctx.save();
  ctx.shadowColor = "#4CAF50";
  ctx.shadowBlur = 6 + 4 * Math.sin(time * 3);
  ctx.strokeStyle = "#2E7D32";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, TILE - 4, TILE - 4, 3);
  ctx.stroke();
  ctx.restore();

  // "EXIT" text
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 8px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("EXIT", x + TILE / 2, y + 5);

  // Arrow
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "12px monospace";
  ctx.textBaseline = "middle";
  ctx.fillText("\u2192", x + TILE / 2, y + TILE / 2 + 4);
}

export function drawCameraTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number
): void {
  // Floor underneath
  ctx.fillStyle = "#E8D5B7";
  ctx.fillRect(x, y, TILE, TILE);

  // Subtle grid line
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, TILE, TILE);

  // Camera mount (small device on ceiling)
  ctx.fillStyle = "#333333";
  ctx.fillRect(x + 10, y + 2, 12, 8);
  // Lens
  ctx.fillStyle = "#555555";
  ctx.beginPath();
  ctx.arc(x + 16, y + 6, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#222222";
  ctx.beginPath();
  ctx.arc(x + 16, y + 6, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Blinking red LED
  const blink = Math.sin(time * 4) > 0;
  if (blink) {
    ctx.fillStyle = "#FF0000";
    ctx.beginPath();
    ctx.arc(x + 22, y + 3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    // LED glow
    ctx.save();
    ctx.shadowColor = "#FF0000";
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#FF0000";
    ctx.beginPath();
    ctx.arc(x + 22, y + 3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fillStyle = "#660000";
    ctx.beginPath();
    ctx.arc(x + 22, y + 3, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
