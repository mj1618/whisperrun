# Task: Complete Game Loop & Results Screen (Milestone 6)

## Overview

Wire together all the individual features (Runner gameplay, Whisper view, Guard AI) into a polished, complete game loop with proper phase transitions, timing, and a results screen. After this milestone, two players can play a full session from start to finish: lobby → planning phase → heist → win or lose → see results → play again.

**Dependencies:** This task should be started after Milestones 3, 4, and 5 are complete. The Runner can move and interact, the Whisper can see the blueprint and ping, and guards patrol and detect. This milestone is the integration layer that makes them all work together seamlessly.

## What to Build

### 1. Planning Phase Timer (`/convex/game.ts` — MODIFY)

Currently the planning phase has a manual "Start Heist!" button. Add a **30-second countdown timer** to the planning phase:

#### `startHeistPhase` — update existing mutation
- Instead of immediately transitioning, have the client call this after the countdown ends
- The mutation already exists — no change needed server-side

#### Client-side planning countdown (`/src/components/GameCanvas.tsx` — MODIFY)
- When `phase === "planning"`, show a countdown timer: "Planning Phase — 0:27"
- The timer counts down from 30 seconds based on `startTime` (set when game starts)
- When the timer reaches 0, the Runner client automatically calls `startHeistPhase` mutation
- The Whisper should use this time to study the map and place initial pings
- Keep the manual "Start Heist!" button so either player can skip the countdown early
- Both players see the same countdown (derived from `startTime` so it's synchronized)

**Implementation:**
```typescript
// In GameCanvas, during planning phase render:
const planningDuration = 30_000; // 30 seconds
const elapsed = Date.now() - state.startTime;
const remaining = Math.max(0, planningDuration - elapsed);
const remainingSeconds = Math.ceil(remaining / 1000);

// Auto-transition when timer expires
if (remaining <= 0 && phase === "planning") {
  startHeistPhaseRef.current({ roomId });
}
```

Update the planning overlay to show the countdown prominently, replacing the simple "Planning Phase" text.

### 2. Heist Timer & Time Limit (`/src/components/HUD.tsx` — MODIFY)

Add a proper game timer to the heist phase:

- **Heist time limit:** 3 minutes (180 seconds) — if time runs out, the game ends in a "timeout" loss
- The timer should count DOWN from 3:00, not up
- Display prominently at top-center of HUD in `MM:SS` format
- When under 30 seconds remaining, the timer turns red and pulses
- When under 10 seconds, add urgency styling (larger, more intense pulse)

**Timer source:** Calculate from `startTime` plus the 30-second planning phase:
```typescript
const heistStartTime = state.startTime + 30_000; // Planning phase was 30s
const heistElapsed = Date.now() - heistStartTime;
const heistRemaining = Math.max(0, 180_000 - heistElapsed); // 3-minute limit
```

Note: If the players skipped planning early, `heistStartTime` should be when `startHeistPhase` was actually called, not `startTime + 30_000`. To handle this properly:

#### Add `heistStartTime` field to gameState (`/convex/schema.ts` — MODIFY)
- Add `heistStartTime: v.optional(v.number())` to the gameState table
- In the `startHeistPhase` mutation, set `heistStartTime: Date.now()` alongside setting `phase: "heist"`

Then the HUD timer uses `heistStartTime` from the game state for accurate countdown.

### 3. Timeout Loss Condition (`/convex/game.ts` — MODIFY)

Add a new mutation:

#### `checkTimeout` (mutation)
- Args: `{ roomId: v.id("rooms") }`
- If `phase === "heist"` and `Date.now() - heistStartTime > 180_000`:
  - Set `phase = "timeout"`
  - Set room status to `"finished"`
- The Runner client calls this every second during the heist phase
- This is server-authoritative — the server checks the real elapsed time

Also update the phase union in the schema to include `"timeout"`:
```typescript
phase: v.union(
  v.literal("planning"),
  v.literal("heist"),
  v.literal("escaped"),
  v.literal("caught"),
  v.literal("timeout")
)
```

### 4. Results Screen (`/src/components/ResultsScreen.tsx` — NEW FILE)

Create a post-game results screen that shows after any game-ending condition (escaped, caught, timeout).

**Layout:**
```
┌───────────────────────────────────────────┐
│                                           │
│            🎉 YOU ESCAPED! 🎉             │  (or "BUSTED!" or "TIME'S UP!")
│                                           │
│     ┌─────────────────────────────┐       │
│     │  Time:        1:47          │       │
│     │  Stealth:     ⭐⭐⭐         │       │
│     │  Close Calls: 2            │       │
│     │  Item:        Golden       │       │
│     │               Rubber Duck  │       │
│     └─────────────────────────────┘       │
│                                           │
│     ┌─────────────────────────────┐       │
│     │  Runner:   you (Player 1)  │       │
│     │  Whisper:  Player 2        │       │
│     └─────────────────────────────┘       │
│                                           │
│        [ Play Again ]  [ Home ]           │
│                                           │
└───────────────────────────────────────────┘
```

**Props:**
```typescript
interface ResultsScreenProps {
  outcome: "escaped" | "caught" | "timeout";
  heistDuration: number;   // ms elapsed during heist phase
  itemName: string;
  hasItem: boolean;        // Did Runner grab the item before game ended?
  roomCode: string;
  role: "runner" | "whisper";
}
```

**Outcome displays:**
- **escaped:** Green theme. Title "You Escaped!" with celebration. Show time and stealth rating.
- **caught:** Red theme. Title "Busted!" with "The guard politely escorted you out." Show how far they got.
- **timeout:** Orange/amber theme. Title "Time's Up!" with "The building closed for the night." Show progress.

**Stealth rating** (simple for MVP):
- ⭐⭐⭐ (3 stars): Escaped in under 1 minute of heist time
- ⭐⭐ (2 stars): Escaped in under 2 minutes
- ⭐ (1 star): Escaped but took over 2 minutes
- No stars for caught/timeout

**Buttons:**
- "Play Again" — calls a `resetRoom` mutation (see below) that resets the room to "waiting" status, then redirects both players back to the lobby
- "Home" — navigates to `/`

**Styling:**
- Semi-transparent dark overlay covering the full screen
- Centered card with rounded corners
- Outcome-dependent color accents (green/red/amber)
- Warm, cozy typography matching the game theme
- Subtle entrance animation (fade in + scale up)

### 5. Reset Room Mutation (`/convex/rooms.ts` — MODIFY)

#### `resetRoom` (mutation)
- Args: `{ roomCode: v.string(), sessionId: v.string() }`
- Validate: room exists, player is in the room, room status is "finished"
- Reset room: `status = "waiting"`, clear all players' `ready` flags (keep roles so they don't have to re-pick)
- Delete the old `gameState` document for this room (or leave it — it won't conflict since `getGameState` filters by roomId and the new game will create a new one)
- Both players' UIs will react to the room status change (via Convex subscription) and show the Lobby again

### 6. Replace Inline Overlays with ResultsScreen (`/src/components/GameCanvas.tsx` — MODIFY)

Currently, the "You Escaped!" and "Busted!" overlays are inline in GameCanvas. Replace them:

- Remove the inline escaped/caught overlay divs from GameCanvas
- Instead, when `phase` is `"escaped"`, `"caught"`, or `"timeout"`, render the `<ResultsScreen>` component
- The ResultsScreen should be rendered in the game page (`/src/app/game/[roomId]/page.tsx`) rather than inside GameCanvas, since it replaces the entire game view
- Pass the necessary props from the game state

**Updated game page logic:**
```typescript
// In game/[roomId]/page.tsx:
if (room.status === "playing") {
  const gameState = /* from useQuery */;
  const isGameOver = gameState?.phase === "escaped" || gameState?.phase === "caught" || gameState?.phase === "timeout";

  if (isGameOver) {
    return <ResultsScreen outcome={gameState.phase} ... />;
  }

  return <GameCanvas roomId={room._id} sessionId={sessionId} role={myRole} />;
}
```

Wait — there's a subtlety. The game page currently shows GameCanvas when status is "playing". But when the game ends, the room status changes to "finished", which would make the page show... nothing (or an error). We need to handle the "finished" state:

**Updated flow in game page:**
- `status === "waiting"` → Show Lobby
- `status === "playing"` → Show GameCanvas
- `status === "finished"` → Show ResultsScreen (query the gameState for outcome/stats)

This means the game page needs to query `getGameState` at the page level (not just inside GameCanvas) when status is "finished", to get the final outcome.

### 7. Stop Game Loop on Game End (`/src/components/GameCanvas.tsx` — MODIFY)

When the game ends (phase is escaped/caught/timeout):
- Stop sending Runner position updates
- Stop the guard tick driver
- Freeze the canvas (stop the game loop, or let it render one final frame)
- The ResultsScreen will overlay or replace the canvas

### 8. Integration: Both Views See Game End

Make sure both the Runner and Whisper see the game-ending state:
- **Runner caught:** Both clients see `phase === "caught"` via subscription. GameCanvas freezes. ResultsScreen appears.
- **Runner escaped:** Both clients see `phase === "escaped"`. Same flow.
- **Timeout:** Both clients see `phase === "timeout"`. Same flow.
- The Whisper doesn't have a different end-game experience — both players see the same ResultsScreen.

### 9. Guard Alert State Sync for Whisper

When guards are in alert state (chasing the Runner), the Whisper should see visual feedback:
- The guard's color on the blueprint should change (brighter red, pulsing)
- A "! ALERT" label near the guard on the blueprint
- This should already be handled if the Whisper view reads `guard.state` from the game state — just confirm the whisper-view.ts renderer handles different guard states visually.

If not already implemented in Milestone 4, add to `renderWhisperEntities()` in whisper-view.ts:
```typescript
// Guard state-dependent rendering:
if (guard.state === "alert") {
  // Brighter red, larger radius, "!" icon
  ctx.fillStyle = "#FF0000";
  // Draw pulsing effect
} else if (guard.state === "suspicious") {
  ctx.fillStyle = "#FF8800";
  // Draw "?" icon
} else {
  ctx.fillStyle = "#FF4444";
}
```

## Key Technical Details

### Phase Transitions (Complete Flow)

```
Game Created → status: "waiting"
                ↓ (startGame mutation)
Planning Phase → phase: "planning", startTime set
                ↓ (30s countdown or manual skip)
Heist Phase → phase: "heist", heistStartTime set
                ↓ (one of three outcomes)
        ┌───────┼───────────┐
        ↓       ↓           ↓
    "escaped"  "caught"   "timeout"
        └───────┼───────────┘
                ↓
        status: "finished"
                ↓ (resetRoom mutation)
        status: "waiting" (back to lobby)
```

### Timer Synchronization

Both clients derive timers from server-provided timestamps (`startTime`, `heistStartTime`), so they stay in sync without any additional coordination. The server is the authority on timeout — the `checkTimeout` mutation uses `Date.now()` on the server to verify.

### Convex Schema Changes Summary

```typescript
// gameState table additions:
heistStartTime: v.optional(v.number()),  // When heist phase actually started

// Phase enum update:
phase: v.union(
  v.literal("planning"),
  v.literal("heist"),
  v.literal("escaped"),
  v.literal("caught"),
  v.literal("timeout")
)
```

### Results Screen Data

The ResultsScreen needs data that might not be in the current gameState. For MVP, keep it simple:
- `heistDuration`: calculated from `heistStartTime` to the current time (or time of game end)
- `itemName`: from `gameState.items[0].name`
- `hasItem`: from `gameState.runner.hasItem`
- No need to store additional stats in Convex for now — calculate client-side

### Play Again Flow

1. Player clicks "Play Again" on ResultsScreen
2. Calls `resetRoom` mutation → room status → "waiting"
3. Convex subscription fires → game page re-renders
4. Both players see the Lobby again (roles preserved from previous game)
5. They can swap roles or keep the same, ready up, and start a new game

## Files to Create
- `/src/components/ResultsScreen.tsx` — Post-game results display with stats, outcome, and play-again

## Files to Modify
- `/convex/schema.ts` — Add `heistStartTime` field, add `"timeout"` to phase union
- `/convex/game.ts` — Add `checkTimeout` mutation, update `startHeistPhase` to set `heistStartTime`
- `/convex/rooms.ts` — Add `resetRoom` mutation
- `/src/components/GameCanvas.tsx` — Planning countdown timer, auto-transition, stop loop on game end, remove inline end-game overlays
- `/src/components/HUD.tsx` — Countdown timer display (heist time remaining), urgency styling under 30s/10s
- `/src/app/game/[roomId]/page.tsx` — Handle "finished" room status, render ResultsScreen when game is over, query gameState at page level
- `/src/game/whisper-view.ts` — Guard state-dependent rendering (alert/suspicious visual feedback) if not already implemented

## How to Verify

1. `npx convex dev` runs without errors (schema changes and new mutations deploy)
2. `npm run build` succeeds
3. Open two browser tabs. Create a game, join, pick roles, start game.
4. **Planning countdown:** Both players see a 30-second countdown. The Whisper can place pings during planning. Either player can click "Start Heist!" to skip.
5. **Heist timer:** After planning ends, the HUD shows a 3:00 countdown timer ticking down.
6. **Timer urgency:** When under 30 seconds, the timer turns red and pulses. Under 10 seconds, it gets more intense.
7. **Timeout:** Let the timer run out → both players see the "Time's Up!" results screen with amber theme.
8. **Escape win:** In a new game, grab the item and exit before time runs out → both players see "You Escaped!" results screen with green theme, stealth rating stars, and elapsed time.
9. **Caught loss:** Get caught by a guard → both players see "Busted!" results screen with red theme.
10. **Results data:** Results screen shows correct time, item name, and whether the item was grabbed.
11. **Play Again:** Click "Play Again" on results screen → both players return to the lobby with their roles preserved. They can ready up and start a new game immediately.
12. **Home button:** Click "Home" → navigates to the landing page.
13. **Frozen game:** When the game ends, the Runner can no longer move and guards stop updating.
14. **Whisper sees end state:** The Whisper sees the same results screen as the Runner.

---

## Implementation Summary

### Files Modified
- **`/convex/schema.ts`** — Added `heistStartTime: v.optional(v.number())` field and `v.literal("timeout")` to the phase union
- **`/convex/game.ts`** — Updated `startHeistPhase` to set `heistStartTime` (instead of overwriting `startTime`); added `checkTimeout` mutation (server-authoritative timeout after 180s)
- **`/convex/rooms.ts`** — Added `resetRoom` mutation (resets room to "waiting", clears ready flags, preserves roles, deletes old gameState)
- **`/src/game/game-state.ts`** — Added `heistStartTime` to `LocalGameState` interface; linter tightened guard/ping/phase types
- **`/src/components/GameCanvas.tsx`** — Added planning countdown overlay (`PlanningOverlay` sub-component with 30s countdown from `startTime`); auto-transition to heist when countdown ends (Runner client); timeout checking every 1s during heist; game loop stops all updates when game ends (escaped/caught/timeout); inline fallback overlays kept for brief phase-to-finished transition window
- **`/src/components/HUD.tsx`** — Rewrote to use countdown timer (3:00 → 0:00) derived from `heistStartTime`; urgency styling at <30s (red + pulse) and <10s (larger + more intense pulse); both Runner and Whisper HUDs show countdown
- **`/src/app/game/[roomId]/page.tsx`** — Added `getGameState` query at page level; handles `room.status === "finished"` → renders `ResultsScreen`; passes game state data to ResultsScreen
- **`/src/game/whisper-view.ts`** — Enhanced guard state rendering: pulsing red glow + "! ALERT" label for alert state; "?" label for suspicious state; state-based colors for vision cone and body

### Files Created
- **`/src/components/ResultsScreen.tsx`** — Post-game results screen with three outcome themes (escaped/green, caught/red, timeout/amber); shows heist duration, stealth rating (1-3 stars for escaped), item status; "Play Again" button calls `resetRoom` → both players return to lobby; "Home" button navigates to `/`

### Key Design Decisions
- Timer synchronization: All timers derived from server-provided `startTime` and `heistStartTime` so both clients stay in sync
- Server-authoritative timeout: `checkTimeout` mutation verifies elapsed time server-side
- Planning auto-start: Runner client auto-transitions to heist when 30s planning countdown ends; either player can skip early via "Start Heist!" button
- Game freeze: Update loop returns early when game phase is escaped/caught/timeout, stopping all runner movement, guard AI ticks, and server sync
- Duration captured once at mount via `useState` initializer to avoid impure `Date.now()` calls during render

---

## Review Notes (b54e5d4c)

### Issues Found & Fixed

1. **`TEST_MAP` renamed to `FALLBACK_MAP` — build break** (`GameCanvas.tsx`): The map module had been renamed from `TEST_MAP` to `FALLBACK_MAP` (likely by the Milestone 7 map generation work), but `GameCanvas.tsx` still imported `TEST_MAP`. Replaced all 10 occurrences with `FALLBACK_MAP` to fix the build.

2. **Unused `startTime` prop in HUD** (`HUD.tsx`): The `HUDProps` interface declared `startTime: number` and `GameCanvas` passed it, but the HUD component never used it (it derives timers from `heistStartTime` instead). Removed the prop from the interface and the caller.

3. **Unsafe type cast for game outcome** (`page.tsx`): `gameState.phase` was cast with `as "escaped" | "caught" | "timeout"` which bypasses type safety. Replaced with an inline narrowing check (`gameState.phase === "escaped" || ...`) so TypeScript correctly narrows the type without an unsafe assertion.

4. **Missing CSS animations — `tailwindcss-animate` not installed** (`ResultsScreen.tsx`): Used `animate-in fade-in` and `zoom-in-95` classes which require the `tailwindcss-animate` plugin, which is not installed. Replaced with inline `style={{ animation: ... }}` referencing keyframes added to `globals.css`.

5. **Added `fade-in` and `scale-in` keyframes** (`globals.css`): Added the two animation keyframes needed by the ResultsScreen entrance animations.

### Verified
- `npm run build` passes
- `npm run lint` passes (no new warnings)
- All Convex schema/mutation changes look correct
- Phase transition flow is sound: planning → heist → escaped/caught/timeout → finished
- Timer synchronization uses server-provided timestamps correctly
- Server-authoritative timeout check prevents client-side manipulation
- ResultsScreen properly handles all three outcomes with distinct theming
- Play Again flow (resetRoom mutation) correctly resets state while preserving roles
