# Task: Mobile Touch Controls

## Overview

WhisperRun is a browser-based game, and many players will open the invite link on their phone. Currently, the game is keyboard-only — the Runner uses WASD/Arrow keys for movement, Shift for crouching, and Space/E for interaction. On mobile, none of these inputs exist. The Whisper role is partially functional on mobile (tap-to-ping uses `pointerdown` which works on touch), but lacks ping type selection and the HUD is cramped on small screens.

This task adds a virtual joystick for Runner movement, touch buttons for crouch and interact, and ensures the Whisper's tap-to-ping works well on mobile. The goal is "playable on phone" — not pixel-perfect mobile optimization, but enough that a friend can join from their phone and have a good time.

**Dependencies:** All milestones complete. The input system (`/src/engine/input.ts`) is keyboard-only. Touch input will be a separate parallel system that feeds the same movement/action signals.

## What to Build

### 1. Touch Input Manager (`/src/engine/touch-input.ts` — NEW FILE)

Create a touch input system that runs alongside the keyboard InputHandler. It tracks:
- Virtual joystick state (direction vector from joystick center to finger position)
- Button states (crouch held, interact pressed)

```typescript
export interface TouchState {
  /** Movement direction from virtual joystick: { dx, dy } normalized to -1..1, or { 0, 0 } if idle */
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

  /** Joystick dead zone radius in pixels — prevents drift from imprecise taps */
  private readonly DEAD_ZONE = 10;
  /** Joystick max radius in pixels — finger beyond this still gives max magnitude */
  private readonly MAX_RADIUS = 50;

  getState(): TouchState {
    return { ...this.state };
  }

  /** Call at end of frame to clear one-shot flags */
  endFrame() {
    this.state.interactPressed = false;
  }

  // --- Joystick ---
  onJoystickTouchStart(touchId: number, x: number, y: number) { ... }
  onJoystickTouchMove(touchId: number, x: number, y: number) { ... }
  onJoystickTouchEnd(touchId: number) { ... }

  // --- Buttons ---
  setCrouching(active: boolean) { this.state.crouching = active; }
  triggerInteract() { this.state.interactPressed = true; }
}
```

Key design: The joystick is "floating" — it starts wherever the player first touches the left side of the screen. This is better than a fixed position because it works regardless of screen size or hand position. The joystick origin is set on `touchstart` and cleared on `touchend`.

The `moveX`/`moveY` values are normalized to -1..1 range, where the magnitude determines speed (within the dead zone = no movement, beyond max radius = full speed). The direction maps directly to `dx`/`dy` in the movement code.

### 2. Touch Controls UI Component (`/src/components/TouchControls.tsx` — NEW FILE)

A React component that renders the virtual joystick and action buttons as an overlay on top of the canvas. Only rendered on touch-capable devices.

```tsx
interface TouchControlsProps {
  touchInput: TouchInputManager;
  role: "runner" | "whisper";
  phase: string;
}

export function TouchControls({ touchInput, role, phase }: TouchControlsProps) {
  if (role !== "runner") return null; // Whisper uses tap-to-ping directly on canvas
  if (phase !== "heist") return null; // No controls during planning/results

  return (
    <div className="fixed inset-0 z-20 pointer-events-none">
      {/* Left side: Virtual joystick area */}
      <div
        className="absolute left-0 bottom-0 w-1/2 h-1/2 pointer-events-auto"
        onTouchStart={...}
        onTouchMove={...}
        onTouchEnd={...}
      >
        {/* Joystick visual indicator (shown while touching) */}
        {joystickActive && (
          <>
            {/* Outer ring */}
            <div className="absolute rounded-full border-2 border-[#E8D5B7]/40"
              style={{ width: 100, height: 100, left: originX - 50, top: originY - 50 }} />
            {/* Inner knob */}
            <div className="absolute rounded-full bg-[#E8D5B7]/60"
              style={{ width: 40, height: 40, left: knobX - 20, top: knobY - 20 }} />
          </>
        )}
      </div>

      {/* Right side: Action buttons */}
      <div className="absolute right-4 bottom-8 flex flex-col gap-3 pointer-events-auto">
        {/* Crouch button (toggle) */}
        <button
          className="w-16 h-16 rounded-full bg-[#2D1B0E]/70 border-2 border-[#FFD700]/50
                     text-[#FFD700] text-xs font-bold active:bg-[#FFD700]/30"
          onTouchStart={() => touchInput.setCrouching(true)}
          onTouchEnd={() => touchInput.setCrouching(false)}
        >
          SNEAK
        </button>
        {/* Interact button */}
        <button
          className="w-16 h-16 rounded-full bg-[#2D1B0E]/70 border-2 border-[#44FF44]/50
                     text-[#44FF44] text-xs font-bold active:bg-[#44FF44]/30"
          onTouchStart={() => touchInput.triggerInteract()}
        >
          ACT
        </button>
      </div>
    </div>
  );
}
```

**Visual design:** Semi-transparent buttons that match the game's warm/cozy aesthetic. The joystick is invisible until touched (floating joystick pattern). Action buttons are large (64x64) for easy thumb access.

**Important:** The `pointer-events-auto` on the touch areas means these elements capture touch events. The rest of the overlay is `pointer-events-none` so it doesn't block the canvas. Use `onTouchStart`/`onTouchMove`/`onTouchEnd` (not `onClick`) for responsive touch handling.

### 3. Touch Detection Utility (`/src/engine/touch-input.ts` — ADD)

Add a function to detect if the device has touch capability:

```typescript
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
```

This is used to conditionally render touch controls. Note: some laptops have touch screens, so users might have both keyboard and touch available. In that case, showing touch controls is fine — they overlay transparently and don't interfere with keyboard input.

### 4. Integrate Touch Input into GameCanvas (`/src/components/GameCanvas.tsx` — MODIFY)

The game loop currently reads movement from the `InputHandler` (keyboard). Add the touch input as a parallel source:

**a) Create and pass the TouchInputManager:**

```typescript
// At the top of the component, alongside existing refs:
const touchInputRef = useRef(new TouchInputManager());
const [showTouchControls, setShowTouchControls] = useState(false);

useEffect(() => {
  setShowTouchControls(isTouchDevice());
}, []);
```

**b) Merge touch input with keyboard input in the game loop:**

In the game loop where Runner movement is computed (around the `dx`/`dy` calculation on lines 645-653), merge touch input:

```typescript
// Existing keyboard input:
let dx = 0;
let dy = 0;
const isCrouching = input.isKeyDown("ShiftLeft") || input.isKeyDown("ShiftRight");

if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) dy -= 1;
if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) dy += 1;
if (input.isKeyDown("KeyA") || input.isKeyDown("ArrowLeft")) dx -= 1;
if (input.isKeyDown("KeyD") || input.isKeyDown("ArrowRight")) dx += 1;

// NEW: Merge touch input (touch overrides keyboard if active)
const touch = touchInputRef.current.getState();
if (touch.moveX !== 0 || touch.moveY !== 0) {
  dx = touch.moveX;
  dy = touch.moveY;
}
const isCrouchingFinal = isCrouching || touch.crouching;
```

**c) Touch interact:**

Where the interact key is checked (around line 897), also check touch:

```typescript
const interactPressed = input.isKeyPressed("Space") || input.isKeyPressed("KeyE")
  || touchInputRef.current.getState().interactPressed;
```

**d) Clear touch one-shot flags at end of frame:**

After the game loop body, call `touchInputRef.current.endFrame()`.

**e) Render the TouchControls component:**

```tsx
return (
  <div className="relative w-full h-full">
    <canvas ref={canvasRef} ... />
    <HUD ... />
    {showTouchControls && (
      <TouchControls
        touchInput={touchInputRef.current}
        role={role}
        phase={state?.phase ?? "planning"}
      />
    )}
  </div>
);
```

### 5. Whisper Touch Improvements (`/src/components/HUD.tsx` — MODIFY)

The Whisper's ping system already works on touch (canvas `pointerdown`), but the ping type selection buttons in the HUD need to be touch-friendly:

- Increase ping type button size on mobile (at least 44x44 touch target)
- Make sure buttons don't overlap or crowd on small screens
- The selected ping type indicator should be clearly visible

Check if the existing HUD layout works on a 375px-wide viewport (iPhone SE). If buttons are too small or text overlaps, adjust the responsive Tailwind classes. Use `min-w-[44px] min-h-[44px]` on interactive elements for touch accessibility.

### 6. Prevent Default Touch Behaviors (`/src/components/GameCanvas.tsx` — MODIFY)

Mobile browsers have default behaviors that interfere with games:
- Pull-to-refresh
- Double-tap zoom
- Text selection
- Scroll bounce

Add CSS to the game container and touch event prevention:

```tsx
// On the root game container div:
<div
  className="relative w-full h-full touch-none select-none"
  style={{ overscrollBehavior: "none" }}
>
```

Also add to the canvas element:

```tsx
<canvas
  ref={canvasRef}
  className="touch-none"
  style={{ touchAction: "none" }}
/>
```

The `touch-none` Tailwind class and `touchAction: "none"` CSS prevent the browser from intercepting touch events on the game canvas.

### 7. Viewport Meta Tag (`/src/app/layout.tsx` — SMALL MODIFY)

Ensure the viewport meta tag prevents zoom and sets proper scaling for mobile:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
```

This prevents accidental pinch-zoom during gameplay. Check if this meta tag already exists and update it if needed.

## Files to Create

- `/src/engine/touch-input.ts` — TouchInputManager class, isTouchDevice utility
- `/src/components/TouchControls.tsx` — Virtual joystick and action buttons overlay

## Files to Modify

- `/src/components/GameCanvas.tsx` — Integrate touch input into game loop, merge with keyboard input, render TouchControls, add touch-none CSS
- `/src/components/HUD.tsx` — Increase touch target sizes for ping buttons, ensure mobile-friendly layout
- `/src/app/layout.tsx` — Viewport meta tag for mobile

## Files NOT to Touch

- `/src/engine/input.ts` — Keep the existing keyboard InputHandler as-is; touch input is a separate parallel system
- `/convex/*` — No backend changes needed
- `/src/game/guard-ai.ts` — Game logic is input-agnostic
- `/src/game/runner-view.ts` — Rendering is unchanged
- `/src/game/whisper-view.ts` — Rendering is unchanged
- `/src/engine/audio.ts` — Audio is unchanged (note: mobile browsers require a user gesture to start AudioContext; the existing click/tap to start game likely satisfies this)

## Key Technical Details

### Floating Joystick Pattern

The joystick doesn't have a fixed position on screen. Instead:
1. Player touches anywhere on the left half of the screen → that point becomes the joystick center
2. Moving the finger away from that center determines direction and magnitude
3. Lifting the finger resets the joystick (movement stops)

This is the standard pattern used by mobile games (Brawl Stars, Among Us, etc.) because it works regardless of hand size or grip style.

### Input Merging Priority

Both keyboard and touch input can be active simultaneously (e.g., on a tablet with a keyboard). The merging logic is:
- If touch joystick is active (non-zero movement), use touch movement
- If touch joystick is idle, use keyboard movement
- Crouch: either source triggers crouch (OR logic)
- Interact: either source triggers interact (OR logic)

This means a player can switch between keyboard and touch mid-game without issues.

### Touch vs Click Events

Use `onTouchStart`/`onTouchMove`/`onTouchEnd` for the joystick and action buttons, NOT `onClick` or `onPointerDown`. Touch events fire immediately on contact, while click events have a ~300ms delay on mobile. For a game, this latency is unacceptable. The pointer events on the canvas (for Whisper pings) are fine because pings aren't latency-sensitive.

### Performance Considerations

- The TouchControls component only re-renders when phase changes (the joystick visual uses direct DOM manipulation via refs, not React state, to avoid re-render overhead)
- Touch event handlers are passive where possible (joystick movement) and `preventDefault` where needed (to prevent scroll)
- The joystick visual (outer ring + inner knob) uses absolute positioning with inline styles updated via refs — no CSS transitions or animations that could cause layout thrashing

### Joystick Visual Positioning

The joystick visual elements need to be positioned relative to the touch area, not the page. Use a `ref` on the touch area container and compute positions relative to its bounding rect. The knob position should be clamped to the max radius:

```typescript
const angle = Math.atan2(touchY - originY, touchX - originX);
const distance = Math.min(Math.hypot(touchX - originX, touchY - originY), MAX_RADIUS);
const knobX = originX + Math.cos(angle) * distance;
const knobY = originY + Math.sin(angle) * distance;
```

### Multi-Touch Handling

The virtual joystick and action buttons need to handle multi-touch correctly:
- The joystick tracks one specific `Touch.identifier` — other touches don't affect it
- The crouch and interact buttons are independent touch targets
- A player should be able to move with their left thumb AND hold crouch with their right thumb simultaneously

This is why we use `Touch.identifier` in the joystick tracking (not just "the first touch") and why each button handles its own touch events independently.

## How to Verify

1. `npm run build` succeeds with no type errors.
2. `npm run lint` passes.
3. **Desktop keyboard still works**: Play the game with keyboard — all WASD, Shift, Space/E inputs work exactly as before. Touch controls should be hidden or non-intrusive on desktop (only shown if touch is detected).
4. **Mobile Runner controls**: Open the game on a phone (or use Chrome DevTools device emulation with touch enabled):
   - Touch the left side of the screen → joystick visual appears at touch point
   - Drag finger → Runner moves in that direction
   - Release → Runner stops, joystick disappears
   - Tap the SNEAK button → Runner crouches (hold to stay crouched)
   - Tap the ACT button → Runner interacts (pick up items, enter hide spots, use exit)
   - Can move AND crouch simultaneously (two-thumb operation)
5. **Mobile Whisper controls**: Open as Whisper on a phone:
   - Tap on the map → ping is placed (existing behavior works on touch)
   - Ping type buttons are large enough to tap easily (at least 44px targets)
6. **No browser interference**: During gameplay on mobile:
   - No pull-to-refresh when swiping down
   - No accidental zoom on double-tap
   - No text selection on UI elements
   - No scroll bounce when touching the game area
7. **Responsive layout**: The touch controls and HUD don't overlap or clip on a 375×667 viewport (iPhone SE size).

---

## Implementation Summary

### Files Created
- **`/src/engine/touch-input.ts`** — `TouchInputManager` class with floating joystick logic (dead zone, max radius, normalized -1..1 output), crouch/interact button state, `isTouchDevice()` utility, and `getJoystickKnobPosition()` helper for visual positioning
- **`/src/components/TouchControls.tsx`** — React overlay component with:
  - Floating virtual joystick on left half of screen (appears at touch point, disappears on release)
  - Outer ring + inner knob visual using refs for DOM manipulation (avoids React re-renders)
  - SNEAK button (hold to crouch) and ACT button (tap to interact) on bottom-right
  - Multi-touch support — joystick tracks specific `Touch.identifier`, buttons are independent
  - All touch events use `onTouchStart`/`onTouchMove`/`onTouchEnd` for zero-latency response
  - `pointer-events-none` overlay with `pointer-events-auto` on interactive areas

### Files Modified
- **`/src/components/GameCanvas.tsx`**:
  - Added `TouchInputManager` instance (via `useMemo`) alongside existing `InputHandler`
  - Merged touch input into Runner movement: touch joystick overrides keyboard when active, crouch uses OR logic
  - Added touch interact check alongside keyboard Space/E
  - `endFrame()` called at end of update loop to clear one-shot flags
  - Renders `<TouchControls>` overlay when `isTouchDevice()` is true
  - Added `touch-none select-none` CSS + `overscrollBehavior: "none"` on game container
  - Added `touch-none` + `touchAction: "none"` on canvas element
  - Added `touchstart` event listener for audio initialization on mobile
- **`/src/components/HUD.tsx`**:
  - Increased touch targets on MuteButton and HelpButton to `min-w-[44px] min-h-[44px]` with flex centering
  - Increased Whisper ping type selector buttons to `min-w-[44px] min-h-[44px]`
  - Added responsive padding (`px-3 sm:px-4 py-2 sm:py-3`) on ping selector container
- **`/src/app/layout.tsx`**:
  - Added separate `viewport` export with `maximumScale: 1, userScalable: false` to prevent accidental zoom

### Build Status
- `npm run build` — passes, no type errors
- `npm run lint` — passes (0 errors, only pre-existing warnings from generated Convex files)

---

## Review Notes (agent 85cfd7df)

### Issues Found & Fixed

1. **Joystick visual appears at (0,0) on initial touch (TouchControls.tsx)**
   - `handleTouchStart` called `updateVisuals()` before `setActive(true)` triggered a re-render, so the outer ring and inner knob divs didn't exist yet (they're conditionally rendered when `active` is true). The first frame would show the joystick at position (0,0) in the container.
   - **Fix:** Replaced plain `outerRef`/`innerRef` with callback refs (`outerCallbackRef`/`innerCallbackRef`) that set the initial position from stored `originRef`/`knobRef` when the divs first mount.

2. **Touch joystick diagonal movement ignoring analog magnitude (GameCanvas.tsx)**
   - Keyboard normalization code (`if (dx !== 0 && dy !== 0) { normalize }`) was applied unconditionally, including to touch input. Touch joystick values are already normalized with magnitude encoding distance from center (for proportional speed control). Re-normalizing diagonal touch input boosted any diagonal movement to full speed, defeating the analog joystick.
   - **Fix:** Only normalize when using keyboard input (`!usingTouch`).

3. **Hydration-safe touch detection (GameCanvas.tsx)**
   - Original `useState(() => isTouchDevice())` could cause hydration mismatch (SSR returns `false`, client initializer may return `true` but React reuses server state during hydration, so touch controls would never show). Replaced with `useSyncExternalStore` with a server snapshot of `false` and client snapshot calling `isTouchDevice()`, which is the recommended SSR-safe pattern.

4. **Missing `doors` field in LocalGameState construction (GameCanvas.tsx)**
   - The "Interactive Doors" task added `doors` to `LocalGameState` interface, but the `GameCanvas.tsx` state mapping didn't include it, causing a TypeScript build error. Added `doors: gameState.doors ?? []`.

5. **Missing `touch-none` on joystick area (TouchControls.tsx)**
   - The joystick area div had `pointer-events-auto` but not `touch-none`. While `preventDefault()` is called in handlers, some browsers may initiate scroll before JS handlers fire. Added `touch-none` class.

### Items Reviewed — No Issues
- `/src/engine/touch-input.ts` — Clean implementation. Dead zone, max radius, normalized output all correct. Multi-touch identifier tracking is correct.
- `/src/components/HUD.tsx` — Touch targets correctly sized at 44x44 minimum. Responsive padding looks good.
- `/src/app/layout.tsx` — Viewport export is the correct Next.js App Router pattern.
- Touch/keyboard input merging logic and `endFrame()` placement are correct.
- Audio initialization includes `touchstart` listener — correct for mobile.

### Build/Lint Status After Review
- `npm run build` — passes
- `npm run lint` — 0 errors (only pre-existing warnings from generated Convex files and unused import in guard-ai.ts)
