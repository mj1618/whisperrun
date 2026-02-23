"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { GameEvent } from "@/game/events";
import { calculateScore } from "@/game/scoring";
import { generateHighlights, formatEventTime } from "@/game/highlights";

interface ResultsScreenProps {
  outcome: "escaped" | "caught" | "timeout" | "disconnected";
  heistStartTime?: number;
  itemName: string;
  hasItem: boolean;
  roomCode: string;
  sessionId: string;
  role: "runner" | "whisper";
  events?: GameEvent[];
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const OUTCOME_CONFIG = {
  escaped: {
    title: "You Escaped!",
    subtitle: "The heist was a success! The loot is yours.",
    accent: "#4CAF50",
    bgAccent: "from-green-900/30 to-transparent",
    borderColor: "border-green-500/30",
  },
  caught: {
    title: "Busted!",
    subtitle: "The guard politely escorted you out of the building.",
    accent: "#FF6B6B",
    bgAccent: "from-red-900/30 to-transparent",
    borderColor: "border-red-500/30",
  },
  timeout: {
    title: "Time's Up!",
    subtitle: "The building closed for the night. Better luck next time!",
    accent: "#FFB74D",
    bgAccent: "from-amber-900/30 to-transparent",
    borderColor: "border-amber-500/30",
  },
  disconnected: {
    title: "Partner Disconnected",
    subtitle: "Your partner left the heist. Maybe next time!",
    accent: "#90A4AE",
    bgAccent: "from-gray-900/30 to-transparent",
    borderColor: "border-gray-500/30",
  },
} as const;

export default function ResultsScreen({
  outcome,
  heistStartTime,
  itemName,
  hasItem,
  roomCode,
  sessionId,
  role,
  events,
}: ResultsScreenProps) {
  const router = useRouter();
  const resetRoom = useMutation(api.rooms.resetRoom);
  const config = OUTCOME_CONFIG[outcome];
  const [heistDuration] = useState(() =>
    heistStartTime ? Date.now() - heistStartTime : 0
  );

  const isDisconnected = outcome === "disconnected";
  const hasEvents = events && events.length > 0 && !isDisconnected;

  const score = useMemo(
    () =>
      hasEvents
        ? calculateScore(outcome as "escaped" | "caught" | "timeout", heistDuration, events)
        : null,
    [hasEvents, outcome, heistDuration, events]
  );

  const highlights = useMemo(
    () => (hasEvents ? generateHighlights(events) : []),
    [hasEvents, events]
  );

  const stars = score?.stealthRating ?? 0;

  const handlePlayAgain = async () => {
    try {
      await resetRoom({ roomCode, sessionId });
    } catch {
      // Room may already be reset by the other player
    }
  };

  const handleHome = () => {
    router.push("/");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 overflow-y-auto py-8"
      style={{ animation: "fade-in 0.5s ease-out" }}
    >
      <div
        className={`bg-[#2D1B0E] rounded-2xl p-8 max-w-md w-full mx-4 space-y-6 border ${config.borderColor} bg-gradient-to-b ${config.bgAccent}`}
        style={{ animation: "scale-in 0.3s ease-out" }}
      >
        {/* Title + Play Style */}
        <div className="text-center space-y-2">
          <h2
            className="text-4xl font-bold"
            style={{ color: config.accent }}
          >
            {config.title}
          </h2>
          {score && (
            <p className="text-[#FFD700] font-bold text-lg">
              &ldquo;{score.playStyleTitle}&rdquo;
            </p>
          )}
          {!score && (
            <p className="text-[#E8D5B7]/70 text-sm">{config.subtitle}</p>
          )}
          {/* Stealth stars */}
          {stars > 0 && (
            <div className="text-[#FFD700] text-2xl tracking-wider">
              {Array.from({ length: stars }, (_, i) => (
                <span key={i}>&#9733;</span>
              ))}
              {Array.from({ length: 3 - stars }, (_, i) => (
                <span key={i} className="opacity-20">
                  &#9733;
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Score & Stats card — skip for disconnected games */}
        {!isDisconnected && (
          <div className="bg-black/30 rounded-xl p-5 space-y-3">
            {score && (
              <div className="flex justify-between items-center">
                <span className="text-[#E8D5B7]/60 text-sm">Score</span>
                <span className="text-[#FFD700] font-mono font-bold text-lg">
                  {score.total.toLocaleString()}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="text-[#E8D5B7]/60 text-sm">Time</span>
              <span className="text-[#E8D5B7] font-mono font-bold">
                {formatDuration(heistDuration)}
              </span>
            </div>

            {score && score.timeBonus > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-[#E8D5B7]/60 text-sm">Time Bonus</span>
                <span className="text-[#4CAF50] font-mono text-sm">
                  +{score.timeBonus}
                </span>
              </div>
            )}

            {score && score.stealthBonus > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-[#E8D5B7]/60 text-sm">Stealth</span>
                <span className="text-[#4CAF50] font-mono text-sm">
                  +{score.stealthBonus}
                </span>
              </div>
            )}

            {score && score.stylePoints > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-[#E8D5B7]/60 text-sm">Style</span>
                <span className="text-[#4CAF50] font-mono text-sm">
                  +{score.stylePoints}
                </span>
              </div>
            )}

            {score && (
              <div className="flex justify-between items-center">
                <span className="text-[#E8D5B7]/60 text-sm">Panic Moments</span>
                <span className="text-[#FF6B6B] font-mono text-sm">
                  {score.panicMoments}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="text-[#E8D5B7]/60 text-sm">Item</span>
              <span
                className={`text-sm font-bold ${hasItem ? "text-[#FFD700]" : "text-[#E8D5B7]/40"}`}
              >
                {hasItem ? itemName : `${itemName} (missed)`}
              </span>
            </div>

            {!hasEvents && role === "whisper" && (
              <p className="text-[#E8D5B7]/40 text-xs text-center pt-1">
                Score tracked for the Runner
              </p>
            )}
          </div>
        )}

        {/* Highlight Reel */}
        {highlights.length > 0 && (
          <div className="bg-black/30 rounded-xl p-5 space-y-3">
            <h3 className="text-[#FFD700] font-bold text-sm uppercase tracking-wider">
              Highlight Reel
            </h3>
            <div className="space-y-2">
              {highlights.map((h, i) => (
                <div key={i} className="flex gap-3 border-l-2 border-[#FFD700]/30 pl-3">
                  <span className="text-[#E8D5B7]/40 font-mono text-xs shrink-0 w-8 pt-0.5">
                    {formatEventTime(h.timestamp)}
                  </span>
                  <span className="text-[#E8D5B7]/80 text-sm">
                    {h.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handlePlayAgain}
            className="flex-1 px-6 py-3 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                       hover:bg-[#FFC107] transition-colors text-base cursor-pointer"
          >
            Play Again
          </button>
          <button
            onClick={handleHome}
            className="flex-1 px-6 py-3 bg-[#E8D5B7]/10 text-[#E8D5B7] font-bold rounded-lg
                       hover:bg-[#E8D5B7]/20 transition-colors text-base border border-[#E8D5B7]/20 cursor-pointer"
          >
            Home
          </button>
        </div>
      </div>
    </div>
  );
}
