"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import InviteLink from "./InviteLink";

type Role = "runner" | "whisper";

interface LobbyProps {
  roomCode: string;
  sessionId: string;
}

export default function Lobby({ roomCode, sessionId }: LobbyProps) {
  const room = useQuery(api.rooms.getRoom, { roomCode });
  const selectRole = useMutation(api.rooms.selectRole);
  const toggleReady = useMutation(api.rooms.toggleReady);
  const startGame = useMutation(api.rooms.startGame);

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2D1B0E]">
        <p className="text-[#E8D5B7] text-lg">Loading lobby...</p>
      </div>
    );
  }

  const me = room.players.find((p) => p.sessionId === sessionId);
  const other = room.players.find((p) => p.sessionId !== sessionId);
  const bothReady = room.players.length === 2 && room.players.every((p) => p.ready);

  const handleSelectRole = async (role: Role) => {
    // If already selected this role, deselect
    const newRole = me?.role === role ? null : role;
    await selectRole({ roomCode, sessionId, role: newRole });
  };

  const handleToggleReady = async () => {
    await toggleReady({ roomCode, sessionId });
  };

  const handleStartGame = async () => {
    await startGame({ roomCode, sessionId });
  };

  function getRoleCardState(role: Role): "available" | "selected" | "taken" {
    if (me?.role === role) return "selected";
    if (other?.role === role) return "taken";
    return "available";
  }

  function getPlayerLabel(role: Role): string {
    const player = room!.players.find((p) => p.role === role);
    if (!player) return "---";
    if (player.sessionId === sessionId) return "You";
    return "Player 2";
  }

  function getStatusMessage(): string {
    if (room!.players.length < 2) return "Waiting for another player...";
    const roles = room!.players.map((p) => p.role);
    if (roles.includes(null)) return "Waiting for role selection...";
    if (!room!.players.every((p) => p.ready)) return "Waiting for everyone to ready up...";
    return "All ready! Start the heist!";
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#2D1B0E] p-6">
      <div className="w-full max-w-xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-4xl font-bold text-[#FFD700] tracking-tight">
            WhisperRun
          </h1>
          <p className="text-[#8B7355] text-sm">
            Room: <span className="font-mono text-[#E8D5B7]">{roomCode}</span>
          </p>
        </div>

        {/* Role Cards */}
        <div className="grid grid-cols-2 gap-4">
          <RoleCard
            title="Runner"
            description="Sneak through the building. Grab the loot. Get out."
            icon="🏃"
            state={getRoleCardState("runner")}
            playerLabel={getPlayerLabel("runner")}
            onSelect={() => handleSelectRole("runner")}
          />
          <RoleCard
            title="Whisper"
            description="See the full map. Spot the guards. Guide your partner."
            icon="👁️"
            state={getRoleCardState("whisper")}
            playerLabel={getPlayerLabel("whisper")}
            onSelect={() => handleSelectRole("whisper")}
          />
        </div>

        {/* Invite Link */}
        <InviteLink roomCode={roomCode} />

        {/* Ready / Start */}
        <div className="text-center space-y-3">
          {!bothReady ? (
            <button
              onClick={handleToggleReady}
              disabled={!me?.role}
              className={`px-8 py-3 font-bold text-lg rounded-xl transition-all duration-200 shadow-lg
                ${me?.ready
                  ? "bg-green-500 text-white hover:bg-green-600 ring-2 ring-green-400"
                  : "bg-[#FFD700] text-[#2D1B0E] hover:bg-[#FFC107] hover:scale-105"
                }
                disabled:opacity-40 disabled:hover:scale-100`}
            >
              {me?.ready ? "Ready!" : "Ready Up"}
            </button>
          ) : (
            <button
              onClick={handleStartGame}
              className="px-8 py-3 bg-green-500 text-white font-bold text-lg rounded-xl
                         hover:bg-green-600 hover:scale-105 transition-all duration-200
                         shadow-lg ring-2 ring-green-400 animate-pulse"
            >
              Start Heist!
            </button>
          )}
          <p className="text-sm text-[#8B7355]">{getStatusMessage()}</p>
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  title,
  description,
  icon,
  state,
  playerLabel,
  onSelect,
}: {
  title: string;
  description: string;
  icon: string;
  state: "available" | "selected" | "taken";
  playerLabel: string;
  onSelect: () => void;
}) {
  const borderClass =
    state === "selected"
      ? "ring-2 ring-[#FFD700]"
      : state === "taken"
        ? "ring-2 ring-[#8B7355] opacity-60"
        : "";

  return (
    <div
      className={`bg-[#3D2B1E] rounded-xl p-5 flex flex-col items-center gap-3 ${borderClass}`}
    >
      <span className="text-4xl">{icon}</span>
      <h2 className="text-xl font-bold text-[#E8D5B7]">{title}</h2>
      <p className="text-xs text-[#8B7355] text-center">{description}</p>

      <button
        onClick={onSelect}
        disabled={state === "taken"}
        className={`mt-auto px-4 py-1.5 text-sm font-bold rounded-lg transition-colors
          ${state === "selected"
            ? "bg-[#FFD700] text-[#2D1B0E]"
            : state === "taken"
              ? "bg-[#3D2B1E] text-[#8B7355] border border-[#8B7355] cursor-not-allowed"
              : "bg-[#2D1B0E] text-[#E8D5B7] border border-[#8B7355] hover:border-[#FFD700] hover:text-[#FFD700]"
          }`}
      >
        {state === "selected" ? "Selected" : state === "taken" ? "Taken" : "Select"}
      </button>

      <p className="text-xs text-[#8B7355]">{playerLabel}</p>
    </div>
  );
}
