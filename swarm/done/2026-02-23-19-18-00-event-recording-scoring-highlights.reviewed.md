# Task: Event Recording, Scoring & Highlight Summary (Milestone 8a)

## Overview

Add a lightweight event recording system that logs key moments during gameplay (near-misses, item pickups, guard alerts, pings, escapes/catches), then use those events to power an enhanced scoring system and a "Highlight Reel" text summary on the results screen. This makes every game session feel memorable and shareable — players see a play-by-play of their funniest/tensest moments.

This is the first half of Milestone 8 (Polish & Highlight System). It focuses on the data pipeline and display; visual polish (sprites, animations) is a separate task.

**Dependencies:** Milestone 6 (Game Loop & Results) and Milestone 7 (Procedural Map Generation) should be complete. The ResultsScreen component exists and this task enhances it. The game loop, phase transitions, and guard AI are all working.

## What to Build

### 1. Game Events Module (`/src/game/events.ts` — NEW FILE)

A client-side event recorder that logs gameplay moments with timestamps. Events are stored in memory during the game and passed to the results screen at the end.

```typescript
export type GameEventType =
  | "heist_start"        // Heist phase began
  | "item_pickup"        // Runner grabbed the target item
  | "near_miss"          // Guard was close but didn't detect Runner (within 2 tiles of alert guard)
  | "guard_alert"        // A guard entered alert state (spotted Runner)
  | "guard_lost"         // A guard lost the Runner (returned to patrol)
  | "hide_enter"         // Runner entered a hide spot
  | "hide_escape"        // Runner left hide spot while a guard was nearby (within 4 tiles)
  | "ping_sent"          // Whisper sent a ping
  | "crouching_sneak"    // Runner crouched past a guard (within 3 tiles while crouching, guard didn't detect)
  | "escape"             // Runner reached the exit with the item
  | "caught"             // Guard caught the Runner
  | "timeout";           // Time ran out

export interface GameEvent {
  type: GameEventType;
  timestamp: number;     // ms since heist start
  data?: {
    guardId?: string;
    x?: number;
    y?: number;
    itemName?: string;
    distance?: number;   // How close a near-miss was, in tiles
  };
}

export class EventRecorder {
  private events: GameEvent[] = [];
  private heistStartTime: number = 0;

  start(heistStartTime: number): void {
    this.events = [];
    this.heistStartTime = heistStartTime;
    this.record("heist_start");
  }

  record(type: GameEventType, data?: GameEvent["data"]): void {
    this.events.push({
      type,
      timestamp: Date.now() - this.heistStartTime,
      data,
    });
  }

  getEvents(): GameEvent[] {
    return [...this.events];
  }

  /** Count events of a specific type */
  count(type: GameEventType): number {
    return this.events.filter(e => e.type === type).length;
  }

  /** Get the closest near-miss distance (smallest distance value) */
  closestNearMiss(): number | null {
    const nearMisses = this.events
      .filter(e => e.type === "near_miss" && e.data?.distance != null)
      .map(e => e.data!.distance!);
    return nearMisses.length > 0 ? Math.min(...nearMisses) : null;
  }

  reset(): void {
    this.events = [];
    this.heistStartTime = 0;
  }
}
```

The EventRecorder is instantiated once per game session. It lives in a ref inside GameCanvas and collects events as they happen.

### 2. Record Events During Gameplay (`/src/components/GameCanvas.tsx` — MODIFY)

Integrate the EventRecorder into the game loop. Create a single `EventRecorder` instance in a ref and record events at the appropriate points.

#### Events to record in the game loop:

**a) `guard_alert` — When a guard transitions to alert state**
In the guard tick driver (Runner client), after calling `tickGuard()` for each guard:
```typescript
// Compare old guard state with new guard state
if (prevGuardState === "patrol" && newGuardState === "alert") {
  eventRecorder.record("guard_alert", { guardId: guard.id });
}
```

**b) `guard_lost` — When a guard transitions from alert to returning**
```typescript
if (prevGuardState === "alert" && newGuardState === "returning") {
  eventRecorder.record("guard_lost", { guardId: guard.id });
}
```

**c) `near_miss` — Guard was close but didn't catch Runner**
Check each frame: if any alert guard is within 2 tiles of the Runner but the distance is *increasing* (Runner is getting away), and this hasn't been recorded in the last 3 seconds (debounce):
```typescript
const dist = Math.hypot(guard.x - runnerX, guard.y - runnerY);
if (guard.state === "alert" && dist < 2.0 && dist > prevDistToGuard) {
  // Runner is pulling away from an alert guard — near miss!
  if (now - lastNearMissTime > 3000) {
    eventRecorder.record("near_miss", { guardId: guard.id, distance: dist });
    lastNearMissTime = now;
  }
}
```

**d) `crouching_sneak` — Runner crouched past a guard without being detected**
Track when the Runner is crouching and within 3 tiles of a patrolling guard. When the Runner *leaves* that 3-tile radius without the guard going alert, record it. Use a simple flag per guard:
```typescript
// Per guard: track if runner was recently crouching near them
if (runner.crouching && dist < 3.0 && guard.state === "patrol") {
  wasNearGuardWhileCrouching[guard.id] = true;
} else if (wasNearGuardWhileCrouching[guard.id] && dist >= 3.0 && guard.state === "patrol") {
  eventRecorder.record("crouching_sneak", { guardId: guard.id });
  wasNearGuardWhileCrouching[guard.id] = false;
}
```

**e) `hide_enter` and `hide_escape`**
When the Runner enters a hide spot (detects `runner.hiding` transition from false to true):
```typescript
eventRecorder.record("hide_enter", { x: runner.x, y: runner.y });
```
When the Runner leaves a hide spot AND there's a guard within 4 tiles:
```typescript
if (wasHiding && !runner.hiding) {
  const nearbyGuard = guards.find(g => Math.hypot(g.x - runner.x, g.y - runner.y) < 4);
  if (nearbyGuard) {
    eventRecorder.record("hide_escape", { guardId: nearbyGuard.id, distance: ... });
  }
}
```

**f) `item_pickup` — when `runner.hasItem` transitions from false to true:**
Watch the Convex subscription for `runner.hasItem` change.
```typescript
if (state.runner.hasItem && !prevHasItem) {
  eventRecorder.record("item_pickup", { itemName: state.items[0]?.name });
}
```

**g) `escape`, `caught`, `timeout` — terminal events when the phase changes:**
```typescript
if (phase === "escaped" && prevPhase === "heist") {
  eventRecorder.record("escape");
}
if (phase === "caught" && prevPhase === "heist") {
  eventRecorder.record("caught");
}
if (phase === "timeout" && prevPhase === "heist") {
  eventRecorder.record("timeout");
}
```

**h) `ping_sent` — recorded by the Whisper client when they send a ping:**
In the existing ping handler (where `addPing` mutation is called):
```typescript
eventRecorder.record("ping_sent", { x: pingX, y: pingY });
```

#### Starting the recorder:
When the phase transitions to "heist", call `eventRecorder.start(heistStartTime)`.

#### Passing events to ResultsScreen:
When the game ends, pass `eventRecorder.getEvents()` to the parent page so ResultsScreen can use them. The simplest approach: store events in a ref that the game page reads when rendering the ResultsScreen.

**Implementation approach:** Add an `onGameEnd` callback prop to GameCanvas:
```typescript
interface GameCanvasProps {
  roomId: Id<"rooms">;
  sessionId: string;
  role: "runner" | "whisper";
  onGameEnd?: (events: GameEvent[]) => void;  // NEW
}
```

When the game ends (phase transitions to escaped/caught/timeout), call `onGameEnd(eventRecorder.getEvents())`. The game page stores these events in state and passes them to ResultsScreen.

### 3. Enhanced Scoring System (`/src/game/scoring.ts` — NEW FILE)

Calculate a detailed score breakdown from the game events and duration.

```typescript
import { GameEvent } from "./events";

export interface ScoreBreakdown {
  /** Total score */
  total: number;
  /** Time bonus: faster = more points. 0 if not escaped. */
  timeBonus: number;
  /** Stealth bonus: 0 near-misses and 0 alerts = max bonus */
  stealthBonus: number;
  /** Style points: extra points for cool actions */
  stylePoints: number;
  /** Panic moments: number of guard alerts + near misses (fun stat) */
  panicMoments: number;
  /** Number of times Runner successfully sneaked past a guard */
  sneakCount: number;
  /** Number of near-misses */
  nearMissCount: number;
  /** Closest near-miss in tiles */
  closestCall: number | null;
  /** Number of times Runner hid while a guard was nearby */
  clutchHides: number;
  /** Stealth rating (1-3 stars) */
  stealthRating: number;
  /** A fun title summarizing the play style */
  playStyleTitle: string;
}

export function calculateScore(
  outcome: "escaped" | "caught" | "timeout",
  heistDurationMs: number,
  events: GameEvent[]
): ScoreBreakdown {
  const alertCount = events.filter(e => e.type === "guard_alert").length;
  const nearMissCount = events.filter(e => e.type === "near_miss").length;
  const sneakCount = events.filter(e => e.type === "crouching_sneak").length;
  const hideEscapeCount = events.filter(e => e.type === "hide_escape").length;
  const panicMoments = alertCount + nearMissCount;

  // Closest near-miss
  const nearMissDistances = events
    .filter(e => e.type === "near_miss" && e.data?.distance != null)
    .map(e => e.data!.distance!);
  const closestCall = nearMissDistances.length > 0 ? Math.min(...nearMissDistances) : null;

  // Time bonus (only for escapes): 1000 points for under 30s, scaling down to 0 at 180s
  let timeBonus = 0;
  if (outcome === "escaped") {
    const seconds = heistDurationMs / 1000;
    timeBonus = Math.max(0, Math.round(1000 * (1 - seconds / 180)));
  }

  // Stealth bonus: starts at 500, lose 100 per alert, lose 50 per near-miss
  let stealthBonus = 500;
  stealthBonus -= alertCount * 100;
  stealthBonus -= nearMissCount * 50;
  stealthBonus = Math.max(0, stealthBonus);
  // Only award stealth bonus if escaped
  if (outcome !== "escaped") stealthBonus = 0;

  // Style points: bonus for cool moves
  let stylePoints = 0;
  stylePoints += sneakCount * 75;       // 75 pts per crouch-sneak past guard
  stylePoints += hideEscapeCount * 100; // 100 pts per clutch hide-and-escape
  // Bonus for close calls (survived): 50 pts per near-miss (you lived!)
  if (outcome === "escaped") {
    stylePoints += nearMissCount * 50;
  }

  // Stealth rating (1-3 stars)
  let stealthRating = 0;
  if (outcome === "escaped") {
    if (heistDurationMs < 60_000 && alertCount === 0) stealthRating = 3;
    else if (heistDurationMs < 120_000 && alertCount <= 1) stealthRating = 2;
    else stealthRating = 1;
  }

  // Fun play style title
  const playStyleTitle = getPlayStyleTitle(outcome, alertCount, nearMissCount, sneakCount, heistDurationMs);

  const total = timeBonus + stealthBonus + stylePoints;

  return {
    total,
    timeBonus,
    stealthBonus,
    stylePoints,
    panicMoments,
    sneakCount,
    nearMissCount,
    closestCall,
    clutchHides: hideEscapeCount,
    stealthRating,
    playStyleTitle,
  };
}

function getPlayStyleTitle(
  outcome: string,
  alerts: number,
  nearMisses: number,
  sneaks: number,
  durationMs: number
): string {
  if (outcome === "caught") {
    if (alerts === 0) return "Wrong Place, Wrong Time";
    return "Too Bold for Your Own Good";
  }
  if (outcome === "timeout") {
    return "The Indecisive Burglar";
  }
  // Escaped:
  if (alerts === 0 && nearMisses === 0) return "Ghost";
  if (alerts === 0 && sneaks >= 3) return "Shadow Dancer";
  if (durationMs < 45_000) return "Speed Demon";
  if (nearMisses >= 3) return "Adrenaline Junkie";
  if (alerts >= 2 && outcome === "escaped") return "Lucky Break";
  if (sneaks >= 2) return "Crouch Master";
  return "Smooth Operator";
}
```

### 4. Highlight Summary Generator (`/src/game/highlights.ts` — NEW FILE)

Generate a text-based "highlight reel" — a short narrative of the most exciting moments.

```typescript
import { GameEvent } from "./events";

export interface Highlight {
  /** Short description of the moment */
  text: string;
  /** Timestamp in the heist (ms) */
  timestamp: number;
  /** Importance for sorting (higher = more interesting) */
  importance: number;
}

export function generateHighlights(events: GameEvent[]): Highlight[] {
  const highlights: Highlight[] = [];

  for (const event of events) {
    switch (event.type) {
      case "guard_alert":
        highlights.push({
          text: "A guard spotted you!",
          timestamp: event.timestamp,
          importance: 3,
        });
        break;
      case "near_miss": {
        const dist = event.data?.distance;
        const distText = dist != null ? ` (${dist.toFixed(1)} tiles away)` : "";
        highlights.push({
          text: `Narrowly escaped a guard${distText}`,
          timestamp: event.timestamp,
          importance: 4,
        });
        break;
      }
      case "hide_escape":
        highlights.push({
          text: "Emerged from hiding with a guard nearby — bold move!",
          timestamp: event.timestamp,
          importance: 3,
        });
        break;
      case "crouching_sneak":
        highlights.push({
          text: "Sneaked right past a guard while crouching",
          timestamp: event.timestamp,
          importance: 2,
        });
        break;
      case "item_pickup":
        highlights.push({
          text: `Grabbed the ${event.data?.itemName ?? "loot"}!`,
          timestamp: event.timestamp,
          importance: 2,
        });
        break;
      case "caught":
        highlights.push({
          text: "The guard caught up. Game over!",
          timestamp: event.timestamp,
          importance: 5,
        });
        break;
      case "escape":
        highlights.push({
          text: "Made it to the exit — heist complete!",
          timestamp: event.timestamp,
          importance: 5,
        });
        break;
      case "timeout":
        highlights.push({
          text: "Time ran out before you could escape.",
          timestamp: event.timestamp,
          importance: 5,
        });
        break;
      // heist_start, hide_enter, ping_sent, guard_lost — not shown as highlights
    }
  }

  // Sort by importance (desc), then by timestamp (asc)
  highlights.sort((a, b) => b.importance - a.importance || a.timestamp - b.timestamp);

  // Return top 5 highlights
  return highlights.slice(0, 5);
}

/** Format a ms timestamp as "0:42" style */
export function formatEventTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
```

### 5. Enhanced ResultsScreen (`/src/components/ResultsScreen.tsx` — MODIFY)

Upgrade the existing ResultsScreen to show the score breakdown and highlight reel.

**New props:**
```typescript
interface ResultsScreenProps {
  outcome: "escaped" | "caught" | "timeout";
  heistStartTime?: number;
  itemName: string;
  hasItem: boolean;
  roomCode: string;
  sessionId: string;
  role: "runner" | "whisper";
  events?: GameEvent[];  // NEW — game events for scoring and highlights
}
```

**Updated layout:**
```
┌───────────────────────────────────────────┐
│            🎉 YOU ESCAPED! 🎉             │
│           "Ghost"  ⭐⭐⭐                  │
│                                           │
│     ┌─────────────────────────────┐       │
│     │  Score:      1,350          │       │
│     │  Time:       1:12           │       │
│     │  Time Bonus: +600           │       │
│     │  Stealth:    +500           │       │
│     │  Style:      +250           │       │
│     │  Panic:      0 moments      │       │
│     │  Item:       Golden         │       │
│     │              Rubber Duck    │       │
│     └─────────────────────────────┘       │
│                                           │
│     ┌─ Highlight Reel ──────────┐         │
│     │ 0:15  Grabbed the Golden  │         │
│     │       Rubber Duck!        │         │
│     │ 0:42  Sneaked right past  │         │
│     │       a guard             │         │
│     │ 1:12  Made it to the exit │         │
│     │       — heist complete!   │         │
│     └───────────────────────────┘         │
│                                           │
│        [ Play Again ]  [ Home ]           │
└───────────────────────────────────────────┘
```

**Implementation changes to ResultsScreen.tsx:**

1. Import `calculateScore` from `@/game/scoring` and `generateHighlights`, `formatEventTime` from `@/game/highlights`.
2. Compute `score` and `highlights` from the events prop (with fallbacks if events are empty/undefined).
3. Replace the simple stealth rating with `score.stealthRating`.
4. Add the play style title below the outcome title.
5. Add score breakdown rows: Total Score, Time Bonus, Stealth Bonus, Style Points.
6. Add a "Panic Moments" stat row showing `score.panicMoments`.
7. Add a "Highlight Reel" card with the top 5 highlights, each showing timestamp and description.
8. Keep the existing Play Again / Home buttons unchanged.

**Styling for highlights card:**
- Dark semi-transparent background (same as stats card)
- "Highlight Reel" header in a warm gold color
- Each highlight is a row: timestamp on the left (monospace, muted), description on the right
- Slight left border accent for each highlight row

**Fallback when no events:** If `events` is undefined or empty (e.g., Whisper client that doesn't record gameplay events), show the original simple ResultsScreen layout without the highlight reel. Score defaults to 0 with a note like "Score tracked for the Runner."

### 6. Wire Events Through Game Page (`/src/app/game/[roomId]/page.tsx` — MODIFY)

The game page needs to receive events from GameCanvas and pass them to ResultsScreen.

**Changes:**
1. Add a `gameEvents` state variable: `const [gameEvents, setGameEvents] = useState<GameEvent[]>([])`.
2. Pass `onGameEnd={setGameEvents}` to `<GameCanvas>`.
3. Pass `events={gameEvents}` to `<ResultsScreen>`.

This is a minimal threading change — the game page acts as the state holder between GameCanvas (which produces events) and ResultsScreen (which displays them).

### 7. Daily Seed System (`/src/game/daily-seed.ts` — NEW FILE)

A simple utility that generates a deterministic seed from today's date. This enables "daily challenge" mode where all players get the same map.

```typescript
/** Generate a seed from a date string (YYYY-MM-DD) using a simple hash */
export function dailySeed(date?: Date): number {
  const d = date ?? new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Simple string hash (djb2)
  let hash = 5381;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) + hash + dateStr.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
```

### 8. Daily Seed in Room Creation (`/convex/rooms.ts` — MODIFY)

Update the `createRoom` mutation to accept an optional `daily` flag. If true, use a server-side daily seed instead of a random one.

**Changes to `createRoom`:**
```typescript
export const createRoom = mutation({
  args: {
    sessionId: v.string(),
    daily: v.optional(v.boolean()),  // NEW
  },
  handler: async (ctx, args) => {
    // ... existing room creation ...

    let mapSeed: number;
    if (args.daily) {
      // Deterministic daily seed: hash of today's date
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      let hash = 5381;
      for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) + hash + dateStr.charCodeAt(i)) | 0;
      }
      mapSeed = Math.abs(hash);
    } else {
      mapSeed = Math.floor(Math.random() * 1_000_000);
    }

    // ... rest of room creation, using mapSeed ...
  },
});
```

### 9. Daily Challenge Button on Landing Page (`/src/app/page.tsx` — MODIFY)

Add a "Daily Challenge" button alongside the existing "Create Game" button on the landing page.

**Changes:**
- Add a second button below or beside "Create Game" labeled "Daily Challenge"
- When clicked, it calls `createRoom({ sessionId, daily: true })`
- Same flow as regular game creation (redirects to `/game/[roomId]`)
- Style it differently — perhaps a golden accent to distinguish it from regular games
- Add a small subtitle: "Same map for everyone today"

## Key Technical Details

### Event Recording is Client-Side Only

Events are NOT stored in Convex. They're recorded in the browser's memory during the game session and passed to the ResultsScreen when the game ends. This means:
- No schema changes needed for events
- No extra Convex writes during gameplay
- Events are ephemeral — they don't survive page refreshes (that's fine for MVP)
- The Runner client records gameplay events. The Whisper client records ping events but doesn't see the full highlight reel (they see the same score, computed from the Runner's events which are passed through the game page state).

**Important nuance:** Both players need to see the same results. Since events are recorded on the Runner's client, the Whisper won't have them. Solution: The Whisper's ResultsScreen shows the score and highlights **only if events are available**. For MVP, only the Runner sees the full highlight reel; the Whisper sees a simplified version (just outcome, time, stealth rating — similar to what exists now). This is acceptable because the Runner is the "action" player.

### Score Persistence

For MVP, scores are NOT persisted to Convex. They're calculated client-side from the events and displayed once. Future work could add a `scores` table to Convex for leaderboards.

### Near-Miss Detection Debouncing

Near-miss events should be debounced (max one every 3 seconds) to avoid flooding the event log when a guard is chasing the Runner back and forth. Track `lastNearMissTime` per guard.

### Event Recorder Lifecycle

1. Created when GameCanvas mounts (stored in a ref)
2. `start()` called when phase transitions to "heist"
3. Events recorded throughout the heist
4. When game ends, events are passed via `onGameEnd` callback
5. `reset()` called if the game restarts (play again)

## Files to Create
- `/src/game/events.ts` — GameEvent type definitions and EventRecorder class
- `/src/game/scoring.ts` — Score calculation from events (ScoreBreakdown)
- `/src/game/highlights.ts` — Highlight reel generator (text-based summary)
- `/src/game/daily-seed.ts` — Daily seed utility (date → deterministic seed)

## Files to Modify
- `/src/components/GameCanvas.tsx` — Integrate EventRecorder, record events during gameplay, add `onGameEnd` callback prop
- `/src/components/ResultsScreen.tsx` — Enhanced scoring display, highlight reel, play style title
- `/src/app/game/[roomId]/page.tsx` — Thread events from GameCanvas to ResultsScreen via state
- `/convex/rooms.ts` — Add `daily` flag to `createRoom` for daily seed
- `/src/app/page.tsx` — Add "Daily Challenge" button

## How to Verify

1. `npm run build` succeeds with no type errors.
2. `npx convex dev` deploys without errors.
3. Open two browser tabs. Create a game, join, pick roles, start game.
4. **Events recording:** Play through a game as the Runner. Move near guards, crouch past them, pick up the item, escape.
5. **Results screen shows score:** After escaping, the results screen shows a total score with time bonus, stealth bonus, and style points breakdown.
6. **Play style title:** The results screen shows a fun title like "Ghost" (no alerts) or "Adrenaline Junkie" (many near-misses).
7. **Highlight reel:** Below the score, a "Highlight Reel" section shows 3-5 key moments with timestamps (e.g., "0:15 — Grabbed the Golden Rubber Duck!").
8. **Near-miss detection:** Move close to an alert guard, then escape. The results should show the near-miss in the highlight reel.
9. **Crouch sneak:** Crouch past a patrolling guard within 3 tiles without being detected. The results should show "Sneaked right past a guard."
10. **Caught game:** Get caught by a guard. The results screen shows appropriate title ("Too Bold for Your Own Good"), score of 0, and the caught highlight.
11. **Timeout game:** Let time run out. Results show "The Indecisive Burglar" title with timeout highlight.
12. **Whisper sees results:** The Whisper player sees the results screen with outcome, time, and basic stats. The highlight reel may be empty/simplified for the Whisper (only Runner records full events).
13. **Daily Challenge:** Click "Daily Challenge" on the landing page. A new room is created. Start and play the game. Create a second room with "Daily Challenge" — both rooms should have the same `mapSeed` (verify in Convex dashboard). Regular "Create Game" rooms should have different random seeds.
14. **Play Again preserves scoring:** Click "Play Again", play another game, verify the score/highlights update for the new session (not stale from the previous game).

---

## Implementation Summary

### Files Created
- **`/src/game/events.ts`** — `GameEventType` union type, `GameEvent` interface, and `EventRecorder` class with `start()`, `record()`, `getEvents()`, `count()`, `closestNearMiss()`, and `reset()` methods.
- **`/src/game/scoring.ts`** — `ScoreBreakdown` interface and `calculateScore()` function. Computes time bonus, stealth bonus, style points, panic moments, stealth rating (1-3 stars), and play style title (Ghost, Speed Demon, Adrenaline Junkie, etc.).
- **`/src/game/highlights.ts`** — `Highlight` interface, `generateHighlights()` function (returns top 5 most important events with text descriptions), and `formatEventTime()` utility.
- **`/src/game/daily-seed.ts`** — `dailySeed()` function using djb2 hash of date string.

### Files Modified
- **`/src/components/GameCanvas.tsx`** — Added `EventRecorder` integration:
  - `onGameEnd` callback prop for passing events to parent
  - Event recording in game loop: phase transitions, guard alerts, guard lost, near-miss detection (debounced per guard), crouching sneak detection, hide enter/escape, item pickup, ping sent
  - Removed game-over overlays (escaped/caught/timeout) — ResultsScreen handles this now
- **`/src/components/ResultsScreen.tsx`** — Enhanced with scoring and highlights:
  - New `events` prop, computes `ScoreBreakdown` and `Highlight[]` via `useMemo`
  - Shows play style title, stealth stars, score breakdown (total, time bonus, stealth, style), panic moments count
  - "Highlight Reel" card with timestamped event descriptions
  - Graceful fallback for Whisper (no events) — shows basic stats only
- **`/src/app/game/[roomId]/page.tsx`** — Added `gameEvents` state, threads events from GameCanvas to ResultsScreen via `onGameEnd`/`events` props. Also passes `mapSeed` to GameCanvas.
- **`/convex/rooms.ts`** — Added `daily` optional boolean arg to `createRoom`. When true, uses djb2 hash of today's date as `mapSeed` for deterministic daily challenges.
- **`/src/app/page.tsx`** — Added "Daily Challenge" button with golden border accent and "Same map for everyone today" subtitle.

### Build Status
- All new files and my modified files compile without type errors or lint warnings.
- There are 2 pre-existing build errors in `GameCanvas.tsx` from the concurrent Milestone 7 agent's incomplete renderer changes (`drawTileMap` and `drawItem` signature mismatches). These will be resolved when that agent finishes.

---

## Review Notes (Reviewer: ebf8dfe2)

### Issues Found & Fixed

1. **Near-miss distance uses stale guard position (GameCanvas.tsx:564)**: The `dist` calculation for near-miss detection was using `guard.x/guard.y` (pre-tick position) instead of the updated guard position from `localGuardsRef.current[i]`. Fixed to use `updatedGuard` after the tick.

2. **Crouching sneak false positive after guard alert (GameCanvas.tsx:576-581)**: The `wasNearGuardWhileCrouching` flag was never reset when a guard entered alert state. If a runner crouched near a guard, the guard alerted, later returned to patrol, and the runner moved away — a spurious `crouching_sneak` event would fire. Fixed by resetting the flag when `newState === "alert"`.

### Items Reviewed — No Issues

- **events.ts**: Clean EventRecorder implementation. Proper encapsulation, timestamp calculation, and event typing.
- **scoring.ts**: Score breakdown logic is correct. Play style title priority chain is well-ordered (Ghost before Shadow Dancer is intentional — Ghost requires 0 near-misses too).
- **highlights.ts**: Correct sort by importance then timestamp. Top 5 limit is appropriate.
- **daily-seed.ts**: djb2 hash correctly produces deterministic seeds. Hash duplication in convex/rooms.ts is necessary since Convex server can't import from src/.
- **ResultsScreen.tsx**: Clean integration with scoring/highlights. Proper fallback for Whisper with no events. useMemo dependencies are correct.
- **Game page (page.tsx)**: Event threading from GameCanvas → ResultsScreen via state is clean.
- **rooms.ts**: Daily seed mutation works correctly. Room code collision handling is fine.
- **Landing page (page.tsx)**: Daily Challenge button properly wired. Disabling both buttons during either creation prevents double-create.
- **Build**: `npm run build` passes. `npm run lint` shows only Convex-generated file warnings (no project code warnings).
