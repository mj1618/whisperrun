export interface Sprite {
  width: number;
  height: number;
  color: string;
}

export function drawColorRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sprite: Sprite
) {
  ctx.fillStyle = sprite.color;
  ctx.fillRect(x, y, sprite.width, sprite.height);
}
