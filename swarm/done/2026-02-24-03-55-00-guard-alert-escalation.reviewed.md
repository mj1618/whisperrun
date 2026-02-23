# Task: Guard Alert Escalation (Radio Chatter)

## Overview

Currently, guards operate independently — when one guard spots the Runner, nearby guards remain completely unaware and continue patrolling. On maps with 2-3 guards (Standard/Hard), this means the Runner only needs to worry about one guard at a time, which undercuts the tension that multiple guards should create.

**Guard Alert Escalation** adds a "radio chatter" mechanic: when a guard transitions to the **alert** state (sees the Runner), nearby guards within a configurable radius hear the alert and become **suspicious**, investigating the alert location. This creates cascading tension — one guard spotting you can trigger a multi-guard response, making the Whisper's guidance and the Runner's hiding much more critical.

This mechanic is the foundation of compelling multi-guard gameplay. It turns "avoid one guard at a time" into "one mistake can snowball" — exactly the kind of high-stakes, clip-worthy moments the game is designed around. For the Whisper, it adds strategic depth: they can see which guards are responding and guide the Runner to safety before the net closes.

### Design Goals
- **Cascading tension:** One alert can ripple through nearby guards, creating "oh no" moments
- **Difficulty scaling:** More guards + larger alert radius on Hard = bigger cascading potential
- **Whisper-critical:** Whisper can see the cascading alerts and guide the Runner to hide before backup arrives
- **Not unfair:** Guards become *suspicious* (not alert), so the Runner has time to react. Suspicious guards investigate but don't chase at full speed
- **Visual feedback:** Both players see a brief radio wave visual when guards communicate, so the escalation is legible

## What to Build

### 1. Alert Escalation Logic in Guard AI (`/src/game/guard-ai.ts` — MODIFY)

Add a new exported function that processes alert escalation across all guards. This runs once per tick in GameCanvas, after all individual guard ticks.

```typescript
export const GUARD_ALERT_RADIUS = 8; // tiles — how far a guard's alert carries
export const GUARD_ESCALATION_COOLDOWN = 8000; // ms — prevent repeated cascading from same source

export interface EscalationEvent {
  sourceGuardId: string;
  targetGuardId: string;
  alertX: number;
  alertY: number;
  timestamp: number;
}

/**
 * After ticking all guards individually, check for alert escalation:
 * If any guard just transitioned to "alert" state this tick, nearby guards
 * in "patrol" or "returning" state become "suspicious" toward the alert location.
 *
 * Returns a list of escalation events (for visual/audio feedback).
 */
export function processAlertEscalation(
  guards: GuardData[],
  previousStates: Map<string, GuardState>,
  updates: Map<string, GuardUpdate>,
  now: number,
  escalationCooldowns: Map<string, number>, // guardId → earliest next escalation time
  alertRadius?: number
): EscalationEvent[] {
  const radius = alertRadius ?? GUARD_ALERT_RADIUS;
  const events: EscalationEvent[] = [];

  for (const guard of guards) {
    const prevState = previousStates.get(guard.id);
    const update = updates.get(guard.id);
    if (!update) continue;

    // Check if this guard just became alert (transition from non-alert → alert)
    const justBecameAlert = update.state === "alert" && prevState !== "alert";
    if (!justBecameAlert) continue;

    // This guard raised the alarm — check nearby guards
    for (const other of guards) {
      if (other.id === guard.id) continue;

      const otherUpdate = updates.get(other.id);
      if (!otherUpdate) continue;

      // Only escalate to guards that are currently patrolling or returning
      // (don't double-alert guards already suspicious or alert)
      if (otherUpdate.state !== "patrol" && otherUpdate.state !== "returning") continue;

      // Check cooldown — don't repeatedly escalate to the same guard
      const cooldownKey = `${guard.id}->${other.id}`;
      const cooldownUntil = escalationCooldowns.get(cooldownKey);
      if (cooldownUntil && now < cooldownUntil) continue;

      // Distance check
      const dx = other.x - guard.x;
      const dy = other.y - guard.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      // Escalate! Make the other guard suspicious toward the alert location
      const alertX = update.lastKnownX ?? guard.x;
      const alertY = update.lastKnownY ?? guard.y;

      otherUpdate.state = "suspicious";
      otherUpdate.lastKnownX = alertX;
      otherUpdate.lastKnownY = alertY;
      otherUpdate.stateTimer = now;

      // Set cooldown
      escalationCooldowns.set(cooldownKey, now + GUARD_ESCALATION_COOLDOWN);

      events.push({
        sourceGuardId: guard.id,
        targetGuardId: other.id,
        alertX,
        alertY,
        timestamp: now,
      });
    }
  }

  return events;
}
```

**Key design details:**
- Only triggers on the *transition* to alert state (patrol→alert or suspicious→alert), not every frame a guard is alert. Track previous states to detect transitions.
- Escalated guards become **suspicious**, not alert. They investigate the last-known position but don't chase at full speed. If they see the Runner themselves, they'll upgrade to alert through normal vision detection.
- **Cooldown per pair:** Prevents guard A from repeatedly escalating guard B. The 8-second cooldown means one cascade per encounter.
- **Radius-based, not LOS-based:** Guards communicate via "radio" (thematically), so walls don't block the escalation. This is simpler and creates more interesting gameplay than requiring line-of-sight between guards.
- Does NOT trigger for camera-alerted or laser-tripped guards going suspicious → only full "alert" (visual confirmation of Runner) triggers the cascade. This means cameras and lasers create localized threats, while a direct sighting creates a team response.

### 2. Integrate Escalation into Game Loop (`/src/components/GameCanvas.tsx` — MODIFY)

In the game loop where guards are ticked, add the escalation step:

1. **Before ticking guards:** Save each guard's current state into a `previousStates` map.
2. **Tick all guards individually** (existing code).
3. **After all ticks:** Call `processAlertEscalation()` with the previous states and current updates.
4. **Store escalation events** for visual rendering and audio playback.

You'll need to add module-level state:
```typescript
// Module-level (near other module-level state like lastLaserTripTime)
const escalationCooldowns = new Map<string, number>();
const activeEscalationEvents: Array<EscalationEvent & { fadeUntil: number }> = [];
```

In the guard tick loop:
```typescript
// 1. Save previous states
const previousStates = new Map<string, GuardState>();
for (const guard of gameState.guards) {
  previousStates.set(guard.id, guard.state as GuardState);
}

// 2. Tick guards individually (existing code)
const guardUpdates = new Map<string, GuardUpdate>();
for (const guard of gameState.guards) {
  const update = tickGuard(/* ... existing args ... */);
  guardUpdates.set(guard.id, update);
}

// 3. Process alert escalation
const escalations = processAlertEscalation(
  gameState.guards as GuardData[],
  previousStates,
  guardUpdates,
  now,
  escalationCooldowns,
  diffConfig?.guardAlertRadius  // optional difficulty-based radius
);

// 4. Handle escalation feedback
for (const esc of escalations) {
  // Record event for scoring
  eventRecorder.record("guard_escalation", {
    sourceGuardId: esc.sourceGuardId,
    targetGuardId: esc.targetGuardId,
    x: esc.alertX,
    y: esc.alertY,
  });

  // Store for visual rendering (1.5s fade)
  activeEscalationEvents.push({ ...esc, fadeUntil: now + 1500 });

  // Play radio chatter sound
  audioEngine?.playRadioChatter();
}

// Clean up expired visual events
for (let i = activeEscalationEvents.length - 1; i >= 0; i--) {
  if (now >= activeEscalationEvents[i].fadeUntil) {
    activeEscalationEvents.splice(i, 1);
  }
}

// 5. Apply guard updates (existing code)
```

### 3. Difficulty Config for Alert Radius (`/src/game/difficulty.ts` — MODIFY)

Add `guardAlertRadius` to `DifficultyConfig`:

```typescript
export interface DifficultyConfig {
  // ... existing fields ...
  guardAlertRadius: number;
}
```

Values:
```typescript
casual: {
  // ...existing...
  guardAlertRadius: 0,  // No escalation — only 1 guard on casual anyway
},
standard: {
  // ...existing...
  guardAlertRadius: 8,  // Moderate radius — guards nearby will respond
},
hard: {
  // ...existing...
  guardAlertRadius: 12, // Large radius — almost all guards on the map will hear
},
```

Setting casual to 0 disables escalation entirely (which makes sense since casual has only 1 guard). Standard and Hard have 2 and 3 guards respectively, so escalation becomes increasingly impactful.

### 4. Radio Chatter Sound (`/src/engine/audio.ts` — MODIFY)

Add a `playRadioChatter()` method. The sound should be a brief static-burst + voice-like chirp, evoking a walkie-talkie transmission. Keep it short (~0.3s) and distinct from other alert sounds:

```typescript
playRadioChatter(): void {
  if (this.muted || !this.ctx) return;
  const now = this.ctx.currentTime;

  // Static burst (white noise via oscillator detuning trick)
  const static1 = this.ctx.createOscillator();
  static1.type = "sawtooth";
  static1.frequency.setValueAtTime(3000, now);
  static1.frequency.linearRampToValueAtTime(100, now + 0.05);

  const staticGain = this.ctx.createGain();
  staticGain.gain.setValueAtTime(0.12, now);
  staticGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

  static1.connect(staticGain);
  staticGain.connect(this.masterGain ?? this.ctx.destination);
  static1.start(now);
  static1.stop(now + 0.08);

  // Walkie-talkie chirp (two quick tones)
  const chirp = this.ctx.createOscillator();
  chirp.type = "square";
  chirp.frequency.setValueAtTime(1400, now + 0.05);
  chirp.frequency.setValueAtTime(1800, now + 0.12);

  const chirpGain = this.ctx.createGain();
  chirpGain.gain.setValueAtTime(0.15, now + 0.05);
  chirpGain.gain.setValueAtTime(0.15, now + 0.12);
  chirpGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

  chirp.connect(chirpGain);
  chirpGain.connect(this.masterGain ?? this.ctx.destination);
  chirp.start(now + 0.05);
  chirp.stop(now + 0.25);
}
```

### 5. Radio Wave Visual Effect (Runner View — `/src/game/runner-view.ts` or renderer)

When an escalation event occurs, render a brief **radio wave** visual effect at the source guard's position. This is a small expanding circle with a radio icon appearance, visible within the Runner's fog-of-war:

- **Expanding concentric rings** from the alerting guard's position (2-3 rings, expanding over 1.5s)
- Color: orange/yellow tint (distinct from red guard alert indicators)
- Only visible if the guard is within the Runner's visibility radius
- Fades out over the 1.5s duration

The rendering function receives the `activeEscalationEvents` array and the current time. For each event:
```typescript
function drawEscalationWaves(
  ctx: CanvasRenderingContext2D,
  events: Array<{ sourceGuardId: string; alertX: number; alertY: number; timestamp: number; fadeUntil: number }>,
  guards: Array<{ id: string; x: number; y: number }>,
  now: number,
  camera: { x: number; y: number },
  tileSize: number
): void {
  for (const event of events) {
    const progress = 1 - (event.fadeUntil - now) / 1500; // 0 → 1
    const alpha = 1 - progress;

    // Find source guard position
    const sourceGuard = guards.find(g => g.id === event.sourceGuardId);
    if (!sourceGuard) continue;

    const sx = sourceGuard.x * tileSize - camera.x;
    const sy = sourceGuard.y * tileSize - camera.y;

    // Draw 2-3 expanding rings
    for (let ring = 0; ring < 3; ring++) {
      const ringProgress = Math.max(0, progress - ring * 0.15);
      const radius = ringProgress * 40;
      ctx.strokeStyle = `rgba(255, 180, 50, ${alpha * (1 - ring * 0.3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
```

### 6. Whisper View — Guard Communication Lines (`/src/game/whisper-view.ts` — MODIFY)

On the Whisper's blueprint view, when an escalation occurs, draw a brief **dashed line** between the alerting guard and the responding guard(s). This makes the communication visible and helps the Whisper understand the threat:

- Dashed orange line between source and target guard positions
- 1.5s duration, fading out
- Helps Whisper see "Guard A alerted Guard B" at a glance
- Labels optional, but the line itself is informative enough

### 7. Event Type for Scoring (`/src/game/events.ts` — MODIFY)

Add `"guard_escalation"` to `GameEventType`:

```typescript
export type GameEventType =
  | "heist_start"
  | "item_pickup"
  // ... existing types ...
  | "guard_escalation"  // NEW — guard alerted nearby guards
  | "escape"
  | "caught"
  | "timeout";
```

### 8. Scoring Integration (`/src/game/scoring.ts` — MODIFY)

Guard escalation events count as **panic moments** (same category as guard alerts and near-misses). Each escalation reduces the stealth rating:

- Add `"guard_escalation"` to the event types counted for panic moments
- Each escalation is worth -50 stealth points (less than a direct guard alert at -100, since it's a secondary effect)

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `/src/game/guard-ai.ts` | MODIFY | Add `processAlertEscalation()` function, constants, `EscalationEvent` type |
| `/src/components/GameCanvas.tsx` | MODIFY | Integrate escalation processing into guard tick loop, store visual events, pass to renderer |
| `/src/game/difficulty.ts` | MODIFY | Add `guardAlertRadius` to `DifficultyConfig` (0/8/12 for casual/standard/hard) |
| `/src/engine/audio.ts` | MODIFY | Add `playRadioChatter()` walkie-talkie sound |
| `/src/game/runner-view.ts` | MODIFY | Draw radio wave expanding rings at escalating guard positions |
| `/src/game/whisper-view.ts` | MODIFY | Draw dashed communication lines between escalating guards |
| `/src/game/events.ts` | MODIFY | Add `"guard_escalation"` to `GameEventType` |
| `/src/game/scoring.ts` | MODIFY | Count `guard_escalation` events as panic moments (-50 stealth) |

## Key Design Decisions (Already Made)

1. **Suspicious, not alert:** Escalated guards become suspicious (slower, investigates) rather than alert (chasing). This gives the Runner a fair chance to hide before backup arrives. If the backup guard then *sees* the Runner, they'll go alert through normal vision detection — creating a natural difficulty escalation.

2. **Radio-based (ignores walls):** Guards communicate via radio, not by shouting. This means walls don't block the escalation signal. It's simpler than LOS-based communication and creates more interesting gameplay: you can't just hide behind a wall to prevent guards from calling for backup.

3. **Only on visual contact (alert state):** Escalation only triggers when a guard sees the Runner directly (transitions to alert). Camera alerts and laser trips make guards suspicious but don't trigger radio escalation. This keeps cameras/lasers as localized threats and makes direct visual detection uniquely dangerous.

4. **Cooldown prevents spam:** The 8-second cooldown per guard pair prevents cascading loops (Guard A alerts Guard B, Guard B sees Runner and goes alert, Guard B alerts Guard A again). One radio call per encounter is enough.

5. **Casual has no escalation:** Casual difficulty has only 1 guard, so `guardAlertRadius: 0` effectively disables the mechanic. This keeps the feature from adding complexity to the simplest difficulty level.

6. **Visual and audio feedback:** Both players get clear feedback when escalation happens — the Runner hears the radio chirp and sees expanding rings, the Whisper sees communication lines on the blueprint. This makes the mechanic legible rather than mysterious.

7. **Scoring as panic moments:** Escalations count as minor panic moments (-50 stealth), reflecting that the situation is getting worse but isn't the Runner's direct fault. It's less punishing than a direct alert (-100) since the Runner didn't make a new mistake.

8. **No Convex changes needed:** Escalation is computed entirely client-side within the game tick loop. Guard state transitions are already synced — we just add a post-processing step that may modify guard updates before they're applied. No schema changes required.

## How to Verify

1. **`npm run build`** — Must compile with no errors
2. **`npm run lint`** — Must pass
3. **In browser (two tabs):**
   - Create a game on **Standard difficulty** (2 guards)
   - During heist, let one guard spot the Runner
   - **Expected:** The alerting guard goes to "alert" state. The second guard (if within 8 tiles) should transition to "suspicious" and start moving toward the alert location
   - **Radio chirp sound** should play when escalation triggers
   - **Runner view:** Should see orange expanding rings at the alerting guard (if visible in fog-of-war)
   - **Whisper view:** Should see a brief dashed orange line connecting the two guards
   - Wait for escalation to pass (guards return to patrol), then trigger another alert — second escalation should work (cooldown expired)
   - **Hard difficulty** (3 guards): One sighting should potentially alert both other guards if within radius (12 tiles on Hard)
   - **Casual difficulty:** Only 1 guard — no escalation should occur
4. **Scoring:** After a game where escalation happened, results screen should show escalation events as panic moments and slightly reduced stealth rating
5. **Edge cases:**
   - Guard sees Runner, goes alert → nearby guard already suspicious → should NOT re-escalate (only patrol/returning guards affected)
   - Two guards simultaneously see Runner → both go alert → should NOT cascade to each other (both already alert)
   - Guard goes alert, no other guards nearby → no escalation (radius check)

## Scope Boundaries

**DO:**
- Add alert escalation processing function in guard-ai.ts
- Integrate into game loop in GameCanvas.tsx
- Add difficulty config for alert radius
- Add radio chatter audio
- Add visual feedback (expanding rings for Runner, communication lines for Whisper)
- Add event type and scoring integration

**DO NOT:**
- Add guard-to-guard line-of-sight checks (radio doesn't need LOS)
- Add guard "call for help" voice lines or chat bubbles
- Add Whisper ability to jam guard radios (interesting future feature)
- Add guard coordination behaviors (flanking, surrounding) — that's a separate feature
- Change Convex schema (this is pure client-side logic)
- Add escalation for camera/laser alerts (only direct visual sighting triggers radio)
- Add guard type variations or specializations

---

## Implementation Summary

### Files Modified

| File | Changes |
|------|---------|
| `/src/game/difficulty.ts` | Added `guardAlertRadius` to `DifficultyConfig` interface and all three difficulty presets (0/8/12 tiles for casual/standard/hard) |
| `/src/game/events.ts` | Added `"guard_escalation"` to `GameEventType` union |
| `/src/game/guard-ai.ts` | Added `processAlertEscalation()` function, `EscalationEvent` interface, `GUARD_ALERT_RADIUS` and `GUARD_ESCALATION_COOLDOWN` constants |
| `/src/engine/audio.ts` | Added `playRadioChatter()` — walkie-talkie static burst + two-tone chirp sound |
| `/src/game/runner-view.ts` | Added `renderEscalationWaves()` — expanding orange concentric rings at alerting guard position (fog-of-war aware) |
| `/src/game/whisper-view.ts` | Added `renderEscalationLines()` — dashed orange communication lines between source/target guards with midpoint radio wave icon |
| `/src/components/GameCanvas.tsx` | Integrated escalation: saves previous guard states, calls `processAlertEscalation()` after guard ticks, manages visual events with 1.5s fade, plays radio chatter + suspicious sounds, records events, renders visuals in both Runner and Whisper views |
| `/src/game/scoring.ts` | Added `guard_escalation` counting as panic moments, -50 stealth per escalation |
| `CLAUDE.md` | Updated Guard Alert Escalation status from "In Progress" to "Completed" |

### What Was Built

- **Core escalation logic**: When a guard transitions to alert (sees the Runner), nearby guards in patrol/returning state become suspicious and investigate the alert location. Radio-based (ignores walls), only triggers on visual contact, not camera/laser alerts.
- **Difficulty scaling**: Casual (0 radius = disabled, only 1 guard anyway), Standard (8 tile radius), Hard (12 tile radius — nearly all guards respond).
- **Cooldown system**: 8-second cooldown per guard pair prevents cascading loops.
- **Radio chatter sound**: Distinct walkie-talkie static burst + two-tone chirp.
- **Runner view**: Expanding orange concentric rings at alerting guard position (only visible within fog-of-war).
- **Whisper view**: Dashed orange communication lines between source and target guards with midpoint radio wave icon.
- **Scoring**: Escalation events count as panic moments (-50 stealth each).
- **Build**: `npm run build` passes with no errors. `npm run lint` passes (only pre-existing warnings in generated files).

---

## Review Notes

**Reviewer:** Agent 12bf7cda — 2026-02-23

### Files Reviewed
All 8 modified files listed above were read and analyzed in full.

### Issues Found & Fixed

1. **Unused `guards` parameter in `processAlertEscalation()`** (`/src/game/guard-ai.ts`): The function had two guard array parameters — `guards: GuardData[]` and `currentGuards: GuardData[]` — but only `currentGuards` was ever used in the function body. Both loops iterated `currentGuards`, making the first parameter dead code. Removed the unused `guards` parameter and updated the call site in `GameCanvas.tsx` accordingly.

### Items Verified as Correct

- **Escalation logic**: Properly detects patrol→alert and suspicious→alert transitions using previousStates map. Only escalates to guards in patrol/returning state. Cooldown system correctly prevents cascading loops with per-pair 8s cooldown.
- **Direct mutation pattern**: `processAlertEscalation` directly mutates the guard objects (state, lastKnownX, lastKnownY, stateTimer) which is intentional since these are refs to localGuardsRef.current objects that will be applied in-place.
- **Difficulty scaling**: Casual=0 (disabled), Standard=8, Hard=12 tile radius — well-tuned for guard counts (1/2/3).
- **Audio synthesis**: `playRadioChatter()` properly creates and schedules oscillators with correct start/stop times and gain envelopes. No resource leaks.
- **Runner view rendering**: Fog-of-war awareness check via `distToRunner > fogRadius`. Uses camera.worldToScreen correctly. Canvas save/restore properly paired.
- **Whisper view rendering**: Dashed line with midpoint radio wave icon. Canvas save/restore properly paired. setLineDash properly reset before arc.
- **Scoring**: Escalation events counted as panic moments (-50 stealth each), correctly added alongside alerts, near-misses, and laser trips.
- **GameCanvas integration**: Previous states saved before guard ticks, escalation processed after all ticks, worst alert state re-checked after escalation modifies guards, expired visual events cleaned up properly.
- **Build**: Passes cleanly. Lint: Only pre-existing warnings in auto-generated Convex files.
