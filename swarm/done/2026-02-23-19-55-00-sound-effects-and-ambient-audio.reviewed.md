# Task: Sound Effects & Ambient Audio

## Overview

Add procedural sound effects and ambient audio to WhisperRun using the Web Audio API. Just like the procedural sprite system (Canvas 2D primitives, no external images), all sounds will be synthesized in the browser — no audio files to load.

Sound is the single biggest missing piece for game feel. The game is visually polished with sprites, animations, and atmosphere, but it's completely silent. Adding footsteps, guard alerts, item pickup jingles, and ambient background hum will transform the experience from "interactive prototype" to "actual game."

**Dependencies:** All milestones complete. This task only adds a new audio module and hooks into existing game events — no game logic changes.

## What to Build

### 1. Audio Engine (`/src/engine/audio.ts` — NEW FILE)

Create a lightweight procedural audio system built on the Web Audio API. The system should:
- Lazy-initialize an `AudioContext` on first user interaction (browsers require user gesture to start audio)
- Provide simple functions to play synthesized sound effects
- Include a master volume control
- Handle the AudioContext lifecycle (suspend/resume on page visibility)

```typescript
/**
 * Procedural audio engine for WhisperRun.
 *
 * All sounds are synthesized using Web Audio API oscillators,
 * noise buffers, and gain envelopes. No external audio files.
 */

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let initialized = false;

/** Call on first user interaction (click/keypress) to unlock audio */
export function initAudio(): void {
  if (initialized) return;
  audioCtx = new AudioContext();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.3; // default volume
  masterGain.connect(audioCtx.destination);
  initialized = true;
}

export function isAudioReady(): boolean {
  return initialized && audioCtx?.state === "running";
}

export function setMasterVolume(v: number): void {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v));
}

/** Resume audio context if suspended (e.g. after tab switch) */
export function resumeAudio(): void {
  if (audioCtx?.state === "suspended") audioCtx.resume();
}
```

### Sound Effects to Implement

Each sound effect is a small function that creates oscillators/noise, shapes them with gain envelopes, and auto-disconnects when done.

#### a) `playFootstep(crouching: boolean)`
- **Normal walk:** Short noise burst (10ms), bandpass-filtered around 200Hz, low volume. Alternate between two slight pitch variations for left/right foot feel.
- **Crouching:** Same but quieter (50% volume), slightly higher filter (softer sound).
- **Throttle:** Maximum 6 footsteps/second to prevent audio spam.

#### b) `playGuardFootstep()`
- Heavier footstep: Longer noise burst (15ms), lower bandpass (150Hz), slightly louder than runner footsteps.
- Only play when guard is within the Runner's visibility radius (caller is responsible for distance check).

#### c) `playAlertSound()`
- Guard spots the Runner: Quick ascending two-tone beep. Oscillator at 400Hz for 80ms, then 600Hz for 80ms. Square wave for a retro/alarm feel.
- Play once per alert event (not every frame).

#### d) `playSuspiciousSound()`
- Guard becomes suspicious: Single tone, 350Hz, triangle wave, 150ms, gentle fade out. Quieter than alert.

#### e) `playItemPickup()`
- Cheerful ascending arpeggio: Three quick notes (C5-E5-G5, ~80ms each), sine wave, medium volume. The "got the treasure" jingle.

#### f) `playExitUnlock()`
- Satisfying "door open" sound: Low tone (200Hz) sweeping up to 400Hz over 200ms, with a click (short noise burst) at the start.

#### g) `playPingSound(type: "go" | "danger" | "item")`
- **go (green):** Soft high-pitched blip, 800Hz sine, 50ms
- **danger (red):** Two rapid low blips, 300Hz square, 30ms each with 20ms gap
- **item (yellow):** Sparkly tone, 1000Hz sine with quick vibrato, 80ms

#### h) `playGameOverCaught()`
- Descending "wah wah" trombone: Sawtooth oscillator sliding from 400Hz to 200Hz over 500ms, with slight vibrato.

#### i) `playGameOverEscaped()`
- Victory fanfare: Quick ascending 4-note arpeggio (C4-E4-G4-C5), sine wave, 100ms per note, with a gentle sustain on the final note.

#### j) `playAmbientLoop()` / `stopAmbientLoop()`
- Very subtle background hum during the heist phase:
  - Low-frequency oscillator (60Hz, sine, very quiet ~5% volume)
  - Layered with filtered brown noise (extremely quiet) for "building HVAC" feel
  - Should loop seamlessly
  - Stored in a ref so it can be stopped when the heist ends

#### k) `playCountdownTick()`
- For the last 10 seconds of the heist timer: Short click sound, 1000Hz sine, 20ms. Gets slightly louder each tick.

#### l) `playCountdownUrgent()`
- For the last 3 seconds: Same as tick but with an added lower harmonic (500Hz) for urgency.

### 2. Hook Audio into GameCanvas (`/src/components/GameCanvas.tsx` — MODIFY)

Wire up sound triggers in the existing game loop. These are small additions — just calling audio functions at the right moments.

**a) Initialize audio on first interaction:**
```typescript
// In the game loop setup effect, add:
const handleFirstInteraction = () => {
  initAudio();
  window.removeEventListener("click", handleFirstInteraction);
  window.removeEventListener("keydown", handleFirstInteraction);
};
window.addEventListener("click", handleFirstInteraction);
window.addEventListener("keydown", handleFirstInteraction);
```

**b) Runner footsteps (in the movement section):**
```typescript
// After computing dx/dy and confirming runner is moving:
if (runnerMoving && isAudioReady()) {
  // Play footstep on each walk frame change (frames 1 and 3 = feet hitting ground)
  if (walkFrameRef.current === 1 || walkFrameRef.current === 3) {
    const prevFrame = /* track previous frame */;
    if (prevFrame !== walkFrameRef.current) {
      playFootstep(crouching);
    }
  }
}
```

**c) Guard footsteps (in the guard AI tick section):**
```typescript
// After updating guard position, if guard is within runner's visibility radius:
if (guardMoving && isAudioReady()) {
  const distToRunner = Math.hypot(result.x - gsm.localRunnerX, result.y - gsm.localRunnerY);
  if (distToRunner < 7) { // within ~7 tiles (visibility radius)
    // Throttle: only play if guard walk frame changed to 1 or 3
    const gFrame = guardWalkFrameRef.current[guard.id] ?? 0;
    if (gFrame === 1 || gFrame === 3) {
      playGuardFootstep();
    }
  }
}
```

**d) Guard state change sounds (in the event recording section):**
```typescript
// Where we already detect guard state transitions:
if (oldState !== "alert" && newState === "alert") {
  playAlertSound();
  // ... existing recorder.record
}
if (oldState !== "suspicious" && newState === "suspicious") {
  playSuspiciousSound();
}
```

**e) Item pickup sound:**
```typescript
// Where we detect item pickup for event recording:
if (state.runner.hasItem && !prevHasItem) {
  playItemPickup();
}
```

**f) Ping sounds (in the click handler):**
```typescript
// After addPingRef.current(...):
playPingSound(selectedPingTypeRef.current);
```

**g) Ambient loop management:**
```typescript
// When heist phase begins:
if (state.phase === "heist" && prevPhase !== "heist") {
  playAmbientLoop();
}
// When game ends:
if (isGameOver) {
  stopAmbientLoop();
  if (state.phase === "escaped") playGameOverEscaped();
  if (state.phase === "caught") playGameOverCaught();
}
```

**h) Countdown sounds (in the timeout check section or the HUD timer):**
Add countdown tick sounds in the game loop when remaining time is < 10 seconds. Track a `lastCountdownSecond` ref to play exactly once per second.

```typescript
if (state.phase === "heist" && state.heistStartTime) {
  const elapsed = Date.now() - state.heistStartTime;
  const remaining = Math.max(0, 180_000 - elapsed);
  const remainingSec = Math.ceil(remaining / 1000);
  if (remainingSec <= 10 && remainingSec !== lastCountdownSecRef.current) {
    lastCountdownSecRef.current = remainingSec;
    if (remainingSec <= 3) playCountdownUrgent();
    else playCountdownTick();
  }
}
```

### 3. Mute Button (`/src/components/HUD.tsx` — SMALL MODIFY)

Add a small mute/unmute toggle button in the corner of the HUD. This is important for accessibility and because some players will be on voice chat.

```tsx
// Add to both Runner and Whisper HUD, top-left area:
<button
  onClick={() => {
    const newMuted = !muted;
    setMuted(newMuted);
    setMasterVolume(newMuted ? 0 : 0.3);
  }}
  className="pointer-events-auto bg-black/30 text-[#E8D5B7]/50 px-2 py-1 rounded text-xs
             hover:text-[#E8D5B7] transition-colors cursor-pointer"
>
  {muted ? "🔇" : "🔊"}
</button>
```

The muted state should be stored in localStorage so it persists across sessions.

### 4. Audio Resume on Visibility Change (`/src/components/GameCanvas.tsx`)

Browsers suspend AudioContext when the tab is backgrounded. Add a visibility change handler:

```typescript
useEffect(() => {
  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      resumeAudio();
    }
  };
  document.addEventListener("visibilitychange", handleVisibility);
  return () => document.removeEventListener("visibilitychange", handleVisibility);
}, []);
```

## Key Technical Details

### Web Audio API Synthesis Patterns

**Noise burst (footsteps):**
```typescript
function createNoiseBurst(duration: number, frequency: number): void {
  if (!audioCtx || !masterGain) return;
  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = 1;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

  source.connect(filter).connect(gain).connect(masterGain);
  source.start();
  source.stop(audioCtx.currentTime + duration);
}
```

**Tone with envelope (alerts, pickups):**
```typescript
function playTone(freq: number, duration: number, type: OscillatorType = "sine", volume = 0.2): void {
  if (!audioCtx || !masterGain) return;
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

  osc.connect(gain).connect(masterGain);
  osc.start();
  osc.stop(audioCtx.currentTime + duration + 0.01);
}
```

### Performance Considerations

- All synthesized sounds are short-lived — oscillators and buffers are created per-play and auto-garbage-collected
- Footstep throttling (max 6/sec for runner, 4/sec for guards) prevents audio node buildup
- The ambient loop uses only 2 always-on oscillators — negligible CPU
- Guard footsteps are distance-gated — only synthesized when audible

### No Changes to Game Logic

This task adds a new file (`audio.ts`) and makes small additions to `GameCanvas.tsx` and `HUD.tsx`. It does NOT modify:
- Convex mutations or queries
- Guard AI or detection logic
- Movement, collision, or map generation
- Scoring, events, or highlights
- The Renderer, Camera, or any visual rendering

## Files to Create

- `/src/engine/audio.ts` — Complete procedural audio engine with all sound effect functions

## Files to Modify

- `/src/components/GameCanvas.tsx` — Hook audio triggers into game loop (init, footsteps, alerts, ambient, countdown)
- `/src/components/HUD.tsx` — Add mute/unmute toggle button with localStorage persistence

## How to Verify

1. `npm run build` succeeds with no type errors.
2. `npm run lint` passes.
3. Open the game in a browser. Click or press a key (this initializes audio).
4. Create a game and start playing as Runner:
   - **Footsteps:** Hear soft "tap tap" sounds when walking. Quieter when crouching.
   - **Guard footsteps:** Hear slightly heavier footsteps when a guard is nearby (within visibility).
   - **Alert sound:** Hear a sharp two-tone beep when a guard spots you.
   - **Suspicious sound:** Hear a softer single tone when a guard becomes suspicious.
   - **Item pickup:** Hear a cheerful ascending arpeggio when picking up the item.
   - **Ambient hum:** A very subtle low hum plays during the heist phase.
   - **Countdown:** In the last 10 seconds, hear tick sounds. Last 3 seconds are more urgent.
   - **Game over:** Hear either a victory fanfare (escaped) or sad trombone (caught).
5. Play as Whisper:
   - **Ping sounds:** Hear different blips for go/danger/item pings.
   - **Countdown:** Same countdown ticks as Runner.
6. **Mute button:** A small mute toggle in the HUD corner works. Toggling mutes all sounds. Setting persists across page reloads.
7. **Tab switching:** Audio resumes correctly after switching tabs and back.
8. **Performance:** No audio glitches, no frame drops from audio processing.
9. **Volume:** All sounds are subtle and non-intrusive. The ambient hum is barely perceptible. Nothing startles the player.

---

## Completion Summary

### What was built

Complete procedural audio system for WhisperRun using Web Audio API — all sounds are synthesized in the browser with no external audio files.

### Files Created

- **`/src/engine/audio.ts`** — Full procedural audio engine with:
  - AudioContext lazy initialization on first user interaction
  - Master volume control with mute support
  - `playFootstep(crouching)` — noise burst with left/right alternation, throttled to 6/sec
  - `playGuardFootstep()` — heavier noise burst, throttled to 4/sec
  - `playAlertSound()` — ascending two-tone square wave beep
  - `playSuspiciousSound()` — soft triangle wave tone
  - `playItemPickup()` — cheerful C5-E5-G5 arpeggio
  - `playExitUnlock()` — low sweep 200→400Hz with initial click
  - `playPingSound(type)` — go/danger/item ping blips
  - `playGameOverCaught()` — descending sawtooth "wah wah" with vibrato
  - `playGameOverEscaped()` — C4-E4-G4-C5 victory fanfare
  - `playAmbientLoop()` / `stopAmbientLoop()` — 60Hz hum + brown noise HVAC
  - `playCountdownTick()` / `playCountdownUrgent()` — timer countdown sounds
  - `resumeAudio()` — handles tab visibility changes

### Files Modified

- **`/src/components/GameCanvas.tsx`** — Hooked all audio triggers:
  - Audio init on first click/keypress
  - Visibility change handler for audio resume
  - Runner footstep sounds synced to walk animation frames 1 & 3
  - Guard footstep sounds when within 7 tiles of runner
  - Alert and suspicious sounds on guard state transitions
  - Item pickup jingle
  - Exit unlock sound
  - Ping sounds for whisper click-to-ping
  - Ambient loop start/stop on heist phase transitions
  - Game over victory/defeat sounds
  - Countdown tick/urgent sounds in last 10 seconds
  - Ambient loop cleanup on component unmount

- **`/src/components/HUD.tsx`** — Added MuteButton component:
  - Mute/unmute toggle with speaker emoji icons
  - localStorage persistence for mute preference
  - Themed for both Runner (#E8D5B7) and Whisper (#8BB8E8) views
  - Placed in top-left alongside phase indicator in both HUD variants

### Verification

- `npm run build` — passes with no errors
- `npm run lint` — passes (only pre-existing warnings in generated Convex files)
- No game logic changes — purely additive audio layer
- No Convex schema/mutation changes

---

## Review Notes (Reviewer: 1668b8c2)

### Issues Found & Fixed

1. **Bug: Guard footsteps fired every frame instead of on frame transitions** (`GameCanvas.tsx:720-729`)
   - Guard footstep sounds were triggered every frame the guard's walk frame was 1 or 3, rather than only on the transition to those frames. The runner footstep code correctly checked `prevWalkFrame !== curFrame`, but the guard code did not.
   - The 250ms throttle in `playGuardFootstep()` mitigated the impact, but it still caused unnecessary audio node creation and slightly more frequent footsteps than intended.
   - **Fix:** Added `prevGFrame` tracking to guard walk animation, so `playGuardFootstep()` only fires on actual frame transitions (matching the runner footstep pattern).

2. **Minor: Ambient noise bypassed `ambientGain`** (`audio.ts:265`)
   - The brown noise buffer was connected through its own gain node directly to `masterGain`, bypassing the `ambientGain` node. This meant the ambient gain node only controlled the hum oscillator, not the noise.
   - **Fix:** Routed noise through `ambientGain` so both ambient components can be controlled together.

3. **Minor: Ambient nodes not disconnected on stop** (`audio.ts:270-280`)
   - `stopAmbientLoop()` called `.stop()` on nodes but didn't call `.disconnect()`, leaving them connected to the audio graph until garbage collected.
   - **Fix:** Added `.disconnect()` calls for `ambientOsc`, `ambientNoise`, and `ambientGain` in `stopAmbientLoop()`.

### What Looked Good

- Clean procedural audio implementation — all sounds are synthesized via Web Audio API with no external files
- Proper footstep throttling for runner (6/sec) and guards (4/sec)
- AudioContext lazy init on first user interaction (required by browsers)
- Visibility change handler for audio resume after tab switch
- MuteButton with localStorage persistence, themed per role
- Clean ambient loop with brown noise + low hum for HVAC feel
- Countdown tick/urgent sounds properly track `lastCountdownSec` to fire once per second
- All audio triggers are correctly gated behind `isAudioReady()`
- Game over sounds properly stop ambient loop first
- Component unmount cleanup calls `stopAmbientLoop()`

### Build & Lint

- `npm run build` — passes
- `npm run lint` — passes (only pre-existing warnings in Convex generated files)
