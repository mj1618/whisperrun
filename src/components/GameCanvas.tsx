"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import Link from "next/link";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { GameLoop } from "@/engine/loop";
import { Renderer, TILE_SIZE } from "@/engine/renderer";
import { Camera } from "@/engine/camera";
import { InputHandler } from "@/engine/input";
import { TEST_MAP, isWalkable, getMapWidth, getMapHeight, TileType } from "@/game/map";
import { GameStateManager, LocalGameState } from "@/game/game-state";
import { renderFogOfWar, renderPings } from "@/game/runner-view";
import { renderBlueprintMap, renderWhisperEntities } from "@/game/whisper-view";
import { screenToTileWhisper } from "@/game/ping-system";
import { tickGuard, GuardData } from "@/game/guard-ai";
import HUD from "@/components/HUD";

interface GameCanvasProps {
  roomId: Id<"rooms">;
  sessionId: string;
  role: "runner" | "whisper";
}

// Movement speeds in tiles/second
const WALK_SPEED = 3;
const CROUCH_SPEED = 1.5;

// Visibility radius in pixels
const WALK_VIS_RADIUS = 6 * TILE_SIZE;
const CROUCH_VIS_RADIUS = 4 * TILE_SIZE;

// Runner hitbox half-width in tiles
const HITBOX_HALF = 0.3;

function canMoveTo(x: number, y: number): boolean {
  const corners = [
    { col: Math.floor(x - HITBOX_HALF), row: Math.floor(y - HITBOX_HALF) },
    { col: Math.floor(x + HITBOX_HALF), row: Math.floor(y - HITBOX_HALF) },
    { col: Math.floor(x - HITBOX_HALF), row: Math.floor(y + HITBOX_HALF) },
    { col: Math.floor(x + HITBOX_HALF), row: Math.floor(y + HITBOX_HALF) },
  ];
  return corners.every((c) => isWalkable(TEST_MAP, c.col, c.row));
}

function getInteraction(
  x: number,
  y: number,
  hasItem: boolean,
  hiding: boolean,
  state: LocalGameState
): "exit" | "pickup" | "hide" | "unhide" | null {
  if (hasItem) {
    const dist = Math.hypot(state.exitX - x, state.exitY - y);
    if (dist < 1.5) return "exit";
  }

  const nearItem = state.items.find(
    (item) =>
      !item.pickedUp &&
      Math.abs(item.x - x) < 1.5 &&
      Math.abs(item.y - y) < 1.5
  );
  if (nearItem) return "pickup";

  if (hiding) return "unhide";

  const tileCol = Math.round(x);
  const tileRow = Math.round(y);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = tileRow + dr;
      const c = tileCol + dc;
      if (
        r >= 0 &&
        r < TEST_MAP.length &&
        c >= 0 &&
        c < (TEST_MAP[0]?.length ?? 0)
      ) {
        if (TEST_MAP[r][c] === TileType.HideSpot) {
          const dist = Math.hypot(c - x, r - y);
          if (dist < 1.5) return "hide";
        }
      }
    }
  }

  return null;
}

export default function GameCanvas({
  roomId,
  sessionId,
  role,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateManagerRef = useRef(new GameStateManager());
  const timeRef = useRef(0);

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
  const tickGuardsMutation = useMutation(api.game.tickGuards);
  const checkTimeout = useMutation(api.game.checkTimeout);

  // Store mutations/setters in refs so game loop can access them
  const moveRunnerRef = useRef(moveRunner);
  const interactRunnerRef = useRef(interactRunner);
  const addPingRef = useRef(addPing);
  const tickGuardsRef = useRef(tickGuardsMutation);
  const setHudCrouchingRef = useRef(setHudCrouching);
  const startHeistPhaseRef = useRef(startHeistPhase);
  const checkTimeoutRef = useRef(checkTimeout);
  useEffect(() => {
    moveRunnerRef.current = moveRunner;
    interactRunnerRef.current = interactRunner;
    addPingRef.current = addPing;
    tickGuardsRef.current = tickGuardsMutation;
    setHudCrouchingRef.current = setHudCrouching;
    startHeistPhaseRef.current = startHeistPhase;
    checkTimeoutRef.current = checkTimeout;
  }, [moveRunner, interactRunner, addPing, tickGuardsMutation, setHudCrouching, startHeistPhase, checkTimeout]);

  // Local guard state for client-side prediction (Runner client drives guard AI)
  const localGuardsRef = useRef<GuardData[]>([]);
  const guardsInitializedRef = useRef(false);

  // Guard alert state for HUD
  const [guardAlertState, setGuardAlertState] = useState<string>("patrol");
  const setGuardAlertStateRef = useRef(setGuardAlertState);
  useEffect(() => {
    setGuardAlertStateRef.current = setGuardAlertState;
  }, [setGuardAlertState]);

  // Blueprint zoom state stored in ref so click handler can access it
  const blueprintTransformRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });

  // Update game state manager when Convex data arrives
  useEffect(() => {
    if (!gameState) {
      gameStateManagerRef.current.setServerState(null);
      return;
    }
    const local: LocalGameState = {
      runner: gameState.runner,
      guards: gameState.guards,
      items: gameState.items,
      pings: gameState.pings,
      exitX: gameState.exitX,
      exitY: gameState.exitY,
      phase: gameState.phase,
      startTime: gameState.startTime,
      heistStartTime: gameState.heistStartTime,
    };
    gameStateManagerRef.current.setServerState(local);
  }, [gameState]);

  // Whisper: cleanup expired pings every 2 seconds
  useEffect(() => {
    if (role !== "whisper") return;
    const interval = setInterval(() => {
      cleanupPings({ roomId });
    }, 2000);
    return () => clearInterval(interval);
  }, [role, roomId, cleanupPings]);

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

  // Whisper: click-to-ping handler
  useEffect(() => {
    if (role !== "whisper") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e: MouseEvent) => {
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
      if (!isWalkable(TEST_MAP, col, row)) return;

      addPingRef.current({
        roomId,
        x: tile.x,
        y: tile.y,
        type: selectedPingTypeRef.current,
      });
    };

    canvas.addEventListener("pointerdown", handleClick);
    return () => canvas.removeEventListener("pointerdown", handleClick);
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

    const update = (dt: number) => {
      input.update();
      timeRef.current += dt;

      const state = gsm.getState();
      if (!state) return;

      // Game over — stop all updates
      const isGameOver = state.phase === "escaped" || state.phase === "caught" || state.phase === "timeout";
      if (isGameOver) return;

      // Planning phase auto-transition: Runner client auto-starts heist when countdown ends
      if (state.phase === "planning" && role === "runner" && !planningAutoStarted) {
        const planningDuration = 30_000;
        const elapsed = Date.now() - state.startTime;
        if (elapsed >= planningDuration) {
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
          localGuardsRef.current = state.guards.map((g) => ({
            id: g.id,
            x: g.x,
            y: g.y,
            angle: g.angle,
            state: g.state as GuardData["state"],
            targetWaypoint: g.targetWaypoint,
            lastKnownX: g.lastKnownX,
            lastKnownY: g.lastKnownY,
            stateTimer: g.stateTimer,
          }));
          guardsInitializedRef.current = true;
        }

        // Runner movement (only during heist, not hiding)
        if (state.phase === "heist" && !state.runner.hiding) {
          const crouching =
            input.isKeyDown("ShiftLeft") || input.isKeyDown("ShiftRight");
          const speed = crouching ? CROUCH_SPEED : WALK_SPEED;

          let dx = 0;
          let dy = 0;
          if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) dy -= 1;
          if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) dy += 1;
          if (input.isKeyDown("KeyA") || input.isKeyDown("ArrowLeft")) dx -= 1;
          if (input.isKeyDown("KeyD") || input.isKeyDown("ArrowRight")) dx += 1;

          if (dx !== 0 && dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len;
            dy /= len;
          }

          let newX = gsm.localRunnerX;
          let newY = gsm.localRunnerY;

          const tryX = newX + dx * speed * dt;
          if (canMoveTo(tryX, newY)) newX = tryX;

          const tryY = newY + dy * speed * dt;
          if (canMoveTo(newX, tryY)) newY = tryY;

          gsm.setLocalRunnerPosition(newX, newY, crouching);
          setHudCrouchingRef.current(crouching);

          const now = performance.now();
          if (now - lastSendTime > SEND_INTERVAL) {
            lastSendTime = now;
            moveRunnerRef.current({ roomId, x: newX, y: newY, crouching });
          }
        }

        // Guard AI tick (Runner client drives guards)
        if (state.phase === "heist" && guardsInitializedRef.current) {
          const now = Date.now();
          const runnerForGuard = {
            x: gsm.localRunnerX,
            y: gsm.localRunnerY,
            crouching: gsm.localCrouching,
            hiding: state.runner.hiding,
          };

          let worstState: string = "patrol";
          for (let i = 0; i < localGuardsRef.current.length; i++) {
            const result = tickGuard(
              localGuardsRef.current[i],
              runnerForGuard,
              dt,
              TEST_MAP,
              now
            );
            localGuardsRef.current[i] = {
              ...localGuardsRef.current[i],
              ...result,
            };
            // Track worst alert state for HUD
            const gs = localGuardsRef.current[i].state;
            if (gs === "alert") worstState = "alert";
            else if (gs === "suspicious" && worstState !== "alert") worstState = "suspicious";
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
            });
          }
        }

        // Interaction
        if (
          state.phase === "heist" &&
          (input.isKeyPressed("Space") || input.isKeyPressed("KeyE"))
        ) {
          const interaction = getInteraction(
            gsm.localRunnerX,
            gsm.localRunnerY,
            state.runner.hasItem,
            state.runner.hiding,
            state
          );
          if (interaction) {
            interactRunnerRef.current({ roomId, sessionId, action: interaction });
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
    };

    const render = () => {
      const state = gsm.getState();
      const { width: canvasWidth, height: canvasHeight } = renderer.getCanvasSize();
      const ctx = renderer.getContext();

      if (role === "runner") {
        // ---- Runner rendering path ----
        renderer.clear();
        renderer.drawTileMap(TEST_MAP);

        if (!state) return;

        renderer.drawExit(state.exitX, state.exitY, timeRef.current);

        for (const item of state.items) {
          if (!item.pickedUp) {
            renderer.drawItem(item.x, item.y);
          }
        }

        // Use local guards for smooth rendering (Runner drives guard AI)
        const guardsToRender = guardsInitializedRef.current
          ? localGuardsRef.current
          : state.guards;
        for (const guard of guardsToRender) {
          renderer.drawGuard(guard.x, guard.y, guard.angle, guard.state as "patrol" | "suspicious" | "alert" | "returning");
        }

        const runnerX = gsm.localRunnerX;
        const runnerY = gsm.localRunnerY;
        const crouching = gsm.localCrouching;
        renderer.drawRunner(runnerX, runnerY, crouching, state.runner.hiding);

        // Fog of war
        const screen = camera.worldToScreen(
          runnerX * TILE_SIZE + TILE_SIZE / 2,
          runnerY * TILE_SIZE + TILE_SIZE / 2
        );
        const visRadius = crouching ? CROUCH_VIS_RADIUS : WALK_VIS_RADIUS;
        renderFogOfWar(ctx, canvasWidth, canvasHeight, screen.x, screen.y, visRadius);

        // Pings (rendered above fog)
        renderPings(ctx, camera, state.pings, canvasWidth, canvasHeight);
      } else {
        // ---- Whisper rendering path (blueprint view) ----
        // Dark background
        ctx.fillStyle = "#0a0e1a";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        if (!state) return;

        // Calculate zoom to fit entire map
        const mapPixelW = getMapWidth(TEST_MAP) * TILE_SIZE;
        const mapPixelH = getMapHeight(TEST_MAP) * TILE_SIZE;
        const scale = Math.min(canvasWidth / mapPixelW, canvasHeight / mapPixelH) * 0.9;
        const offsetX = (canvasWidth - mapPixelW * scale) / 2;
        const offsetY = (canvasHeight - mapPixelH * scale) / 2;

        // Store transform for click handler
        blueprintTransformRef.current = { offsetX, offsetY, scale };

        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        renderBlueprintMap(ctx, TEST_MAP);
        renderWhisperEntities(ctx, state, timeRef.current);

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
    };
  }, [roomId, role, sessionId]);

  const handleStartHeist = useCallback(() => {
    startHeistPhase({ roomId });
  }, [startHeistPhase, roomId]);

  const phase = gameState?.phase ?? "planning";
  const activePingCount = (gameState?.pings ?? []).length;

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block"
        style={{ width: "100vw", height: "100vh" }}
      />

      <HUD
        role={role}
        phase={phase}
        startTime={gameState?.heistStartTime ?? gameState?.startTime ?? 0}
        hasItem={gameState?.runner.hasItem ?? false}
        itemName={gameState?.items[0]?.name ?? "Golden Rubber Duck"}
        crouching={hudCrouching}
        selectedPingType={selectedPingType}
        activePingCount={activePingCount}
        runnerState={gameState?.runner ?? { crouching: false, hiding: false, hasItem: false }}
        onSelectPingType={setSelectedPingType}
        guardAlertState={guardAlertState}
      />

      {/* Planning phase overlay */}
      {phase === "planning" && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="bg-black/70 rounded-2xl p-8 text-center space-y-4 max-w-sm">
            <h2 className="text-2xl font-bold text-[#E8D5B7]">
              Planning Phase
            </h2>
            <p className="text-[#E8D5B7]/70 text-sm">
              {role === "whisper"
                ? "Study the map and ping locations for the Runner!"
                : "Get ready to sneak in!"}
            </p>
            <button
              onClick={handleStartHeist}
              className="px-8 py-3 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                         hover:bg-[#FFC107] transition-colors text-lg cursor-pointer"
            >
              Start Heist!
            </button>
          </div>
        </div>
      )}

      {/* Escaped overlay */}
      {phase === "escaped" && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="bg-black/70 rounded-2xl p-8 text-center space-y-4 max-w-sm">
            <h2 className="text-3xl font-bold text-[#4CAF50]">
              You Escaped!
            </h2>
            <p className="text-[#E8D5B7]/70">
              The heist was a success! The loot is yours.
            </p>
            <Link
              href="/"
              className="inline-block px-6 py-2 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                         hover:bg-[#FFC107] transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      )}

      {/* Caught overlay */}
      {phase === "caught" && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="bg-black/70 rounded-2xl p-8 text-center space-y-4 max-w-sm">
            <h2 className="text-3xl font-bold text-[#FF6B6B]">
              Busted!
            </h2>
            <p className="text-[#E8D5B7]/70">
              The guard politely escorted you out of the building. Better luck next time!
            </p>
            <Link
              href="/"
              className="inline-block px-6 py-2 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                         hover:bg-[#FFC107] transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      )}

      {/* Timeout overlay */}
      {phase === "timeout" && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="bg-black/70 rounded-2xl p-8 text-center space-y-4 max-w-sm">
            <h2 className="text-3xl font-bold text-[#FFD700]">
              Time&apos;s Up!
            </h2>
            <p className="text-[#E8D5B7]/70">
              You ran out of time. The heist is over!
            </p>
            <Link
              href="/"
              className="inline-block px-6 py-2 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                         hover:bg-[#FFC107] transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      )}

      {/* Controls hint */}
      {phase === "heist" && role === "runner" && (
        <div className="absolute bottom-4 right-4 z-10 pointer-events-none">
          <div className="bg-black/30 text-[#E8D5B7]/40 px-3 py-2 rounded text-xs space-y-0.5">
            <div>WASD — Move</div>
            <div>Shift — Crouch</div>
            <div>Space/E — Interact</div>
          </div>
        </div>
      )}

      {/* Whisper controls hint */}
      {(phase === "heist" || phase === "planning") && role === "whisper" && (
        <div className="absolute bottom-4 right-4 z-10 pointer-events-none">
          <div className="bg-black/30 text-[#8BB8E8]/40 px-3 py-2 rounded text-xs space-y-0.5">
            <div>Click — Place Ping</div>
            <div>1 — Go Here</div>
            <div>2 — Danger</div>
            <div>3 — Item</div>
          </div>
        </div>
      )}
    </div>
  );
}
