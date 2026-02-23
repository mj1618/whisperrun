# Task: Player Disconnect Handling & Connection Resilience

## Overview

PLAN.md explicitly requires: "If a player disconnects during game, pause briefly then end game." Currently, if one player closes their browser tab during a heist, the other player is permanently stuck — the game never ends, guards may stop updating (if the Runner disconnects), and there's no feedback that the partner is gone. This is the biggest remaining playability issue.

This task adds a heartbeat/presence system so the server can detect when a player has disconnected, briefly pause the game (3-5 seconds grace period for accidental tab switches or brief network blips), and then cleanly end the game with a "partner disconnected" result if they don't return.

**Dependencies:** Milestones 1-8 complete. Room system and game state infrastructure already exist.

## What to Build

### 1. Heartbeat Mutation (`/convex/rooms.ts` — ADD)

Add a `heartbeat` mutation that players call every ~3 seconds to signal they're still connected:

```typescript
export const heartbeat = mutation({
  args: { roomCode: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
    if (!room) return;

    const playerIndex = room.players.findIndex(
      (p) => p.sessionId === args.sessionId
    );
    if (playerIndex === -1) return;

    const updatedPlayers = [...room.players];
    updatedPlayers[playerIndex] = {
      ...updatedPlayers[playerIndex],
      lastHeartbeat: Date.now(),
    };
    await ctx.db.patch(room._id, { players: updatedPlayers });
  },
});
```

### 2. Schema Changes (`/convex/schema.ts` — MODIFY)

Add `lastHeartbeat` to the player object in the rooms table:

```typescript
players: v.array(
  v.object({
    sessionId: v.string(),
    name: v.optional(v.string()),
    role: v.union(v.literal("runner"), v.literal("whisper"), v.null()),
    ready: v.boolean(),
    lastHeartbeat: v.optional(v.number()),  // <-- ADD THIS
  })
),
```

Also add a `disconnectedAt` field to the room (tracks when a disconnect was first detected):

```typescript
// Add to rooms table fields:
disconnectedAt: v.optional(v.number()),  // timestamp when a disconnect was detected
disconnectedPlayer: v.optional(v.string()),  // sessionId of the disconnected player
```

### 3. Disconnect Detection (`/convex/rooms.ts` — ADD)

Add a `checkDisconnect` mutation that the connected player calls periodically (piggyback on the heartbeat interval) to check if the other player has gone silent:

```typescript
const HEARTBEAT_TIMEOUT = 8000;  // 8 seconds without a heartbeat = disconnected
const DISCONNECT_GRACE_PERIOD = 5000;  // 5 seconds grace before ending game

export const checkDisconnect = mutation({
  args: { roomCode: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
    if (!room || room.status !== "playing") return { disconnected: false };

    const now = Date.now();
    const otherPlayer = room.players.find(
      (p) => p.sessionId !== args.sessionId
    );
    if (!otherPlayer) return { disconnected: false };

    // Check if other player's heartbeat has timed out
    const lastBeat = otherPlayer.lastHeartbeat ?? room.createdAt;
    const isTimedOut = now - lastBeat > HEARTBEAT_TIMEOUT;

    if (!isTimedOut) {
      // Partner is fine — clear any pending disconnect
      if (room.disconnectedAt) {
        await ctx.db.patch(room._id, {
          disconnectedAt: undefined,
          disconnectedPlayer: undefined,
        });
      }
      return { disconnected: false };
    }

    // Partner appears disconnected
    if (!room.disconnectedAt) {
      // First detection — start grace period
      await ctx.db.patch(room._id, {
        disconnectedAt: now,
        disconnectedPlayer: otherPlayer.sessionId,
      });
      return { disconnected: false, gracePeriod: true };
    }

    // Check if grace period has expired
    if (now - room.disconnectedAt > DISCONNECT_GRACE_PERIOD) {
      // Grace period expired — end the game
      await ctx.db.patch(room._id, { status: "finished" });

      // Update game state to a disconnected phase
      const gameState = await ctx.db
        .query("gameState")
        .withIndex("by_roomId", (q) => q.eq("roomId", room._id))
        .first();
      if (gameState && gameState.phase !== "escaped" && gameState.phase !== "caught" && gameState.phase !== "timeout") {
        await ctx.db.patch(gameState._id, { phase: "disconnected" });
      }

      return { disconnected: true, endedGame: true };
    }

    // Still in grace period
    return { disconnected: false, gracePeriod: true };
  },
});
```

### 4. Add "disconnected" Phase to Schema (`/convex/schema.ts` — MODIFY)

Add `"disconnected"` to the `phase` union in `gameState`:

```typescript
phase: v.union(
  v.literal("planning"),
  v.literal("heist"),
  v.literal("escaped"),
  v.literal("caught"),
  v.literal("timeout"),
  v.literal("disconnected")  // <-- ADD THIS
),
```

### 5. Client-Side Heartbeat (`/src/components/GameCanvas.tsx` — MODIFY)

In the main `GameCanvas` component, set up a heartbeat interval that runs while the game is active:

```typescript
// Inside the component, alongside existing useEffect hooks:
const heartbeatMut = useMutation(api.rooms.heartbeat);
const checkDisconnectMut = useMutation(api.rooms.checkDisconnect);

useEffect(() => {
  if (!roomCode || !sessionId) return;

  // Send heartbeat every 3 seconds
  const heartbeatInterval = setInterval(async () => {
    try {
      await heartbeatMut({ roomCode, sessionId });
    } catch {
      // Silently fail — the other player's checkDisconnect will handle our absence
    }
  }, 3000);

  return () => clearInterval(heartbeatInterval);
}, [roomCode, sessionId, heartbeatMut]);
```

Also add disconnect checking:

```typescript
const [showDisconnectWarning, setShowDisconnectWarning] = useState(false);

useEffect(() => {
  if (!roomCode || !sessionId) return;

  const checkInterval = setInterval(async () => {
    try {
      const result = await checkDisconnectMut({ roomCode, sessionId });
      if (result?.gracePeriod) {
        setShowDisconnectWarning(true);
      } else {
        setShowDisconnectWarning(false);
      }
    } catch {
      // Ignore errors
    }
  }, 3000);

  return () => clearInterval(checkInterval);
}, [roomCode, sessionId, checkDisconnectMut]);
```

### 6. Heartbeat in Lobby Too (`/src/components/Lobby.tsx` — MODIFY)

The heartbeat should also run in the lobby so players in the waiting room know if their partner leaves. Add a similar heartbeat interval in the Lobby component:

```typescript
const heartbeatMut = useMutation(api.rooms.heartbeat);

useEffect(() => {
  if (!roomCode || !sessionId) return;

  // Send initial heartbeat immediately
  heartbeatMut({ roomCode, sessionId }).catch(() => {});

  const interval = setInterval(() => {
    heartbeatMut({ roomCode, sessionId }).catch(() => {});
  }, 3000);

  return () => clearInterval(interval);
}, [roomCode, sessionId, heartbeatMut]);
```

Also set `lastHeartbeat` when creating or joining a room (in `createRoom` and `joinRoom` mutations). Add `lastHeartbeat: Date.now()` to the player objects.

### 7. Disconnect UI (`/src/components/GameCanvas.tsx` — MODIFY)

Show a warning overlay when a disconnect is detected (during grace period) and handle the game ending on disconnect:

**Grace period warning (5 seconds):**
```tsx
{showDisconnectWarning && (
  <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
    <div className="bg-[#2D1B0E]/90 border-2 border-[#FFD700]/50 rounded-xl px-8 py-6 text-center">
      <p className="text-[#FFD700] text-xl font-bold">Partner Disconnected</p>
      <p className="text-[#E8D5B7] text-sm mt-2">Waiting for them to reconnect...</p>
      <div className="mt-3 w-full bg-[#3D2B1E] rounded-full h-2">
        {/* Animated countdown bar */}
        <div
          className="bg-[#FFD700] h-2 rounded-full transition-all duration-1000"
          style={{ width: `${disconnectCountdownPct}%` }}
        />
      </div>
    </div>
  </div>
)}
```

**Disconnected result screen:**
When the phase becomes `"disconnected"`, show a message on the results screen. This should integrate with the existing results/game-over flow. In the game state check:

```typescript
if (state?.phase === "disconnected") {
  // Show a friendly disconnect message instead of the normal results
  // "Your partner disconnected. The heist is off... for now."
}
```

### 8. Results Screen — Disconnect Message (`/src/components/GameCanvas.tsx` — MODIFY)

In the results screen section (where "escaped", "caught", "timeout" are handled), add a case for "disconnected":

```typescript
// In the results overlay:
const phaseMessage = {
  escaped: "You Escaped!",
  caught: "Caught!",
  timeout: "Time's Up!",
  disconnected: "Partner Disconnected",
}[state.phase] ?? "";

const phaseSubtext = {
  escaped: "The heist was a success!",
  caught: "Better luck next time...",
  timeout: "The clock ran out!",
  disconnected: "Your partner left the heist. Maybe next time!",
}[state.phase] ?? "";
```

For disconnected games, still show the "Play Again" button but skip the scoring/highlights section (an incomplete game doesn't have meaningful scores).

### 9. Handle Reconnection Gracefully

If a player reconnects within the grace period (their heartbeat resumes), the `checkDisconnect` mutation will clear the `disconnectedAt` field and the warning overlay will disappear. The game continues as normal.

The key is that the heartbeat interval continues even when the browser tab is in the background (setInterval still fires, though less frequently). This is usually enough for a 3-second heartbeat with an 8-second timeout.

**Browser tab visibility note:** `setInterval` may be throttled to ~1/second in background tabs, but our 3-second interval with 8-second timeout has plenty of margin. A tab switch won't cause false disconnects.

## Files to Modify

- `/convex/schema.ts` — Add `lastHeartbeat` to player object, add `disconnectedAt`/`disconnectedPlayer` to rooms, add `"disconnected"` to phase union
- `/convex/rooms.ts` — Add `heartbeat` mutation, `checkDisconnect` mutation, set `lastHeartbeat` in `createRoom`/`joinRoom`
- `/src/components/GameCanvas.tsx` — Heartbeat interval, disconnect check interval, disconnect warning overlay, handle "disconnected" phase in results
- `/src/components/Lobby.tsx` — Heartbeat interval in lobby
- `/src/game/game-state.ts` — Add `"disconnected"` to the `Phase` type if one exists (check the `LocalGameState` interface)

## Files NOT to Touch

- `/src/engine/audio.ts` — No audio changes
- `/src/game/guard-ai.ts` — Guard AI is unaffected by disconnects
- `/src/game/map-generator.ts` — No map changes
- `/src/game/scoring.ts` — Don't score disconnected games
- `/src/game/whisper-view.ts` — No rendering changes for Whisper
- `/src/game/runner-view.ts` — No rendering changes for Runner

## Key Technical Details

### Why heartbeat-based (not WebSocket close detection)

Convex uses WebSocket subscriptions internally, but Convex doesn't expose connection status events to mutations. The heartbeat pattern is the standard Convex approach: each client calls a mutation periodically, and the server detects silence. This is reliable and works across all deployment scenarios.

### Heartbeat timing

- **Send interval:** 3 seconds — frequent enough to detect disconnects quickly, infrequent enough to not add meaningful load
- **Timeout threshold:** 8 seconds — 2.5x the send interval, giving room for network hiccups
- **Grace period:** 5 seconds — enough time for an accidental tab close + immediate re-open, but not so long that the remaining player waits forever

### Mutation cost

Each heartbeat is a tiny Convex mutation (~1 DB read + 1 write). At 2 players × 1 heartbeat/3s = 0.67 mutations/second per room. Plus 2 disconnect checks/3s = another 0.67/s. Total: ~1.3 mutations/second per active room. This is negligible for Convex.

### Reconnection flow

If a player closes their tab and re-opens the URL within 8 seconds, they'll:
1. Rejoin the room (idempotent via `joinRoom` — the `existing` check)
2. Resume heartbeats
3. Subscribe to game state and resume rendering
4. The disconnect warning will clear on the other player's screen

The game state is server-authoritative, so reconnection is seamless — the reconnecting client just starts receiving the latest state again.

### Edge case: both players disconnect

If both players close their tabs, nobody calls `checkDisconnect`, so the game hangs in "playing" state. This is acceptable — the room will be effectively abandoned. For future cleanup, a Convex cron job could sweep rooms that haven't been updated in 30+ minutes, but that's out of scope for this task.

### Edge case: disconnect during planning phase

The heartbeat and disconnect detection should work identically during the planning phase and the heist phase. If a player disconnects during planning countdown, end the game the same way.

## Implementation Summary

### Files Changed

- **`/convex/schema.ts`** — Added `lastHeartbeat: v.optional(v.number())` to player object, `disconnectedAt`/`disconnectedPlayer` optional fields to rooms table, `v.literal("disconnected")` to gameState phase union
- **`/convex/rooms.ts`** — Added `heartbeat` mutation (updates player lastHeartbeat), `checkDisconnect` mutation (detects partner timeout → grace period → game end), set `lastHeartbeat: Date.now()` in `createRoom`/`joinRoom`, clear disconnect fields in `resetRoom`
- **`/src/game/game-state.ts`** — Added `"disconnected"` to the `Phase` type in `LocalGameState`
- **`/src/components/GameCanvas.tsx`** — Added `roomCode` prop, heartbeat interval (every 3s), disconnect check interval (every 3s), disconnect warning overlay UI, `"disconnected"` in game-over detection
- **`/src/components/Lobby.tsx`** — Added heartbeat interval (every 3s) while in lobby
- **`/src/app/game/[roomId]/page.tsx`** — Added `"disconnected"` to finished state condition for showing ResultsScreen
- **`/src/components/ResultsScreen.tsx`** — Added `"disconnected"` outcome type with gray-themed config, skip scoring/stats for disconnected games

### What Was Built

- **Heartbeat system**: Both players send a heartbeat mutation every 3 seconds from both Lobby and GameCanvas. Initial heartbeat is set on room create/join.
- **Disconnect detection**: Each player checks the other's heartbeat every 3 seconds. 8-second timeout threshold triggers grace period, 5-second grace period before ending game.
- **Grace period UI**: Warning overlay appears during grace period with "Partner Disconnected — Waiting for them to reconnect..." message.
- **Reconnection**: If the disconnected player's heartbeat resumes during grace period, the warning clears and game continues normally.
- **Game end on disconnect**: After grace period expires, room status → "finished", game phase → "disconnected". Results screen shows "Partner Disconnected" with no scoring/stats.
- **Play Again works**: Reset room clears disconnect fields; normal lobby flow resumes.

### Verification

- `npm run build` — passes with no type errors
- `npm run lint` — passes (only pre-existing warnings in auto-generated Convex files)

## How to Verify

1. `npm run build` succeeds with no type errors.
2. `npm run lint` passes.
3. **Normal gameplay unaffected**: Play a full game with both players connected. No disconnect warnings should appear. Heartbeat intervals should not cause any visible performance issues.
4. **Disconnect detection works**: Open a game with two browser tabs. During the heist, close one tab.
   - The remaining player should see a "Partner Disconnected — Waiting for them to reconnect..." warning within ~8 seconds
   - After 5 more seconds, the game should end with a "Partner Disconnected" message
   - The "Play Again" button should work normally
5. **Reconnection within grace**: Open a game, close one tab, then quickly re-open it and navigate to the game URL. If done within ~13 seconds (8s timeout + 5s grace), the game should resume normally and the warning should disappear.
6. **Lobby disconnect**: In the lobby with 2 players, close one player's tab. The other player should still be able to wait (lobby doesn't end on disconnect, but the heartbeat lays groundwork for showing a "partner left" indicator in a future task).
7. **Disconnected result screen**: When a game ends due to disconnect, it should show "Partner Disconnected" with an appropriate message, not a scoring/highlights screen.

---

## Review Notes (Reviewer: 53c2eb42)

### Issues Found and Fixed

1. **`joinRoom` idempotent rejoin didn't refresh `lastHeartbeat`** (`convex/rooms.ts:81-83`)
   - **Problem:** When a disconnected player reconnected via `joinRoom`, the early return `if (existing) return room;` skipped updating `lastHeartbeat`. This meant the reconnecting player's heartbeat timestamp stayed stale, which could cause the `checkDisconnect` mutation to still see them as timed out — potentially triggering a false disconnect during the grace period.
   - **Fix:** Changed idempotent rejoin to update `lastHeartbeat` to `Date.now()` and write it back to the database before returning. This ensures reconnection immediately refreshes the player's presence.

2. **`checkDisconnect` only worked during "playing" status** (`convex/rooms.ts:201`)
   - **Problem:** The mutation early-returned with `{ disconnected: false }` if `room.status !== "playing"`. The task spec explicitly states: "The heartbeat and disconnect detection should work identically during the planning phase and the heist phase." Disconnects during planning phase went undetected.
   - **Fix:** Changed the guard to `room.status === "finished"` — now disconnect detection works for both "waiting" (lobby/planning) and "playing" statuses, only skipping already-finished rooms.

### Items Reviewed (No Issues)

- **Schema changes** (`convex/schema.ts`): `lastHeartbeat`, `disconnectedAt`, `disconnectedPlayer`, and `"disconnected"` phase all correctly defined with proper optional types.
- **Heartbeat mutation** (`convex/rooms.ts`): Clean and minimal — finds player, updates timestamp.
- **`createRoom` / `joinRoom`**: Both correctly set `lastHeartbeat: Date.now()` on new players.
- **`resetRoom`**: Correctly clears `disconnectedAt` and `disconnectedPlayer`.
- **`checkDisconnect` grace period logic**: Correct three-state flow (not timed out → first detection → grace expired → end game). Properly clears disconnect fields when partner's heartbeat resumes.
- **Game state manager** (`game-state.ts`): `"disconnected"` properly added to Phase type.
- **GameCanvas heartbeat/disconnect intervals**: Both properly clean up with `clearInterval` in effect returns. Heartbeat sends initial beat immediately.
- **Lobby heartbeat**: Correctly runs while in lobby with proper cleanup.
- **Page routing** (`page.tsx`): `"disconnected"` properly added to finished state condition.
- **ResultsScreen**: `"disconnected"` outcome correctly configured with gray theme, scoring/stats properly skipped for disconnected games.

### Build Verification
- `npm run build` — passes
- `npm run lint` — passes (only pre-existing warnings)
