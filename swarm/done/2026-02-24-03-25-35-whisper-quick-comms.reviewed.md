# Task: Whisper Quick-Comm System

## Overview

The Whisper can see everything on the map but has limited ways to communicate urgency to the Runner. Currently the Whisper has **pings** (map markers with 5s fadeout) and **path drawing** (drawn routes). These are spatial tools — they say *where* but not *what* or *when*.

This task adds a **Quick-Comm system**: a set of predefined short messages the Whisper can send to the Runner. Messages appear as a large, prominent text overlay on the Runner's screen with a sound cue, then fade out. Think of it like the quick-chat in Rocket League or the ping wheel in Apex Legends — fast, expressive, no typing required.

This dramatically improves the co-op experience because:
- The Whisper can express urgency ("STOP!" / "GO NOW!") that pings can't convey
- It creates clip-worthy moments ("BEHIND YOU!" flashing as a guard rounds the corner)
- It's accessible on mobile (tap buttons instead of complex gestures)
- It deepens the asymmetric gameplay without adding voice chat

## What to Build

### 1. Quick-Comm Message Definitions (`/src/game/quick-comms.ts` — CREATE)

Create a new file with the message catalog and types:

```typescript
export interface QuickCommMessage {
  id: string;
  text: string;       // What appears on Runner's screen
  color: string;      // Color of the overlay text
  icon: string;       // Short emoji/symbol prefix
  key: string;        // Keyboard shortcut (Q + number shown in UI)
  sound: "urgent" | "info" | "celebrate";  // Sound category
  duration: number;   // How long the message shows (ms)
}

export const QUICK_COMM_MESSAGES: QuickCommMessage[] = [
  { id: "stop",       text: "STOP!",           color: "#FF4444", icon: "🛑", key: "Q", sound: "urgent",    duration: 2500 },
  { id: "go",         text: "GO NOW!",          color: "#44FF44", icon: "▶",  key: "W", sound: "info",      duration: 2000 },
  { id: "behind",     text: "BEHIND YOU!",      color: "#FF6B6B", icon: "⚠",  key: "E", sound: "urgent",    duration: 2500 },
  { id: "hide",       text: "HIDE!",            color: "#FFB74D", icon: "🫣", key: "R", sound: "urgent",    duration: 2000 },
  { id: "safe",       text: "You're safe",      color: "#81C784", icon: "✓",  key: "T", sound: "info",      duration: 2000 },
  { id: "nice",       text: "Nice move!",       color: "#FFD700", icon: "★",  key: "Y", sound: "celebrate", duration: 1800 },
];

export const QUICK_COMM_DURATION_MS = 3000; // Max display time
export const QUICK_COMM_COOLDOWN_MS = 1500; // Minimum time between sends (prevents spam)
```

### 2. Store Quick-Comms on Game State (`/convex/schema.ts` — MODIFY)

Add a `quickComm` field to the `gameState` table. Only one quick-comm is active at a time (latest wins), similar to how paths work. Use a single object rather than an array — this is simpler and prevents message pile-up.

```typescript
quickComm: v.optional(v.object({
  messageId: v.string(),
  createdAt: v.number(),
})),
```

Using `v.optional()` for backwards compatibility with existing game states.

### 3. Send Quick-Comm Mutation (`/convex/game.ts` — MODIFY)

Add a `sendQuickComm` mutation:

```typescript
export const sendQuickComm = mutation({
  args: {
    roomId: v.id("rooms"),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();

    if (!gameState) throw new Error("Game not found");
    if (gameState.phase !== "planning" && gameState.phase !== "heist") return;

    await ctx.db.patch(gameState._id, {
      quickComm: {
        messageId: args.messageId,
        createdAt: Date.now(),
      },
    });
  },
});
```

No server-side spam protection needed — the cooldown is enforced client-side, and even if someone bypasses it, the worst case is more messages which is harmless.

### 4. Quick-Comm Sound Effect (`/src/engine/audio.ts` — MODIFY)

Add a `playQuickCommSound` function that plays different sounds based on the message category:

```typescript
export function playQuickCommSound(category: "urgent" | "info" | "celebrate"): void {
  if (!audioCtx || !masterGain) return;
  switch (category) {
    case "urgent":
      // Two quick ascending tones (attention-grabbing)
      playTone(600, 0.1, "square", 0.25);
      playTone(800, 0.15, "square", 0.25, 0.1);
      break;
    case "info":
      // Soft single chime
      playTone(520, 0.2, "sine", 0.15);
      break;
    case "celebrate":
      // Happy ascending triple
      playTone(523, 0.1, "sine", 0.15);
      playTone(659, 0.1, "sine", 0.15, 0.1);
      playTone(784, 0.15, "sine", 0.15, 0.2);
      break;
  }
}
```

### 5. Quick-Comm Buttons for Whisper HUD (`/src/components/HUD.tsx` — MODIFY)

Add a quick-comm bar to the Whisper's HUD. Place it on the **left side** of the screen (vertically stacked), separate from the ping selector (bottom center). The Whisper clicks a button or presses the keyboard shortcut to send.

Add these props to `HUDProps`:
```typescript
onSendQuickComm?: (messageId: string) => void;
```

Add to `WhisperHUD`:
```tsx
{/* Quick-Comm buttons — left side, vertical stack */}
<div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-auto">
  <div className="flex flex-col gap-1.5 bg-[#0a0e1a]/80 p-2 rounded-xl border border-[#1e3a5f]">
    <div className="text-[#8BB8E8]/40 text-[10px] text-center mb-1">COMMS</div>
    {QUICK_COMM_MESSAGES.map((msg) => (
      <button
        key={msg.id}
        onClick={() => onSendQuickComm?.(msg.id)}
        className="min-w-[44px] min-h-[44px] px-2 py-1.5 rounded-lg text-xs font-bold
                   transition-all cursor-pointer hover:scale-105 active:scale-95
                   border border-transparent hover:border-current"
        style={{ color: msg.color, backgroundColor: msg.color + "15" }}
        title={`${msg.text} (${msg.key})`}
      >
        <span className="text-[10px] opacity-40 mr-1">{msg.key}</span>
        {msg.text}
      </button>
    ))}
  </div>
</div>
```

### 6. Keyboard Shortcuts for Whisper Quick-Comms (`/src/components/GameCanvas.tsx` — MODIFY)

In the existing keyboard handler for the Whisper role, add listeners for Q/W/E/R/T/Y keys to trigger quick-comms. These must NOT conflict with existing keybindings:
- Runner uses WASD, Shift, E/Space, H — no conflicts
- Whisper uses 1/2/3 (ping types), Shift+drag (path), H (help) — no conflicts with Q/W/E/R/T/Y

Important: Only the Whisper role should be able to send quick-comms. Check the role before handling.

Add cooldown tracking:
```typescript
const lastQuickCommRef = useRef(0);

function handleSendQuickComm(messageId: string) {
  const now = Date.now();
  if (now - lastQuickCommRef.current < QUICK_COMM_COOLDOWN_MS) return;
  lastQuickCommRef.current = now;
  sendQuickComm({ roomId, messageId });
}
```

In the keyboard handler (Whisper only):
```typescript
const commKeyMap: Record<string, string> = {
  KeyQ: "stop", KeyW: "go", KeyE: "behind",
  KeyR: "hide", KeyT: "safe", KeyY: "nice",
};
if (role === "whisper" && commKeyMap[e.code]) {
  handleSendQuickComm(commKeyMap[e.code]);
}
```

**IMPORTANT:** Since W is used for Runner movement (WASD), make sure this binding only fires for the Whisper role. The Whisper doesn't move, so WASD keys are free.

### 7. Runner Quick-Comm Display (`/src/components/GameCanvas.tsx` — MODIFY)

The Runner needs to see incoming quick-comms as a large, animated text overlay. Watch the `gameState.quickComm` field from the Convex subscription. When it changes (new `createdAt`), display the message.

Add state to track the currently-displayed message:
```typescript
const [activeComm, setActiveComm] = useState<{ id: string; text: string; color: string; icon: string; sound: string; expiresAt: number } | null>(null);
const lastCommRef = useRef(0);
```

In a `useEffect` watching `gameState?.quickComm`:
```typescript
useEffect(() => {
  if (!gameState?.quickComm) return;
  if (gameState.quickComm.createdAt <= lastCommRef.current) return; // Already shown
  lastCommRef.current = gameState.quickComm.createdAt;

  const msg = QUICK_COMM_MESSAGES.find(m => m.id === gameState.quickComm!.messageId);
  if (!msg) return;

  // Play sound
  playQuickCommSound(msg.sound);

  // Show overlay
  setActiveComm({
    id: msg.id,
    text: msg.text,
    color: msg.color,
    icon: msg.icon,
    sound: msg.sound,
    expiresAt: Date.now() + msg.duration,
  });

  // Auto-dismiss
  const timer = setTimeout(() => setActiveComm(null), msg.duration);
  return () => clearTimeout(timer);
}, [gameState?.quickComm]);
```

### 8. Quick-Comm Overlay Component (`/src/components/GameCanvas.tsx` — MODIFY)

Render the quick-comm overlay as a large text banner in the center of the Runner's screen. It should be attention-grabbing but not block gameplay:

```tsx
{/* Quick-Comm overlay — Runner sees Whisper messages */}
{activeComm && (
  <div
    className="fixed inset-0 z-20 pointer-events-none flex items-center justify-center"
    style={{ animation: "quick-comm-in 0.15s ease-out" }}
  >
    <div
      className="text-center px-8 py-4 rounded-2xl bg-black/40 backdrop-blur-sm border-2"
      style={{
        borderColor: activeComm.color + "80",
        animation: "quick-comm-pulse 0.5s ease-out",
      }}
    >
      <div
        className="text-3xl sm:text-4xl font-black tracking-wider uppercase"
        style={{
          color: activeComm.color,
          textShadow: `0 0 20px ${activeComm.color}60, 0 2px 4px rgba(0,0,0,0.5)`,
        }}
      >
        {activeComm.text}
      </div>
      <div className="text-xs mt-1 opacity-40" style={{ color: activeComm.color }}>
        — Whisper
      </div>
    </div>
  </div>
)}
```

Add the keyframe animations to `globals.css`:
```css
@keyframes quick-comm-in {
  0% { opacity: 0; transform: scale(1.3); }
  100% { opacity: 1; transform: scale(1); }
}

@keyframes quick-comm-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}
```

### 9. Whisper Sees Own Messages Too (`/src/components/GameCanvas.tsx` — MODIFY)

The Whisper should see a brief confirmation that their message was sent — a small text flash near the quick-comm buttons. Use the same `gameState.quickComm` watch but render it as a subtle toast rather than a full-screen overlay:

```tsx
{/* Whisper: quick-comm sent confirmation */}
{role === "whisper" && activeComm && (
  <div className="fixed bottom-20 left-4 z-20 pointer-events-none">
    <div
      className="text-sm font-bold px-3 py-1 rounded-lg bg-black/40"
      style={{ color: activeComm.color, animation: "fade-in 0.2s ease-out" }}
    >
      Sent: {activeComm.text}
    </div>
  </div>
)}
```

### 10. Mobile Support — Quick-Comm Touch Buttons

The quick-comm buttons in the Whisper HUD already use `min-w-[44px] min-h-[44px]` for touch targets, so they work on mobile out of the box. The vertical layout on the left side avoids conflicting with the ping selector at the bottom.

On very small screens (< 640px), consider making the button text shorter or using just the icon. Use responsive classes:

```tsx
<span className="hidden sm:inline">{msg.text}</span>
<span className="sm:hidden">{msg.icon}</span>
```

### 11. Event Recording for Quick-Comms (`/src/game/events.ts` — MODIFY)

Add a `"quick_comm"` event type so quick-comms show up in the highlight reel:

In the `GameEventType` union, add `"quick_comm"`.

When a quick-comm is received (in the Runner's useEffect), record it:
```typescript
eventRecorder?.record({
  type: "quick_comm",
  timestamp: Date.now(),
  data: { messageId: msg.id, text: msg.text },
});
```

Update `highlights.ts` to include a highlight entry for quick-comms like "Whisper shouted: BEHIND YOU!"

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `/src/game/quick-comms.ts` | CREATE | Quick-comm message definitions, types, constants |
| `/convex/schema.ts` | MODIFY | Add `quickComm` optional field to gameState table |
| `/convex/game.ts` | MODIFY | Add `sendQuickComm` mutation |
| `/src/engine/audio.ts` | MODIFY | Add `playQuickCommSound` function |
| `/src/components/HUD.tsx` | MODIFY | Add quick-comm buttons to Whisper HUD, add `onSendQuickComm` prop |
| `/src/components/GameCanvas.tsx` | MODIFY | Wire keyboard shortcuts, handle incoming comms, render overlay |
| `/src/app/globals.css` | MODIFY | Add `quick-comm-in` and `quick-comm-pulse` keyframe animations |
| `/src/game/events.ts` | MODIFY | Add `"quick_comm"` to event types |
| `/src/game/highlights.ts` | MODIFY | Add quick-comm highlight entries |

## Key Design Decisions (Already Made)

1. **6 predefined messages** — Enough variety without overwhelming the UI. Covers urgency, safety, and celebration. Not a free-text chat (that would be too slow and distract from gameplay).
2. **One message at a time** — Latest wins. No queue or stacking. Keeps it snappy.
3. **Whisper-only** — Only the Whisper can send quick-comms. The Runner is busy sneaking. (The Runner already communicates implicitly through movement.)
4. **1.5s cooldown** — Prevents spam but allows rapid communication in tense moments.
5. **Stored on gameState** — Uses the same Convex subscription pattern as pings and paths. No extra tables, no extra queries.
6. **Q/W/E/R/T/Y keys** — Easy to reach, don't conflict with Whisper's existing controls (1/2/3 for pings, Shift+drag for paths, H for help). Note: W conflicts with Runner WASD, but quick-comms only bind for the Whisper role.
7. **Sound cues** — Different sounds for urgent/info/celebrate so the Runner knows the tone without reading. Uses existing procedural audio system.
8. **Backwards compatible** — `v.optional()` on schema, old game states work fine without the field.

## How to Verify

1. **`npm run build`** — Must compile with no errors.
2. **`npm run lint`** — Must pass.
3. **In browser (two tabs):**
   - Create a game, assign Runner and Whisper roles, start game
   - **As Whisper:** See the quick-comm buttons on the left side of the screen
   - **As Whisper:** Click "STOP!" button → Runner sees "STOP!" overlay with red text, hears urgent sound
   - **As Whisper:** Press Q key → Same "STOP!" message sent
   - **As Whisper:** Press W key → "GO NOW!" in green
   - **As Whisper:** Try spamming → 1.5s cooldown prevents rapid-fire
   - **As Runner:** Messages appear centered, large, with glow effect
   - **As Runner:** Messages auto-dismiss after their duration
   - **As Runner:** New message replaces previous one instantly
   - **As Whisper:** See "Sent: STOP!" confirmation near buttons
   - **During planning phase:** Quick-comms work (useful for pre-heist coordination)
   - **During heist phase:** Quick-comms work (the main use case)
   - **After game ends:** Quick-comms stop working (phase check)
4. **Mobile testing:**
   - Touch the quick-comm buttons as Whisper — they work with proper touch targets
   - On small screens, buttons show icons instead of text
5. **Highlight reel:**
   - Complete a game where Whisper sent quick-comms
   - Results screen highlight reel shows entries like "Whisper shouted: BEHIND YOU!"
6. **Edge cases:**
   - Game state without `quickComm` field (old games) → no errors, feature just doesn't show
   - Whisper disconnects mid-message → Runner sees last message, no crash
   - Both players in same tab for testing → only Whisper role sees send buttons, only Runner role sees full overlay

## Scope Boundaries

**DO:**
- Create quick-comm message catalog
- Add quickComm field to gameState schema
- Add sendQuickComm Convex mutation
- Add quick-comm buttons to Whisper HUD
- Add keyboard shortcuts for Whisper (Q/W/E/R/T/Y)
- Add Runner overlay display with animations
- Add sound effects for each message category
- Add event recording for highlights
- Ensure mobile touch targets

**DO NOT:**
- Add free-text chat (scope creep, different feature entirely)
- Add Runner-to-Whisper messages (Runner communicates through gameplay)
- Add message customization or custom message creation
- Add message history or chat log
- Add typing indicators or "seen" receipts
- Add voice chat integration
- Add quick-comm frequency to the scoring system (might be interesting later)
- Modify the ping system — quick-comms are complementary, not a replacement

---

## Implementation Summary

### Files Created
- `/src/game/quick-comms.ts` — Message catalog with 6 predefined quick-comm messages (STOP!, GO NOW!, BEHIND YOU!, HIDE!, You're safe, Nice move!), types, and cooldown constant

### Files Modified
- `/convex/schema.ts` — Added `quickComm` optional field to `gameState` table (messageId + createdAt)
- `/convex/game.ts` — Added `sendQuickComm` mutation with phase check (planning/heist only)
- `/src/engine/audio.ts` — Added `playQuickCommSound()` with 3 sound categories (urgent: ascending square waves, info: soft sine chime, celebrate: happy triple)
- `/src/components/HUD.tsx` — Added `onSendQuickComm` prop, quick-comm button panel on Whisper HUD left side (vertical stack with COMMS header), responsive mobile icons, added Q/W/E/R/T/Y to controls help popup
- `/src/components/GameCanvas.tsx` — Wired `sendQuickComm` Convex mutation, added cooldown tracking ref, quick-comm keyboard shortcuts for Whisper (Q/W/E/R/T/Y), Runner full-screen overlay with glow/pulse animation, Whisper sent-confirmation toast, event recording for quick-comms, added quick-comms tip to PlanningOverlay
- `/src/app/globals.css` — Added `quick-comm-in` (scale+fade) and `quick-comm-pulse` keyframe animations
- `/src/game/events.ts` — Added `"quick_comm"` to `GameEventType` union, added `messageId` and `text` to event data interface
- `/src/game/highlights.ts` — Added highlight entry for quick-comms ("Whisper shouted: BEHIND YOU!")

### What Was Built
- Full Whisper Quick-Comm system: 6 predefined messages the Whisper can send to the Runner
- Runner sees large animated text overlay with color-coded glow effect and sound cues
- Whisper sees small "Sent: ..." confirmation toast
- Keyboard shortcuts (Q/W/E/R/T/Y) for Whisper only — no conflicts with existing bindings
- 1.5s client-side cooldown to prevent spam
- Mobile-friendly: 44px touch targets, icons on small screens
- Backwards compatible: `v.optional()` schema, old game states unaffected
- Event recording and highlight reel integration

### Verification
- `npm run build` — passes with no errors
- `npm run lint` — passes (only pre-existing warnings in auto-generated Convex files)

---

## Review Notes (agent 1f46ccd5)

**Result: All code approved, no fixes needed.**

Reviewed all 9 files (1 created, 8 modified). Verified build and lint pass.

Key observations:
- Type safety is solid throughout — no `any` types, proper interfaces and union types
- Convex schema is backwards-compatible with `v.optional()`
- `sendQuickComm` mutation properly gates on phase (planning/heist only)
- Quick-comm keyboard shortcuts (Q/W/E/R/T/Y) are correctly role-gated to Whisper only, avoiding conflict with Runner's WASD
- The `useEffect` watcher for incoming quick-comms has proper cleanup (clears both show/hide timers) and deduplication via `lastCommCreatedAtRef`
- The `setTimeout(..., 0)` pattern to defer `setActiveComm` avoids React's set-state-in-effect lint rule — acceptable approach
- Audio null checks present in `playQuickCommSound`
- Event recording and highlight integration are clean, with appropriate low importance (1) for quick-comms in the highlight reel
- Mobile support: 44px touch targets, responsive icon/text display via `hidden sm:inline` / `sm:hidden`
- CSS keyframe animations are properly scoped
