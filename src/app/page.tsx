"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getSessionId } from "@/lib/session";

export default function Home() {
  const router = useRouter();
  const createRoom = useMutation(api.rooms.createRoom);
  const [creating, setCreating] = useState(false);
  const [creatingDaily, setCreatingDaily] = useState(false);

  const handleCreateGame = async () => {
    setCreating(true);
    try {
      const sessionId = getSessionId();
      const { roomCode } = await createRoom({ sessionId });
      router.push(`/game/${roomCode}`);
    } catch (e) {
      console.error("Failed to create room:", e);
      setCreating(false);
    }
  };

  const handleDailyChallenge = async () => {
    setCreatingDaily(true);
    try {
      const sessionId = getSessionId();
      const { roomCode } = await createRoom({ sessionId, daily: true });
      router.push(`/game/${roomCode}`);
    } catch (e) {
      console.error("Failed to create daily room:", e);
      setCreatingDaily(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#2D1B0E] relative overflow-hidden">
      {/* Animated background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute w-[800px] h-[800px] rounded-full bg-[#FFD700]/5 blur-3xl
                      -top-40 -left-40 animate-pulse"
          style={{ animationDuration: "8s" }}
        />
        <div
          className="absolute w-[600px] h-[600px] rounded-full bg-[#E39B32]/5 blur-3xl
                      -bottom-40 -right-40 animate-pulse"
          style={{ animationDuration: "12s" }}
        />
      </div>

      <div className="text-center space-y-8 relative z-10">
        <h1 className="text-6xl font-bold text-[#FFD700] drop-shadow-lg tracking-tight">
          WhisperRun
        </h1>
        <p className="text-xl text-[#E8D5B7] max-w-md mx-auto">
          A cozy two-player co-op micro-heist. One sneaks, one guides.
          Steal the thing. Don&apos;t get caught.
        </p>
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={handleCreateGame}
            disabled={creating || creatingDaily}
            className="inline-block px-8 py-4 bg-[#FFD700] text-[#2D1B0E] font-bold text-lg rounded-xl
                       hover:bg-[#FFC107] hover:scale-105 transition-all duration-200
                       shadow-lg hover:shadow-xl disabled:opacity-50 disabled:hover:scale-100"
          >
            {creating ? "Creating..." : "Create Game"}
          </button>
          <button
            onClick={handleDailyChallenge}
            disabled={creating || creatingDaily}
            className="inline-block px-8 py-4 bg-[#2D1B0E] text-[#FFD700] font-bold text-lg rounded-xl
                       border-2 border-[#FFD700]/50 hover:border-[#FFD700] hover:scale-105 transition-all duration-200
                       shadow-lg hover:shadow-xl disabled:opacity-50 disabled:hover:scale-100"
          >
            {creatingDaily ? "Creating..." : "Daily Challenge"}
          </button>
          <p className="text-xs text-[#8B7355]">
            Same map for everyone today
          </p>
        </div>
        <p className="text-sm text-[#8B7355]">
          No account needed — just share the link with a friend
        </p>
      </div>

      {/* Version label */}
      <div className="absolute bottom-3 right-3 text-[#8B7355]/40 text-xs z-10">
        v0.1
      </div>
    </div>
  );
}
