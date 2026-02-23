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
      players: [{ sessionId: args.sessionId, role: null, ready: false }],
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

    // Idempotent rejoin — if player is already in the room, just return
    const existing = room.players.find((p) => p.sessionId === args.sessionId);
    if (existing) return room;

    if (room.players.length >= 2) throw new Error("Room is full");

    const updatedPlayers = [
      ...room.players,
      { sessionId: args.sessionId, role: null as "runner" | "whisper" | null, ready: false },
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

    // Basic bounds validation — map is ~46x35 tiles max
    const MAX_COORD = 50;
    const allPositions = [
      runnerPos,
      { x: exitX, y: exitY },
      ...guardData.map((g) => ({ x: g.x, y: g.y })),
      ...itemData.map((i) => ({ x: i.x, y: i.y })),
      ...cameraData.map((c) => ({ x: c.x, y: c.y })),
    ];
    for (const pos of allPositions) {
      if (pos.x < 0 || pos.x > MAX_COORD || pos.y < 0 || pos.y > MAX_COORD) {
        throw new Error("Invalid entity position");
      }
    }

    // Create initial game state
    await ctx.db.insert("gameState", {
      roomId: room._id,
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
      exitX,
      exitY,
      pings: [],
      phase: "planning",
      startTime: Date.now(),
    });
  },
});
