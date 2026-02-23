export interface TouchState {
  /** Movement direction from virtual joystick: normalized to -1..1, or 0 if idle */
  moveX: number;
  moveY: number;
  /** True while crouch button is held */
  crouching: boolean;
  /** True only on the frame interact button was tapped */
  interactPressed: boolean;
}

export class TouchInputManager {
  private state: TouchState = { moveX: 0, moveY: 0, crouching: false, interactPressed: false };
  private joystickTouchId: number | null = null;
  private joystickOrigin: { x: number; y: number } | null = null;

  /** Joystick dead zone radius in pixels */
  private readonly DEAD_ZONE = 10;
  /** Joystick max radius in pixels */
  private readonly MAX_RADIUS = 50;

  getState(): TouchState {
    return { ...this.state };
  }

  getJoystickOrigin(): { x: number; y: number } | null {
    return this.joystickOrigin;
  }

  isJoystickActive(): boolean {
    return this.joystickTouchId !== null;
  }

  /** Call at end of frame to clear one-shot flags */
  endFrame() {
    this.state.interactPressed = false;
  }

  // --- Joystick ---
  onJoystickTouchStart(touchId: number, x: number, y: number) {
    if (this.joystickTouchId !== null) return; // already tracking a joystick touch
    this.joystickTouchId = touchId;
    this.joystickOrigin = { x, y };
    this.state.moveX = 0;
    this.state.moveY = 0;
  }

  onJoystickTouchMove(touchId: number, x: number, y: number) {
    if (touchId !== this.joystickTouchId || !this.joystickOrigin) return;

    const dx = x - this.joystickOrigin.x;
    const dy = y - this.joystickOrigin.y;
    const distance = Math.hypot(dx, dy);

    if (distance < this.DEAD_ZONE) {
      this.state.moveX = 0;
      this.state.moveY = 0;
      return;
    }

    const clampedDist = Math.min(distance, this.MAX_RADIUS);
    const magnitude = (clampedDist - this.DEAD_ZONE) / (this.MAX_RADIUS - this.DEAD_ZONE);
    const angle = Math.atan2(dy, dx);

    this.state.moveX = Math.cos(angle) * magnitude;
    this.state.moveY = Math.sin(angle) * magnitude;
  }

  onJoystickTouchEnd(touchId: number) {
    if (touchId !== this.joystickTouchId) return;
    this.joystickTouchId = null;
    this.joystickOrigin = null;
    this.state.moveX = 0;
    this.state.moveY = 0;
  }

  // --- Buttons ---
  setCrouching(active: boolean) {
    this.state.crouching = active;
  }

  triggerInteract() {
    this.state.interactPressed = true;
  }
}

/** Returns the current knob position clamped within the max radius */
export function getJoystickKnobPosition(
  origin: { x: number; y: number },
  touchX: number,
  touchY: number,
  maxRadius: number
): { x: number; y: number } {
  const dx = touchX - origin.x;
  const dy = touchY - origin.y;
  const distance = Math.min(Math.hypot(dx, dy), maxRadius);
  const angle = Math.atan2(dy, dx);
  return {
    x: origin.x + Math.cos(angle) * distance,
    y: origin.y + Math.sin(angle) * distance,
  };
}

export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
