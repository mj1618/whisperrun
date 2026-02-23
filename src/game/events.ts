export type GameEventType =
  | "heist_start"
  | "item_pickup"
  | "near_miss"
  | "guard_alert"
  | "guard_lost"
  | "hide_enter"
  | "hide_escape"
  | "ping_sent"
  | "crouching_sneak"
  | "escape"
  | "caught"
  | "timeout";

export interface GameEvent {
  type: GameEventType;
  timestamp: number; // ms since heist start
  data?: {
    guardId?: string;
    x?: number;
    y?: number;
    itemName?: string;
    distance?: number; // How close a near-miss was, in tiles
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

  count(type: GameEventType): number {
    return this.events.filter((e) => e.type === type).length;
  }

  closestNearMiss(): number | null {
    const nearMisses = this.events
      .filter((e) => e.type === "near_miss" && e.data?.distance != null)
      .map((e) => e.data!.distance!);
    return nearMisses.length > 0 ? Math.min(...nearMisses) : null;
  }

  reset(): void {
    this.events = [];
    this.heistStartTime = 0;
  }
}
