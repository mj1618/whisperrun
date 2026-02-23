import { GameEvent } from "./events";

export interface ScoreBreakdown {
  total: number;
  timeBonus: number;
  stealthBonus: number;
  stylePoints: number;
  panicMoments: number;
  sneakCount: number;
  nearMissCount: number;
  closestCall: number | null;
  clutchHides: number;
  stealthRating: number;
  playStyleTitle: string;
}

export function calculateScore(
  outcome: "escaped" | "caught" | "timeout",
  heistDurationMs: number,
  events: GameEvent[]
): ScoreBreakdown {
  const alertCount = events.filter((e) => e.type === "guard_alert").length;
  const nearMissCount = events.filter((e) => e.type === "near_miss").length;
  const sneakCount = events.filter((e) => e.type === "crouching_sneak").length;
  const hideEscapeCount = events.filter((e) => e.type === "hide_escape").length;
  const laserTripCount = events.filter((e) => e.type === "laser_tripped").length;
  const escalationCount = events.filter((e) => e.type === "guard_escalation").length;
  const panicMoments = alertCount + nearMissCount + laserTripCount + escalationCount;

  const nearMissDistances = events
    .filter((e) => e.type === "near_miss" && e.data?.distance != null)
    .map((e) => e.data!.distance!);
  const closestCall =
    nearMissDistances.length > 0 ? Math.min(...nearMissDistances) : null;

  // Time bonus (only for escapes): 1000 points for under 30s, scaling down to 0 at 180s
  let timeBonus = 0;
  if (outcome === "escaped") {
    const seconds = heistDurationMs / 1000;
    timeBonus = Math.max(0, Math.round(1000 * (1 - seconds / 180)));
  }

  // Stealth bonus: starts at 500, lose 100 per alert, lose 50 per near-miss, lose 75 per laser trip
  let stealthBonus = 500;
  stealthBonus -= alertCount * 100;
  stealthBonus -= nearMissCount * 50;
  stealthBonus -= laserTripCount * 75;
  stealthBonus -= escalationCount * 50;
  stealthBonus = Math.max(0, stealthBonus);
  if (outcome !== "escaped") stealthBonus = 0;

  // Style points: bonus for cool moves
  let stylePoints = 0;
  stylePoints += sneakCount * 75;
  stylePoints += hideEscapeCount * 100;
  if (outcome === "escaped") {
    stylePoints += nearMissCount * 50;
  }

  // Stealth rating (1-3 stars)
  let stealthRating = 0;
  if (outcome === "escaped") {
    if (heistDurationMs < 60_000 && alertCount === 0 && laserTripCount === 0) stealthRating = 3;
    else if (heistDurationMs < 120_000 && alertCount <= 1 && laserTripCount <= 1) stealthRating = 2;
    else stealthRating = 1;
  }

  const playStyleTitle = getPlayStyleTitle(
    outcome,
    alertCount,
    nearMissCount,
    sneakCount,
    heistDurationMs
  );

  const total = timeBonus + stealthBonus + stylePoints;

  return {
    total,
    timeBonus,
    stealthBonus,
    stylePoints,
    panicMoments,
    sneakCount,
    nearMissCount,
    closestCall,
    clutchHides: hideEscapeCount,
    stealthRating,
    playStyleTitle,
  };
}

function getPlayStyleTitle(
  outcome: string,
  alerts: number,
  nearMisses: number,
  sneaks: number,
  durationMs: number
): string {
  if (outcome === "caught") {
    if (alerts === 0) return "Wrong Place, Wrong Time";
    return "Too Bold for Your Own Good";
  }
  if (outcome === "timeout") {
    return "The Indecisive Burglar";
  }
  // Escaped:
  if (alerts === 0 && nearMisses === 0) return "Ghost";
  if (alerts === 0 && sneaks >= 3) return "Shadow Dancer";
  if (durationMs < 45_000) return "Speed Demon";
  if (nearMisses >= 3) return "Adrenaline Junkie";
  if (alerts >= 2 && outcome === "escaped") return "Lucky Break";
  if (sneaks >= 2) return "Crouch Master";
  return "Smooth Operator";
}
