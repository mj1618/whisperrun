"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

interface ResultsScreenProps {
  outcome: "escaped" | "caught" | "timeout";
  heistStartTime?: number;
  itemName: string;
  hasItem: boolean;
  roomCode: string;
  sessionId: string;
  role: "runner" | "whisper";
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getStealthRating(outcome: string, durationMs: number): number {
  if (outcome !== "escaped") return 0;
  if (durationMs < 60_000) return 3;
  if (durationMs < 120_000) return 2;
  return 1;
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
} as const;

export default function ResultsScreen({
  outcome,
  heistStartTime,
  itemName,
  hasItem,
  roomCode,
  sessionId,
  role,
}: ResultsScreenProps) {
  const router = useRouter();
  const resetRoom = useMutation(api.rooms.resetRoom);
  const config = OUTCOME_CONFIG[outcome];
  // Capture duration once on mount to avoid calling Date.now() during render
  const [heistDuration] = useState(() => heistStartTime ? Date.now() - heistStartTime : 0);
  const stars = getStealthRating(outcome, heistDuration);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" style={{ animation: "fade-in 0.5s ease-out" }}>
      <div className={`bg-[#2D1B0E] rounded-2xl p-8 max-w-md w-full mx-4 space-y-6 border ${config.borderColor} bg-gradient-to-b ${config.bgAccent}`} style={{ animation: "scale-in 0.3s ease-out" }}>
        {/* Title */}
        <div className="text-center space-y-2">
          <h2
            className="text-4xl font-bold"
            style={{ color: config.accent }}
          >
            {config.title}
          </h2>
          <p className="text-[#E8D5B7]/70 text-sm">
            {config.subtitle}
          </p>
        </div>

        {/* Stats card */}
        <div className="bg-black/30 rounded-xl p-5 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[#E8D5B7]/60 text-sm">Time</span>
            <span className="text-[#E8D5B7] font-mono font-bold">
              {formatDuration(heistDuration)}
            </span>
          </div>

          {outcome === "escaped" && (
            <div className="flex justify-between items-center">
              <span className="text-[#E8D5B7]/60 text-sm">Stealth</span>
              <span className="text-[#FFD700] text-lg tracking-wider">
                {Array.from({ length: stars }, (_, i) => (
                  <span key={i}>&#9733;</span>
                ))}
                {Array.from({ length: 3 - stars }, (_, i) => (
                  <span key={i} className="opacity-20">&#9733;</span>
                ))}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-[#E8D5B7]/60 text-sm">Item</span>
            <span className={`text-sm font-bold ${hasItem ? "text-[#FFD700]" : "text-[#E8D5B7]/40"}`}>
              {hasItem ? itemName : `${itemName} (missed)`}
            </span>
          </div>
        </div>

        {/* Players card */}
        <div className="bg-black/30 rounded-xl p-5 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[#E8D5B7]/60 text-sm">Your Role</span>
            <span className={`text-sm font-bold uppercase tracking-wider ${
              role === "runner" ? "text-[#FF8C42]" : "text-[#8BB8E8]"
            }`}>
              {role}
            </span>
          </div>
        </div>

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
