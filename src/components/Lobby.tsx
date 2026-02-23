"use client";

import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { generateMap } from "@/game/map-generator";
import { facingToAngle } from "@/game/guard-ai";
import { DifficultyLevel, getDifficultyConfig } from "@/game/difficulty";
import InviteLink from "./InviteLink";
import { RUNNER_COLOR_PRESETS } from "@/game/runner-colors";

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
  const setDifficultyMut = useMutation(api.rooms.setDifficulty);
  const setRunnerColorMut = useMutation(api.rooms.setRunnerColor);
  const heartbeatMut = useMutation(api.rooms.heartbeat);

  // Heartbeat — signal presence every 3 seconds while in lobby
  useEffect(() => {
    if (!roomCode || !sessionId) return;

    // Send initial heartbeat immediately
    heartbeatMut({ roomCode, sessionId }).catch(() => {});

    const interval = setInterval(() => {
      heartbeatMut({ roomCode, sessionId }).catch(() => {});
    }, 3000);

    return () => clearInterval(interval);
  }, [roomCode, sessionId, heartbeatMut]);

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

  const currentDifficulty: DifficultyLevel = (room.difficulty as DifficultyLevel) ?? "standard";

  const handleSetDifficulty = async (level: DifficultyLevel) => {
    await setDifficultyMut({ roomCode, sessionId, difficulty: level });
  };

  const handleSetRunnerColor = async (presetId: string) => {
    await setRunnerColorMut({ roomCode, sessionId, colorPresetId: presetId });
  };

  const handleSelectRole = async (role: Role) => {
    // If already selected this role, deselect
    const newRole = me?.role === role ? null : role;
    await selectRole({ roomCode, sessionId, role: newRole });
  };

  const handleToggleReady = async () => {
    await toggleReady({ roomCode, sessionId });
  };

  const handleStartGame = async () => {
    // Generate map from seed and pass entity positions to the server
    try {
      const difficulty = room?.difficulty as DifficultyLevel | undefined ?? "standard";
      const map = generateMap(room!.mapSeed, difficulty);
      const cameras = map.entities
        .filter((e) => e.type === "camera")
        .map((e) => ({
          id: e.id ?? `camera-${e.x}-${e.y}`,
          x: e.x,
          y: e.y,
          baseAngle: facingToAngle(e.facing),
        }));
      // Collect door tile positions from the map
      const doors: Array<{ x: number; y: number }> = [];
      for (let row = 0; row < map.tiles.length; row++) {
        for (let col = 0; col < (map.tiles[row]?.length ?? 0); col++) {
          if (map.tiles[row][col] === 2) { // TileType.Door = 2
            doors.push({ x: col, y: row });
          }
        }
      }

      await startGame({
        roomCode,
        sessionId,
        runnerSpawn: map.runnerSpawn,
        guards: map.guardPatrols.map((g) => ({ id: g.guardId, x: g.spawnX, y: g.spawnY })),
        items: [{ id: "item-1", x: map.targetItem.x, y: map.targetItem.y, name: map.targetItem.name }],
        exitX: map.exitPos.x,
        exitY: map.exitPos.y,
        cameras,
        doors,
        lasers: map.lasers.map((l) => ({
          id: l.id,
          x1: l.x1,
          y1: l.y1,
          x2: l.x2,
          y2: l.y2,
          onDurationMs: l.onDurationMs,
          offDurationMs: l.offDurationMs,
          phaseOffsetMs: l.phaseOffsetMs,
        })),
      });
    } catch {
      // Game may have already been started by the other player — ignore
    }
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

        {/* Runner Color Picker — only shown to the player who selected Runner */}
        {me?.role === "runner" && (
          <div className="text-center space-y-2">
            <p className="text-sm text-[#8B7355]">Runner Color</p>
            <div className="flex justify-center gap-2 flex-wrap">
              {RUNNER_COLOR_PRESETS.map((preset) => {
                const isSelected = (me.runnerColor ?? "classic") === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSetRunnerColor(preset.id)}
                    className={`w-10 h-10 rounded-full border-2 transition-all duration-200
                      ${isSelected
                        ? "border-[#FFD700] ring-2 ring-[#FFD700]/50 scale-110"
                        : "border-[#8B7355]/40 hover:border-[#E8D5B7] hover:scale-105"
                      }`}
                    title={preset.label}
                  >
                    <div
                      className="w-full h-full rounded-full"
                      style={{ backgroundColor: preset.body }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Difficulty Selector */}
        <div className="text-center space-y-2">
          <p className="text-sm text-[#8B7355]">Difficulty</p>
          <div className="flex justify-center gap-3">
            {(["casual", "standard", "hard"] as const).map((level) => {
              const config = getDifficultyConfig(level);
              const isSelected = currentDifficulty === level;
              return (
                <button
                  key={level}
                  onClick={() => handleSetDifficulty(level)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200
                    ${isSelected
                      ? "bg-[#FFD700] text-[#2D1B0E] ring-2 ring-[#FFD700]"
                      : "bg-[#2D1B0E] text-[#E8D5B7] border border-[#8B7355] hover:border-[#FFD700] hover:text-[#FFD700]"
                    }`}
                >
                  {config.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-[#8B7355]">
            {getDifficultyConfig(currentDifficulty).description}
          </p>
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
