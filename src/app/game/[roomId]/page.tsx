"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../../convex/_generated/api";
import { getSessionId } from "@/lib/session";
import { GameEvent, PositionPoint } from "@/game/events";
import { DifficultyLevel } from "@/game/difficulty";
import Lobby from "@/components/Lobby";
import GameCanvas from "@/components/GameCanvas";
import RoomJoiner from "@/components/RoomJoiner";
import ResultsScreen from "@/components/ResultsScreen";

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
  const [gameEvents, setGameEvents] = useState<GameEvent[]>([]);
  const [positionTrail, setPositionTrail] = useState<PositionPoint[]>([]);

  const room = useQuery(api.rooms.getRoom, { roomCode });
  const gameState = useQuery(
    api.game.getGameState,
    room?._id ? { roomId: room._id } : "skip"
  );

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

  // Determine current player's role
  const currentPlayer = room.players.find((p) => p.sessionId === sessionId);
  const playerRole = (currentPlayer?.role ?? "runner") as "runner" | "whisper";

  // Show lobby when waiting
  if (room.status === "waiting") {
    return <Lobby roomCode={roomCode} sessionId={sessionId} />;
  }

  const gameDifficulty = (gameState?.difficulty as DifficultyLevel | undefined) ?? (room.difficulty as DifficultyLevel | undefined) ?? "standard";

  // Finished state — show ResultsScreen
  if (
    room.status === "finished" &&
    gameState &&
    (gameState.phase === "escaped" ||
      gameState.phase === "caught" ||
      gameState.phase === "timeout" ||
      gameState.phase === "disconnected")
  ) {
    return (
      <ResultsScreen
        outcome={gameState.phase}
        heistStartTime={gameState.heistStartTime}
        itemName={gameState.items[0]?.name ?? "Golden Rubber Duck"}
        hasItem={gameState.runner.hasItem}
        roomCode={roomCode}
        sessionId={sessionId}
        role={playerRole}
        events={gameEvents}
        positionTrail={positionTrail}
        mapSeed={room.mapSeed}
        difficulty={gameDifficulty}
      />
    );
  }

  // Playing state — show game
  return (
    <GameCanvas
      roomId={room._id}
      roomCode={roomCode}
      sessionId={sessionId}
      role={playerRole}
      mapSeed={room.mapSeed}
      difficulty={gameDifficulty}
      onGameEnd={(data) => {
        setGameEvents(data.events);
        setPositionTrail(data.positionTrail);
      }}
    />
  );
}
