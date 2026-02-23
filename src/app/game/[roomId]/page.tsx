"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../../convex/_generated/api";
import { getSessionId } from "@/lib/session";
import Lobby from "@/components/Lobby";
import GameCanvas from "@/components/GameCanvas";
import RoomJoiner from "@/components/RoomJoiner";

function useSessionId(): string | null {
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return null;
    return getSessionId();
  });
  return sessionId;
}

export default function GamePage() {
  const params = useParams<{ roomId: string }>();
  const roomCode = params.roomId;
  const sessionId = useSessionId();

  const room = useQuery(api.rooms.getRoom, { roomCode });

  // Loading states
  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2D1B0E]">
        <p className="text-[#E8D5B7]">Loading...</p>
      </div>
    );
  }

  if (room === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2D1B0E]">
        <p className="text-[#E8D5B7]">Connecting to room...</p>
      </div>
    );
  }

  if (room === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2D1B0E]">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg">Room not found</p>
          <Link
            href="/"
            className="inline-block px-6 py-2 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                       hover:bg-[#FFC107] transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Check if player is already in the room
  const isPlayerInRoom = room.players.some((p) => p.sessionId === sessionId);

  // If not in the room yet and room is waiting, show the joiner
  if (!isPlayerInRoom && room.status === "waiting") {
    return <RoomJoiner roomCode={roomCode} sessionId={sessionId} />;
  }

  // Non-players can't access a game that's already started
  if (!isPlayerInRoom) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2D1B0E]">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg">This game is already in progress</p>
          <Link
            href="/"
            className="inline-block px-6 py-2 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                       hover:bg-[#FFC107] transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Show lobby or game based on room status
  if (room.status === "waiting") {
    return <Lobby roomCode={roomCode} sessionId={sessionId} />;
  }

  // Determine current player's role
  const currentPlayer = room.players.find((p) => p.sessionId === sessionId);
  const playerRole = currentPlayer?.role ?? "runner";

  return (
    <GameCanvas
      roomId={room._id}
      sessionId={sessionId}
      role={playerRole as "runner" | "whisper"}
    />
  );
}
