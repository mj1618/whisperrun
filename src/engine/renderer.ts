import { Camera } from "./camera";
import { TileType } from "../game/map";

const TILE_SIZE = 32;

const TILE_COLORS: Record<TileType, string> = {
  [TileType.Floor]: "#E8D5B7",
  [TileType.Wall]: "#5C4033",
  [TileType.Door]: "#8B7355",
  [TileType.HideSpot]: "#6B8E23",
  [TileType.ItemSpawn]: "#FFD700",
  [TileType.Exit]: "#4CAF50",
  [TileType.GuardSpawn]: "#FF6B6B",
  [TileType.Camera]: "#87CEEB",
};

const TILE_LABELS: Partial<Record<TileType, string>> = {
  [TileType.HideSpot]: "H",
  [TileType.ItemSpawn]: "I",
  [TileType.Exit]: "E",
  [TileType.GuardSpawn]: "G",
  [TileType.Camera]: "C",
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  camera: Camera;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");
    this.ctx = ctx;
    this.camera = camera;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Dark background
    this.ctx.fillStyle = "#1a1a2e";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawTileMap(map: TileType[][]) {
    const rows = map.length;
    const cols = map[0]?.length ?? 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = map[row][col];
        const worldX = col * TILE_SIZE;
        const worldY = row * TILE_SIZE;

        const screen = this.camera.worldToScreen(worldX, worldY);

        // Cull offscreen tiles
        if (
          screen.x + TILE_SIZE < 0 ||
          screen.y + TILE_SIZE < 0 ||
          screen.x > this.canvas.width ||
          screen.y > this.canvas.height
        ) {
          continue;
        }

        // Draw tile background
        this.ctx.fillStyle = TILE_COLORS[tile] ?? "#FF00FF";
        this.ctx.fillRect(screen.x, screen.y, TILE_SIZE, TILE_SIZE);

        // Draw subtle grid lines
        this.ctx.strokeStyle = "rgba(0,0,0,0.1)";
        this.ctx.strokeRect(screen.x, screen.y, TILE_SIZE, TILE_SIZE);

        // Draw label for special tiles
        const label = TILE_LABELS[tile];
        if (label) {
          this.ctx.fillStyle = "rgba(0,0,0,0.6)";
          this.ctx.font = "bold 14px monospace";
          this.ctx.textAlign = "center";
          this.ctx.textBaseline = "middle";
          this.ctx.fillText(
            label,
            screen.x + TILE_SIZE / 2,
            screen.y + TILE_SIZE / 2
          );
        }
      }
    }
  }

  /** Draw the Runner as a warm orange circle */
  drawRunner(worldX: number, worldY: number, crouching: boolean, hiding: boolean) {
    const screen = this.camera.worldToScreen(
      worldX * TILE_SIZE + TILE_SIZE / 2,
      worldY * TILE_SIZE + TILE_SIZE / 2
    );
    const radius = crouching ? TILE_SIZE * 0.3 : TILE_SIZE * 0.4;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = hiding ? "rgba(227, 155, 50, 0.4)" : "#E39B32";
    this.ctx.fill();
    this.ctx.strokeStyle = hiding ? "rgba(180, 120, 30, 0.4)" : "#B47820";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();
  }

  /** Draw an item as a gold diamond */
  drawItem(worldX: number, worldY: number) {
    const screen = this.camera.worldToScreen(
      worldX * TILE_SIZE + TILE_SIZE / 2,
      worldY * TILE_SIZE + TILE_SIZE / 2
    );
    const size = TILE_SIZE * 0.3;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.moveTo(screen.x, screen.y - size);
    this.ctx.lineTo(screen.x + size, screen.y);
    this.ctx.lineTo(screen.x, screen.y + size);
    this.ctx.lineTo(screen.x - size, screen.y);
    this.ctx.closePath();
    this.ctx.fillStyle = "#FFD700";
    this.ctx.fill();
    this.ctx.strokeStyle = "#DAA520";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();
  }

  /** Draw the exit as a pulsing green square */
  drawExit(worldX: number, worldY: number, time: number) {
    const screen = this.camera.worldToScreen(
      worldX * TILE_SIZE,
      worldY * TILE_SIZE
    );
    // Pulse between 0.6 and 1.0 alpha
    const pulse = 0.6 + 0.4 * Math.sin(time * 3);

    this.ctx.save();
    this.ctx.fillStyle = `rgba(76, 175, 80, ${pulse})`;
    this.ctx.fillRect(screen.x + 2, screen.y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    this.ctx.strokeStyle = "#2E7D32";
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(screen.x + 2, screen.y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    this.ctx.restore();
  }

  /** Draw a guard as a red circle with direction indicator and state coloring */
  drawGuard(worldX: number, worldY: number, angle: number = 0, state: "patrol" | "suspicious" | "alert" | "returning" = "patrol") {
    const screen = this.camera.worldToScreen(
      worldX * TILE_SIZE + TILE_SIZE / 2,
      worldY * TILE_SIZE + TILE_SIZE / 2
    );
    const radius = TILE_SIZE * 0.45;

    // State-based coloring
    let fillColor: string;
    let strokeColor: string;
    switch (state) {
      case "alert":
        fillColor = "#FF3333";
        strokeColor = "#CC0000";
        break;
      case "suspicious":
        fillColor = "#FFaa33";
        strokeColor = "#CC8800";
        break;
      case "returning":
        fillColor = "#CC6666";
        strokeColor = "#994444";
        break;
      default: // patrol
        fillColor = "#FF6B6B";
        strokeColor = "#CC4444";
    }

    this.ctx.save();

    // Draw body
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = fillColor;
    this.ctx.fill();
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Direction indicator (small triangle pointing in guard.angle direction)
    const triDist = radius + 4;
    const triSize = 6;
    const tipX = screen.x + Math.cos(angle) * triDist;
    const tipY = screen.y + Math.sin(angle) * triDist;
    const baseAngle1 = angle + Math.PI * 0.75;
    const baseAngle2 = angle - Math.PI * 0.75;

    this.ctx.beginPath();
    this.ctx.moveTo(tipX, tipY);
    this.ctx.lineTo(
      tipX + Math.cos(baseAngle1) * triSize,
      tipY + Math.sin(baseAngle1) * triSize
    );
    this.ctx.lineTo(
      tipX + Math.cos(baseAngle2) * triSize,
      tipY + Math.sin(baseAngle2) * triSize
    );
    this.ctx.closePath();
    this.ctx.fillStyle = strokeColor;
    this.ctx.fill();

    this.ctx.restore();
  }

  /** Draw a guard's vision cone (for Whisper view) */
  drawGuardVisionCone(
    guardX: number,
    guardY: number,
    angle: number,
    range: number,
    fov: number,
    state: string
  ) {
    const screen = this.camera.worldToScreen(
      guardX * TILE_SIZE + TILE_SIZE / 2,
      guardY * TILE_SIZE + TILE_SIZE / 2
    );
    const rangePixels = range * TILE_SIZE;
    const halfFovRad = ((fov * Math.PI) / 180) / 2;

    const color = state === "alert" ? "rgba(255, 50, 50, 0.15)" : "rgba(255, 100, 100, 0.1)";

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.moveTo(screen.x, screen.y);
    this.ctx.arc(screen.x, screen.y, rangePixels, angle - halfFovRad, angle + halfFovRad);
    this.ctx.closePath();
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.restore();
  }

  /** Get canvas dimensions */
  getCanvasSize(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  /** Get the raw 2D context for custom drawing (e.g. fog of war) */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.camera.setViewport(width, height);
  }
}

export { TILE_SIZE };
