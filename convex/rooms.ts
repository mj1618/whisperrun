import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export const createRoom = mutation({
  args: { sessionId: v.string(), daily: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    // Generate a unique room code (retry on collision)
    let roomCode = generateRoomCode();
    let existing = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", roomCode))
      .first();
    let attempts = 0;
    while (existing && attempts < 5) {
      roomCode = generateRoomCode();
      existing = await ctx.db
        .query("rooms")
        .withIndex("by_roomCode", (q) => q.eq("roomCode", roomCode))
        .first();
      attempts++;
    }
    if (existing) {
      throw new Error("Failed to generate unique room code, please try again");
    }

    let mapSeed: number;
    if (args.daily) {
      // Deterministic daily seed: djb2 hash of today's date
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      let hash = 5381;
      for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) + hash + dateStr.charCodeAt(i)) | 0;
      }
      mapSeed = Math.abs(hash);
    } else {
      mapSeed = Math.floor(Math.random() * 1_000_000);
    }

    const roomId = await ctx.db.insert("rooms", {
      roomCode,
      players: [{ sessionId: args.sessionId, role: null, ready: false, lastHeartbeat: Date.now() }],
      status: "waiting",
      mapSeed,
      createdAt: Date.now(),
    });
    return { roomId, roomCode };
  },
});

export const getRoom = query({
  args: { roomCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
  },
});

export const joinRoom = mutation({
  args: { roomCode: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();

    if (!room) throw new Error("Room not found");
    if (room.status !== "waiting") throw new Error("Game already started");

    // Idempotent rejoin — if player is already in the room, refresh heartbeat
    const existingIdx = room.players.findIndex((p) => p.sessionId === args.sessionId);
    if (existingIdx !== -1) {
      const updatedPlayers = [...room.players];
      updatedPlayers[existingIdx] = {
        ...updatedPlayers[existingIdx],
        lastHeartbeat: Date.now(),
      };
      await ctx.db.patch(room._id, { players: updatedPlayers });
      return { ...room, players: updatedPlayers };
    }

    if (room.players.length >= 2) throw new Error("Room is full");

    const updatedPlayers = [
      ...room.players,
      { sessionId: args.sessionId, role: null as "runner" | "whisper" | null, ready: false, lastHeartbeat: Date.now() },
    ];
    await ctx.db.patch(room._id, { players: updatedPlayers });

    return { ...room, players: updatedPlayers };
  },
});

export const selectRole = mutation({
  args: {
    roomCode: v.string(),
    sessionId: v.string(),
    role: v.union(v.literal("runner"), v.literal("whisper"), v.null()),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();

    if (!room) throw new Error("Room not found");
    if (room.status !== "waiting") throw new Error("Game already started");

    const playerIndex = room.players.findIndex(
      (p) => p.sessionId === args.sessionId
    );
    if (playerIndex === -1) throw new Error("Player not in room");

    // If selecting a role, check it's not taken by the other player
    if (args.role !== null) {
      const otherPlayer = room.players.find(
        (p) => p.sessionId !== args.sessionId
      );
      if (otherPlayer && otherPlayer.role === args.role) {
        throw new Error("Role already taken");
      }
    }

    const updatedPlayers = [...room.players];
    updatedPlayers[playerIndex] = {
      ...updatedPlayers[playerIndex],
      role: args.role,
      // Un-ready when changing role
      ready: false,
    };

    await ctx.db.patch(room._id, { players: updatedPlayers });
  },
});

export const setDifficulty = mutation({
  args: {
    roomCode: v.string(),
    sessionId: v.string(),
    difficulty: v.union(v.literal("casual"), v.literal("standard"), v.literal("hard")),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
    if (!room) throw new Error("Room not found");
    if (room.status !== "waiting") throw new Error("Game already started");
    const isPlayer = room.players.some((p) => p.sessionId === args.sessionId);
    if (!isPlayer) throw new Error("You are not in this room");

    // Unready all players when difficulty changes
    const updatedPlayers = room.players.map((p) => ({ ...p, ready: false }));
    await ctx.db.patch(room._id, {
      difficulty: args.difficulty,
      players: updatedPlayers,
    });
  },
});

export const toggleReady = mutation({
  args: { roomCode: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();

    if (!room) throw new Error("Room not found");
    if (room.status !== "waiting") throw new Error("Game already started");

    const playerIndex = room.players.findIndex(
      (p) => p.sessionId === args.sessionId
    );
    if (playerIndex === -1) throw new Error("Player not in room");

    const player = room.players[playerIndex];
    if (!player.role) throw new Error("Must select a role before readying up");

    const updatedPlayers = [...room.players];
    updatedPlayers[playerIndex] = {
      ...updatedPlayers[playerIndex],
      ready: !player.ready,
    };

    await ctx.db.patch(room._id, { players: updatedPlayers });
  },
});

const HEARTBEAT_TIMEOUT = 8000; // 8 seconds without a heartbeat = disconnected
const DISCONNECT_GRACE_PERIOD = 5000; // 5 seconds grace before ending game

export const heartbeat = mutation({
  args: { roomCode: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
    if (!room) return;

    const playerIndex = room.players.findIndex(
      (p) => p.sessionId === args.sessionId
    );
    if (playerIndex === -1) return;

    const updatedPlayers = [...room.players];
    updatedPlayers[playerIndex] = {
      ...updatedPlayers[playerIndex],
      lastHeartbeat: Date.now(),
    };
    await ctx.db.patch(room._id, { players: updatedPlayers });
  },
});

export const checkDisconnect = mutation({
  args: { roomCode: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
    if (!room || room.status === "finished") return { disconnected: false };

    const now = Date.now();
    const otherPlayer = room.players.find(
      (p) => p.sessionId !== args.sessionId
    );
    if (!otherPlayer) return { disconnected: false };

    // Check if other player's heartbeat has timed out
    const lastBeat = otherPlayer.lastHeartbeat ?? room.createdAt;
    const isTimedOut = now - lastBeat > HEARTBEAT_TIMEOUT;

    if (!isTimedOut) {
      // Partner is fine — clear any pending disconnect
      if (room.disconnectedAt) {
        await ctx.db.patch(room._id, {
          disconnectedAt: undefined,
          disconnectedPlayer: undefined,
        });
      }
      return { disconnected: false };
    }

    // Partner appears disconnected
    if (!room.disconnectedAt) {
      // First detection — start grace period
      await ctx.db.patch(room._id, {
        disconnectedAt: now,
        disconnectedPlayer: otherPlayer.sessionId,
      });
      return { disconnected: false, gracePeriod: true };
    }

    // Check if grace period has expired
    if (now - room.disconnectedAt > DISCONNECT_GRACE_PERIOD) {
      // Grace period expired — end the game
      await ctx.db.patch(room._id, { status: "finished" });

      // Update game state to a disconnected phase
      const gameState = await ctx.db
        .query("gameState")
        .withIndex("by_roomId", (q) => q.eq("roomId", room._id))
        .first();
      if (
        gameState &&
        gameState.phase !== "escaped" &&
        gameState.phase !== "caught" &&
        gameState.phase !== "timeout"
      ) {
        await ctx.db.patch(gameState._id, { phase: "disconnected" });
      }

      return { disconnected: true, endedGame: true };
    }

    // Still in grace period
    return { disconnected: false, gracePeriod: true };
  },
});

export const resetRoom = mutation({
  args: { roomCode: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();

    if (!room) throw new Error("Room not found");
    if (room.status !== "finished") throw new Error("Game is not finished");

    const isPlayer = room.players.some((p) => p.sessionId === args.sessionId);
    if (!isPlayer) throw new Error("You are not in this room");

    // Reset players: keep roles, clear ready flags
    const resetPlayers = room.players.map((p) => ({
      ...p,
      ready: false,
    }));

    await ctx.db.patch(room._id, {
      status: "waiting",
      players: resetPlayers,
      mapSeed: Math.floor(Math.random() * 1000000),
      disconnectedAt: undefined,
      disconnectedPlayer: undefined,
    });

    // Delete old game state
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", room._id))
      .first();
    if (gameState) {
      await ctx.db.delete(gameState._id);
    }
  },
});

export const startGame = mutation({
  args: {
    roomCode: v.string(),
    sessionId: v.string(),
    runnerSpawn: v.optional(v.object({ x: v.number(), y: v.number() })),
    guards: v.optional(v.array(v.object({
      id: v.string(),
      x: v.number(),
      y: v.number(),
    }))),
    items: v.optional(v.array(v.object({
      id: v.string(),
      x: v.number(),
      y: v.number(),
      name: v.string(),
    }))),
    exitX: v.optional(v.number()),
    exitY: v.optional(v.number()),
    cameras: v.optional(v.array(v.object({
      id: v.string(),
      x: v.number(),
      y: v.number(),
      baseAngle: v.number(),
    }))),
    doors: v.optional(v.array(v.object({
      x: v.number(),
      y: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();

    if (!room) throw new Error("Room not found");
    if (room.status !== "waiting") throw new Error("Game already started");

    // Validate the caller is a player in this room
    const isPlayer = room.players.some((p) => p.sessionId === args.sessionId);
    if (!isPlayer) throw new Error("You are not in this room");

    if (room.players.length !== 2) throw new Error("Need 2 players to start");

    const roles = room.players.map((p) => p.role);
    if (!roles.includes("runner") || !roles.includes("whisper")) {
      throw new Error("Both roles must be assigned");
    }
    if (!room.players.every((p) => p.ready)) {
      throw new Error("All players must be ready");
    }

    // Guard against duplicate game state (race between both players clicking start)
    const existingGameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", room._id))
      .first();
    if (existingGameState) return;

    // Set room to playing
    await ctx.db.patch(room._id, { status: "playing" });

    // Use client-provided positions (from procedural map generator) or defaults
    const runnerPos = args.runnerSpawn ?? { x: 1, y: 1 };
    const guardData = args.guards ?? [{ id: "guard-1", x: 9, y: 12 }];
    const itemData = args.items ?? [{ id: "item-1", x: 17, y: 7, name: "Golden Rubber Duck" }];
    const exitX = args.exitX ?? 6;
    const exitY = args.exitY ?? 14;
    const cameraData = args.cameras ?? [];
    const doorData = (args.doors ?? []).map((d) => ({ x: d.x, y: d.y, open: false }));

    // Basic bounds validation — map is up to ~57x35 tiles (hard mode 5x3 grid)
    const MAX_COORD = 60;
    const allPositions = [
      runnerPos,
      { x: exitX, y: exitY },
      ...guardData.map((g) => ({ x: g.x, y: g.y })),
      ...itemData.map((i) => ({ x: i.x, y: i.y })),
      ...cameraData.map((c) => ({ x: c.x, y: c.y })),
      ...doorData.map((d) => ({ x: d.x, y: d.y })),
    ];
    for (const pos of allPositions) {
      if (pos.x < 0 || pos.x > MAX_COORD || pos.y < 0 || pos.y > MAX_COORD) {
        throw new Error("Invalid entity position");
      }
    }

    // Create initial game state
    await ctx.db.insert("gameState", {
      roomId: room._id,
      difficulty: room.difficulty ?? "standard",
      runner: { x: runnerPos.x, y: runnerPos.y, crouching: false, hiding: false, hasItem: false },
      guards: guardData.map((g) => ({
        id: g.id,
        x: g.x,
        y: g.y,
        angle: 0,
        state: "patrol" as const,
        targetWaypoint: 0,
      })),
      items: itemData.map((i) => ({
        id: i.id,
        x: i.x,
        y: i.y,
        pickedUp: false,
        name: i.name,
      })),
      cameras: cameraData,
      doors: doorData,
      exitX,
      exitY,
      pings: [],
      paths: [],
      phase: "planning",
      startTime: Date.now(),
    });
  },
});
