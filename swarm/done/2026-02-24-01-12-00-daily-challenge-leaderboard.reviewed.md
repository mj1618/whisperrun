# Task: Daily Challenge Leaderboard

## Overview

The Daily Challenge button already creates rooms with a deterministic seed (djb2 hash of today's date), so all players who hit "Daily Challenge" get the same map. The scoring system calculates a detailed `ScoreBreakdown` on the results screen. But scores vanish when the results screen is dismissed — there's no persistence and no way to see how you compare to others.

This task adds a **Daily Challenge Leaderboard**: after completing a daily challenge game, the pair's score is automatically submitted to a leaderboard. Players can view today's top scores from the landing page and on the results screen. This is the #1 missing piece for making the daily challenge meaningful and driving repeat play.

**Design decisions (already settled):**
1. **Team scores, not individual** — Both players (Runner + Whisper) share the same score. The score is calculated from the Runner's gameplay events, and the Whisper enabled it. Submit the team's score once, keyed by roomCode.
2. **One entry per room** — Prevent duplicate submissions from both players submitting separately. The results screen submits the score once (Runner's client does it, since they have the events). If the Whisper's client also tries, it's a no-op because the roomCode already has an entry.
3. **Daily leaderboard resets automatically** — Entries are keyed by a `dateKey` string (YYYY-MM-DD). No cleanup needed; old entries are just never queried. (Optionally add a TTL/cleanup later.)
4. **Anonymous names** — No auth system exists. Players are identified by a fun auto-generated team name (adjective + noun pairs like "Sneaky Otters", "Silent Pandas"). The team name is generated client-side from the roomCode hash and shown on the leaderboard.
5. **Top 20 shown** — Keep it simple. Show rank, team name, score, outcome, time, and stealth stars.
6. **Only escaped teams rank** — Caught/timeout teams can see the leaderboard but don't appear on it. This makes escaping the daily challenge feel special.

**Dependencies:** None. Independent of Interactive Doors, Whisper Path Drawing, and Difficulty Levels. Uses existing scoring system.

## What to Build

### 1. Leaderboard Table in Convex Schema (`/convex/schema.ts` — MODIFY)

Add a new `leaderboard` table:

```typescript
leaderboard: defineTable({
  dateKey: v.string(),           // "2026-02-23" — groups entries by day
  roomCode: v.string(),          // prevents duplicate submissions
  teamName: v.string(),          // fun auto-generated name
  score: v.number(),             // total score from ScoreBreakdown
  timeBonus: v.number(),
  stealthBonus: v.number(),
  stylePoints: v.number(),
  stealthRating: v.number(),     // 1-3 stars
  heistDurationMs: v.number(),
  playStyleTitle: v.string(),
  outcome: v.string(),           // "escaped" | "caught" | "timeout"
  submittedAt: v.number(),
}).index("by_dateKey_score", ["dateKey", "score"])
  .index("by_roomCode", ["roomCode"]),
```

The `by_dateKey_score` index enables efficient queries for "today's top scores sorted by score descending." The `by_roomCode` index enables the duplicate-check on submission.

### 2. Leaderboard Convex Functions (`/convex/leaderboard.ts` — CREATE)

Create a new file with two functions:

**`submitScore` mutation:**
```typescript
export const submitScore = mutation({
  args: {
    roomCode: v.string(),
    dateKey: v.string(),
    teamName: v.string(),
    score: v.number(),
    timeBonus: v.number(),
    stealthBonus: v.number(),
    stylePoints: v.number(),
    stealthRating: v.number(),
    heistDurationMs: v.number(),
    playStyleTitle: v.string(),
    outcome: v.string(),
  },
  handler: async (ctx, args) => {
    // Only accept "escaped" outcomes for leaderboard ranking
    // (we still store caught/timeout for the player's own reference, but could skip — decided to only store escaped)
    if (args.outcome !== "escaped") return null;

    // Check for duplicate submission (same roomCode)
    const existing = await ctx.db
      .query("leaderboard")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
    if (existing) return existing._id; // Already submitted, no-op

    return await ctx.db.insert("leaderboard", {
      ...args,
      submittedAt: Date.now(),
    });
  },
});
```

**`getDailyLeaderboard` query:**
```typescript
export const getDailyLeaderboard = query({
  args: { dateKey: v.string() },
  handler: async (ctx, args) => {
    // Get all entries for this date, sorted by score descending
    const entries = await ctx.db
      .query("leaderboard")
      .withIndex("by_dateKey_score", (q) => q.eq("dateKey", args.dateKey))
      .order("desc")
      .take(20);
    return entries;
  },
});
```

### 3. Team Name Generator (`/src/lib/team-names.ts` — CREATE)

A small utility that generates a fun team name from a roomCode hash. Deterministic (same roomCode → same name).

```typescript
const ADJECTIVES = [
  "Sneaky", "Silent", "Shadow", "Velvet", "Nimble",
  "Ghostly", "Crafty", "Stealthy", "Swift", "Midnight",
  "Cosmic", "Lucky", "Daring", "Clever", "Mystic",
  "Fuzzy", "Slippery", "Tiny", "Bold", "Phantom",
];

const NOUNS = [
  "Otters", "Pandas", "Foxes", "Raccoons", "Cats",
  "Owls", "Ferrets", "Badgers", "Penguins", "Bunnies",
  "Hamsters", "Sloths", "Lemurs", "Koalas", "Hedgehogs",
  "Chameleons", "Squirrels", "Capybaras", "Platypuses", "Wombats",
];

export function generateTeamName(roomCode: string): string {
  let hash = 0;
  for (let i = 0; i < roomCode.length; i++) {
    hash = ((hash << 5) - hash + roomCode.charCodeAt(i)) | 0;
  }
  hash = Math.abs(hash);
  const adj = ADJECTIVES[hash % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(hash / ADJECTIVES.length) % NOUNS.length];
  return `${adj} ${noun}`;
}
```

### 4. Auto-Submit Score on Results Screen (`/src/components/ResultsScreen.tsx` — MODIFY)

After the score is calculated, if this is a daily challenge game with outcome "escaped", automatically submit to the leaderboard. Need to:

1. Add a `isDaily` prop to ResultsScreen (passed from the parent based on whether the room was created with the daily flag).
2. Import and call the `submitScore` mutation on mount (inside a `useEffect`).
3. Show a small "Score submitted to daily leaderboard!" confirmation text.

The `isDaily` determination: the room's `mapSeed` matches the daily seed for today. However, since we don't store a `daily` flag on the room, the simplest approach is to add a `daily` boolean to the room schema (set it during `createRoom` when `args.daily` is true).

**Alternative (simpler, no schema change):** Compute the daily seed client-side and compare with the room's `mapSeed`. If they match, it's a daily challenge. This avoids a schema migration.

```typescript
function isDailyChallenge(mapSeed: number): boolean {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let hash = 5381;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) + hash + dateStr.charCodeAt(i)) | 0;
  }
  return mapSeed === Math.abs(hash);
}
```

Use this helper to check. If it's daily + escaped + runner role (runner has events), submit the score.

Add to ResultsScreen props: `mapSeed: number`.

In a `useEffect`:
```typescript
useEffect(() => {
  if (!score || outcome !== "escaped" || role !== "runner") return;
  if (!isDailyChallenge(mapSeed)) return;

  const dateKey = new Date().toISOString().slice(0, 10);
  const teamName = generateTeamName(roomCode);

  submitScore({
    roomCode,
    dateKey,
    teamName,
    score: score.total,
    timeBonus: score.timeBonus,
    stealthBonus: score.stealthBonus,
    stylePoints: score.stylePoints,
    stealthRating: score.stealthRating,
    heistDurationMs: heistDuration,
    playStyleTitle: score.playStyleTitle,
    outcome,
  });
}, []); // Run once on mount
```

### 5. Leaderboard Component (`/src/components/DailyLeaderboard.tsx` — CREATE)

A reusable leaderboard component that shows today's top daily challenge scores. Used in two places:
- The landing page (below the buttons)
- The results screen (when the game was a daily challenge)

```tsx
interface DailyLeaderboardProps {
  highlightRoomCode?: string; // Highlight the current team's entry
}
```

The component:
1. Computes today's `dateKey` (YYYY-MM-DD).
2. Calls `useQuery(api.leaderboard.getDailyLeaderboard, { dateKey })`.
3. Renders a clean table/list with rank, team name, score, stars, and time.
4. Highlights the entry matching `highlightRoomCode` (if provided) with a gold border.
5. Shows "No scores yet — be the first!" if empty.

**Styling:** Match the existing warm/cozy theme. Dark card with gold accents.

```tsx
<div className="bg-[#2D1B0E] rounded-xl border border-[#FFD700]/20 p-5 max-w-md w-full">
  <h3 className="text-[#FFD700] font-bold text-lg text-center mb-4">
    Today's Top Heists
  </h3>
  {entries.length === 0 ? (
    <p className="text-[#8B7355] text-sm text-center">
      No scores yet — be the first!
    </p>
  ) : (
    <div className="space-y-2">
      {entries.map((entry, i) => {
        const isMe = entry.roomCode === highlightRoomCode;
        return (
          <div
            key={entry._id}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm
              ${isMe ? "bg-[#FFD700]/10 border border-[#FFD700]/40" : "bg-black/20"}`}
          >
            <span className="text-[#FFD700] font-bold w-6 text-center">
              {i + 1}
            </span>
            <span className={`flex-1 truncate ${isMe ? "text-[#FFD700]" : "text-[#E8D5B7]"}`}>
              {entry.teamName}
            </span>
            <span className="text-[#FFD700]/60 text-xs">
              {"★".repeat(entry.stealthRating)}
              {"☆".repeat(3 - entry.stealthRating)}
            </span>
            <span className="text-[#E8D5B7] font-mono font-bold w-16 text-right">
              {entry.score.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  )}
</div>
```

### 6. Show Leaderboard on Landing Page (`/src/app/page.tsx` — MODIFY)

Add the `DailyLeaderboard` component below the "Daily Challenge" button section on the landing page. This shows players what they're competing for before they even start a game.

Place it after the existing buttons and helper text:
```tsx
{/* Daily Leaderboard */}
<DailyLeaderboard />
```

### 7. Show Leaderboard on Results Screen (`/src/components/ResultsScreen.tsx` — MODIFY)

If the game was a daily challenge (detected via `isDailyChallenge(mapSeed)`), show the leaderboard below the highlight reel on the results screen:

```tsx
{isDailyChallenge(mapSeed) && (
  <DailyLeaderboard highlightRoomCode={roomCode} />
)}
```

### 8. Pass `mapSeed` to ResultsScreen (`/src/components/GameCanvas.tsx` — MODIFY)

The `GameCanvas` component renders `ResultsScreen`. It needs to pass the room's `mapSeed` so ResultsScreen can determine if it's a daily challenge. The room data is already available via the Convex subscription in GameCanvas — just add `mapSeed` to the props passed down.

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `/convex/schema.ts` | MODIFY | Add `leaderboard` table with indexes |
| `/convex/leaderboard.ts` | CREATE | `submitScore` mutation and `getDailyLeaderboard` query |
| `/src/lib/team-names.ts` | CREATE | `generateTeamName()` from roomCode hash |
| `/src/components/DailyLeaderboard.tsx` | CREATE | Leaderboard display component |
| `/src/components/ResultsScreen.tsx` | MODIFY | Auto-submit score on mount, show leaderboard for daily games, add `mapSeed` prop |
| `/src/components/GameCanvas.tsx` | MODIFY | Pass `mapSeed` prop to ResultsScreen |
| `/src/app/page.tsx` | MODIFY | Show DailyLeaderboard on landing page |

## Key Technical Details

- **No auth needed** — team names are generated from roomCode, no accounts
- **Duplicate prevention** — `by_roomCode` index + check before insert
- **Efficient querying** — `by_dateKey_score` compound index for sorted daily results
- **Only "escaped" outcomes** — caught/timeout games don't appear on leaderboard
- **Runner submits** — only the Runner's client has events/score, so only Runner submits (Whisper's client doesn't have events)
- **Daily detection** — client-side djb2 hash comparison with room's mapSeed (no schema change needed)
- **Real-time updates** — `useQuery` subscription means the leaderboard updates live as other teams finish

## How to Verify

1. **`npm run build`** — Must compile with no errors.
2. **`npm run lint`** — Must pass.
3. **In browser:**
   - Landing page shows "Today's Top Heists" section (empty initially)
   - Click "Daily Challenge" → play a game → escape successfully
   - Results screen shows "Score submitted to daily leaderboard!" confirmation
   - Results screen shows the leaderboard with your team highlighted
   - Go back to landing page → your score appears on the leaderboard
   - Play daily challenge again in another pair of tabs → their score also appears
   - Scores are ranked by total score descending
   - Team names are fun and deterministic (same roomCode → same name)
   - Non-daily games do NOT submit to leaderboard or show leaderboard section
4. **Edge cases:**
   - Caught/timeout daily games: leaderboard shown on results but no score submitted
   - Whisper client: doesn't try to submit (no events/score)
   - Refresh results page: doesn't double-submit (roomCode duplicate check)
   - Non-daily game: no leaderboard shown anywhere on results
5. **Check Convex dashboard:**
   - `leaderboard` table has entries with correct dateKey, scores, team names
   - Index `by_dateKey_score` works correctly for sorted queries

## Scope Boundaries

**DO:**
- Create leaderboard Convex table and functions
- Create team name generator
- Create leaderboard display component
- Auto-submit daily challenge scores from Runner's results screen
- Show leaderboard on landing page and daily challenge results
- Highlight current team's entry

**DO NOT:**
- Add authentication or persistent player profiles
- Add all-time leaderboards (daily only for now)
- Add leaderboard for non-daily (random seed) games
- Add difficulty-specific leaderboards (one leaderboard per day regardless of difficulty)
- Add score editing or admin features
- Add old entry cleanup/TTL (can be added later if the table grows)
- Add share-to-social features (separate task)

---

## Implementation Summary

### Files Created
- **`/convex/leaderboard.ts`** — `submitScore` mutation (escaped-only, roomCode duplicate check) and `getDailyLeaderboard` query (compound index on dateKey+score, top 20 descending)
- **`/src/lib/team-names.ts`** — Deterministic team name generator (djb2 hash of roomCode → adjective + noun, e.g., "Sneaky Otters")
- **`/src/components/DailyLeaderboard.tsx`** — Reusable leaderboard component with real-time Convex subscription, gold-highlighted current team entry, loading/empty states

### Files Modified
- **`/convex/schema.ts`** — Added `leaderboard` table with `by_dateKey_score` and `by_roomCode` indexes
- **`/src/components/ResultsScreen.tsx`** — Added `mapSeed` prop, `isDailyChallenge()` detection (djb2 hash comparison), auto-submit on mount for Runner+escaped+daily games, "Score submitted!" confirmation, DailyLeaderboard shown below results for daily games
- **`/src/app/game/[roomId]/page.tsx`** — Pass `mapSeed={room.mapSeed}` to ResultsScreen
- **`/src/app/page.tsx`** — Added DailyLeaderboard component below buttons on landing page
- **`/src/components/GameCanvas.tsx`** — Fixed scoping bug where `guardDiffConfig` was inaccessible in camera detection block (moved declaration to parent scope)
- **`CLAUDE.md`** — Updated daily leaderboard status from Queued to Completed

### What Was Built
- Full daily challenge leaderboard system: Convex backend for score persistence, client-side auto-submission, real-time leaderboard display
- Only escaped daily challenge games appear on the leaderboard
- Runner's client submits (has events/score), duplicate prevention via roomCode index
- Landing page shows today's top heists (updates in real-time)
- Results screen shows leaderboard with current team highlighted in gold
- Fun deterministic team names from roomCode hash
- Build passes, lint clean

---

## Review Notes (Reviewer: 6ec2998c)

### Issues Found & Fixed

1. **Timezone inconsistency in daily challenge detection (bug fix)**
   - `isDailyChallenge()` in `ResultsScreen.tsx` used local time (`getFullYear/getMonth/getDate`) while the Convex server's `createRoom` uses `new Date()` in UTC (Convex runs in UTC). Near midnight UTC, a player's local date could differ from the server's UTC date, causing the daily challenge detection to fail (hash mismatch).
   - **Fix:** Changed `isDailyChallenge()` to use `getUTCFullYear/getUTCMonth/getUTCDate`.
   - Also fixed `getTodayDateKey()` in `DailyLeaderboard.tsx` to use UTC methods for consistency, ensuring the leaderboard query matches the server's date.

2. **Server-side `dateKey` enforcement (security fix)**
   - The `submitScore` mutation accepted `dateKey` from the client, meaning a malicious client could submit scores to arbitrary dates' leaderboards.
   - **Fix:** Server now computes `dateKey` from `new Date()` (UTC) and overrides the client-provided value. The client still sends `dateKey` in args (for API compatibility) but the server ignores it.

### Items Reviewed, No Issues Found
- **Convex schema:** `leaderboard` table with `by_dateKey_score` and `by_roomCode` indexes — correctly defined, compound index enables efficient sorted queries.
- **Duplicate prevention:** `by_roomCode` index + check-before-insert in `submitScore` — correctly prevents double submissions from both players.
- **Team name generator:** Deterministic djb2 hash → adjective + noun lookup — clean, no issues.
- **DailyLeaderboard component:** Proper loading/empty states, clean Convex subscription via `useQuery`, correct highlight logic.
- **ResultsScreen integration:** `useRef` for submit-once guard, proper dependency array on `useEffect`, graceful error handling on submission failure.
- **GameCanvas changes:** `guardDiffConfig` scoping fix is correct — needed for camera detection block.
- **Game page (`[roomId]/page.tsx`):** `mapSeed={room.mapSeed}` correctly passed to ResultsScreen.
- **Landing page:** DailyLeaderboard placed appropriately below buttons.
- **TypeScript types:** All clean, no `any` types introduced.
- **Build & lint:** Both pass cleanly after fixes.
