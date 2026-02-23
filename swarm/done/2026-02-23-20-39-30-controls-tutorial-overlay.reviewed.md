# Task: Controls Tutorial & Onboarding Overlay

## Overview

Add a controls tutorial overlay that teaches players how to play their assigned role. Currently, a new player joining WhisperRun has no idea what keys to press — the planning phase overlay just says "Study the map" or "Get ready to sneak in" without explaining any controls. This is the single biggest UX gap in the game.

The tutorial should appear **during the planning phase** (naturally integrated into the existing `PlanningOverlay` component) and should be **role-specific**: the Runner sees movement/crouch/interact controls, while the Whisper sees ping/camera/ping-type controls. A dismissable controls reference should also be available via a keyboard shortcut during gameplay for players who forget mid-heist.

**Dependencies:** All milestones complete. This task modifies `GameCanvas.tsx` (the `PlanningOverlay` component) and adds a small controls-help popup to `HUD.tsx`. No game logic changes.

## What to Build

### 1. Enhanced Planning Phase Overlay (`/src/components/GameCanvas.tsx` — MODIFY `PlanningOverlay`)

Replace the sparse planning overlay with a rich, role-specific tutorial that fills the planning phase with useful information. The planning phase is 30 seconds — plenty of time for players to absorb their controls.

**Runner Planning Overlay should show:**
```
PLANNING PHASE — 0:XX

YOUR ROLE: RUNNER
Sneak through the building. Find the target. Get out.

CONTROLS:
  WASD / Arrow Keys — Move
  Shift (hold)      — Crouch (slower but harder to detect)
  E / Space          — Interact (hide spots, items, exit)

TIPS:
  • Guards have vision cones — stay behind them
  • Crouching reduces your detection range
  • Hide in cabinets to become invisible
  • Grab the target item, then find the exit door

        [Start Heist!]
```

**Whisper Planning Overlay should show:**
```
PLANNING PHASE — 0:XX

YOUR ROLE: WHISPER
You see the full map. Guide the Runner past the guards.

CONTROLS:
  Click             — Place a ping (Runner sees it)
  1 / 2 / 3         — Switch ping type (Go / Danger / Item)

PING TYPES:
  🟢 Go     — "Head this way"
  🔴 Danger — "Guard nearby!"
  🟡 Item   — "Target is here"

TIPS:
  • You can have up to 3 active pings
  • Watch the guard patrol routes (dashed lines)
  • The Runner has limited vision — you're their eyes

        [Start Heist!]
```

**Design guidelines:**
- Keep the dark semi-transparent backdrop (`bg-black/70`)
- Use the existing warm color palette (`#E8D5B7` for text, `#FFD700` for accents)
- Controls should be displayed in a clean, monospace-style layout for readability
- Use the same `rounded-2xl` card style but make it wider (`max-w-lg`) to fit controls
- Keep the countdown timer and Start Heist button exactly as they are
- Animate the controls section in with a subtle fade (CSS transition, no library needed)

### 2. In-Game Controls Help Popup (`/src/components/HUD.tsx` — MODIFY)

Add a small `?` button in the HUD corner and a keyboard shortcut (`H` key or `?` key) that shows a compact controls reference overlay during gameplay. Players often forget controls mid-game.

**Implementation:**
- Add a `showControls` boolean state to the HUD component
- Add a `?` button in the top-left area (next to the phase indicator) — both Runner and Whisper HUDs
- Pressing `H` or `?` toggles the overlay; clicking the `?` button also toggles it; pressing `Escape` or clicking outside dismisses it
- The overlay is a small card in the center of the screen showing a condensed version of the role's controls

**Runner controls popup:**
```
Controls (press H to close)
─────────────────────────
WASD / Arrows  Move
Shift          Crouch
E / Space      Interact
```

**Whisper controls popup:**
```
Controls (press H to close)
─────────────────────────
Click    Place ping
1/2/3    Ping type
```

**Design:**
- Semi-transparent dark card (`bg-black/60 backdrop-blur-sm`)
- Small text, monospace font for the key bindings
- Auto-dismiss after 5 seconds of inactivity or on any game action
- The `?` button should be small and unobtrusive (`text-xs`, low opacity until hovered)
- Make the `?` button `pointer-events-auto` so clicks pass through the rest of the HUD
- Add the keydown listener inside a `useEffect` in the HUD component — listen for `KeyH` and `Slash` (with shift = `?`). Make sure to check that no input element is focused before toggling.

### 3. First-Time Player Detection (optional enhancement)

Check `localStorage` for a `whisperrun_seen_tutorial` key. If it's not set:
- Show a brief "Welcome to WhisperRun!" banner on the landing page (just a small text line, nothing fancy)
- After the player completes their first planning phase, set `localStorage.setItem("whisperrun_seen_tutorial", "1")`

This is a small touch — don't over-engineer it. If it adds too much complexity, skip it entirely.

## Files to Modify

- `/src/components/GameCanvas.tsx` — Rewrite the `PlanningOverlay` function component (lines ~99-140) with role-specific controls tutorial
- `/src/components/HUD.tsx` — Add `?` button and controls help popup with keyboard shortcut toggle

## Files NOT to Touch

- No Convex changes
- No engine changes
- No game logic changes
- No new files needed (everything fits in existing components)

## Key Technical Details

### Checking Current Controls

The controls to document are based on what's already wired in `GameCanvas.tsx`:

- **Runner movement:** `KeyW`/`KeyA`/`KeyS`/`KeyD` + `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight` (search for `isKeyDown` calls)
- **Runner crouch:** `ShiftLeft`/`ShiftRight` (search for `Shift`)
- **Runner interact:** `KeyE`/`Space` (search for `isKeyPressed` calls for interaction)
- **Whisper ping:** Canvas `onClick` handler
- **Whisper ping type:** `Digit1`/`Digit2`/`Digit3` (search for `Digit` in the game loop)

Before writing the tutorial text, **read `GameCanvas.tsx`** to verify these are the actual key bindings. If they differ, document what's actually implemented.

### HUD Keyboard Listener

The `H` key listener in HUD needs to NOT conflict with any game controls. Check that `KeyH` isn't used for anything in the game loop (it shouldn't be — the game uses WASD, Shift, E, Space, and 1/2/3).

### PlanningOverlay Props

The `PlanningOverlay` component already receives `role` as a prop — use this to conditionally render Runner vs Whisper tutorials. No new props needed.

## How to Verify

1. `npm run build` succeeds with no errors.
2. `npm run lint` passes.
3. Create a game and join as **Runner**:
   - During planning phase, see the Runner controls tutorial with WASD, Shift, E/Space explained.
   - Controls are clearly laid out and easy to read.
   - The countdown timer and "Start Heist!" button still work.
4. Create a game and join as **Whisper**:
   - During planning phase, see the Whisper controls tutorial with click-to-ping and 1/2/3 ping types explained.
   - Ping type descriptions match the actual colors and behaviors.
5. During the **heist phase** (either role):
   - See a small `?` button in the HUD corner.
   - Press `H` → see a compact controls popup.
   - Press `H` again or `Escape` → popup dismisses.
   - The popup auto-dismisses after ~5 seconds.
   - Game controls still work normally (movement, crouching, pinging aren't blocked).
6. The tutorial overlay doesn't interfere with the Whisper's ability to ping during the planning phase (the Whisper should still be able to click the map behind/around the overlay).

---

## Implementation Summary

### Files Modified
- `/src/components/GameCanvas.tsx` — Rewrote `PlanningOverlay` component with role-specific controls tutorial; removed static controls hint divs (replaced by HUD help popup)
- `/src/components/HUD.tsx` — Added `useControlsHelp` hook, `ControlsPopup` component, and `HelpButton` component; integrated into both Runner HUD and Whisper HUD

### What Was Built

**1. Enhanced Planning Phase Overlay (GameCanvas.tsx)**
- Replaced sparse planning overlay with rich, role-specific tutorial
- **Runner** sees: WASD/Arrow movement, Shift crouch, E/Space interact, with tips about guards, crouching, hiding, and objectives
- **Whisper** sees: Click-to-ping, 1/2/3 ping type switcher, colored ping type descriptions (Go/Danger/Item with matching colors), and tips about pings, patrol routes, and being the Runner's eyes
- Countdown timer and Start Heist button preserved
- Controls and tips sections fade in with CSS transitions (300ms/500ms delay)
- Wider card (`max-w-lg`) with left-aligned layout for readability
- Monospace font for key bindings

**2. In-Game Controls Help Popup (HUD.tsx)**
- Added `?` button in top-left HUD area (next to phase indicator and mute button) for both roles
- `useControlsHelp` custom hook handles state, keyboard listeners, and auto-dismiss
- Press `H` or `?` (Shift+/) to toggle; `Escape` or click outside to dismiss
- Auto-dismisses after 5 seconds of inactivity
- Compact centered popup with role-specific controls (Runner: WASD/Shift/E, Whisper: Click/1-2-3)
- Semi-transparent dark card with backdrop blur
- Only shown during heist phase (planning phase has the full tutorial overlay)

**3. Removed Old Static Controls Hints**
- Removed the static bottom-right controls hints from GameCanvas.tsx (for both Runner and Whisper) since they're now replaced by the richer planning overlay tutorial and the on-demand HUD help popup

**Note:** Skipped the optional "First-Time Player Detection" enhancement (localStorage-based) as the planning overlay tutorial is already comprehensive and shown every game.

### Verification
- `npm run build` — passes cleanly
- `npm run lint` — passes (only pre-existing warnings in generated Convex files)
- No new files created; no Convex/engine/game-logic changes

---

## Review Notes (Reviewer: e26cad14)

### Issues Found & Fixed

1. **PlanningOverlay blocks Whisper pings during planning (Bug)**
   - The overlay's outer `div` (`absolute inset-0 z-20`) covered the entire screen, intercepting all pointer events. This prevented the Whisper from clicking the canvas to place pings during the planning phase — a requirement explicitly stated in the task spec.
   - **Fix:** Added `pointer-events-none` to the outer wrapper and `pointer-events-auto` to the inner card, so clicks outside the card pass through to the canvas.

2. **ControlsPopup click-outside-to-dismiss was broken (Bug)**
   - The popup's outer `div` (`absolute inset-0 z-30`) is rendered inside the HUD which has `pointer-events-none`. Without `pointer-events-auto`, clicking the backdrop to dismiss the popup didn't work — clicks passed through without triggering the `onClick` handler.
   - **Fix:** Added `pointer-events-auto` to the ControlsPopup's outer wrapper so the click-outside dismiss handler fires correctly.

### Things That Look Good

- Controls tutorial content is accurate: matches actual key bindings (WASD/Arrows, Shift, E/Space for Runner; Click, 1/2/3 for Whisper)
- Ping type colors (#44FF44, #FF4444, #FFD700) match the `PING_TYPES` config in `ping-system.ts`
- `useControlsHelp` hook correctly handles keyboard shortcuts (H, ?, Escape), auto-dismiss timer, and input element focus check
- Fade-in animations use clean CSS transitions (no animation libraries)
- `H` key doesn't conflict with any existing game controls
- Build and lint pass cleanly
