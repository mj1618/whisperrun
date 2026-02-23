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
  | "camera_spotted"
  | "noise_alert"
  | "quick_comm"
  | "escape"
  | "caught"
  | "timeout";

export interface GameEvent {
  type: GameEventType;
  timestamp: number; // ms since heist start
  data?: {
    guardId?: string;
    cameraId?: string;
    x?: number;
    y?: number;
    itemName?: string;
    distance?: number; // How close a near-miss was, in tiles
    messageId?: string;
    text?: string;
  };
}

export interface PositionPoint {
  x: number;
  y: number;
  t: number;
  crouching: boolean;
}

export class EventRecorder {
  private events: GameEvent[] = [];
  private heistStartTime: number = 0;
  private positionTrail: PositionPoint[] = [];

  start(heistStartTime: number): void {
    this.events = [];
    this.positionTrail = [];
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

  recordPosition(x: number, y: number, crouching: boolean): void {
    const t = Date.now() - this.heistStartTime;
    const last = this.positionTrail[this.positionTrail.length - 1];
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < 0.09) return; // 0.3^2 threshold
    }
    this.positionTrail.push({ x, y, t, crouching });
  }

  getPositionTrail(): PositionPoint[] {
    return [...this.positionTrail];
  }

  reset(): void {
    this.events = [];
    this.positionTrail = [];
    this.heistStartTime = 0;
  }
}
