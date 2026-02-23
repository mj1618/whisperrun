export class Camera {
  x = 0;
  y = 0;
  viewportWidth = 0;
  viewportHeight = 0;

  private smoothing = 0.1;

  setViewport(width: number, height: number) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /** Immediately center on a world position */
  centerOn(worldX: number, worldY: number) {
    this.x = worldX - this.viewportWidth / 2;
    this.y = worldY - this.viewportHeight / 2;
  }

  /** Smoothly move toward a world position */
  follow(worldX: number, worldY: number, dt: number) {
    const targetX = worldX - this.viewportWidth / 2;
    const targetY = worldY - this.viewportHeight / 2;
    const t = 1 - Math.pow(1 - this.smoothing, dt * 60);
    this.x += (targetX - this.x) * t;
    this.y += (targetY - this.y) * t;
  }

  /** Convert world coords to screen coords */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX - this.x,
      y: worldY - this.y,
    };
  }

  /** Convert screen coords to world coords */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: screenX + this.x,
      y: screenY + this.y,
    };
  }
}
