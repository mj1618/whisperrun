"use client";

import { useEffect, useRef, useCallback, useState, useMemo, useSyncExternalStore } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { GameLoop } from "@/engine/loop";
import { Renderer, TILE_SIZE, clearTileCache } from "@/engine/renderer";
import { Camera } from "@/engine/camera";
import { InputHandler } from "@/engine/input";
import { TouchInputManager, isTouchDevice } from "@/engine/touch-input";
import { TouchControls } from "@/components/TouchControls";
import { isWalkable, isWalkableWithDoors, getMapWidth, getMapHeight, TileType } from "@/game/map";
import { isLaserActive, isRunnerInLaser } from "@/game/lasers";
import { generateMap, GeneratedMap } from "@/game/map-generator";
import { GameStateManager, LocalGameState } from "@/game/game-state";
import { renderFogOfWar, renderPings, renderPathForRunner, renderEscalationWaves } from "@/game/runner-view";
import { renderBlueprintMap, renderWhisperEntities, renderPaths, renderPathPreview, renderEscalationLines } from "@/game/whisper-view";
import { screenToTileWhisper } from "@/game/ping-system";
import {
  tickGuard,
  GuardData,
  GuardState,
  DoorState,
  GuardDifficultyConfig,
  EscalationEvent,
  canGuardSeeRunner,
  canCameraSeeRunner,
  updateCameraAngle,
  clearGuardPaths,
  processAlertEscalation,
  CAMERA_ALERT_COOLDOWN,
  CAMERA_FOV,
  NOISE_RADIUS_RUNNING,
} from "@/game/guard-ai";
import { DifficultyLevel, getDifficultyConfig } from "@/game/difficulty";
import { EventRecorder, GameEvent, PositionPoint } from "@/game/events";
import {
  initAudio,
  isAudioReady,
  resumeAudio,
  playFootstep,
  playGuardFootstep,
  playAlertSound,
  playSuspiciousSound,
  playItemPickup,
  playExitUnlock,
  playPingSound,
  playGameOverCaught,
  playGameOverEscaped,
  playAmbientLoop,
  stopAmbientLoop,
  playCountdownTick,
  playCountdownUrgent,
  playDoorOpen,
  playDoorClose,
  playQuickCommSound,
  playLaserAlarm,
  playRadioChatter,
} from "@/engine/audio";
import HUD from "@/components/HUD";
import { QUICK_COMM_MESSAGES, QUICK_COMM_COOLDOWN_MS } from "@/game/quick-comms";
import { getRunnerPreset } from "@/game/runner-colors";

interface GameCanvasProps {
  roomId: Id<"rooms">;
  roomCode: string;
  sessionId: string;
  role: "runner" | "whisper";
  mapSeed: number;
  difficulty?: DifficultyLevel;
  runnerColorPresetId?: string;
  onGameEnd?: (data: { events: GameEvent[]; positionTrail: PositionPoint[] }) => void;
}

// Movement speeds in tiles/second
const WALK_SPEED = 3;
const CROUCH_SPEED = 1.5;

// Visibility radius in pixels
const WALK_VIS_RADIUS = 6 * TILE_SIZE;
const CROUCH_VIS_RADIUS = 4 * TILE_SIZE;

// Runner hitbox half-width in tiles
const HITBOX_HALF = 0.3;

// Planning phase duration default (overridden by difficulty)
const DEFAULT_PLANNING_DURATION = 30_000;

function canMoveTo(x: number, y: number, map: TileType[][], doors?: DoorState[]): boolean {
  const corners = [
    { col: Math.floor(x - HITBOX_HALF), row: Math.floor(y - HITBOX_HALF) },
    { col: Math.floor(x + HITBOX_HALF), row: Math.floor(y - HITBOX_HALF) },
    { col: Math.floor(x - HITBOX_HALF), row: Math.floor(y + HITBOX_HALF) },
    { col: Math.floor(x + HITBOX_HALF), row: Math.floor(y + HITBOX_HALF) },
  ];
  return corners.every((c) => isWalkableWithDoors(map, c.col, c.row, doors));
}

interface InteractionResult {
  action: "exit" | "pickup" | "hide" | "unhide" | "toggleDoor";
  doorX?: number;
  doorY?: number;
}

function getInteraction(
  x: number,
  y: number,
  hasItem: boolean,
  hiding: boolean,
  state: LocalGameState,
  map: TileType[][]
): InteractionResult | null {
  if (hiding) return { action: "unhide" };

  if (hasItem) {
    const dist = Math.hypot(state.exitX - x, state.exitY - y);
    if (dist < 1.5) return { action: "exit" };
  }

  const nearItem = state.items.find(
    (item) =>
      !item.pickedUp &&
      Math.abs(item.x - x) < 1.5 &&
      Math.abs(item.y - y) < 1.5
  );
  if (nearItem) return { action: "pickup" };

  const tileCol = Math.round(x);
  const tileRow = Math.round(y);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = tileRow + dr;
      const c = tileCol + dc;
      if (
        r >= 0 &&
        r < map.length &&
        c >= 0 &&
        c < (map[0]?.length ?? 0)
      ) {
        if (map[r][c] === TileType.HideSpot) {
          const dist = Math.hypot(c - x, r - y);
          if (dist < 1.5) return { action: "hide" };
        }
      }
    }
  }

  // Door toggle — lowest priority
  let nearestDoorDist = Infinity;
  let nearestDoor: { x: number; y: number } | null = null;
  for (const door of state.doors) {
    const dist = Math.hypot(door.x + 0.5 - x, door.y + 0.5 - y);
    if (dist < 1.5 && dist < nearestDoorDist) {
      nearestDoorDist = dist;
      nearestDoor = door;
    }
  }
  if (nearestDoor) return { action: "toggleDoor", doorX: nearestDoor.x, doorY: nearestDoor.y };

  return null;
}

function PlanningOverlay({
  startTime,
  role,
  onStartHeist,
  planningDuration = DEFAULT_PLANNING_DURATION,
}: {
  startTime: number;
  role: "runner" | "whisper";
  onStartHeist: () => void;
  planningDuration?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // Fade in controls after a short delay
  useEffect(() => {
    const timer = setTimeout(() => setShowControls(true), 300);
    return () => clearTimeout(timer);
  }, []);

  const remaining = Math.max(0, planningDuration - (now - startTime));
  const remainingSeconds = Math.ceil(remaining / 1000);

  return (
    <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
      <div className="bg-black/70 rounded-2xl p-6 text-center space-y-3 max-w-lg pointer-events-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#E8D5B7]/60 uppercase tracking-wider">
            Planning Phase
          </h2>
          <div className="text-2xl font-mono font-bold text-[#FFD700]">
            0:{remainingSeconds.toString().padStart(2, "0")}
          </div>
        </div>

        <div className="text-left space-y-3">
          <div>
            <h3 className="text-xl font-bold text-[#FFD700]">
              Your Role: {role === "runner" ? "Runner" : "Whisper"}
            </h3>
            <p className="text-[#E8D5B7]/70 text-sm mt-1">
              {role === "runner"
                ? "Sneak through the building. Find the target. Get out."
                : "You see the full map. Guide the Runner past the guards."}
            </p>
          </div>

          <div
            className={`transition-opacity duration-500 ${showControls ? "opacity-100" : "opacity-0"}`}
          >
            <h4 className="text-sm font-bold text-[#E8D5B7] uppercase tracking-wider mb-2">
              Controls
            </h4>
            {role === "runner" ? (
              <div className="font-mono text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#FFD700]">WASD / Arrow Keys</span>
                  <span className="text-[#E8D5B7]/70">Move</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#FFD700]">Shift (hold)</span>
                  <span className="text-[#E8D5B7]/70">Crouch (slower but harder to detect)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#FFD700]">E / Space</span>
                  <span className="text-[#E8D5B7]/70">Interact (hide spots, items, exit)</span>
                </div>
              </div>
            ) : (
              <div className="font-mono text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#FFD700]">Click</span>
                  <span className="text-[#8BB8E8]/70">Place a ping (Runner sees it)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#FFD700]">1 / 2 / 3</span>
                  <span className="text-[#8BB8E8]/70">Switch ping type</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#00E5FF]">Shift+Drag</span>
                  <span className="text-[#8BB8E8]/70">Draw a route for the Runner</span>
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#44FF44]" />
                    <span className="text-[#44FF44] font-bold">1 Go</span>
                    <span className="text-[#8BB8E8]/50">&mdash; &ldquo;Head this way&rdquo;</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#FF4444]" />
                    <span className="text-[#FF4444] font-bold">2 Danger</span>
                    <span className="text-[#8BB8E8]/50">&mdash; &ldquo;Guard nearby!&rdquo;</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#FFD700]" />
                    <span className="text-[#FFD700] font-bold">3 Item</span>
                    <span className="text-[#8BB8E8]/50">&mdash; &ldquo;Target is here&rdquo;</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            className={`transition-opacity duration-700 delay-200 ${showControls ? "opacity-100" : "opacity-0"}`}
          >
            <h4 className="text-sm font-bold text-[#E8D5B7] uppercase tracking-wider mb-2">
              Tips
            </h4>
            {role === "runner" ? (
              <ul className="text-[#E8D5B7]/60 text-xs space-y-1 list-disc list-inside">
                <li>Guards have vision cones &mdash; stay behind them</li>
                <li>Running creates noise &mdash; crouch (Shift) near guards to stay silent</li>
                <li>Hide in cabinets to become invisible</li>
                <li>Grab the target item, then find the exit door</li>
              </ul>
            ) : (
              <ul className="text-[#8BB8E8]/60 text-xs space-y-1 list-disc list-inside">
                <li>You can have up to 3 active pings</li>
                <li>Shift+Drag to draw a route &mdash; Runner sees it as a glowing trail</li>
                <li>Press Q/W/E/R/T/Y to send quick-comms (&ldquo;STOP!&rdquo;, &ldquo;GO NOW!&rdquo;, etc.)</li>
                <li>Watch the guard patrol routes (dashed lines)</li>
                <li>The Runner has limited vision &mdash; you&apos;re their eyes</li>
              </ul>
            )}
          </div>
        </div>

        <button
          onClick={onStartHeist}
          className="px-8 py-3 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                     hover:bg-[#FFC107] transition-colors text-lg cursor-pointer w-full"
        >
          Start Heist!
        </button>
      </div>
    </div>
  );
}

export default function GameCanvas({
  roomId,
  roomCode,
  sessionId,
  role,
  mapSeed,
  difficulty: difficultyProp,
  runnerColorPresetId,
  onGameEnd,
}: GameCanvasProps) {
  const diffConfig = getDifficultyConfig(difficultyProp ?? "standard");
  const diffConfigRef = useRef(diffConfig);
  useEffect(() => { diffConfigRef.current = diffConfig; }, [diffConfig]);
  const runnerColors = getRunnerPreset(runnerColorPresetId ?? "classic");
  const runnerColorsRef = useRef(runnerColors);
  useEffect(() => { runnerColorsRef.current = runnerColors; }, [runnerColors]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateManagerRef = useRef(new GameStateManager());
  const timeRef = useRef(0);
  const eventRecorderRef = useRef(new EventRecorder());
  const onGameEndRef = useRef(onGameEnd);
  const touchInput = useMemo(() => new TouchInputManager(), []);
  const touchInputRef = useRef(touchInput);
  const showTouchControls = useSyncExternalStore(
    () => () => {},          // no-op subscribe — value never changes
    () => isTouchDevice(),   // client snapshot
    () => false              // server snapshot
  );

  // Walk animation state
  const walkFrameRef = useRef(0);
  const walkFrameAccumRef = useRef(0);
  const facingAngleRef = useRef(0);
  const runnerMovingRef = useRef(false);
  const guardWalkFrameRef = useRef<Record<string, number>>({});
  const guardWalkAccumRef = useRef<Record<string, number>>({});
  const guardPrevPosRef = useRef<Record<string, { x: number; y: number }>>({});
  useEffect(() => {
    onGameEndRef.current = onGameEnd;
  }, [onGameEnd]);

  // Generate the map deterministically from the seed (memoized — same seed = same map)
  const generatedMap = useMemo(() => generateMap(mapSeed, difficultyProp ?? "standard"), [mapSeed, difficultyProp]);
  const generatedMapRef = useRef<GeneratedMap>(generatedMap);
  useEffect(() => {
    generatedMapRef.current = generatedMap;
  }, [generatedMap]);

  // Build guard waypoint lookup from generated map
  const guardWaypoints = useMemo(() => {
    const waypointMap: Record<string, Array<{ x: number; y: number }>> = {};
    for (const patrol of generatedMap.guardPatrols) {
      waypointMap[patrol.guardId] = patrol.waypoints;
    }
    return waypointMap;
  }, [generatedMap]);
  const guardWaypointsRef = useRef(guardWaypoints);
  useEffect(() => {
    guardWaypointsRef.current = guardWaypoints;
  }, [guardWaypoints]);

  // Force periodic re-render for HUD timer
  const [, setTick] = useState(0);
  const [hudCrouching, setHudCrouching] = useState(false);

  // Whisper ping type selection
  const [selectedPingType, setSelectedPingType] = useState<"go" | "danger" | "item">("go");
  const selectedPingTypeRef = useRef(selectedPingType);
  useEffect(() => {
    selectedPingTypeRef.current = selectedPingType;
  }, [selectedPingType]);

  // Convex queries/mutations
  const gameState = useQuery(api.game.getGameState, { roomId });
  const moveRunner = useMutation(api.game.moveRunner);
  const interactRunner = useMutation(api.game.interactRunner);
  const startHeistPhase = useMutation(api.game.startHeistPhase);
  const addPing = useMutation(api.game.addPing);
  const cleanupPings = useMutation(api.game.cleanupPings);
  const drawPathMutation = useMutation(api.game.drawPath);
  const cleanupPathsMutation = useMutation(api.game.cleanupPaths);
  const tickGuardsMutation = useMutation(api.game.tickGuards);
  const toggleDoorMutation = useMutation(api.game.toggleDoor);
  const checkTimeout = useMutation(api.game.checkTimeout);
  const sendQuickCommMutation = useMutation(api.game.sendQuickComm);

  // Store mutations/setters in refs so game loop can access them
  const moveRunnerRef = useRef(moveRunner);
  const interactRunnerRef = useRef(interactRunner);
  const addPingRef = useRef(addPing);
  const tickGuardsRef = useRef(tickGuardsMutation);
  const toggleDoorRef = useRef(toggleDoorMutation);
  const setHudCrouchingRef = useRef(setHudCrouching);
  const startHeistPhaseRef = useRef(startHeistPhase);
  const checkTimeoutRef = useRef(checkTimeout);
  useEffect(() => {
    moveRunnerRef.current = moveRunner;
    interactRunnerRef.current = interactRunner;
    addPingRef.current = addPing;
    drawPathRef.current = drawPathMutation;
    tickGuardsRef.current = tickGuardsMutation;
    toggleDoorRef.current = toggleDoorMutation;
    setHudCrouchingRef.current = setHudCrouching;
    startHeistPhaseRef.current = startHeistPhase;
    checkTimeoutRef.current = checkTimeout;
  }, [moveRunner, interactRunner, addPing, drawPathMutation, tickGuardsMutation, toggleDoorMutation, setHudCrouching, startHeistPhase, checkTimeout]);

  // Local guard state for client-side prediction (Runner client drives guard AI)
  const localGuardsRef = useRef<GuardData[]>([]);
  const localDoorsRef = useRef<DoorState[]>([]);
  const guardsInitializedRef = useRef(false);

  // Guard alert state for HUD
  const [guardAlertState, setGuardAlertState] = useState<string>("patrol");
  const setGuardAlertStateRef = useRef(setGuardAlertState);
  useEffect(() => {
    setGuardAlertStateRef.current = setGuardAlertState;
  }, [setGuardAlertState]);

  // Blueprint zoom state stored in ref so click handler can access it
  const blueprintTransformRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });

  // Whisper path drawing state
  const drawingPathPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const drawPathRef = useRef(drawPathMutation);
  const drawModeRef = useRef(false);

  // Quick-comm state
  const lastQuickCommRef = useRef(0);
  const [activeComm, setActiveComm] = useState<{
    id: string; text: string; color: string; icon: string;
    sound: "urgent" | "info" | "celebrate"; expiresAt: number;
  } | null>(null);
  const lastCommCreatedAtRef = useRef(0);

  const handleSendQuickComm = useCallback((messageId: string) => {
    const now = Date.now();
    if (now - lastQuickCommRef.current < QUICK_COMM_COOLDOWN_MS) return;
    lastQuickCommRef.current = now;
    sendQuickCommMutation({ roomId, messageId });
  }, [sendQuickCommMutation, roomId]);

  // Disconnect warning state
  const [showDisconnectWarning, setShowDisconnectWarning] = useState(false);

  // Heartbeat — signal presence every 3 seconds
  const heartbeatMut = useMutation(api.rooms.heartbeat);
  useEffect(() => {
    if (!roomCode || !sessionId) return;

    // Send initial heartbeat immediately
    heartbeatMut({ roomCode, sessionId }).catch(() => {});

    const interval = setInterval(() => {
      heartbeatMut({ roomCode, sessionId }).catch(() => {});
    }, 3000);

    return () => clearInterval(interval);
  }, [roomCode, sessionId, heartbeatMut]);

  // Disconnect detection — check partner presence every 3 seconds
  const checkDisconnectMut = useMutation(api.rooms.checkDisconnect);
  useEffect(() => {
    if (!roomCode || !sessionId) return;

    const interval = setInterval(async () => {
      try {
        const result = await checkDisconnectMut({ roomCode, sessionId });
        if (result?.gracePeriod) {
          setShowDisconnectWarning(true);
        } else {
          setShowDisconnectWarning(false);
        }
      } catch {
        // Ignore errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [roomCode, sessionId, checkDisconnectMut]);

  // Watch for incoming quick-comms
  useEffect(() => {
    const qc = gameState?.quickComm;
    if (!qc) return;
    if (qc.createdAt <= lastCommCreatedAtRef.current) return;
    lastCommCreatedAtRef.current = qc.createdAt;

    const msg = QUICK_COMM_MESSAGES.find((m) => m.id === qc.messageId);
    if (!msg) return;

    if (isAudioReady()) playQuickCommSound(msg.sound);

    // Record event
    eventRecorderRef.current.record("quick_comm", { messageId: msg.id, text: msg.text });

    // Schedule setState outside of the effect body to avoid the
    // react-hooks/set-state-in-effect lint rule (cascading renders).
    const showTimer = setTimeout(() => {
      setActiveComm({
        id: msg.id,
        text: msg.text,
        color: msg.color,
        icon: msg.icon,
        sound: msg.sound,
        expiresAt: Date.now() + msg.duration,
      });
    }, 0);
    const hideTimer = setTimeout(() => setActiveComm(null), msg.duration);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, [gameState?.quickComm]);

  // Update game state manager when Convex data arrives
  useEffect(() => {
    if (!gameState) {
      gameStateManagerRef.current.setServerState(null);
      return;
    }
    const local: LocalGameState = {
      runner: gameState.runner,
      guards: gameState.guards,
      cameras: gameState.cameras ?? [],
      doors: gameState.doors ?? [],
      lasers: gameState.lasers ?? [],
      items: gameState.items,
      pings: gameState.pings,
      paths: gameState.paths ?? [],
      exitX: gameState.exitX,
      exitY: gameState.exitY,
      phase: gameState.phase,
      startTime: gameState.startTime,
      heistStartTime: gameState.heistStartTime,
    };
    gameStateManagerRef.current.setServerState(local);
    // Keep local doors in sync before guard AI takes over
    if (local.doors.length > 0 && !guardsInitializedRef.current) {
      localDoorsRef.current = local.doors.map((d) => ({ ...d }));
    }
  }, [gameState]);

  // Initialize audio on first user interaction (click, key, or touch)
  useEffect(() => {
    const handleFirstInteraction = () => {
      initAudio();
      window.removeEventListener("click", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);
      window.removeEventListener("touchstart", handleFirstInteraction);
    };
    window.addEventListener("click", handleFirstInteraction);
    window.addEventListener("keydown", handleFirstInteraction);
    window.addEventListener("touchstart", handleFirstInteraction);
    return () => {
      window.removeEventListener("click", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);
      window.removeEventListener("touchstart", handleFirstInteraction);
    };
  }, []);

  // Resume audio on tab visibility change
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        resumeAudio();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Whisper: cleanup expired pings and paths every 2 seconds
  useEffect(() => {
    if (role !== "whisper") return;
    const interval = setInterval(() => {
      cleanupPings({ roomId });
      cleanupPathsMutation({ roomId });
    }, 2000);
    return () => clearInterval(interval);
  }, [role, roomId, cleanupPings, cleanupPathsMutation]);

  // Whisper: ping type keyboard shortcuts (1/2/3)
  useEffect(() => {
    if (role !== "whisper") return;
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Digit1" || e.code === "Numpad1") setSelectedPingType("go");
      if (e.code === "Digit2" || e.code === "Numpad2") setSelectedPingType("danger");
      if (e.code === "Digit3" || e.code === "Numpad3") setSelectedPingType("item");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [role]);

  // Whisper: quick-comm keyboard shortcuts (Q/W/E/R/T/Y)
  useEffect(() => {
    if (role !== "whisper") return;
    const commKeyMap: Record<string, string> = {
      KeyQ: "stop", KeyW: "go", KeyE: "behind",
      KeyR: "hide", KeyT: "safe", KeyY: "nice",
    };
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const msgId = commKeyMap[e.code];
      if (msgId) handleSendQuickComm(msgId);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [role, handleSendQuickComm]);

  // Whisper: click-to-ping handler
  useEffect(() => {
    if (role !== "whisper") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e: MouseEvent) => {
      if (e.shiftKey || drawModeRef.current) return; // Shift+click or draw mode = path drawing, not ping
      const state = gameStateManagerRef.current.getState();
      if (!state) return;
      if (state.phase !== "planning" && state.phase !== "heist") return;

      const rect = canvas.getBoundingClientRect();
      const screenX = (e.clientX - rect.left) * (canvas.width / rect.width);
      const screenY = (e.clientY - rect.top) * (canvas.height / rect.height);

      const { offsetX, offsetY, scale } = blueprintTransformRef.current;
      const tile = screenToTileWhisper(screenX, screenY, offsetX, offsetY, scale);

      // Only ping on walkable tiles
      const col = Math.floor(tile.x);
      const row = Math.floor(tile.y);
      if (!isWalkable(generatedMapRef.current.tiles, col, row)) return;

      addPingRef.current({
        roomId,
        x: tile.x,
        y: tile.y,
        type: selectedPingTypeRef.current,
      });

      // Play ping sound
      if (isAudioReady()) {
        playPingSound(selectedPingTypeRef.current);
      }

      // Record ping event
      eventRecorderRef.current.record("ping_sent", { x: tile.x, y: tile.y });
    };

    canvas.addEventListener("pointerdown", handleClick);
    return () => canvas.removeEventListener("pointerdown", handleClick);
  }, [role, roomId]);

  // Whisper: Shift+drag path drawing (or draw mode on mobile)
  useEffect(() => {
    if (role !== "whisper") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isDrawing = false;
    const pathPoints: Array<{ x: number; y: number }> = [];
    const MIN_POINT_DISTANCE = 0.5;

    const screenToTile = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const screenX = (clientX - rect.left) * (canvas.width / rect.width);
      const screenY = (clientY - rect.top) * (canvas.height / rect.height);
      const { offsetX, offsetY, scale } = blueprintTransformRef.current;
      return screenToTileWhisper(screenX, screenY, offsetX, offsetY, scale);
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!e.shiftKey && !drawModeRef.current) return;
      const state = gameStateManagerRef.current.getState();
      if (!state) return;
      if (state.phase !== "planning" && state.phase !== "heist") return;

      e.preventDefault();
      e.stopPropagation();
      isDrawing = true;
      pathPoints.length = 0;

      const tile = screenToTile(e.clientX, e.clientY);
      pathPoints.push({ x: tile.x, y: tile.y });
      drawingPathPointsRef.current = [...pathPoints];

      canvas.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDrawing) return;

      const tile = screenToTile(e.clientX, e.clientY);
      const last = pathPoints[pathPoints.length - 1];
      const dist = Math.hypot(tile.x - last.x, tile.y - last.y);

      if (dist >= MIN_POINT_DISTANCE && pathPoints.length < 50) {
        pathPoints.push({ x: tile.x, y: tile.y });
        drawingPathPointsRef.current = [...pathPoints];
      }
    };

    const handlePointerUp = () => {
      if (!isDrawing) return;
      isDrawing = false;

      if (pathPoints.length >= 2) {
        drawPathRef.current({
          roomId,
          points: [...pathPoints],
        });

        if (isAudioReady()) {
          playPingSound("go");
        }
      }

      pathPoints.length = 0;
      drawingPathPointsRef.current = [];
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [role, roomId]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const camera = new Camera();
    const renderer = new Renderer(canvas, camera);
    const input = new InputHandler();
    const gsm = gameStateManagerRef.current;

    const resize = () => {
      renderer.resize(window.innerWidth, window.innerHeight);
    };
    resize();
    window.addEventListener("resize", resize);
    input.attach();

    let lastSendTime = 0;
    let lastGuardSendTime = 0;
    let lastTimeoutCheck = 0;
    const SEND_INTERVAL = 100;
    const GUARD_SEND_INTERVAL = 100;
    const TIMEOUT_CHECK_INTERVAL = 1000;
    let cameraCentered = false;
    let planningAutoStarted = false;

    // Audio state
    let lastCountdownSec = -1;
    let prevWalkFrame = -1;

    // Event recording state
    const recorder = eventRecorderRef.current;
    let prevPhase: string = "";
    let prevHasItem = false;
    let prevHiding = false;
    const lastNearMissTime: Record<string, number> = {};
    const wasNearGuardWhileCrouching: Record<string, boolean> = {};
    const prevDistToGuard: Record<string, number> = {};
    const lastCameraAlertTime: Record<string, number> = {};
    let lastLaserTripTime = 0;
    const LASER_TRIP_COOLDOWN = 4000;
    let gameEndFired = false;

    // Guard alert escalation state
    const escalationCooldowns = new Map<string, number>();
    const activeEscalationEvents: Array<EscalationEvent & { fadeUntil: number }> = [];

    const update = (dt: number) => {
      input.update();
      timeRef.current += dt;

      const state = gsm.getState();
      if (!state) return;

      const map = generatedMapRef.current;

      // --- Event recording: phase transitions ---
      if (state.phase !== prevPhase) {
        // Start recorder when heist begins
        if (state.phase === "heist" && prevPhase !== "") {
          recorder.start(state.heistStartTime ?? Date.now());
          if (isAudioReady()) playAmbientLoop();
        }
        // Terminal events
        if (prevPhase === "heist" && state.phase === "escaped") {
          recorder.record("escape");
        }
        if (prevPhase === "heist" && state.phase === "caught") {
          recorder.record("caught");
        }
        if (prevPhase === "heist" && state.phase === "timeout") {
          recorder.record("timeout");
        }
        prevPhase = state.phase;
      }

      // --- Event recording: item pickup ---
      if (state.runner.hasItem && !prevHasItem) {
        recorder.record("item_pickup", { itemName: state.items[0]?.name });
        if (isAudioReady()) playItemPickup();
      }
      prevHasItem = state.runner.hasItem;

      // --- Event recording: hide enter / hide escape ---
      if (state.runner.hiding && !prevHiding) {
        recorder.record("hide_enter", { x: gsm.localRunnerX, y: gsm.localRunnerY });
      }
      if (!state.runner.hiding && prevHiding && role === "runner") {
        const guards = guardsInitializedRef.current ? localGuardsRef.current : state.guards;
        const nearbyGuard = guards.find(
          (g) => Math.hypot(g.x - gsm.localRunnerX, g.y - gsm.localRunnerY) < 4
        );
        if (nearbyGuard) {
          recorder.record("hide_escape", {
            guardId: nearbyGuard.id,
            distance: Math.hypot(nearbyGuard.x - gsm.localRunnerX, nearbyGuard.y - gsm.localRunnerY),
          });
        }
      }
      prevHiding = state.runner.hiding;

      // Game over — fire onGameEnd callback and stop updates
      const isGameOver = state.phase === "escaped" || state.phase === "caught" || state.phase === "timeout" || state.phase === "disconnected";
      if (isGameOver) {
        if (!gameEndFired) {
          gameEndFired = true;
          stopAmbientLoop();
          if (isAudioReady()) {
            if (state.phase === "escaped") playGameOverEscaped();
            if (state.phase === "caught") playGameOverCaught();
          }
          onGameEndRef.current?.({
            events: recorder.getEvents(),
            positionTrail: recorder.getPositionTrail(),
          });
        }
        return;
      }

      // Planning phase auto-transition: Runner client auto-starts heist when countdown ends
      if (state.phase === "planning" && role === "runner" && !planningAutoStarted) {
        const elapsed = Date.now() - state.startTime;
        if (elapsed >= diffConfigRef.current.planningDurationMs) {
          planningAutoStarted = true;
          startHeistPhaseRef.current({ roomId });
        }
      }

      // Timeout check: Runner client checks every second during heist
      if (state.phase === "heist" && role === "runner") {
        const perfNow = performance.now();
        if (perfNow - lastTimeoutCheck > TIMEOUT_CHECK_INTERVAL) {
          lastTimeoutCheck = perfNow;
          checkTimeoutRef.current({ roomId });
        }
      }

      // Countdown sounds for last 10 seconds
      if (state.phase === "heist" && state.heistStartTime && isAudioReady()) {
        const elapsed = Date.now() - state.heistStartTime;
        const remaining = Math.max(0, diffConfigRef.current.heistDurationMs - elapsed);
        const remainingSec = Math.ceil(remaining / 1000);
        if (remainingSec <= 10 && remainingSec !== lastCountdownSec) {
          lastCountdownSec = remainingSec;
          if (remainingSec <= 3) playCountdownUrgent();
          else playCountdownTick();
        }
      }

      if (role === "runner") {
        // Runner: center camera on runner position
        if (!cameraCentered) {
          camera.centerOn(
            state.runner.x * TILE_SIZE + TILE_SIZE / 2,
            state.runner.y * TILE_SIZE + TILE_SIZE / 2
          );
          cameraCentered = true;
        }

        // Initialize local guards from server state on first sync
        if (!guardsInitializedRef.current && state.guards.length > 0) {
          clearGuardPaths();
          localGuardsRef.current = state.guards.map((g) => ({
            id: g.id,
            x: g.x,
            y: g.y,
            angle: g.angle,
            state: g.state,
            targetWaypoint: g.targetWaypoint,
            lastKnownX: g.lastKnownX,
            lastKnownY: g.lastKnownY,
            stateTimer: g.stateTimer,
          }));
          localDoorsRef.current = state.doors.map((d) => ({ ...d }));
          guardsInitializedRef.current = true;
        }

        // Runner movement (only during heist, not hiding)
        let runnerMoving = false;
        runnerMovingRef.current = false;
        if (state.phase === "heist" && !state.runner.hiding) {
          const touchState = touchInputRef.current.getState();

          const crouching =
            input.isKeyDown("ShiftLeft") || input.isKeyDown("ShiftRight") || touchState.crouching;
          const speed = crouching ? CROUCH_SPEED : WALK_SPEED;

          let dx = 0;
          let dy = 0;
          if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) dy -= 1;
          if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) dy += 1;
          if (input.isKeyDown("KeyA") || input.isKeyDown("ArrowLeft")) dx -= 1;
          if (input.isKeyDown("KeyD") || input.isKeyDown("ArrowRight")) dx += 1;

          // Touch joystick overrides keyboard if active
          const usingTouch = touchState.moveX !== 0 || touchState.moveY !== 0;
          if (usingTouch) {
            dx = touchState.moveX;
            dy = touchState.moveY;
          }

          // Normalize keyboard input (discrete -1/0/1) for consistent
          // diagonal speed. Touch input is already normalized by the
          // joystick manager and carries analog magnitude, so skip it.
          if (!usingTouch && dx !== 0 && dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len;
            dy /= len;
          }

          const prevX = gsm.localRunnerX;
          const prevY = gsm.localRunnerY;
          let newX = prevX;
          let newY = prevY;

          const tryX = newX + dx * speed * dt;
          if (canMoveTo(tryX, newY, map.tiles, localDoorsRef.current)) newX = tryX;

          const tryY = newY + dy * speed * dt;
          if (canMoveTo(newX, tryY, map.tiles, localDoorsRef.current)) newY = tryY;

          gsm.setLocalRunnerPosition(newX, newY, crouching);
          setHudCrouchingRef.current(crouching);

          // Walk animation: use actual position delta so pressing against
          // a wall doesn't count as moving or making noise
          runnerMoving = (newX !== prevX || newY !== prevY);
          runnerMovingRef.current = runnerMoving;
          if (runnerMoving) {
            walkFrameAccumRef.current += dt * 8; // 8 fps walk cycle
            walkFrameRef.current = Math.floor(walkFrameAccumRef.current) % 4;
            facingAngleRef.current = Math.atan2(dy, dx);

            // Runner footstep sounds on frames 1 and 3 (feet hitting ground)
            const curFrame = walkFrameRef.current;
            if ((curFrame === 1 || curFrame === 3) && prevWalkFrame !== curFrame && isAudioReady()) {
              playFootstep(crouching);
            }
            prevWalkFrame = curFrame;
          } else {
            walkFrameAccumRef.current = 0;
            walkFrameRef.current = 0;
            prevWalkFrame = -1;
          }

          const now = performance.now();
          if (now - lastSendTime > SEND_INTERVAL) {
            lastSendTime = now;
            moveRunnerRef.current({ roomId, x: newX, y: newY, crouching });
          }

          // Record position for replay map
          recorder.recordPosition(newX, newY, crouching);
        }

        const guardDiffConfig: GuardDifficultyConfig = {
          guardSpeed: diffConfigRef.current.guardSpeed,
          guardAlertSpeed: diffConfigRef.current.guardAlertSpeed,
          guardRange: diffConfigRef.current.guardRange,
          guardCrouchRange: diffConfigRef.current.guardCrouchRange,
          cameraRange: diffConfigRef.current.cameraRange,
          cameraSweepSpeed: diffConfigRef.current.cameraSweepSpeed,
        };

        // Guard AI tick (Runner client drives guards)
        if (state.phase === "heist" && guardsInitializedRef.current) {
          const now = Date.now();
          const runnerForGuard = {
            x: gsm.localRunnerX,
            y: gsm.localRunnerY,
            crouching: gsm.localCrouching,
            hiding: state.runner.hiding,
            moving: runnerMoving,
          };

          // Save previous guard states for escalation detection
          const previousGuardStates = new Map<string, GuardState>();
          for (const g of localGuardsRef.current) {
            previousGuardStates.set(g.id, g.state);
          }

          let worstState: string = "patrol";
          for (let i = 0; i < localGuardsRef.current.length; i++) {
            const guard = localGuardsRef.current[i];
            const oldState = guard.state;
            const wps = guardWaypointsRef.current[guard.id];
            const result = tickGuard(
              guard,
              runnerForGuard,
              dt,
              map.tiles,
              now,
              wps,
              localDoorsRef.current,
              guardDiffConfig
            );
            localGuardsRef.current[i] = {
              ...guard,
              ...result,
            };

            // Guard walk animation
            const prevPos = guardPrevPosRef.current[guard.id];
            const guardMoving = prevPos
              ? Math.abs(result.x - prevPos.x) > 0.001 || Math.abs(result.y - prevPos.y) > 0.001
              : false;
            if (guardMoving) {
              guardWalkAccumRef.current[guard.id] = (guardWalkAccumRef.current[guard.id] ?? 0) + dt * 6; // 6 fps
              const prevGFrame = guardWalkFrameRef.current[guard.id] ?? 0;
              guardWalkFrameRef.current[guard.id] = Math.floor(guardWalkAccumRef.current[guard.id]) % 4;
              const gFrame = guardWalkFrameRef.current[guard.id];

              // Guard footstep sounds on frame transitions (only when within visibility range)
              if ((gFrame === 1 || gFrame === 3) && prevGFrame !== gFrame && isAudioReady()) {
                const distToRunner = Math.hypot(result.x - gsm.localRunnerX, result.y - gsm.localRunnerY);
                if (distToRunner < 7) {
                  playGuardFootstep();
                }
              }
            } else {
              guardWalkAccumRef.current[guard.id] = 0;
              guardWalkFrameRef.current[guard.id] = 0;
            }
            guardPrevPosRef.current[guard.id] = { x: result.x, y: result.y };

            const newState = localGuardsRef.current[i].state;

            // --- Event recording: guard state transitions ---
            if (oldState !== "alert" && newState === "alert") {
              recorder.record("guard_alert", { guardId: guard.id });
              if (isAudioReady()) playAlertSound();
            }
            if (oldState === "alert" && newState === "returning") {
              recorder.record("guard_lost", { guardId: guard.id });
            }
            if (oldState !== "suspicious" && newState === "suspicious") {
              if (isAudioReady()) playSuspiciousSound();
            }

            // --- Event recording: noise-triggered suspicion ---
            if (
              (oldState === "patrol" || oldState === "returning") &&
              newState === "suspicious" &&
              !canGuardSeeRunner(guard, runnerForGuard, map.tiles, localDoorsRef.current, guardDiffConfig)
            ) {
              recorder.record("noise_alert", {
                guardId: guard.id,
                x: gsm.localRunnerX,
                y: gsm.localRunnerY,
              });
            }

            // --- Event recording: near-miss detection ---
            const updatedGuard = localGuardsRef.current[i];
            const dist = Math.hypot(updatedGuard.x - gsm.localRunnerX, updatedGuard.y - gsm.localRunnerY);
            const prevDist = prevDistToGuard[guard.id] ?? dist;
            if (newState === "alert" && dist < 2.0 && dist > prevDist) {
              const lastTime = lastNearMissTime[guard.id] ?? 0;
              if (now - lastTime > 3000) {
                recorder.record("near_miss", { guardId: guard.id, distance: dist });
                lastNearMissTime[guard.id] = now;
              }
            }
            prevDistToGuard[guard.id] = dist;

            // --- Event recording: crouching sneak ---
            if (newState === "alert") {
              // Reset if guard alerted — doesn't count as a clean sneak
              wasNearGuardWhileCrouching[guard.id] = false;
            } else if (gsm.localCrouching && dist < 3.0 && newState === "patrol") {
              wasNearGuardWhileCrouching[guard.id] = true;
            } else if (wasNearGuardWhileCrouching[guard.id] && dist >= 3.0 && newState === "patrol") {
              recorder.record("crouching_sneak", { guardId: guard.id });
              wasNearGuardWhileCrouching[guard.id] = false;
            }

            // Track worst alert state for HUD
            const gs = localGuardsRef.current[i].state;
            if (gs === "alert") worstState = "alert";
            else if (gs === "suspicious" && worstState !== "alert") worstState = "suspicious";
          }

          // --- Alert Escalation: radio chatter between guards ---
          const alertRadius = diffConfigRef.current.guardAlertRadius;
          if (alertRadius > 0) {
            const escalations = processAlertEscalation(
              localGuardsRef.current,
              previousGuardStates,
              localGuardsRef.current,
              now,
              escalationCooldowns,
              alertRadius
            );

            for (const esc of escalations) {
              recorder.record("guard_escalation", {
                guardId: esc.sourceGuardId,
                x: esc.alertX,
                y: esc.alertY,
              });
              activeEscalationEvents.push({ ...esc, fadeUntil: now + 1500 });
              if (isAudioReady()) playRadioChatter();
              if (isAudioReady()) playSuspiciousSound();
            }

            // Re-check worst state after escalation (guards may have become suspicious)
            if (escalations.length > 0) {
              for (const g of localGuardsRef.current) {
                if (g.state === "alert") worstState = "alert";
                else if (g.state === "suspicious" && worstState !== "alert") worstState = "suspicious";
              }
            }
          }

          // Clean up expired escalation events
          for (let i = activeEscalationEvents.length - 1; i >= 0; i--) {
            if (now >= activeEscalationEvents[i].fadeUntil) {
              activeEscalationEvents.splice(i, 1);
            }
          }

          setGuardAlertStateRef.current(worstState);

          // Throttled send to server
          const perfNow = performance.now();
          if (perfNow - lastGuardSendTime > GUARD_SEND_INTERVAL) {
            lastGuardSendTime = perfNow;
            tickGuardsRef.current({
              roomId,
              guards: localGuardsRef.current.map((g) => ({
                id: g.id,
                x: g.x,
                y: g.y,
                angle: g.angle,
                state: g.state,
                targetWaypoint: g.targetWaypoint,
                lastKnownX: g.lastKnownX,
                lastKnownY: g.lastKnownY,
                stateTimer: g.stateTimer,
              })),
              doors: localDoorsRef.current,
            });
          }
        }

        // Camera detection (Runner client only)
        if (state.phase === "heist" && state.heistStartTime && guardsInitializedRef.current) {
          const elapsed = (Date.now() - state.heistStartTime) / 1000;
          const now = Date.now();
          const runnerForCamera = {
            x: gsm.localRunnerX,
            y: gsm.localRunnerY,
            crouching: gsm.localCrouching,
            hiding: state.runner.hiding,
            moving: runnerMoving,
          };

          for (const cam of state.cameras) {
            const currentAngle = updateCameraAngle(cam.baseAngle, elapsed, guardDiffConfig.cameraSweepSpeed);
            const sees = canCameraSeeRunner(
              { x: cam.x, y: cam.y, angle: currentAngle },
              runnerForCamera,
              map.tiles,
              localDoorsRef.current,
              guardDiffConfig
            );

            if (sees) {
              const lastAlert = lastCameraAlertTime[cam.id] ?? 0;
              if (now - lastAlert > CAMERA_ALERT_COOLDOWN) {
                lastCameraAlertTime[cam.id] = now;

                // Alert nearest guard in patrol or returning state
                let nearestGuard: GuardData | null = null;
                let nearestDist = Infinity;
                for (const guard of localGuardsRef.current) {
                  if (guard.state === "patrol" || guard.state === "returning") {
                    const d = Math.hypot(guard.x - cam.x, guard.y - cam.y);
                    if (d < nearestDist) {
                      nearestDist = d;
                      nearestGuard = guard;
                    }
                  }
                }

                if (nearestGuard) {
                  const idx = localGuardsRef.current.findIndex((g) => g.id === nearestGuard!.id);
                  if (idx !== -1) {
                    localGuardsRef.current[idx] = {
                      ...localGuardsRef.current[idx],
                      state: "suspicious",
                      lastKnownX: gsm.localRunnerX,
                      lastKnownY: gsm.localRunnerY,
                      stateTimer: now,
                    };
                  }
                }

                // Record event for highlights
                recorder.record("camera_spotted", {
                  cameraId: cam.id,
                  x: gsm.localRunnerX,
                  y: gsm.localRunnerY,
                });
              }
            }
          }
        }

        // Laser tripwire detection (Runner client only)
        if (state.phase === "heist" && state.heistStartTime && guardsInitializedRef.current) {
          const elapsedMs = Date.now() - state.heistStartTime;
          const now = Date.now();

          if (!state.runner.hiding && now - lastLaserTripTime > LASER_TRIP_COOLDOWN) {
            for (const laser of state.lasers) {
              if (!isLaserActive(laser, elapsedMs)) continue;
              if (!isRunnerInLaser(laser, gsm.localRunnerX, gsm.localRunnerY)) continue;

              lastLaserTripTime = now;

              // Alert nearest idle guard (same pattern as camera detection)
              let nearestGuard: GuardData | null = null;
              let nearestDist = Infinity;
              const laserMidX = (laser.x1 + laser.x2) / 2;
              const laserMidY = (laser.y1 + laser.y2) / 2;
              for (const guard of localGuardsRef.current) {
                if (guard.state === "patrol" || guard.state === "returning") {
                  const d = Math.hypot(guard.x - laserMidX, guard.y - laserMidY);
                  if (d < nearestDist) {
                    nearestDist = d;
                    nearestGuard = guard;
                  }
                }
              }

              if (nearestGuard) {
                const idx = localGuardsRef.current.findIndex((g) => g.id === nearestGuard!.id);
                if (idx !== -1) {
                  localGuardsRef.current[idx] = {
                    ...localGuardsRef.current[idx],
                    state: "suspicious",
                    lastKnownX: gsm.localRunnerX,
                    lastKnownY: gsm.localRunnerY,
                    stateTimer: now,
                  };
                }
              }

              recorder.record("laser_tripped", {
                x: gsm.localRunnerX,
                y: gsm.localRunnerY,
              });

              if (isAudioReady()) playLaserAlarm();
              break; // Only trip one laser per frame
            }
          }
        }

        // Interaction (keyboard or touch)
        if (
          state.phase === "heist" &&
          (input.isKeyPressed("Space") || input.isKeyPressed("KeyE") || touchInputRef.current.getState().interactPressed)
        ) {
          const interaction = getInteraction(
            gsm.localRunnerX,
            gsm.localRunnerY,
            state.runner.hasItem,
            state.runner.hiding,
            state,
            map.tiles
          );
          if (interaction) {
            if (interaction.action === "toggleDoor") {
              const doorIdx = localDoorsRef.current.findIndex(
                (d) => d.x === interaction.doorX && d.y === interaction.doorY
              );
              if (doorIdx !== -1) {
                const wasOpen = localDoorsRef.current[doorIdx].open;
                localDoorsRef.current[doorIdx] = { ...localDoorsRef.current[doorIdx], open: !wasOpen };
                if (isAudioReady()) { if (wasOpen) playDoorClose(); else playDoorOpen(); }
              }
              toggleDoorRef.current({ roomId, doorX: interaction.doorX!, doorY: interaction.doorY! });
            } else {
              if (isAudioReady() && interaction.action === "exit") playExitUnlock();
              interactRunnerRef.current({ roomId, sessionId, action: interaction.action });
            }
          }
        }

        // Camera follows runner
        camera.follow(
          gsm.localRunnerX * TILE_SIZE + TILE_SIZE / 2,
          gsm.localRunnerY * TILE_SIZE + TILE_SIZE / 2,
          dt
        );
      }
      // Whisper: no movement, no camera follow — static zoomed-out view

      // Clear touch one-shot flags at end of frame
      touchInputRef.current.endFrame();
    };

    const render = () => {
      const state = gsm.getState();
      const { width: canvasWidth, height: canvasHeight } = renderer.getCanvasSize();
      const ctx = renderer.getContext();

      const map = generatedMapRef.current;

      if (role === "runner") {
        // ---- Runner rendering path ----
        renderer.clear();
        renderer.drawTileMap(map.tiles, timeRef.current, localDoorsRef.current.length > 0 ? localDoorsRef.current : state?.doors);

        if (!state) return;

        for (const item of state.items) {
          if (!item.pickedUp) {
            renderer.drawItem(item.x, item.y, timeRef.current);
          }
        }

        // Use local guards for smooth rendering (Runner drives guard AI)
        const guardsToRender = guardsInitializedRef.current
          ? localGuardsRef.current
          : state.guards;
        for (const guard of guardsToRender) {
          const gWalkFrame = guardWalkFrameRef.current[guard.id] ?? 0;
          renderer.drawGuard(guard.x, guard.y, guard.angle, guard.state, gWalkFrame, timeRef.current);
        }

        // Camera vision cones (rendered within fog-of-war visibility)
        if (state.cameras && state.heistStartTime) {
          const elapsedSec = (Date.now() - state.heistStartTime) / 1000;
          const runnerX_ = gsm.localRunnerX;
          const runnerY_ = gsm.localRunnerY;
          const fogRadius = (gsm.localCrouching ? CROUCH_VIS_RADIUS : WALK_VIS_RADIUS) / TILE_SIZE;

          for (const cam of state.cameras) {
            const distToRunner = Math.hypot(cam.x - runnerX_, cam.y - runnerY_);
            if (distToRunner <= fogRadius) {
              const camScreen = camera.worldToScreen(
                cam.x * TILE_SIZE + TILE_SIZE / 2,
                cam.y * TILE_SIZE + TILE_SIZE / 2
              );
              const currentAngle = updateCameraAngle(cam.baseAngle, elapsedSec, diffConfigRef.current.cameraSweepSpeed);
              const rangePixels = (diffConfigRef.current.cameraRange) * TILE_SIZE;
              const halfFovRad = ((CAMERA_FOV * Math.PI) / 180) / 2;

              ctx.save();
              ctx.globalAlpha = 0.12;
              ctx.fillStyle = "#FFAA33";
              ctx.beginPath();
              ctx.moveTo(camScreen.x, camScreen.y);
              ctx.arc(camScreen.x, camScreen.y, rangePixels, currentAngle - halfFovRad, currentAngle + halfFovRad);
              ctx.closePath();
              ctx.fill();
              ctx.globalAlpha = 0.25;
              ctx.strokeStyle = "#FFAA33";
              ctx.lineWidth = 1;
              ctx.stroke();
              ctx.restore();
            }
          }
        }

        // Laser tripwires (rendered within fog-of-war visibility)
        if (state.lasers.length > 0) {
          const laserElapsedMs = state.heistStartTime
            ? Date.now() - state.heistStartTime
            : 0;
          const runnerX_ = gsm.localRunnerX;
          const runnerY_ = gsm.localRunnerY;
          const fogRadius = (gsm.localCrouching ? CROUCH_VIS_RADIUS : WALK_VIS_RADIUS) / TILE_SIZE;

          for (const laser of state.lasers) {
            // Check if either emitter is within fog-of-war visibility
            const d1 = Math.hypot(laser.x1 - runnerX_, laser.y1 - runnerY_);
            const d2 = Math.hypot(laser.x2 - runnerX_, laser.y2 - runnerY_);
            if (d1 > fogRadius && d2 > fogRadius) continue;

            const active = state.heistStartTime ? isLaserActive(laser, laserElapsedMs) : true;

            const sx1 = camera.worldToScreen(
              (laser.x1 + 0.5) * TILE_SIZE,
              (laser.y1 + 0.5) * TILE_SIZE
            );
            const sx2 = camera.worldToScreen(
              (laser.x2 + 0.5) * TILE_SIZE,
              (laser.y2 + 0.5) * TILE_SIZE
            );

            if (active) {
              // Glow layer (wider, translucent)
              ctx.save();
              ctx.strokeStyle = "rgba(255, 40, 40, 0.3)";
              ctx.lineWidth = 8;
              ctx.beginPath();
              ctx.moveTo(sx1.x, sx1.y);
              ctx.lineTo(sx2.x, sx2.y);
              ctx.stroke();

              // Core beam (thin, bright, pulsing)
              const pulse = 0.7 + 0.3 * Math.sin(laserElapsedMs * 0.005);
              ctx.strokeStyle = `rgba(255, 0, 0, ${pulse})`;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(sx1.x, sx1.y);
              ctx.lineTo(sx2.x, sx2.y);
              ctx.stroke();
              ctx.restore();
            }

            // Emitter boxes on both ends
            const dotColor = active ? "#FF0000" : "#660000";
            const boxSize = 6;
            for (const pt of [sx1, sx2]) {
              ctx.fillStyle = "#333";
              ctx.fillRect(pt.x - boxSize / 2, pt.y - boxSize / 2, boxSize, boxSize);
              ctx.fillStyle = dotColor;
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        const runnerX = gsm.localRunnerX;
        const runnerY = gsm.localRunnerY;
        const crouching = gsm.localCrouching;
        renderer.drawRunner(
          runnerX,
          runnerY,
          crouching,
          state.runner.hiding,
          state.runner.hasItem,
          walkFrameRef.current,
          facingAngleRef.current,
          runnerColorsRef.current
        );

        // Noise wave indicator (visible when running, not crouching)
        if (runnerMovingRef.current && !crouching && !state.runner.hiding) {
          const runnerScreen = camera.worldToScreen(
            runnerX * TILE_SIZE + TILE_SIZE / 2,
            runnerY * TILE_SIZE + TILE_SIZE / 2
          );
          const pulse = (Date.now() % 800) / 800;
          ctx.save();
          ctx.strokeStyle = "rgba(255, 200, 100, 0.25)";
          ctx.lineWidth = 1;
          for (let ring = 0; ring < 3; ring++) {
            const radius = NOISE_RADIUS_RUNNING * TILE_SIZE * (0.3 + ring * 0.25 + pulse * 0.15);
            const alpha = 0.25 - ring * 0.08;
            ctx.globalAlpha = Math.max(0, alpha);
            ctx.beginPath();
            ctx.arc(runnerScreen.x, runnerScreen.y, radius, -0.3, 0.3);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(runnerScreen.x, runnerScreen.y, radius, Math.PI - 0.3, Math.PI + 0.3);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Escalation wave visuals (rendered BELOW fog so only visible in Runner's radius)
        if (activeEscalationEvents.length > 0) {
          const guardsForVis = guardsInitializedRef.current ? localGuardsRef.current : state.guards;
          const fogRadiusTiles = (crouching ? CROUCH_VIS_RADIUS : WALK_VIS_RADIUS) / TILE_SIZE;
          renderEscalationWaves(
            ctx,
            activeEscalationEvents,
            guardsForVis,
            Date.now(),
            camera,
            runnerX,
            runnerY,
            fogRadiusTiles
          );
        }

        // Whisper-drawn paths (rendered BELOW fog so only visible in Runner's radius)
        if (state.paths.length > 0) {
          renderPathForRunner(ctx, camera, state.paths, state.phase);
        }

        // Fog of war
        const screen = camera.worldToScreen(
          runnerX * TILE_SIZE + TILE_SIZE / 2,
          runnerY * TILE_SIZE + TILE_SIZE / 2
        );
        const visRadius = crouching ? CROUCH_VIS_RADIUS : WALK_VIS_RADIUS;
        renderFogOfWar(ctx, canvasWidth, canvasHeight, screen.x, screen.y, visRadius, timeRef.current);

        // Pings (rendered above fog)
        renderPings(ctx, camera, state.pings, canvasWidth, canvasHeight);
      } else {
        // ---- Whisper rendering path (blueprint view) ----
        // Dark background
        ctx.fillStyle = "#0a0e1a";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        if (!state) return;

        // Calculate zoom to fit entire map
        const mapPixelW = getMapWidth(map.tiles) * TILE_SIZE;
        const mapPixelH = getMapHeight(map.tiles) * TILE_SIZE;
        const scale = Math.min(canvasWidth / mapPixelW, canvasHeight / mapPixelH) * 0.9;
        const offsetX = (canvasWidth - mapPixelW * scale) / 2;
        const offsetY = (canvasHeight - mapPixelH * scale) / 2;

        // Store transform for click handler
        blueprintTransformRef.current = { offsetX, offsetY, scale };

        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        renderBlueprintMap(ctx, map.tiles, state.doors);
        renderWhisperEntities(ctx, state, timeRef.current, guardWaypointsRef.current, {
          guardRange: diffConfigRef.current.guardRange,
          cameraRange: diffConfigRef.current.cameraRange,
          cameraSweepSpeed: diffConfigRef.current.cameraSweepSpeed,
        }, runnerColorsRef.current.body);

        // Laser tripwires (Whisper sees all, always visible)
        if (state.lasers.length > 0) {
          const laserElapsedMs = state.heistStartTime
            ? Date.now() - state.heistStartTime
            : 0;

          for (const laser of state.lasers) {
            const active = state.heistStartTime ? isLaserActive(laser, laserElapsedMs) : true;

            const lx1 = (laser.x1 + 0.5) * TILE_SIZE;
            const ly1 = (laser.y1 + 0.5) * TILE_SIZE;
            const lx2 = (laser.x2 + 0.5) * TILE_SIZE;
            const ly2 = (laser.y2 + 0.5) * TILE_SIZE;

            if (active) {
              // Active beam: bright red with glow
              ctx.save();
              ctx.strokeStyle = "rgba(255, 40, 40, 0.3)";
              ctx.lineWidth = 6;
              ctx.beginPath();
              ctx.moveTo(lx1, ly1);
              ctx.lineTo(lx2, ly2);
              ctx.stroke();

              const pulse = 0.7 + 0.3 * Math.sin(laserElapsedMs * 0.005);
              ctx.strokeStyle = `rgba(255, 0, 0, ${pulse})`;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(lx1, ly1);
              ctx.lineTo(lx2, ly2);
              ctx.stroke();
              ctx.restore();
            } else {
              // Inactive beam: dashed dim red line
              ctx.save();
              ctx.setLineDash([4, 6]);
              ctx.strokeStyle = "rgba(255, 60, 60, 0.25)";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(lx1, ly1);
              ctx.lineTo(lx2, ly2);
              ctx.stroke();
              ctx.restore();
            }

            // Emitter boxes on both ends
            const dotColor = active ? "#FF0000" : "#660000";
            const boxSize = 6;
            for (const [px, py] of [[lx1, ly1], [lx2, ly2]]) {
              ctx.fillStyle = "#333";
              ctx.fillRect(px - boxSize / 2, py - boxSize / 2, boxSize, boxSize);
              ctx.fillStyle = dotColor;
              ctx.beginPath();
              ctx.arc(px, py, 2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        // Escalation communication lines between guards
        if (activeEscalationEvents.length > 0) {
          renderEscalationLines(ctx, activeEscalationEvents, state.guards, Date.now());
        }

        // Render synced paths
        if (state.paths.length > 0) {
          renderPaths(ctx, state.paths, state.phase, timeRef.current);
        }

        // Render path preview while drawing
        if (drawingPathPointsRef.current.length >= 2) {
          renderPathPreview(ctx, drawingPathPointsRef.current, timeRef.current);
        }

        ctx.restore();
      }
    };

    const loop = new GameLoop(update, render);
    loop.start();

    // Periodic tick for HUD timer
    const hudInterval = setInterval(() => {
      setTick((t) => t + 1);
    }, 500);

    return () => {
      loop.stop();
      input.detach();
      window.removeEventListener("resize", resize);
      clearInterval(hudInterval);
      clearTileCache();
      clearGuardPaths();
      stopAmbientLoop();
    };
  }, [roomId, role, sessionId]);

  const [drawModeActive, setDrawModeActive] = useState(false);
  const toggleDrawMode = useCallback(() => {
    setDrawModeActive((prev) => {
      const next = !prev;
      drawModeRef.current = next;
      return next;
    });
  }, []);

  const handleStartHeist = useCallback(() => {
    startHeistPhase({ roomId });
  }, [startHeistPhase, roomId]);

  const phase = gameState?.phase ?? "planning";
  const activePingCount = (gameState?.pings ?? []).length;

  return (
    <div
      className="relative w-screen h-screen overflow-hidden touch-none select-none"
      style={{ overscrollBehavior: "none" }}
    >
      <canvas
        ref={canvasRef}
        className="block touch-none"
        style={{ width: "100vw", height: "100vh", touchAction: "none" }}
      />

      <HUD
        role={role}
        phase={phase}
        heistStartTime={gameState?.heistStartTime}
        hasItem={gameState?.runner.hasItem ?? false}
        itemName={gameState?.items[0]?.name ?? "Golden Rubber Duck"}
        crouching={hudCrouching}
        selectedPingType={selectedPingType}
        activePingCount={activePingCount}
        runnerState={gameState?.runner ?? { crouching: false, hiding: false, hasItem: false }}
        onSelectPingType={setSelectedPingType}
        onSendQuickComm={handleSendQuickComm}
        guardAlertState={guardAlertState}
        difficulty={difficultyProp}
      />

      {showTouchControls && (
        <TouchControls
          touchInput={touchInput}
          role={role}
          phase={phase}
          drawModeActive={drawModeActive}
          onToggleDrawMode={toggleDrawMode}
        />
      )}

      {/* Planning phase overlay with countdown */}
      {phase === "planning" && (
        <PlanningOverlay
          startTime={gameState?.startTime ?? 0}
          role={role}
          onStartHeist={handleStartHeist}
          planningDuration={diffConfig.planningDurationMs}
        />
      )}

      {/* Quick-Comm overlay — Runner sees Whisper messages */}
      {role === "runner" && activeComm && (
        <div
          className="fixed inset-0 z-20 pointer-events-none flex items-center justify-center"
          style={{ animation: "quick-comm-in 0.15s ease-out" }}
        >
          <div
            className="text-center px-8 py-4 rounded-2xl bg-black/40 backdrop-blur-sm border-2"
            style={{
              borderColor: activeComm.color + "80",
              animation: "quick-comm-pulse 0.5s ease-out",
            }}
          >
            <div
              className="text-3xl sm:text-4xl font-black tracking-wider uppercase"
              style={{
                color: activeComm.color,
                textShadow: `0 0 20px ${activeComm.color}60, 0 2px 4px rgba(0,0,0,0.5)`,
              }}
            >
              {activeComm.text}
            </div>
            <div className="text-xs mt-1 opacity-40" style={{ color: activeComm.color }}>
              — Whisper
            </div>
          </div>
        </div>
      )}

      {/* Whisper: quick-comm sent confirmation */}
      {role === "whisper" && activeComm && (
        <div className="fixed bottom-20 left-4 z-20 pointer-events-none">
          <div
            className="text-sm font-bold px-3 py-1 rounded-lg bg-black/40"
            style={{ color: activeComm.color, animation: "fade-in 0.2s ease-out" }}
          >
            Sent: {activeComm.text}
          </div>
        </div>
      )}

      {/* Disconnect warning overlay */}
      {showDisconnectWarning && (
        <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-[#2D1B0E]/90 border-2 border-[#FFD700]/50 rounded-xl px-8 py-6 text-center">
            <p className="text-[#FFD700] text-xl font-bold">Partner Disconnected</p>
            <p className="text-[#E8D5B7] text-sm mt-2">Waiting for them to reconnect...</p>
          </div>
        </div>
      )}

    </div>
  );
}
