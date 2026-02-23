import { Camera } from "./camera";
import { TileType, getTile } from "../game/map";
import {
  drawFloorTile,
  drawWallTile,
  drawDoorTile,
  drawHideSpotTile,
  drawExitTile,
  drawCameraTile,
  drawRunnerSprite,
  drawGuardSprite,
  drawItemSprite,
} from "./sprites";

const TILE_SIZE = 32;

// ---- Tile cache for static tiles ----

const tileCache = new Map<string, HTMLCanvasElement>();

function getCachedTile(
  type: TileType,
  variation: number,
  neighbors?: { top: boolean; bottom: boolean; left: boolean; right: boolean }
): HTMLCanvasElement {
  const key = neighbors
    ? `${type}-${variation}-${neighbors.top ? 1 : 0}${neighbors.bottom ? 1 : 0}${neighbors.left ? 1 : 0}${neighbors.right ? 1 : 0}`
    : `${type}-${variation}`;
  const cached = tileCache.get(key);
  if (cached) return cached;

  const offscreen = document.createElement("canvas");
  offscreen.width = TILE_SIZE;
  offscreen.height = TILE_SIZE;
  const octx = offscreen.getContext("2d")!;

  switch (type) {
    case TileType.Floor:
    case TileType.GuardSpawn:
    case TileType.ItemSpawn:
      drawFloorTile(octx, 0, 0, variation);
      break;
    case TileType.Wall:
      drawWallTile(octx, 0, 0, neighbors ?? { top: true, bottom: true, left: true, right: true });
      break;
    case TileType.Door:
      drawDoorTile(octx, 0, 0);
      break;
    case TileType.HideSpot:
      drawHideSpotTile(octx, 0, 0);
      break;
    // Exit and Camera are animated — don't cache
    default:
      break;
  }

  tileCache.set(key, offscreen);
  return offscreen;
}

function getWallNeighbors(map: TileType[][], row: number, col: number) {
  return {
    top: getTile(map, col, row - 1) === TileType.Wall,
    bottom: getTile(map, col, row + 1) === TileType.Wall,
    left: getTile(map, col - 1, row) === TileType.Wall,
    right: getTile(map, col + 1, row) === TileType.Wall,
  };
}

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
    this.ctx.fillStyle = "#1a1a2e";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawTileMap(map: TileType[][], time: number) {
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

        const variation = (col * 7 + row * 13) % 4;

        // Animated tiles are drawn directly; static tiles use cache
        if (tile === TileType.Exit) {
          drawExitTile(this.ctx, screen.x, screen.y, time);
        } else if (tile === TileType.Camera) {
          drawCameraTile(this.ctx, screen.x, screen.y, time);
        } else if (tile === TileType.Wall) {
          const neighbors = getWallNeighbors(map, row, col);
          const cached = getCachedTile(tile, variation, neighbors);
          this.ctx.drawImage(cached, screen.x, screen.y);
        } else {
          const cached = getCachedTile(tile, variation);
          this.ctx.drawImage(cached, screen.x, screen.y);
        }
      }
    }
  }

  /** Draw the Runner as a procedural sprite */
  drawRunner(
    worldX: number,
    worldY: number,
    crouching: boolean,
    hiding: boolean,
    hasItem: boolean = false,
    walkFrame: number = 0,
    facingAngle: number = 0
  ) {
    const screen = this.camera.worldToScreen(
      worldX * TILE_SIZE + TILE_SIZE / 2,
      worldY * TILE_SIZE + TILE_SIZE / 2
    );
    drawRunnerSprite(this.ctx, screen.x, screen.y, {
      crouching,
      hiding,
      hasItem,
      walkFrame,
      facingAngle,
    });
  }

  /** Draw an item as a golden gem with glow and bob */
  drawItem(worldX: number, worldY: number, time: number, pickedUp: boolean = false) {
    const screen = this.camera.worldToScreen(
      worldX * TILE_SIZE + TILE_SIZE / 2,
      worldY * TILE_SIZE + TILE_SIZE / 2
    );
    drawItemSprite(this.ctx, screen.x, screen.y, { time, pickedUp });
  }

  /** Draw the exit (now handled in drawTileMap, kept for explicit overlays) */
  drawExit(worldX: number, worldY: number, time: number) {
    const screen = this.camera.worldToScreen(
      worldX * TILE_SIZE,
      worldY * TILE_SIZE
    );
    drawExitTile(this.ctx, screen.x, screen.y, time);
  }

  /** Draw a guard as a procedural sprite */
  drawGuard(
    worldX: number,
    worldY: number,
    angle: number = 0,
    state: "patrol" | "suspicious" | "alert" | "returning" = "patrol",
    walkFrame: number = 0,
    time: number = 0
  ) {
    const screen = this.camera.worldToScreen(
      worldX * TILE_SIZE + TILE_SIZE / 2,
      worldY * TILE_SIZE + TILE_SIZE / 2
    );
    drawGuardSprite(this.ctx, screen.x, screen.y, {
      state,
      angle,
      walkFrame,
      time,
    });
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

/** Clear the offscreen tile cache to free memory (e.g. on unmount). */
export function clearTileCache() {
  tileCache.clear();
}

export { TILE_SIZE };
