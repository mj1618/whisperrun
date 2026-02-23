import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getGameState = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();
  },
});

export const moveRunner = mutation({
  args: {
    roomId: v.id("rooms"),
    x: v.number(),
    y: v.number(),
    crouching: v.boolean(),
  },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();

    if (!gameState) throw new Error("Game not found");
    if (gameState.phase !== "heist") return;

    await ctx.db.patch(gameState._id, {
      runner: {
        ...gameState.runner,
        x: args.x,
        y: args.y,
        crouching: args.crouching,
      },
    });
  },
});

export const interactRunner = mutation({
  args: {
    roomId: v.id("rooms"),
    sessionId: v.string(),
    action: v.union(
      v.literal("hide"),
      v.literal("unhide"),
      v.literal("pickup"),
      v.literal("exit")
    ),
  },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();

    if (!gameState) throw new Error("Game not found");
    if (gameState.phase !== "heist") return;

    const runner = gameState.runner;

    switch (args.action) {
      case "hide": {
        await ctx.db.patch(gameState._id, {
          runner: { ...runner, hiding: true },
        });
        break;
      }
      case "unhide": {
        await ctx.db.patch(gameState._id, {
          runner: { ...runner, hiding: false },
        });
        break;
      }
      case "pickup": {
        // Find first non-picked-up item within 1.5 tiles
        const itemIndex = gameState.items.findIndex(
          (item) =>
            !item.pickedUp &&
            Math.abs(item.x - runner.x) < 1.5 &&
            Math.abs(item.y - runner.y) < 1.5
        );
        if (itemIndex === -1) return;

        const updatedItems = [...gameState.items];
        updatedItems[itemIndex] = { ...updatedItems[itemIndex], pickedUp: true };

        await ctx.db.patch(gameState._id, {
          items: updatedItems,
          runner: { ...runner, hasItem: true },
        });
        break;
      }
      case "exit": {
        if (!runner.hasItem) return;
        const dist = Math.hypot(
          gameState.exitX - runner.x,
          gameState.exitY - runner.y
        );
        if (dist > 1.5) return;

        await ctx.db.patch(gameState._id, { phase: "escaped" });
        // Also mark room as finished
        const room = await ctx.db.get(args.roomId);
        if (room) {
          await ctx.db.patch(args.roomId, { status: "finished" });
        }
        break;
      }
    }
  },
});

export const addPing = mutation({
  args: {
    roomId: v.id("rooms"),
    x: v.number(),
    y: v.number(),
    type: v.union(v.literal("danger"), v.literal("go"), v.literal("item")),
  },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();

    if (!gameState) throw new Error("Game not found");
    if (gameState.phase !== "planning" && gameState.phase !== "heist") return;

    const now = Date.now();
    // Filter to only active pings (< 5 seconds old)
    let activePings = gameState.pings.filter((p) => now - p.createdAt < 5000);

    // Max 3 active pings — remove the oldest if at limit
    if (activePings.length >= 3) {
      activePings = activePings.slice(1);
    }

    activePings.push({
      x: args.x,
      y: args.y,
      type: args.type,
      createdAt: now,
    });

    await ctx.db.patch(gameState._id, { pings: activePings });
  },
});

export const cleanupPings = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();

    if (!gameState) return;

    const now = Date.now();
    const activePings = gameState.pings.filter((p) => now - p.createdAt < 5000);

    // Only write if pings actually changed
    if (activePings.length !== gameState.pings.length) {
      await ctx.db.patch(gameState._id, { pings: activePings });
    }
  },
});

export const tickGuards = mutation({
  args: {
    roomId: v.id("rooms"),
    guards: v.array(
      v.object({
        id: v.string(),
        x: v.number(),
        y: v.number(),
        angle: v.number(),
        state: v.union(
          v.literal("patrol"),
          v.literal("suspicious"),
          v.literal("alert"),
          v.literal("returning")
        ),
        targetWaypoint: v.number(),
        lastKnownX: v.optional(v.number()),
        lastKnownY: v.optional(v.number()),
        stateTimer: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();

    if (!gameState) throw new Error("Game not found");
    if (gameState.phase !== "heist") return;

    // Update guard positions
    await ctx.db.patch(gameState._id, { guards: args.guards });

    // Server-authoritative catch check
    const runner = gameState.runner;
    if (!runner.hiding) {
      for (const guard of args.guards) {
        if (guard.state === "alert") {
          const dist = Math.hypot(guard.x - runner.x, guard.y - runner.y);
          if (dist < 0.6) {
            await ctx.db.patch(gameState._id, { phase: "caught" });
            const room = await ctx.db.get(args.roomId);
            if (room) {
              await ctx.db.patch(args.roomId, { status: "finished" });
            }
            return;
          }
        }
      }
    }
  },
});

export const startHeistPhase = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();

    if (!gameState) throw new Error("Game not found");
    if (gameState.phase !== "planning") return;

    await ctx.db.patch(gameState._id, {
      phase: "heist",
      heistStartTime: Date.now(),
    });
  },
});

export const checkTimeout = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("gameState")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .first();

    if (!gameState) return;
    if (gameState.phase !== "heist") return;
    if (!gameState.heistStartTime) return;

    const elapsed = Date.now() - gameState.heistStartTime;
    if (elapsed > 180_000) {
      await ctx.db.patch(gameState._id, { phase: "timeout" });
      const room = await ctx.db.get(args.roomId);
      if (room) {
        await ctx.db.patch(args.roomId, { status: "finished" });
      }
    }
  },
});
