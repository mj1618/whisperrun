import { TILE_SIZE } from "@/engine/renderer";

export interface PingConfig {
  type: "danger" | "go" | "item";
  color: string;
  label: string;
  key: string;
}

export const PING_TYPES: PingConfig[] = [
  { type: "go", color: "#44FF44", label: "Go Here", key: "1" },
  { type: "danger", color: "#FF4444", label: "Danger", key: "2" },
  { type: "item", color: "#FFD700", label: "Item", key: "3" },
];

export const PING_DURATION_MS = 5000;

export function getPingColor(type: string): string {
  return PING_TYPES.find((p) => p.type === type)?.color ?? "#FFFFFF";
}

/**
 * Convert screen coordinates to world tile coordinates for the Whisper's
 * zoomed-out blueprint view.
 */
export function screenToTileWhisper(
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number,
  scale: number
): { x: number; y: number } {
  const worldX = (screenX - offsetX) / scale;
  const worldY = (screenY - offsetY) / scale;
  return {
    x: worldX / TILE_SIZE,
    y: worldY / TILE_SIZE,
  };
}
