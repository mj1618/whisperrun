export interface LaserTripwire {
  id: string;
  /** Emitter position (tile coordinates — the wall tile the laser originates from) */
  x1: number;
  y1: number;
  /** Receiver position (tile coordinates — the wall tile the laser ends at) */
  x2: number;
  y2: number;
  /** Pattern timing: beam is on for `onDurationMs`, off for `offDurationMs` */
  onDurationMs: number;
  offDurationMs: number;
  /** Offset into the cycle at game start (so not all lasers pulse in sync) */
  phaseOffsetMs: number;
}

/**
 * Determine if a laser is currently active based on elapsed time.
 * Lasers cycle: ON for onDurationMs, then OFF for offDurationMs, repeat.
 */
export function isLaserActive(laser: LaserTripwire, elapsedMs: number): boolean {
  const cycleLength = laser.onDurationMs + laser.offDurationMs;
  if (cycleLength <= 0) return true;
  const adjustedTime = ((elapsedMs + laser.phaseOffsetMs) % cycleLength + cycleLength) % cycleLength;
  return adjustedTime < laser.onDurationMs;
}

/**
 * Check if the Runner at (rx, ry) is intersecting an active laser beam.
 * The beam goes between the inner edges of the two wall tiles.
 * The Runner has a small radius (~0.3 tiles).
 */
export function isRunnerInLaser(
  laser: LaserTripwire,
  runnerX: number,
  runnerY: number,
  runnerRadius: number = 0.3
): boolean {
  // The beam goes between the inner edges of the two wall tiles
  const bx1 = laser.x1 < laser.x2 ? laser.x1 + 0.9 : laser.x1 > laser.x2 ? laser.x1 + 0.1 : laser.x1 + 0.5;
  const by1 = laser.y1 < laser.y2 ? laser.y1 + 0.9 : laser.y1 > laser.y2 ? laser.y1 + 0.1 : laser.y1 + 0.5;
  const bx2 = laser.x2 < laser.x1 ? laser.x2 + 0.9 : laser.x2 > laser.x1 ? laser.x2 + 0.1 : laser.x2 + 0.5;
  const by2 = laser.y2 < laser.y1 ? laser.y2 + 0.9 : laser.y2 > laser.y1 ? laser.y2 + 0.1 : laser.y2 + 0.5;

  const dist = pointToSegmentDist(runnerX, runnerY, bx1, by1, bx2, by2);
  return dist < runnerRadius;
}

function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}
