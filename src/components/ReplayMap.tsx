"use client";

import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { generateMap } from "@/game/map-generator";
import { DifficultyLevel } from "@/game/difficulty";
import { GameEvent, PositionPoint } from "@/game/events";
import { TileType } from "@/game/map";
interface ReplayMapProps {
  mapSeed: number;
  difficulty: DifficultyLevel;
  positionTrail: PositionPoint[];
  events: GameEvent[];
  outcome: "escaped" | "caught" | "timeout" | "disconnected";
}

const PLAYBACK_DURATION = 5000; // 5 seconds
const AUTO_PLAY_DELAY = 500;
const TILE_SIZE = 32;

// Blueprint color palette
const WALL_COLOR = "#1a1a2e";
const FLOOR_COLOR = "#1e2d4a";
const DOOR_COLOR = "#3a5a7a";
const HIDESPOT_COLOR = "#2a3d5a";
const ITEM_COLOR = "#FFD700";
const EXIT_COLOR = "#4CAF50";
const SPAWN_COLOR = "#4a9eff";
const CAMERA_COLOR = "#FFAA33";

// Event marker colors
const MARKER_ALERT = "#FF4444";
const MARKER_NEAR_MISS = "#FF8C00";
const MARKER_ITEM = "#FFD700";
const MARKER_CAUGHT = "#FF2222";
const MARKER_ESCAPE = "#4CAF50";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getMarkerColor(type: string): { color: string; radius: number } {
  switch (type) {
    case "alert": return { color: MARKER_ALERT, radius: 5 };
    case "near_miss": return { color: MARKER_NEAR_MISS, radius: 5 };
    case "item": return { color: MARKER_ITEM, radius: 6 };
    case "caught": return { color: MARKER_CAUGHT, radius: 7 };
    case "escape": return { color: MARKER_ESCAPE, radius: 7 };
    default: return { color: "#fff", radius: 5 };
  }
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: string,
  scaleFactor: number,
) {
  const { color, radius } = getMarkerColor(type);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scaleFactor, scaleFactor);

  // Outer glow
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 2, 0, Math.PI * 2);
  ctx.fill();

  // Inner circle
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  // Inner symbol
  ctx.fillStyle = "#000";
  ctx.globalAlpha = 0.7;
  ctx.font = `bold ${radius}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (type === "caught") ctx.fillText("X", 0, 0);
  else if (type === "escape") ctx.fillText("\u2713", 0, 0);
  else if (type === "item") ctx.fillText("\u2605", 0, 0.5);
  else if (type === "alert") ctx.fillText("!", 0, 0);

  ctx.restore();
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  crouching: boolean,
) {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.lineWidth = crouching ? 1.5 : 2;
  ctx.strokeStyle = "#FFD700";
  ctx.globalAlpha = crouching ? 0.4 : 0.8;

  if (crouching) {
    ctx.setLineDash([3, 3]);
  } else {
    ctx.setLineDash([]);
  }

  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawRunnerDot(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
) {
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#FFD700";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#FFD700";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
  ctx.fill();
}

interface EventMarker {
  x: number;
  y: number;
  t: number;
  type: "alert" | "near_miss" | "item" | "caught" | "escape";
}

export default function ReplayMap({
  mapSeed,
  difficulty,
  positionTrail,
  events,
  outcome,
}: ReplayMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const startTimeRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // Regenerate map from seed
  const map = useMemo(() => generateMap(mapSeed, difficulty), [mapSeed, difficulty]);

  // Total heist duration from trail
  const heistDuration = useMemo(() => {
    if (positionTrail.length === 0) return 0;
    return positionTrail[positionTrail.length - 1].t;
  }, [positionTrail]);

  // Event markers with positions — match events to nearest trail point
  const eventMarkers = useMemo(() => {
    const markers: EventMarker[] = [];

    for (const event of events) {
      let markerType: EventMarker["type"] | null = null;
      if (event.type === "guard_alert") markerType = "alert";
      else if (event.type === "near_miss") markerType = "near_miss";
      else if (event.type === "item_pickup") markerType = "item";
      else if (event.type === "caught") markerType = "caught";
      else if (event.type === "escape") markerType = "escape";

      if (!markerType) continue;

      let x = event.data?.x;
      let y = event.data?.y;

      if (x == null || y == null) {
        let best = positionTrail[0];
        let bestDelta = Infinity;
        for (const pt of positionTrail) {
          const delta = Math.abs(pt.t - event.timestamp);
          if (delta < bestDelta) {
            bestDelta = delta;
            best = pt;
          }
        }
        if (best) {
          x = best.x;
          y = best.y;
        }
      }

      if (x != null && y != null) {
        markers.push({ x, y, t: event.timestamp, type: markerType });
      }
    }

    return markers;
  }, [events, positionTrail]);

  // Canvas dimensions
  const canvasWidth = 360;
  const mapPixelW = map.width * TILE_SIZE;
  const mapPixelH = map.height * TILE_SIZE;
  const tileScale = canvasWidth / mapPixelW;
  const canvasHeight = Math.round(mapPixelH * tileScale);

  // Convert trail position to canvas coordinates
  const toCanvasPt = useCallback(
    (x: number, y: number) => ({
      x: (x + 0.5) * TILE_SIZE * tileScale,
      y: (y + 0.5) * TILE_SIZE * tileScale,
    }),
    [tileScale],
  );

  // Store render dependencies in refs so the animation loop can read them
  const positionTrailRef = useRef(positionTrail);
  const heistDurationRef = useRef(heistDuration);
  const eventMarkersRef = useRef(eventMarkers);
  const toCanvasPtRef = useRef(toCanvasPt);
  useEffect(() => { positionTrailRef.current = positionTrail; }, [positionTrail]);
  useEffect(() => { heistDurationRef.current = heistDuration; }, [heistDuration]);
  useEffect(() => { eventMarkersRef.current = eventMarkers; }, [eventMarkers]);
  useEffect(() => { toCanvasPtRef.current = toCanvasPt; }, [toCanvasPt]);

  // Render static background map to offscreen canvas
  useEffect(() => {
    const offscreen = document.createElement("canvas");
    offscreen.width = canvasWidth;
    offscreen.height = canvasHeight;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (let row = 0; row < map.tiles.length; row++) {
      for (let col = 0; col < (map.tiles[0]?.length ?? 0); col++) {
        const tile = map.tiles[row][col];
        const x = col * TILE_SIZE * tileScale;
        const y = row * TILE_SIZE * tileScale;
        const w = TILE_SIZE * tileScale;
        const h = TILE_SIZE * tileScale;

        switch (tile) {
          case TileType.Wall:
            ctx.fillStyle = WALL_COLOR;
            break;
          case TileType.Floor:
            ctx.fillStyle = FLOOR_COLOR;
            break;
          case TileType.Door:
            ctx.fillStyle = DOOR_COLOR;
            break;
          case TileType.HideSpot:
            ctx.fillStyle = HIDESPOT_COLOR;
            break;
          default:
            // ItemSpawn, Exit, GuardSpawn, Camera — render as floor
            ctx.fillStyle = FLOOR_COLOR;
        }
        ctx.fillRect(x, y, w, h);
      }
    }

    // Special entity markers
    for (const entity of map.entities) {
      const ex = (entity.x + 0.5) * TILE_SIZE * tileScale;
      const ey = (entity.y + 0.5) * TILE_SIZE * tileScale;
      ctx.globalAlpha = 0.6;

      if (entity.type === "item") {
        ctx.fillStyle = ITEM_COLOR;
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (entity.type === "exit") {
        ctx.fillStyle = EXIT_COLOR;
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (entity.type === "runnerSpawn") {
        ctx.fillStyle = SPAWN_COLOR;
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (entity.type === "camera") {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = CAMERA_COLOR;
        ctx.beginPath();
        ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    bgCanvasRef.current = offscreen;
  }, [map, canvasWidth, canvasHeight, tileScale]);

  // Render a frame at a given normalized time t (0..1)
  const renderFrame = useCallback((t: number) => {
    const canvas = canvasRef.current;
    const bg = bgCanvasRef.current;
    if (!canvas || !bg) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const trail = positionTrailRef.current;
    const duration = heistDurationRef.current;
    const markers = eventMarkersRef.current;
    const toC = toCanvasPtRef.current;

    ctx.drawImage(bg, 0, 0);

    if (trail.length < 2) return;

    const currentHeistTime = t * duration;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let lastPt = toC(trail[0].x, trail[0].y);
    let lastCrouching = trail[0].crouching;

    for (let i = 1; i < trail.length; i++) {
      const pt = trail[i];
      if (pt.t > currentHeistTime) {
        const prev = trail[i - 1];
        const dt = pt.t - prev.t;
        const segFraction = dt > 0 ? (currentHeistTime - prev.t) / dt : 0;
        const interpX = prev.x + (pt.x - prev.x) * segFraction;
        const interpY = prev.y + (pt.y - prev.y) * segFraction;
        const interpCanvas = toC(interpX, interpY);

        drawSegment(ctx, lastPt, interpCanvas, lastCrouching);
        drawRunnerDot(ctx, interpCanvas);
        break;
      }

      const ptCanvas = toC(pt.x, pt.y);
      drawSegment(ctx, lastPt, ptCanvas, lastCrouching);
      lastPt = ptCanvas;
      lastCrouching = pt.crouching;

      if (i === trail.length - 1) {
        drawRunnerDot(ctx, ptCanvas);
      }
    }

    // Event markers
    for (const marker of markers) {
      if (marker.t > currentHeistTime) continue;

      const pos = toC(marker.x, marker.y);
      const age = currentHeistTime - marker.t;
      const scaleIn = Math.min(1, age / 200);
      drawMarker(ctx, pos.x, pos.y, marker.type, scaleIn);
    }
  }, []);

  // Animation effect — uses requestAnimationFrame loop
  useEffect(() => {
    if (!playing) return;

    let rafId: number;

    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const t = Math.min(1, elapsed / PLAYBACK_DURATION);
      setProgress(t);
      renderFrame(t);

      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, renderFrame]);

  // Draw final frame when animation stops
  useEffect(() => {
    if (playing || progress === 0) return;
    renderFrame(1);
  }, [playing, progress, renderFrame]);

  // Auto-play on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      startTimeRef.current = Date.now();
      setPlaying(true);
      setProgress(0);
    }, AUTO_PLAY_DELAY);
    return () => clearTimeout(timer);
  }, []);

  const handleReplay = useCallback(() => {
    startTimeRef.current = Date.now();
    setProgress(0);
    setPlaying(true);
  }, []);

  const outcomeAccent = {
    escaped: "#4CAF50",
    caught: "#FF6B6B",
    timeout: "#FFB74D",
    disconnected: "#90A4AE",
  }[outcome];

  return (
    <div className="space-y-2">
      {/* Canvas */}
      <div
        className="rounded-lg overflow-hidden border"
        style={{ borderColor: outcomeAccent + "40" }}
      >
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="w-full"
          style={{ imageRendering: "pixelated" }}
        />
      </div>

      {/* Timeline bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-100"
            style={{
              width: `${progress * 100}%`,
              backgroundColor: outcomeAccent,
            }}
          />
        </div>
        <span className="text-[#E8D5B7]/40 font-mono text-xs">
          {formatDuration(heistDuration)}
        </span>
      </div>

      {/* Replay button */}
      {!playing && progress > 0 && (
        <button
          onClick={handleReplay}
          className="text-xs text-[#E8D5B7]/50 hover:text-[#E8D5B7]/80 transition-colors cursor-pointer"
        >
          Replay
        </button>
      )}
    </div>
  );
}
