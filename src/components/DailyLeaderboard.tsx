"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

function getTodayDateKey(): string {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface DailyLeaderboardProps {
  highlightRoomCode?: string;
}

export default function DailyLeaderboard({ highlightRoomCode }: DailyLeaderboardProps) {
  const dateKey = getTodayDateKey();
  const entries = useQuery(api.leaderboard.getDailyLeaderboard, { dateKey });

  if (entries === undefined) {
    return (
      <div className="bg-[#2D1B0E] rounded-xl border border-[#FFD700]/20 p-5 max-w-md w-full">
        <h3 className="text-[#FFD700] font-bold text-lg text-center mb-4">
          Today&apos;s Top Heists
        </h3>
        <p className="text-[#8B7355] text-sm text-center">Loading...</p>
      </div>
    );
  }

  return (
    <div className="bg-[#2D1B0E] rounded-xl border border-[#FFD700]/20 p-5 max-w-md w-full">
      <h3 className="text-[#FFD700] font-bold text-lg text-center mb-4">
        Today&apos;s Top Heists
      </h3>
      {entries.length === 0 ? (
        <p className="text-[#8B7355] text-sm text-center">
          No scores yet — be the first!
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => {
            const isMe = entry.roomCode === highlightRoomCode;
            return (
              <div
                key={entry._id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                  ${isMe ? "bg-[#FFD700]/10 border border-[#FFD700]/40" : "bg-black/20"}`}
              >
                <span className="text-[#FFD700] font-bold w-6 text-center">
                  {i + 1}
                </span>
                <span className={`flex-1 truncate ${isMe ? "text-[#FFD700]" : "text-[#E8D5B7]"}`}>
                  {entry.teamName}
                </span>
                <span className="text-[#FFD700]/60 text-xs">
                  {"★".repeat(entry.stealthRating)}
                  {"☆".repeat(3 - entry.stealthRating)}
                </span>
                <span className="text-[#E8D5B7] font-mono font-bold w-16 text-right">
                  {entry.score.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
