# Task: Runner Color Customization

## Overview

Players currently have no way to personalize their Runner. Every heist looks the same — same orange body, same tan head, same brown legs. This task adds **Runner color presets** that players choose in the lobby before a heist. It's a small feature with outsized impact: it makes games feel personal, makes share cards/replay maps more distinctive, and adds a "pick your style" moment to the lobby that builds anticipation.

This is listed in PLAN.md's Week 2 goals as "basic cosmetic unlocks" and is the natural follow-up now that the core gameplay loop, scoring, and sharing are all in place.

## What to Build

### 1. Define Color Presets (`/src/game/runner-colors.ts` — CREATE)

Create a new module with 6 Runner color presets. Each preset defines the 3 key colors used by `drawRunnerSprite()` in `src/engine/sprites.ts`:

```typescript
export interface RunnerColorPreset {
  id: string;
  label: string;
  body: string;      // Torso fill (currently #E39B32)
  bodyOutline: string; // Torso/head stroke (currently #B47820)
  head: string;      // Head fill (currently #F0B050)
  legs: string;      // Leg fill (currently #8B6914)
  hidingOutline: string; // rgba for hiding dashed outline
}

export const RUNNER_COLOR_PRESETS: RunnerColorPreset[] = [
  {
    id: "classic",
    label: "Classic",
    body: "#E39B32",
    bodyOutline: "#B47820",
    head: "#F0B050",
    legs: "#8B6914",
    hidingOutline: "rgba(227, 155, 50, 0.6)",
  },
  {
    id: "midnight",
    label: "Midnight",
    body: "#3B5998",
    bodyOutline: "#2B4478",
    head: "#5B79B8",
    legs: "#1A2540",
    hidingOutline: "rgba(59, 89, 152, 0.6)",
  },
  {
    id: "forest",
    label: "Forest",
    body: "#4A8B5C",
    bodyOutline: "#357043",
    head: "#6AAB7C",
    legs: "#2D5A3A",
    hidingOutline: "rgba(74, 139, 92, 0.6)",
  },
  {
    id: "crimson",
    label: "Crimson",
    body: "#C04040",
    bodyOutline: "#8B2020",
    head: "#E06060",
    legs: "#6B1A1A",
    hidingOutline: "rgba(192, 64, 64, 0.6)",
  },
  {
    id: "violet",
    label: "Violet",
    body: "#7B52AB",
    bodyOutline: "#5A3A8B",
    head: "#9B72CB",
    legs: "#3D2A5A",
    hidingOutline: "rgba(123, 82, 171, 0.6)",
  },
  {
    id: "ghost",
    label: "Ghost",
    body: "#B8B8B8",
    bodyOutline: "#888888",
    head: "#D8D8D8",
    legs: "#707070",
    hidingOutline: "rgba(184, 184, 184, 0.6)",
  },
];

export function getRunnerPreset(id: string): RunnerColorPreset {
  return RUNNER_COLOR_PRESETS.find((p) => p.id === id) ?? RUNNER_COLOR_PRESETS[0];
}
```

The "classic" preset exactly matches the current hardcoded colors. All presets follow the same luminance hierarchy (legs darkest < body mid < head lightest) to ensure readability at small sprite sizes.

### 2. Update `drawRunnerSprite()` to Accept Colors (`/src/engine/sprites.ts` — MODIFY)

Add an optional `colors` parameter to the sprite function. When not provided, use the current hardcoded defaults (backward-compatible):

```typescript
export function drawRunnerSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  opts: {
    crouching: boolean;
    hiding: boolean;
    hasItem: boolean;
    walkFrame: number;
    facingAngle: number;
    colors?: {            // NEW — optional color override
      body: string;
      bodyOutline: string;
      head: string;
      legs: string;
      hidingOutline: string;
    };
  }
): void {
```

Then replace the 5 hardcoded color literals with the passed-in values (falling back to defaults):

- `"#8B6914"` → `colors?.legs ?? "#8B6914"`
- `"#E39B32"` → `colors?.body ?? "#E39B32"`
- `"#B47820"` (both body outline and head outline) → `colors?.bodyOutline ?? "#B47820"`
- `"#F0B050"` → `colors?.head ?? "#F0B050"`
- `"rgba(227, 155, 50, 0.6)"` → `colors?.hidingOutline ?? "rgba(227, 155, 50, 0.6)"`

**DO NOT** change the eye color (`#2D1B0E`), item glow (`#FFD700`), or drop shadow — those stay fixed for all presets.

### 3. Thread Colors Through Renderer (`/src/engine/renderer.ts` — MODIFY)

Update the `drawRunner` method to accept and forward colors:

```typescript
drawRunner(
  worldX: number,
  worldY: number,
  crouching: boolean,
  hiding: boolean,
  hasItem: boolean = false,
  walkFrame: number = 0,
  facingAngle: number = 0,
  colors?: {
    body: string;
    bodyOutline: string;
    head: string;
    legs: string;
    hidingOutline: string;
  }
) {
  // ... existing world-to-screen logic ...
  drawRunnerSprite(this.ctx, screen.x, screen.y, {
    crouching,
    hiding,
    hasItem,
    walkFrame,
    facingAngle,
    colors,  // NEW
  });
}
```

### 4. Add `runnerColor` to Convex Schema (`/convex/schema.ts` — MODIFY)

Add an optional `runnerColor` field to the player objects in the `rooms` table. This stores the preset ID (e.g., `"midnight"`, `"classic"`):

```typescript
players: v.array(
  v.object({
    sessionId: v.string(),
    name: v.optional(v.string()),
    role: v.union(
      v.literal("runner"),
      v.literal("whisper"),
      v.null()
    ),
    ready: v.boolean(),
    lastHeartbeat: v.optional(v.number()),
    runnerColor: v.optional(v.string()),  // NEW — preset ID
  })
),
```

Using `v.string()` rather than a union of literals keeps the schema flexible — adding new presets won't require a schema migration.

### 5. Add `setRunnerColor` Mutation (`/convex/rooms.ts` — MODIFY)

Add a new mutation for changing the Runner's color preset:

```typescript
export const setRunnerColor = mutation({
  args: {
    roomCode: v.string(),
    sessionId: v.string(),
    colorPresetId: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
    if (!room) throw new Error("Room not found");
    if (room.status !== "waiting") throw new Error("Game already started");

    const playerIndex = room.players.findIndex(
      (p) => p.sessionId === args.sessionId
    );
    if (playerIndex === -1) throw new Error("Player not in room");

    const updatedPlayers = [...room.players];
    updatedPlayers[playerIndex] = {
      ...updatedPlayers[playerIndex],
      runnerColor: args.colorPresetId,
    };
    await ctx.db.patch(room._id, { players: updatedPlayers });
  },
});
```

**DO NOT** unready players when they change color (unlike difficulty changes). Color is cosmetic and shouldn't reset readiness.

### 6. Add Color Picker to Lobby UI (`/src/components/Lobby.tsx` — MODIFY)

Add a color selector that appears when a player selects the Runner role. This goes below the Role Cards section, only visible to the player who chose Runner:

```tsx
{/* Runner Color Picker — only shown to the player who selected Runner */}
{me?.role === "runner" && (
  <div className="text-center space-y-2">
    <p className="text-sm text-[#8B7355]">Runner Color</p>
    <div className="flex justify-center gap-2 flex-wrap">
      {RUNNER_COLOR_PRESETS.map((preset) => {
        const isSelected = (me.runnerColor ?? "classic") === preset.id;
        return (
          <button
            key={preset.id}
            onClick={() => handleSetRunnerColor(preset.id)}
            className={`w-10 h-10 rounded-full border-2 transition-all duration-200
              ${isSelected
                ? "border-[#FFD700] ring-2 ring-[#FFD700]/50 scale-110"
                : "border-[#8B7355]/40 hover:border-[#E8D5B7] hover:scale-105"
              }`}
            title={preset.label}
          >
            {/* Mini sprite preview — just a colored circle with the body color */}
            <div
              className="w-full h-full rounded-full"
              style={{ backgroundColor: preset.body }}
            />
          </button>
        );
      })}
    </div>
  </div>
)}
```

Add the mutation hook and handler at the top of the Lobby component:

```typescript
const setRunnerColorMut = useMutation(api.rooms.setRunnerColor);

const handleSetRunnerColor = async (presetId: string) => {
  await setRunnerColorMut({ roomCode, sessionId, colorPresetId: presetId });
};
```

Import `RUNNER_COLOR_PRESETS` from `@/game/runner-colors`.

### 7. Pass Runner Color Through GameCanvas (`/src/components/GameCanvas.tsx` — MODIFY)

The GameCanvas needs to know which color preset the Runner player chose so it can pass colors to the renderer.

Add a `runnerColorPresetId` prop to GameCanvas:
```typescript
interface GameCanvasProps {
  // ... existing props ...
  runnerColorPresetId?: string;
}
```

In the game loop, when rendering the Runner, pass the resolved color preset:
```typescript
import { getRunnerPreset } from "@/game/runner-colors";

// In the render section where drawRunner is called:
const runnerColors = getRunnerPreset(runnerColorPresetId ?? "classic");
renderer.drawRunner(
  runnerX, runnerY,
  state.runner.crouching,
  state.runner.hiding,
  state.runner.hasItem,
  walkFrame,
  facingAngle,
  runnerColors  // NEW
);
```

### 8. Wire Up in Game Page (`/src/app/game/[roomId]/page.tsx` — MODIFY)

Read the Runner player's color preset from the room data and pass it to GameCanvas:

```typescript
// After determining playerRole:
const runnerPlayer = room?.players.find((p) => p.role === "runner");
const runnerColorPresetId = runnerPlayer?.runnerColor ?? "classic";

// Pass to GameCanvas:
<GameCanvas
  // ... existing props ...
  runnerColorPresetId={runnerColorPresetId}
/>
```

### 9. Also Pass to Whisper View (`/src/game/whisper-view.ts` — MODIFY if needed)

The Whisper sees the Runner on the blueprint too. Make sure the Whisper view also uses the Runner's chosen color. Check how the Whisper view renders the Runner and ensure the same color preset is passed through. The Whisper view likely calls `drawRunnerSprite` or `renderer.drawRunner` — thread the `colors` parameter there too.

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `/src/game/runner-colors.ts` | CREATE | Color preset definitions, `RUNNER_COLOR_PRESETS` array, `getRunnerPreset()` helper |
| `/src/engine/sprites.ts` | MODIFY | Add optional `colors` parameter to `drawRunnerSprite()`, use it instead of hardcoded hex values |
| `/src/engine/renderer.ts` | MODIFY | Add optional `colors` parameter to `drawRunner()`, forward to `drawRunnerSprite()` |
| `/convex/schema.ts` | MODIFY | Add `runnerColor: v.optional(v.string())` to the players array object |
| `/convex/rooms.ts` | MODIFY | Add `setRunnerColor` mutation |
| `/src/components/Lobby.tsx` | MODIFY | Add color picker UI below role cards (visible when Runner role selected) |
| `/src/components/GameCanvas.tsx` | MODIFY | Accept `runnerColorPresetId` prop, pass resolved colors to renderer |
| `/src/app/game/[roomId]/page.tsx` | MODIFY | Read Runner's color from room data, pass as prop to GameCanvas |

Depending on how the Whisper view renders the Runner, may also need:
| `/src/game/whisper-view.ts` or `/src/game/runner-view.ts` | MODIFY | Thread colors through Runner rendering in both views |

## Key Design Decisions (Already Made)

1. **Preset-based, not free-form** — 6 fixed palettes instead of RGB sliders. This keeps the UI simple, ensures all presets look good at small sprite sizes, and avoids "ugly character" problems. Each preset is carefully designed with the same luminance hierarchy (dark legs → mid body → light head).
2. **Stored on the room player, not in localStorage** — The color choice is synced via Convex so the Whisper can also see the Runner's chosen color. This also means the color persists across page refreshes within the same session.
3. **Optional field (`v.optional(v.string())`)** — Backward compatible. Existing rooms without the field default to "classic" (the current orange palette). No migration needed.
4. **Visible only to Runner role** — The color picker only shows when a player selects the Runner role. Whisper doesn't need customization (the Whisper doesn't have a visible character).
5. **Does NOT unready players** — Unlike difficulty changes, color is purely cosmetic. Changing it mid-lobby shouldn't reset the ready state.
6. **Defaults remain backward-compatible** — The `drawRunnerSprite()` function uses `opts.colors?.body ?? "#E39B32"` fallbacks so all existing call sites continue working without changes.
7. **Simple circle swatches in lobby** — No elaborate preview canvas or 3D model viewer. Just colored circles with the body color. Players will see the result in-game immediately. Keep the lobby clean and fast.

## How to Verify

1. **`npm run build`** — Must compile with no errors.
2. **`npm run lint`** — Must pass.
3. **In browser (two tabs):**
   - Create a game, open in two tabs with different sessions
   - **Select Runner role** — Color picker appears below the role cards
   - **Select a color** — Swatch highlights with gold border, room state updates (other tab sees the change if they query it)
   - **Switch to Whisper role** — Color picker disappears (Whisper has no character to customize)
   - **Switch back to Runner** — Color picker reappears with previously selected color still active
   - **Start game** — Runner sprite renders in the selected color (not default orange)
   - **Both views** — Runner appears in the chosen color on both the Runner's fog-of-war view AND the Whisper's blueprint view
   - **Default behavior** — If no color is selected, Runner appears in classic orange (backward compatible)
   - **All 6 presets** — Try each one; all should render correctly with clear visual distinction at game-screen sprite sizes
   - **Crouching/hiding/hasItem** — All these states should respect the custom colors (crouching is smaller, hiding is transparent with colored dashed outline, item glow is always gold)
4. **Edge cases:**
   - **Refresh during lobby** — Color selection persists (stored in Convex, not localStorage)
   - **Play Again** — Room resets; color should persist from the player's previous choice
   - **Mobile** — Color picker swatches are tap-friendly (40px circles are above the 44px touch target minimum when including padding)

## Scope Boundaries

**DO:**
- Create 6 color presets with body/bodyOutline/head/legs/hidingOutline values
- Refactor `drawRunnerSprite()` to accept optional color overrides
- Thread colors through Renderer → GameCanvas → game page
- Add `runnerColor` field to Convex schema (rooms.players)
- Add `setRunnerColor` mutation
- Add color picker in Lobby (visible when Runner role selected)
- Ensure both Runner view and Whisper view use the selected color

**DO NOT:**
- Add custom RGB/hex color input (presets only)
- Add Whisper customization (Whisper has no character sprite)
- Add guard or item cosmetics (separate future feature)
- Add unlock/progression mechanics (all presets available from the start)
- Add localStorage persistence for the color preference across rooms (Convex room state is sufficient)
- Add color to the share card or replay map (those features may incorporate it later, but don't modify them now)
- Add a preview canvas in the lobby (simple colored circles are sufficient)
- Change the existing eye color, item glow color, or drop shadow

---

## Implementation Summary

### Files Created
- **`/src/game/runner-colors.ts`** — 6 color presets (Classic, Midnight, Forest, Crimson, Violet, Ghost) with `RunnerColorPreset` interface and `getRunnerPreset()` helper

### Files Modified
- **`/src/engine/sprites.ts`** — Added optional `colors` parameter to `drawRunnerSprite()`, replaced 5 hardcoded color values with `colors?.xxx ?? default` fallbacks. Eye color, item glow, and drop shadow left unchanged.
- **`/src/engine/renderer.ts`** — Added optional `colors` parameter to `drawRunner()` method, forwarded to `drawRunnerSprite()`
- **`/convex/schema.ts`** — Added `runnerColor: v.optional(v.string())` to the players array object in rooms table
- **`/convex/rooms.ts`** — Added `setRunnerColor` mutation (validates room exists, status is waiting, player is in room; does NOT unready players)
- **`/src/components/Lobby.tsx`** — Added color picker UI with 6 circular swatches below role cards (only visible when Runner role selected), gold ring highlight on selected color, mutation hook for `setRunnerColor`
- **`/src/components/GameCanvas.tsx`** — Added `runnerColorPresetId` prop, resolved preset via `getRunnerPreset()` stored in ref, passed colors to `renderer.drawRunner()` for Runner view and `renderWhisperEntities()` for Whisper view
- **`/src/app/game/[roomId]/page.tsx`** — Read runner player's `runnerColor` from room data, passed as `runnerColorPresetId` prop to GameCanvas
- **`/src/game/whisper-view.ts`** — Added optional `runnerColor` parameter to `renderWhisperEntities()`, replaced hardcoded `#FF8C42` with the runner's chosen body color

### What Was Built
- 6 color presets selectable in the lobby when a player has the Runner role
- Colors are stored in Convex room state (persists across refreshes, visible to both players)
- Runner sprite renders in the chosen color on both the Runner's fog-of-war view AND the Whisper's blueprint view
- Fully backward-compatible: all existing call sites and rooms without the field default to "classic" (original orange)
- Does not modify share card, replay map, eye color, item glow, or drop shadow

### Verification
- `npm run build` — passes with no errors
- `npm run lint` — passes (0 errors, only pre-existing warnings in auto-generated Convex files)

---

## Review Notes (reviewer: 87b38cd6)

**All code approved — no fixes needed.**

Reviewed all 9 files (1 created, 8 modified). Findings:

- **Type safety**: All color types properly defined via `RunnerColorPreset` interface. No `any` types. Optional parameters with correct `??` fallbacks throughout.
- **Backward compatibility**: All color parameters are optional. `drawRunnerSprite()` falls back to original hardcoded hex values. Schema field is `v.optional(v.string())`. Existing rooms/call sites unaffected.
- **Server validation**: `setRunnerColor` mutation correctly validates room exists, status is "waiting", and player is in room. Does not unready players (correct for cosmetic change).
- **Both views**: Runner colors properly threaded to both Runner view (`renderer.drawRunner` at GameCanvas:1309) and Whisper blueprint view (`renderWhisperEntities` at GameCanvas:1378 via `.body` color).
- **Canvas rendering**: No memory leaks or unnecessary redraws introduced. Color ref updated via `useEffect`, read from `runnerColorsRef.current` inside game loop closure.
- **No security issues**: Color preset stored as string ID in Convex, resolved client-side from a fixed preset list. No injection vectors.
- **Build**: `npm run build` passes. `npm run lint` passes (only pre-existing warnings).

Minor observation: Whisper-view's fallback runner color changed from `#FF8C42` to `#E39B32` (the actual sprite body color) when the "classic" preset is active. This is a visual improvement — the blueprint dot now matches the actual runner sprite color.
