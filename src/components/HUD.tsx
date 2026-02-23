"use client";

import { useEffect, useState } from "react";
import { PING_TYPES } from "@/game/ping-system";

interface HUDProps {
  role: "runner" | "whisper";
  phase: string;
  startTime: number;
  hasItem: boolean;
  itemName: string;
  crouching: boolean;
  // Whisper-specific
  selectedPingType?: "go" | "danger" | "item";
  activePingCount?: number;
  runnerState?: { crouching: boolean; hiding: boolean; hasItem: boolean };
  onSelectPingType?: (type: "go" | "danger" | "item") => void;
  // Guard alert state for Runner HUD
  guardAlertState?: string;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function HUD({
  role,
  phase,
  startTime,
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

  const activePhases = ["planning", "heist", "escaped", "caught", "timeout"];
  const isActivePhase = activePhases.includes(phase);

  useEffect(() => {
    if (!isActivePhase) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [isActivePhase]);

  // Only show during active game phases
  if (!isActivePhase) return null;

  const elapsed = now - startTime;

  if (role === "whisper") {
    return <WhisperHUD
      phase={phase}
      elapsed={elapsed}
      selectedPingType={selectedPingType}
      activePingCount={activePingCount}
      runnerState={runnerState}
      itemName={itemName}
      onSelectPingType={onSelectPingType}
    />;
  }

  // Runner HUD — only show during heist/escaped
  if (phase !== "heist" && phase !== "escaped") return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Timer — top center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <div className="bg-black/50 text-[#E8D5B7] px-4 py-2 rounded-lg font-mono text-xl">
          {formatTime(elapsed)}
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

      {/* Guard alert indicator — top center below timer */}
      {guardAlertState === "alert" && phase === "heist" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2">
          <div className="bg-red-900/80 text-red-300 px-4 py-1.5 rounded-lg text-sm font-bold uppercase tracking-wider animate-pulse">
            ! ALERT !
          </div>
        </div>
      )}
      {guardAlertState === "suspicious" && phase === "heist" && (
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
          {phase}
        </div>
      </div>
    </div>
  );
}

function WhisperHUD({
  phase,
  elapsed,
  selectedPingType,
  activePingCount,
  runnerState,
  itemName,
  onSelectPingType,
}: {
  phase: string;
  elapsed: number;
  selectedPingType: string;
  activePingCount: number;
  runnerState?: { crouching: boolean; hiding: boolean; hasItem: boolean };
  itemName: string;
  onSelectPingType?: (type: "go" | "danger" | "item") => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Timer — top center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <div className="bg-[#0a0e1a]/80 text-[#8BB8E8] px-4 py-2 rounded-lg font-mono text-xl border border-[#1e3a5f]">
          {formatTime(elapsed)}
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
