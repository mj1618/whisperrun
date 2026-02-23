"use client";

import { useEffect, useState } from "react";
import { PING_TYPES } from "@/game/ping-system";

const HEIST_DURATION = 180_000; // 3 minutes

interface HUDProps {
  role: "runner" | "whisper";
  phase: string;
  startTime: number;
  heistStartTime?: number;
  hasItem: boolean;
  itemName: string;
  crouching: boolean;
  selectedPingType?: "go" | "danger" | "item";
  activePingCount?: number;
  runnerState?: { crouching: boolean; hiding: boolean; hasItem: boolean };
  onSelectPingType?: (type: "go" | "danger" | "item") => void;
  guardAlertState?: string;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function HUD({
  role,
  phase,
  heistStartTime,
  hasItem,
  itemName,
  crouching,
  selectedPingType = "go",
  activePingCount = 0,
  runnerState,
  onSelectPingType,
  guardAlertState = "patrol",
}: HUDProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase !== "heist" && phase !== "planning") return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [phase]);

  // Only show HUD during heist (planning uses PlanningOverlay)
  if (phase !== "heist") {
    // Whisper still sees their HUD during planning
    if (role === "whisper" && phase === "planning") {
      return <WhisperHUD
        phase={phase}
        heistRemaining={HEIST_DURATION}
        selectedPingType={selectedPingType}
        activePingCount={activePingCount}
        runnerState={runnerState}
        itemName={itemName}
        onSelectPingType={onSelectPingType}
      />;
    }
    return null;
  }

  // Heist phase — compute remaining time
  const heistElapsed = heistStartTime ? now - heistStartTime : 0;
  const heistRemaining = Math.max(0, HEIST_DURATION - heistElapsed);
  const isUrgent = heistRemaining <= 30_000;
  const isCritical = heistRemaining <= 10_000;

  if (role === "whisper") {
    return <WhisperHUD
      phase={phase}
      heistRemaining={heistRemaining}
      selectedPingType={selectedPingType}
      activePingCount={activePingCount}
      runnerState={runnerState}
      itemName={itemName}
      onSelectPingType={onSelectPingType}
    />;
  }

  // Runner HUD
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Timer — top center (countdown) */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <div className={`bg-black/50 px-4 py-2 rounded-lg font-mono transition-all ${
          isCritical
            ? "text-red-400 text-2xl animate-pulse scale-110"
            : isUrgent
            ? "text-red-400 text-xl animate-pulse"
            : "text-[#E8D5B7] text-xl"
        }`}>
          {formatCountdown(heistRemaining)}
        </div>
      </div>

      {/* Item status — top right */}
      <div className="absolute top-4 right-4">
        <div className="bg-black/50 text-[#E8D5B7] px-4 py-2 rounded-lg text-sm max-w-[200px]">
          {hasItem ? (
            <span className="text-[#4CAF50] font-bold">
              Got it! Head to the exit!
            </span>
          ) : (
            <span>
              Find the{" "}
              <span className="text-[#FFD700] font-bold">{itemName}</span>
            </span>
          )}
        </div>
      </div>

      {/* Guard alert indicator */}
      {guardAlertState === "alert" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2">
          <div className="bg-red-900/80 text-red-300 px-4 py-1.5 rounded-lg text-sm font-bold uppercase tracking-wider animate-pulse">
            ! ALERT !
          </div>
        </div>
      )}
      {guardAlertState === "suspicious" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2">
          <div className="bg-yellow-900/80 text-yellow-300 px-4 py-1.5 rounded-lg text-sm font-bold uppercase tracking-wider">
            ? Suspicious
          </div>
        </div>
      )}

      {/* Crouch indicator — bottom left */}
      {crouching && (
        <div className="absolute bottom-4 left-4">
          <div className="bg-black/50 text-yellow-300 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">
            Crouching
          </div>
        </div>
      )}

      {/* Phase indicator — top left */}
      <div className="absolute top-4 left-4">
        <div className="bg-black/30 text-[#E8D5B7]/60 px-3 py-1 rounded text-xs uppercase tracking-wider">
          HEIST
        </div>
      </div>
    </div>
  );
}

function WhisperHUD({
  phase,
  heistRemaining,
  selectedPingType,
  activePingCount,
  runnerState,
  itemName,
  onSelectPingType,
}: {
  phase: string;
  heistRemaining: number;
  selectedPingType: string;
  activePingCount: number;
  runnerState?: { crouching: boolean; hiding: boolean; hasItem: boolean };
  itemName: string;
  onSelectPingType?: (type: "go" | "danger" | "item") => void;
}) {
  const isUrgent = heistRemaining <= 30_000;
  const isCritical = heistRemaining <= 10_000;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Timer — top center (countdown) */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <div className={`bg-[#0a0e1a]/80 px-4 py-2 rounded-lg font-mono border transition-all ${
          phase === "heist" && isCritical
            ? "text-red-400 border-red-500 text-2xl animate-pulse scale-110"
            : phase === "heist" && isUrgent
            ? "text-red-400 border-red-500 text-xl animate-pulse"
            : "text-[#8BB8E8] border-[#1e3a5f] text-xl"
        }`}>
          {phase === "heist" ? formatCountdown(heistRemaining) : "3:00"}
        </div>
      </div>

      {/* Phase indicator — top left */}
      <div className="absolute top-4 left-4">
        <div className="bg-[#0a0e1a]/80 text-[#8BB8E8]/80 px-3 py-1 rounded text-xs uppercase tracking-wider border border-[#1e3a5f]">
          {phase === "planning" ? "PLANNING" : "HEIST IN PROGRESS"}
        </div>
      </div>

      {/* Runner status — top right */}
      <div className="absolute top-4 right-4">
        <div className="bg-[#0a0e1a]/80 text-[#8BB8E8] px-4 py-2 rounded-lg text-sm border border-[#1e3a5f] space-y-1">
          <div className="text-[#8BB8E8]/50 text-xs uppercase tracking-wider">Runner</div>
          {runnerState?.hasItem ? (
            <div className="text-[#4CAF50] font-bold text-xs">Has the {itemName}!</div>
          ) : (
            <div className="text-[#8BB8E8]/70 text-xs">Searching for {itemName}</div>
          )}
          {runnerState?.hiding && (
            <div className="text-[#6B8E23] text-xs font-bold">Hiding</div>
          )}
          {runnerState?.crouching && !runnerState?.hiding && (
            <div className="text-yellow-400 text-xs font-bold">Crouching</div>
          )}
        </div>
      </div>

      {/* Ping type selector — bottom center */}
      {(phase === "planning" || phase === "heist") && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto">
          <div className="flex gap-2 bg-[#0a0e1a]/80 px-4 py-3 rounded-xl border border-[#1e3a5f]">
            {PING_TYPES.map((pt) => (
              <button
                key={pt.type}
                onClick={() => onSelectPingType?.(pt.type)}
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer
                  ${selectedPingType === pt.type
                    ? "ring-2 ring-white/50 scale-105"
                    : "opacity-50 hover:opacity-80"
                  }`}
                style={{
                  backgroundColor: selectedPingType === pt.type ? pt.color + "30" : "transparent",
                  color: pt.color,
                  borderColor: pt.color,
                  borderWidth: "1px",
                  borderStyle: "solid",
                }}
              >
                <span className="text-[10px] opacity-60 mr-1">{pt.key}</span>
                {pt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active pings count — bottom right */}
      <div className="absolute bottom-6 right-4">
        <div className="bg-[#0a0e1a]/80 text-[#8BB8E8] px-3 py-2 rounded-lg text-xs border border-[#1e3a5f]">
          Pings: {activePingCount}/3
        </div>
      </div>
    </div>
  );
}
