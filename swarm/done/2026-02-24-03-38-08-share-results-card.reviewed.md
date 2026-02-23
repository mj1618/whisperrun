# Task: Share Results Card

## Overview

After a heist, players see their score, stealth rating, highlight reel, and (soon) a visual replay map. But there's no way to **share** these results. The viral loop (play → see results → share → friends join → play) breaks at "share."

This task adds a **Share Score** button to the results screen that generates a beautifully formatted text snippet and copies it to the clipboard. For daily challenges, it also includes a call-to-action inviting friends to try today's challenge. The share text uses emoji and Unicode art to create a visually appealing card that looks great in Discord, iMessage, Slack, Twitter, and other chat platforms.

This is the highest-impact feature for organic growth — it turns every completed heist into a potential invitation. It's also low-complexity (entirely client-side, no backend changes) and builds directly on the existing scoring, team name, and daily challenge infrastructure.

## What to Build

### 1. Generate Share Text (`/src/lib/share.ts` — CREATE)

Create a utility that generates the share text from results data:

```typescript
export interface ShareData {
  outcome: "escaped" | "caught" | "timeout" | "disconnected";
  score: number;
  stealthRating: number;  // 1-3
  playStyleTitle: string;
  heistDurationMs: number;
  itemName: string;
  hasItem: boolean;
  teamName: string;
  isDaily: boolean;
  panicMoments: number;
}

export function generateShareText(data: ShareData): string {
  // ... builds formatted text
}
```

**Share text format for escapes:**
```
🏆 WhisperRun — Heist Complete!

⭐⭐⭐ "Ghost"
Score: 1,840 pts
Time: 1:23
Panic moments: 0
Stolen: The Golden Rubber Duck

Team: Sneaky Otters

🎯 Try today's daily challenge!
whisperrun.app
```

**Share text format for failures (caught/timeout):**
```
💀 WhisperRun — Busted!

"Too Bold for Your Own Good"
Score: 350 pts
Time: 2:15
Panic moments: 4

Team: Crafty Penguins

Can you do better? 🎮
whisperrun.app
```

**Key formatting rules:**
- Stars use ⭐ emoji (filled) and ☆ (empty) — only for escapes with stealthRating > 0
- Score formatted with commas (toLocaleString)
- Time formatted as M:SS
- Daily challenge games get "🎯 Try today's daily challenge!" CTA
- Non-daily games get "Can you do better? 🎮" CTA
- Disconnected games: don't generate share text (return null)
- The URL should be the deployment URL. Use `window.location.origin` so it works in any environment (localhost, preview, production)
- Keep it concise — under 280 characters when possible (fits in a tweet) for the core info, with the CTA as optional extra lines
- Include the team name for daily challenges (it appears on the leaderboard)
- DO NOT include the room code or invite link to the specific game — the game is over

### 2. Share Button on Results Screen (`/src/components/ResultsScreen.tsx` — MODIFY)

Add a "Share Score" button in the action buttons section, between the score card and "Play Again":

```tsx
// New state:
const [copied, setCopied] = useState(false);

// Share handler:
const handleShare = async () => {
  const teamName = generateTeamName(roomCode);
  const text = generateShareText({
    outcome,
    score: score?.total ?? 0,
    stealthRating: stars,
    playStyleTitle: score?.playStyleTitle ?? "",
    heistDurationMs: heistDuration,
    itemName,
    hasItem,
    teamName,
    isDaily,
    panicMoments: score?.panicMoments ?? 0,
  });
  if (!text) return;

  // Try Web Share API first (mobile), fall back to clipboard
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      // User cancelled or not supported — fall through to clipboard
    }
  }

  await navigator.clipboard.writeText(text);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
};
```

**Button placement:** Add a row above the "Play Again" / "Home" buttons:

```tsx
{/* Share button — only for non-disconnected games with a score */}
{!isDisconnected && score && (
  <button
    onClick={handleShare}
    className="w-full px-6 py-3 bg-[#E8D5B7]/10 text-[#E8D5B7] font-bold rounded-lg
               hover:bg-[#E8D5B7]/20 transition-all text-sm border border-[#E8D5B7]/20
               cursor-pointer flex items-center justify-center gap-2"
  >
    {copied ? (
      <>
        <span className="text-[#4CAF50]">✓</span>
        Copied!
      </>
    ) : (
      <>
        <ShareIcon />
        Share Score
      </>
    )}
  </button>
)}
```

**ShareIcon:** A small inline SVG share icon (the standard "box with arrow" pattern):

```tsx
function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8v5a1 1 0 001 1h6a1 1 0 001-1V8" />
      <polyline points="8 2 8 10" />
      <polyline points="5 5 8 2 11 5" />
    </svg>
  );
}
```

### 3. Daily Challenge Share Enhancement

For daily challenge games, the share text should feel competitive and social:

```
🎯 WhisperRun Daily Challenge

⭐⭐☆ "Speed Demon"
Score: 1,240 pts | Time: 0:58
Team: Lucky Foxes

Can you beat us? 🏃‍♂️
whisperrun.app
```

Key differences from regular share:
- Header says "Daily Challenge" instead of "Heist Complete"
- CTA says "Can you beat us?" instead of generic
- Include team name prominently (since it's on the leaderboard)
- Slightly more compact format (score + time on one line)

### 4. Imports and Wiring

Import the new utility in ResultsScreen:
```typescript
import { generateShareText } from "@/lib/share";
```

No new props needed — all data is already available in ResultsScreen (`score`, `outcome`, `heistDuration`, `itemName`, `hasItem`, `roomCode`, `role`, `mapSeed`).

The team name is generated from `roomCode` using the existing `generateTeamName` utility (already imported in ResultsScreen).

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `/src/lib/share.ts` | CREATE | `generateShareText()` utility, `ShareData` interface |
| `/src/components/ResultsScreen.tsx` | MODIFY | Add "Share Score" button, copy-to-clipboard handler, Web Share API support, ShareIcon component |

## Key Design Decisions (Already Made)

1. **Text-only share** — No image generation. Text works everywhere (Discord, iMessage, Twitter, Slack, WhatsApp) without requiring canvas-to-image, blob URLs, or download prompts. It's also faster and more reliable.
2. **Web Share API with clipboard fallback** — On mobile (especially iOS Safari), `navigator.share()` opens the native share sheet. On desktop, fall back to clipboard copy with a "Copied!" confirmation. This gives the best UX on every platform.
3. **No room code in share text** — The game is over; sharing a room code would be confusing. The share is about the *score*, not the *session*. The URL (`whisperrun.app`) directs people to create their own game.
4. **Use `window.location.origin` for URL** — Works on localhost during development, on preview deploys, and in production. Don't hardcode a domain.
5. **No backend changes** — This is entirely client-side. The share text is generated from data already available in the ResultsScreen component.
6. **280-character target** — The core info (title, stars, score, time, team name) should fit in a tweet. The CTA line is a bonus that can be trimmed.
7. **No share for disconnected games** — There's nothing fun to share about a disconnect. The button simply doesn't appear.
8. **"Copied!" feedback** — Brief 2-second visual confirmation that the text was copied. No toast/notification library needed — just a state toggle on the button text.

## How to Verify

1. **`npm run build`** — Must compile with no errors.
2. **`npm run lint`** — Must pass.
3. **In browser (two tabs):**
   - Create a game, play through to completion (escape or get caught)
   - **Results screen:** See "Share Score" button above "Play Again"
   - **Click "Share Score":** Text is copied to clipboard (or native share sheet on mobile)
   - **Paste somewhere:** Verify the text looks good — proper emoji, formatted score, team name
   - **For escapes:** Stars shown, "Heist Complete!" header, score + time + item
   - **For caught:** No stars, "Busted!" header, score + time + panic moments
   - **For timeout:** "Time's Up!" header
   - **For disconnected:** Share button not shown
   - **For daily challenge:** "Daily Challenge" header, "Can you beat us?" CTA, team name
   - **After clicking:** Button briefly shows "✓ Copied!" for 2 seconds, then reverts to "Share Score"
4. **Mobile testing:**
   - Tap "Share Score" — native share sheet opens (if `navigator.share` is available)
   - If share sheet is cancelled, clipboard fallback works
5. **Paste into various platforms:**
   - Discord: emoji render correctly, text is readable
   - iMessage: text looks clean
   - Twitter/X: text fits in a tweet (core info under 280 chars)
   - Slack: emoji and formatting intact

## Scope Boundaries

**DO:**
- Create `generateShareText()` utility with proper formatting
- Add "Share Score" button to ResultsScreen
- Use Web Share API on mobile, clipboard fallback on desktop
- Show "Copied!" confirmation for 2 seconds
- Format differently for daily challenges vs regular games
- Use `window.location.origin` for the URL
- Handle all outcomes (escaped, caught, timeout — skip disconnected)

**DO NOT:**
- Generate images or canvas-based share cards (text is simpler and more universal)
- Add social media deep links (Twitter intent URLs, etc.) — clipboard/share API is enough
- Add backend changes or share link generation
- Include the room code or game-specific link in share text
- Add share tracking or analytics
- Create a separate share modal or overlay — the button inline is sufficient
- Add "share replay" functionality (that depends on the Replay Map feature, which is separate)

---

## Completion Summary

### What was built
- **Share text generator** (`/src/lib/share.ts`) — `generateShareText()` utility with `ShareData` interface. Generates formatted text with emoji, stars, score, time, team name, and CTA. Three distinct formats: regular escape, failure (caught/timeout), and daily challenge (compact). Returns `null` for disconnected games. Uses `window.location.origin` for the URL.
- **Share Score button** on ResultsScreen — appears above Play Again/Home buttons for non-disconnected games with a score. Uses Web Share API on mobile (native share sheet), falls back to clipboard copy on desktop. Shows "✓ Copied!" confirmation for 2 seconds. Includes inline SVG share icon.

### Files changed
| File | Action | What |
|------|--------|------|
| `/src/lib/share.ts` | CREATED | `ShareData` interface, `generateShareText()`, `formatTime()`, `formatStars()` helpers |
| `/src/components/ResultsScreen.tsx` | MODIFIED | Added `ShareIcon` component, `copied` state, `handleShare` handler, share button UI |
| `/CLAUDE.md` | MODIFIED | Marked Share Results Card as completed |

### Verification
- `npm run lint` — passes (0 errors, 4 pre-existing warnings in generated files)
- `npm run build` — compiles successfully with no errors

---

## Review Notes

**Reviewer:** a6601969
**Status:** Approved with minor fix

### Issues Found & Fixed

1. **Missing error handling on clipboard write** — `navigator.clipboard.writeText()` can throw if clipboard access is denied (e.g., page not focused, permissions policy). Added try/catch around the clipboard write to prevent unhandled promise rejection.

### Code Quality Notes

- `share.ts`: Clean implementation. Three distinct formats (daily, regular escape, failure) are well-structured. `formatStars` handles 0 rating correctly. `window.location.origin` fallback for SSR is appropriate. Returns `null` for disconnected games as specified.
- `ResultsScreen.tsx`: Share button integration is clean. Web Share API with clipboard fallback is the right pattern. The `ShareIcon` SVG is well-formed. Button placement (above action buttons, below replay) is logical.
- The share text format is concise and platform-friendly.
- Build and lint pass cleanly.

---

## Review Notes (Pass 2)

**Reviewer:** caaa5523
**Status:** Approved, no additional fixes needed

### Confirmed Clean

- `share.ts`: All three share text formats (daily, regular escape, failure) are correct. Returns `null` for disconnected. `window.location.origin` with SSR fallback is properly handled. `formatStars` correctly renders filled/empty stars for 0-3 ratings.
- `ResultsScreen.tsx`: Share button only shown for non-disconnected games with a score. Web Share API tried first with clipboard fallback. Clipboard write is properly wrapped in try/catch (fixed by previous reviewer). "Copied!" feedback state resets after 2 seconds.
- No new issues found.
