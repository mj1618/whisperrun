export type UpdateFn = (dt: number) => void;
export type RenderFn = () => void;

export class GameLoop {
  private running = false;
  private lastTime = 0;
  private rafId = 0;
  private updateFn: UpdateFn;
  private renderFn: RenderFn;

  constructor(updateFn: UpdateFn, renderFn: RenderFn) {
    this.updateFn = updateFn;
    this.renderFn = renderFn;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.tick(this.lastTime);
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private tick = (now: number) => {
    if (!this.running) return;

    const dt = Math.min((now - this.lastTime) / 1000, 0.1); // cap at 100ms to avoid spiral
    this.lastTime = now;

    this.updateFn(dt);
    this.renderFn();

    this.rafId = requestAnimationFrame(this.tick);
  };
}
