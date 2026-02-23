export interface ShareData {
  outcome: "escaped" | "caught" | "timeout" | "disconnected";
  score: number;
  stealthRating: number; // 1-3
  playStyleTitle: string;
  heistDurationMs: number;
  itemName: string;
  hasItem: boolean;
  teamName: string;
  isDaily: boolean;
  panicMoments: number;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatStars(rating: number): string {
  return "⭐".repeat(rating) + "☆".repeat(3 - rating);
}

export function generateShareText(data: ShareData): string | null {
  if (data.outcome === "disconnected") return null;

  const url = typeof window !== "undefined" ? window.location.origin : "whisperrun.app";
  const time = formatTime(data.heistDurationMs);
  const score = data.score.toLocaleString();
  const lines: string[] = [];

  if (data.isDaily) {
    // Daily challenge format — compact
    lines.push(data.outcome === "escaped"
      ? "🎯 WhisperRun Daily Challenge"
      : "🎯 WhisperRun Daily — " + (data.outcome === "caught" ? "Busted!" : "Time's Up!"));
    lines.push("");
    if (data.outcome === "escaped" && data.stealthRating > 0) {
      lines.push(`${formatStars(data.stealthRating)} "${data.playStyleTitle}"`);
    } else if (data.playStyleTitle) {
      lines.push(`"${data.playStyleTitle}"`);
    }
    lines.push(`Score: ${score} pts | Time: ${time}`);
    lines.push(`Team: ${data.teamName}`);
    lines.push("");
    lines.push(data.outcome === "escaped" ? "Can you beat us? 🏃‍♂️" : "Can you do better? 🎮");
    lines.push(url);
  } else if (data.outcome === "escaped") {
    lines.push("🏆 WhisperRun — Heist Complete!");
    lines.push("");
    if (data.stealthRating > 0) {
      lines.push(`${formatStars(data.stealthRating)} "${data.playStyleTitle}"`);
    } else if (data.playStyleTitle) {
      lines.push(`"${data.playStyleTitle}"`);
    }
    lines.push(`Score: ${score} pts`);
    lines.push(`Time: ${time}`);
    lines.push(`Panic moments: ${data.panicMoments}`);
    if (data.hasItem) {
      lines.push(`Stolen: ${data.itemName}`);
    }
    lines.push("");
    lines.push(`Team: ${data.teamName}`);
    lines.push("");
    lines.push("Can you do better? 🎮");
    lines.push(url);
  } else {
    // caught or timeout
    const header = data.outcome === "caught" ? "Busted!" : "Time's Up!";
    lines.push(`💀 WhisperRun — ${header}`);
    lines.push("");
    if (data.playStyleTitle) {
      lines.push(`"${data.playStyleTitle}"`);
    }
    lines.push(`Score: ${score} pts`);
    lines.push(`Time: ${time}`);
    lines.push(`Panic moments: ${data.panicMoments}`);
    lines.push("");
    lines.push(`Team: ${data.teamName}`);
    lines.push("");
    lines.push("Can you do better? 🎮");
    lines.push(url);
  }

  return lines.join("\n");
}
