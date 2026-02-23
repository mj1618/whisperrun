"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { PING_TYPES } from "@/game/ping-system";
import { setMasterVolume } from "@/engine/audio";
import { DifficultyLevel, getDifficultyConfig } from "@/game/difficulty";
import { QUICK_COMM_MESSAGES } from "@/game/quick-comms";
const CONTROLS_AUTO_DISMISS = 5_000; // 5 seconds

interface HUDProps {
  role: "runner" | "whisper";
  phase: string;
  heistStartTime?: number;
  hasItem: boolean;
  itemName: string;
  crouching: boolean;
  selectedPingType?: "go" | "danger" | "item";
  activePingCount?: number;
  runnerState?: { crouching: boolean; hiding: boolean; hasItem: boolean };
  onSelectPingType?: (type: "go" | "danger" | "item") => void;
  onSendQuickComm?: (messageId: string) => void;
  guardAlertState?: string;
  difficulty?: DifficultyLevel;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function MuteButton({ themeColor = "#E8D5B7" }: { themeColor?: string }) {
  const [muted, setMuted] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("whisperrun-muted") === "true";
  });

  // Apply mute state on mount
  useEffect(() => {
    setMasterVolume(muted ? 0 : 0.3);
  }, [muted]);

  const toggle = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem("whisperrun-muted", String(next));
      setMasterVolume(next ? 0 : 0.3);
      return next;
    });
  }, []);

  return (
    <button
      onClick={toggle}
      className="pointer-events-auto bg-black/30 min-w-[44px] min-h-[44px] px-2 py-1 rounded text-xs
                 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center"
      style={{ color: themeColor, opacity: 0.5 }}
    >
      {muted ? "\u{1F507}" : "\u{1F50A}"}
    </button>
  );
}

function useControlsHelp() {
  const [showControls, setShowControls] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => setShowControls(false), []);
  const toggle = useCallback(() => {
    setShowControls((prev) => !prev);
  }, []);

  // Auto-dismiss after inactivity
  useEffect(() => {
    if (!showControls) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(dismiss, CONTROLS_AUTO_DISMISS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [showControls, dismiss]);

  // Keyboard listener: H toggles, Escape dismisses
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't toggle if an input element is focused
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.code === "KeyH") {
        toggle();
      } else if (e.code === "Slash" && e.shiftKey) {
        // ? key
        toggle();
      } else if (e.code === "Escape" && showControls) {
        dismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle, dismiss, showControls]);

  return { showControls, toggle, dismiss };
}

function ControlsPopup({
  role,
  onClose,
}: {
  role: "runner" | "whisper";
  onClose: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto"
      onClick={onClose}
    >
      <div
        className="bg-black/60 backdrop-blur-sm rounded-xl p-4 max-w-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[#E8D5B7]/60 text-xs mb-2">
          Controls <span className="opacity-50">(press H to close)</span>
        </div>
        <div className="border-t border-[#E8D5B7]/20 mb-2" />
        {role === "runner" ? (
          <div className="font-mono text-xs space-y-1">
            <div className="flex justify-between gap-6">
              <span className="text-[#FFD700]">WASD / Arrows</span>
              <span className="text-[#E8D5B7]/70">Move</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#FFD700]">Shift</span>
              <span className="text-[#E8D5B7]/70">Crouch</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#FFD700]">E / Space</span>
              <span className="text-[#E8D5B7]/70">Interact</span>
            </div>
          </div>
        ) : (
          <div className="font-mono text-xs space-y-1">
            <div className="flex justify-between gap-6">
              <span className="text-[#FFD700]">Click</span>
              <span className="text-[#8BB8E8]/70">Place ping</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#FFD700]">1/2/3</span>
              <span className="text-[#8BB8E8]/70">Ping type</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#00E5FF]">Shift+Drag</span>
              <span className="text-[#8BB8E8]/70">Draw route</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#FFD700]">Q/W/E/R/T/Y</span>
              <span className="text-[#8BB8E8]/70">Quick-comms</span>
            </div>
            <div className="text-[#8BB8E8]/40 text-[10px] mt-1">
              Routes fade after 15s during heist
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HelpButton({
  onClick,
  themeColor = "#E8D5B7",
}: {
  onClick: () => void;
  themeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="pointer-events-auto bg-black/30 min-w-[44px] min-h-[44px] px-2 py-1 rounded text-xs
                 hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center"
      style={{ color: themeColor, opacity: 0.4 }}
    >
      ?
    </button>
  );
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
  onSendQuickComm,
  guardAlertState = "patrol",
  difficulty,
}: HUDProps) {
  const [now, setNow] = useState(() => Date.now());
  const controlsHelp = useControlsHelp();
  const diffConfig = getDifficultyConfig(difficulty ?? "standard");
  const heistDuration = diffConfig.heistDurationMs;

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
        heistRemaining={heistDuration}
        selectedPingType={selectedPingType}
        activePingCount={activePingCount}
        runnerState={runnerState}
        itemName={itemName}
        onSelectPingType={onSelectPingType}
        onSendQuickComm={onSendQuickComm}
        difficultyLabel={diffConfig.label}
      />;
    }
    return null;
  }

  // Heist phase — compute remaining time
  const heistElapsed = heistStartTime ? now - heistStartTime : 0;
  const heistRemaining = Math.max(0, heistDuration - heistElapsed);
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
      onSendQuickComm={onSendQuickComm}
      controlsHelp={controlsHelp}
      difficultyLabel={diffConfig.label}
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

      {/* Phase indicator + difficulty + help + mute — top left */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div className="bg-black/30 text-[#E8D5B7]/60 px-3 py-1 rounded text-xs uppercase tracking-wider">
          HEIST
        </div>
        <span className="text-xs text-[#E8D5B7]/40 uppercase">{diffConfig.label}</span>
        <HelpButton onClick={controlsHelp.toggle} themeColor="#E8D5B7" />
        <MuteButton themeColor="#E8D5B7" />
      </div>

      {/* Controls help popup */}
      {controlsHelp.showControls && (
        <ControlsPopup role="runner" onClose={controlsHelp.dismiss} />
      )}
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
  onSendQuickComm,
  controlsHelp,
  difficultyLabel,
}: {
  phase: string;
  heistRemaining: number;
  selectedPingType: string;
  activePingCount: number;
  runnerState?: { crouching: boolean; hiding: boolean; hasItem: boolean };
  itemName: string;
  onSelectPingType?: (type: "go" | "danger" | "item") => void;
  onSendQuickComm?: (messageId: string) => void;
  controlsHelp?: { showControls: boolean; toggle: () => void; dismiss: () => void };
  difficultyLabel?: string;
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
          {phase === "heist" ? formatCountdown(heistRemaining) : formatCountdown(heistRemaining)}
        </div>
      </div>

      {/* Phase indicator + difficulty + help + mute — top left */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div className="bg-[#0a0e1a]/80 text-[#8BB8E8]/80 px-3 py-1 rounded text-xs uppercase tracking-wider border border-[#1e3a5f]">
          {phase === "planning" ? "PLANNING" : "HEIST IN PROGRESS"}
        </div>
        {difficultyLabel && (
          <span className="text-xs text-[#8BB8E8]/40 uppercase">{difficultyLabel}</span>
        )}
        {controlsHelp && (
          <HelpButton onClick={controlsHelp.toggle} themeColor="#8BB8E8" />
        )}
        <MuteButton themeColor="#8BB8E8" />
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
          <div className="flex gap-2 bg-[#0a0e1a]/80 px-3 sm:px-4 py-2 sm:py-3 rounded-xl border border-[#1e3a5f]">
            {PING_TYPES.map((pt) => (
              <button
                key={pt.type}
                onClick={() => onSelectPingType?.(pt.type)}
                className={`min-w-[44px] min-h-[44px] px-3 sm:px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer
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

      {/* Quick-Comm buttons — left side, vertical stack */}
      {(phase === "planning" || phase === "heist") && (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-auto">
          <div className="flex flex-col gap-1.5 bg-[#0a0e1a]/80 p-2 rounded-xl border border-[#1e3a5f]">
            <div className="text-[#8BB8E8]/40 text-[10px] text-center mb-1">COMMS</div>
            {QUICK_COMM_MESSAGES.map((msg) => (
              <button
                key={msg.id}
                onClick={() => onSendQuickComm?.(msg.id)}
                className="min-w-[44px] min-h-[44px] px-2 py-1.5 rounded-lg text-xs font-bold
                           transition-all cursor-pointer hover:scale-105 active:scale-95
                           border border-transparent hover:border-current"
                style={{ color: msg.color, backgroundColor: msg.color + "15" }}
                title={`${msg.text} (${msg.key})`}
              >
                <span className="text-[10px] opacity-40 mr-1">{msg.key}</span>
                <span className="hidden sm:inline">{msg.text}</span>
                <span className="sm:hidden">{msg.icon}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Controls help popup */}
      {controlsHelp?.showControls && (
        <ControlsPopup role="whisper" onClose={controlsHelp.dismiss} />
      )}
    </div>
  );
}
