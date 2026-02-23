import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rooms: defineTable({
    roomCode: v.string(),
    players: v.array(
      v.object({
        sessionId: v.string(),
        name: v.optional(v.string()),
        role: v.union(
          v.literal("runner"),
          v.literal("whisper"),
          v.null()
        ),
        ready: v.boolean(),
      })
    ),
    status: v.union(
      v.literal("waiting"),
      v.literal("playing"),
      v.literal("finished")
    ),
    mapSeed: v.number(),
    createdAt: v.number(),
  }).index("by_roomCode", ["roomCode"]),

  gameState: defineTable({
    roomId: v.id("rooms"),
    runner: v.object({
      x: v.number(),
      y: v.number(),
      crouching: v.boolean(),
      hiding: v.boolean(),
      hasItem: v.boolean(),
    }),
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
    pings: v.array(
      v.object({
        x: v.number(),
        y: v.number(),
        type: v.union(
          v.literal("danger"),
          v.literal("go"),
          v.literal("item")
        ),
        createdAt: v.number(),
      })
    ),
    items: v.array(
      v.object({
        id: v.string(),
        x: v.number(),
        y: v.number(),
        pickedUp: v.boolean(),
        name: v.string(),
      })
    ),
    exitX: v.number(),
    exitY: v.number(),
    phase: v.union(
      v.literal("planning"),
      v.literal("heist"),
      v.literal("escaped"),
      v.literal("caught"),
      v.literal("timeout")
    ),
    startTime: v.number(),
    heistStartTime: v.optional(v.number()),
  }).index("by_roomId", ["roomId"]),
});
