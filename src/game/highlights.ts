import { GameEvent } from "./events";

export interface Highlight {
  text: string;
  timestamp: number;
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
        const distText =
          dist != null ? ` (${dist.toFixed(1)} tiles away)` : "";
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
  highlights.sort(
    (a, b) => b.importance - a.importance || a.timestamp - b.timestamp
  );

  return highlights.slice(0, 5);
}

export function formatEventTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
