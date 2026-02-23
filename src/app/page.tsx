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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#2D1B0E]">
      <div className="text-center space-y-8">
        <h1 className="text-6xl font-bold text-[#FFD700] drop-shadow-lg tracking-tight">
          WhisperRun
        </h1>
        <p className="text-xl text-[#E8D5B7] max-w-md mx-auto">
          A cozy two-player co-op micro-heist. One sneaks, one guides.
          Steal the thing. Don&apos;t get caught.
        </p>
        <button
          onClick={handleCreateGame}
          disabled={creating}
          className="inline-block px-8 py-4 bg-[#FFD700] text-[#2D1B0E] font-bold text-lg rounded-xl
                     hover:bg-[#FFC107] hover:scale-105 transition-all duration-200
                     shadow-lg hover:shadow-xl disabled:opacity-50 disabled:hover:scale-100"
        >
          {creating ? "Creating..." : "Create Game"}
        </button>
        <p className="text-sm text-[#8B7355]">
          No account needed — just share the link with a friend
        </p>
      </div>
    </div>
  );
}
