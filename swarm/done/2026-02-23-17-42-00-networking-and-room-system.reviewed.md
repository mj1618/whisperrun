# Task: Networking & Room System (Milestone 2)

## Overview

Build the complete room/lobby system so two players can create a game, share an invite link, join the same room, pick roles (Runner/Whisper), ready up, and start a game together. This is the multiplayer foundation that everything else builds on.

## What to Build

### 1. Session ID System

Create `/src/lib/session.ts`:
- On first visit, generate a random session ID (`crypto.randomUUID()`) and store it in `localStorage` under key `"whisperrun-session-id"`
- On subsequent visits, read from localStorage
- Export a `getSessionId(): string` function
- This must be a client-side module (`"use client"`)

### 2. Flesh Out Convex Room Mutations

Expand `/convex/rooms.ts` with the following functions:

#### `createRoom` (mutation) — already exists, needs modification
- Currently creates room with empty players array — keep this
- Also accept a `sessionId` arg and add the creator as the first player:
  ```ts
  players: [{ sessionId, role: null, ready: false }]
  ```

#### `joinRoom` (mutation)
- Args: `{ roomCode: string, sessionId: string }`
- Look up room by roomCode
- Validate: room exists, status is "waiting", fewer than 2 players, sessionId not already in room
- Add player to players array: `{ sessionId, role: null, ready: false }`
- Return the room document
- If player is already in the room, just return the room (idempotent rejoin)

#### `selectRole` (mutation)
- Args: `{ roomCode: string, sessionId: string, role: "runner" | "whisper" | null }`
- Look up room, find player by sessionId
- If selecting a role: check the other player doesn't already have that role
- Update the player's role
- If deselecting (role=null): just clear it

#### `toggleReady` (mutation)
- Args: `{ roomCode: string, sessionId: string }`
- Toggle the player's `ready` field
- Player must have a role selected to ready up (if no role, don't allow)

#### `startGame` (mutation)
- Args: `{ roomCode: string }`
- Validate: both players present, both have different roles, both are ready
- Set room status to "playing"
- Create the initial `gameState` document in the `gameState` table:
  - `roomId`: the room's `_id`
  - `runner`: find the runner spawn point from the test map (col 9, row 12 based on GuardSpawn... actually use a dedicated runner spawn). Use `{ x: 1, y: 1, crouching: false, hiding: false, hasItem: false }` as a reasonable start position (top-left floor tile)
  - `guards`: one guard at the GuardSpawn position `[{ id: "guard-1", x: 9, y: 12, angle: 0, state: "patrol", targetWaypoint: 0 }]`
  - `items`: one item at the ItemSpawn position `[{ id: "item-1", x: 17, y: 7, pickedUp: false, name: "Golden Rubber Duck" }]`
  - `exitX: 6, exitY: 14` (the Exit tile position)
  - `pings`: `[]`
  - `phase`: `"planning"`
  - `startTime`: `Date.now()`

#### `getRoom` (query) — already exists, keep as-is

#### `getRoomByCode` (query)
- Same as getRoom but add a subscription-friendly version
- Actually, `getRoom` already does this. Keep it.

### 3. Update Landing Page — Create Game Flow

Modify `/src/app/page.tsx`:
- Make it a client component (`"use client"`)
- On "Create Game" click:
  1. Get or create sessionId from localStorage
  2. Call `createRoom` mutation with sessionId
  3. Redirect to `/game/{roomCode}` using `router.push()`
- Show a brief loading state while creating

### 4. Update Game Route — Room Joining + Lobby

Modify `/src/app/game/[roomId]/page.tsx`:
- The `[roomId]` param is actually the `roomCode` (the 6-char invite code)
- Make it a client component
- On mount:
  1. Get sessionId from localStorage
  2. Query the room by roomCode using `getRoom`
  3. If room is in "waiting" status and player isn't in it, call `joinRoom` mutation
  4. Show the Lobby component while status is "waiting"
  5. Show the GameCanvas when status is "playing"

### 5. Build Lobby Component

Create `/src/components/Lobby.tsx`:

A client component that shows the lobby UI. Props: `roomCode: string`, `sessionId: string`.

**Layout (styled with Tailwind, matching the cozy theme):**

```
┌──────────────────────────────────────┐
│         WhisperRun Lobby             │
│         Room: ABCD12                 │
│                                      │
│  ┌─────────────┐  ┌─────────────┐   │
│  │   RUNNER     │  │   WHISPER   │   │
│  │   🏃 ←→ 👁   │  │   🗺️ ←→ 📡  │   │
│  │             │  │             │   │
│  │  [Select]   │  │  [Select]   │   │
│  │  Player: —  │  │  Player: —  │   │
│  └─────────────┘  └─────────────┘   │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │  Invite Link: [Copy Link]      │ │
│  └─────────────────────────────────┘ │
│                                      │
│         [ Ready Up ]                 │
│     Waiting for both players...      │
└──────────────────────────────────────┘
```

**Behavior:**
- Subscribe to room data via `useQuery(api.rooms.getRoom, { roomCode })`
- Show two role cards (Runner and Whisper) — each shows:
  - Role name and brief description
  - A "Select" button (or "Selected" if this player chose it, or "Taken" if the other player has it)
  - The player name/sessionId (abbreviated) if someone selected it
- Role selection calls `selectRole` mutation
- Invite link section: show the full URL, with a "Copy" button that copies to clipboard
- "Ready Up" button: calls `toggleReady` mutation
  - Button is disabled if player hasn't selected a role
  - Shows "Ready!" in green if player is ready, "Ready Up" otherwise
- When both players are ready, automatically call `startGame` mutation (or show a "Start Game" button that either player can press)
- Show status messages: "Waiting for another player...", "Waiting for roles...", "Waiting for ready...", etc.

**Styling:**
- Dark background: `#2D1B0E`
- Card backgrounds: `#3D2B1E` with rounded corners
- Gold accents: `#FFD700` for buttons and highlights
- Warm text: `#E8D5B7`
- Muted text: `#8B7355`
- Ready state: green glow / border

### 6. Build InviteLink Component

Create `/src/components/InviteLink.tsx`:
- Shows the room URL (e.g., `https://localhost:3000/game/ABCD12`)
- "Copy" button using `navigator.clipboard.writeText()`
- Brief "Copied!" feedback after clicking

### 7. Wire Up the Full Flow

The complete user journey should be:

1. **Player 1** visits `/` → clicks "Create Game" → redirected to `/game/XYZABC` → sees Lobby with just themselves
2. **Player 1** copies invite link, sends to friend
3. **Player 2** opens link `/game/XYZABC` → auto-joins room → sees Lobby with both players
4. Both pick different roles (Runner/Whisper)
5. Both click "Ready Up"
6. Game starts → lobby transitions to `GameCanvas`

## Key Technical Details

- **Convex reactivity:** Use `useQuery` for room state subscription — the lobby updates in real-time as the other player joins, selects roles, readies up
- **Convex mutations:** Use `useMutation` for all actions (createRoom, joinRoom, selectRole, toggleReady, startGame)
- **Session IDs:** Stored in localStorage, no auth needed. Generate once per browser.
- **Room codes:** 6-char alphanumeric (excluding I, O, 0, 1 for clarity) — already implemented in `generateRoomCode()`
- **URL structure:** `/game/[roomCode]` — the param is the room code, not the Convex document ID
- **Error handling:** Show user-friendly messages for "room not found", "room is full", "game already started"
- **Cleanup:** Don't worry about room expiry/cleanup yet — that's a polish task

## Files to Create/Modify

### Create:
- `/src/lib/session.ts` — Session ID management
- `/src/components/Lobby.tsx` — Lobby UI
- `/src/components/InviteLink.tsx` — Invite link with copy

### Modify:
- `/convex/rooms.ts` — Add joinRoom, selectRole, toggleReady, startGame mutations
- `/src/app/page.tsx` — Make client component, wire createRoom + redirect
- `/src/app/game/[roomId]/page.tsx` — Add room joining logic, show Lobby vs GameCanvas based on room status

## How to Verify

1. `npx convex dev` runs without schema/type errors
2. `npm run build` succeeds (or at minimum `npm run dev` compiles without errors)
3. Open `http://localhost:3000` — landing page shows
4. Click "Create Game" — redirects to `/game/XXXXXX` with a 6-char code, shows lobby
5. Open the same URL in a second browser tab (simulating player 2) — second player auto-joins, lobby shows 2 players
6. Player 1 selects "Runner", Player 2 selects "Whisper" — role cards update in real-time in both tabs
7. Both click "Ready Up" — both show as ready
8. Game starts — lobby transitions to the tile map canvas (GameCanvas renders)
9. The Convex dashboard shows correct room document (2 players, roles assigned, status "playing") and a gameState document
10. Edge cases: trying to select a role already taken shows appropriate feedback; can't ready up without a role; game won't start without both players ready

---

## Completion Summary

**Agent:** dc933589 | **Completed:** 2026-02-23

### What Was Built

Full networking and room/lobby system (Milestone 2) for two-player co-op gameplay.

### Files Created
- **`/src/lib/session.ts`** — Client-side session ID management using `localStorage` + `crypto.randomUUID()`
- **`/src/components/Lobby.tsx`** — Full lobby UI with role selection cards (Runner/Whisper), ready-up system, and "Start Heist" button. Uses Convex subscriptions for real-time updates between players. Styled with the cozy warm color theme.
- **`/src/components/InviteLink.tsx`** — Invite link display with clipboard copy and "Copied!" feedback
- **`/src/components/RoomJoiner.tsx`** — Auto-join component for Player 2. Uses React 19 `useActionState` with auto-submit-on-mount pattern to avoid `setState`-in-effect lint issues.

### Files Modified
- **`/convex/rooms.ts`** — Added 4 new mutations:
  - `joinRoom` — idempotent room joining with validation (room exists, waiting, not full)
  - `selectRole` — role selection with conflict checking (can't pick taken role), auto-un-ready on change
  - `toggleReady` — ready toggle with role-required validation
  - `startGame` — validates both players ready with distinct roles, sets status to "playing", creates initial `gameState` document with runner spawn, guard, item ("Golden Rubber Duck"), and exit positions
  - Also updated `createRoom` to accept `sessionId` and auto-add creator as first player
- **`/src/app/page.tsx`** — Converted to client component with Convex `useMutation` for createRoom + `router.push()` redirect
- **`/src/app/game/[roomId]/page.tsx`** — Full game page with room state routing: loading → room not found → join (RoomJoiner) → lobby (Lobby) → game (GameCanvas)

### Verification
- `npx convex dev --once` — Convex functions compile and deploy successfully
- `npx next build` — Production build succeeds with no errors
- `npm run lint` — 0 errors (only 4 pre-existing warnings in Convex generated files)
- Full user flow: create room → join via link → select roles → ready up → start game → transition to GameCanvas

---

## Review Notes (Reviewer: e886c33d)

### Assessment

Code quality is strong throughout. No bugs found.

**Highlights:**
- All Convex mutations have proper server-side validation (room state, player membership, role conflicts)
- `selectRole` correctly auto-un-readies players when they change roles — good edge case handling
- `joinRoom` is idempotent, preventing duplicate player entries on reconnect
- `RoomJoiner` uses React 19 `useActionState` pattern to avoid setState-during-render anti-patterns
- `startGame` has thorough validation (2 players, distinct roles, both ready, caller is a player)
- `resetRoom` properly cleans up old game state documents

**No fixes required.** All code is clean, type-safe, and well-structured.
