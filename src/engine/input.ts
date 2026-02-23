export class InputHandler {
  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();
  private prevKeysDown = new Set<string>();

  private onKeyDown = (e: KeyboardEvent) => {
    this.keysDown.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.code);
  };

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.keysDown.clear();
    this.keysPressed.clear();
    this.prevKeysDown.clear();
  }

  /** Call at the start of each update to compute just-pressed keys */
  update() {
    this.keysPressed.clear();
    for (const key of this.keysDown) {
      if (!this.prevKeysDown.has(key)) {
        this.keysPressed.add(key);
      }
    }
    this.prevKeysDown = new Set(this.keysDown);
  }

  /** True while key is held down */
  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /** True only on the frame the key was first pressed */
  isKeyPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }
}
