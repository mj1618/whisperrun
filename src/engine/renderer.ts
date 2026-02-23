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

  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.camera.setViewport(width, height);
  }
}

export { TILE_SIZE };
