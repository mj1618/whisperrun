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
        lastHeartbeat: v.optional(v.number()),
        runnerColor: v.optional(v.string()),
      })
    ),
    status: v.union(
      v.literal("waiting"),
      v.literal("playing"),
      v.literal("finished")
    ),
    mapSeed: v.number(),
    difficulty: v.optional(v.union(
      v.literal("casual"),
      v.literal("standard"),
      v.literal("hard")
    )),
    createdAt: v.number(),
    disconnectedAt: v.optional(v.number()),
    disconnectedPlayer: v.optional(v.string()),
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
    cameras: v.array(
      v.object({
        id: v.string(),
        x: v.number(),
        y: v.number(),
        baseAngle: v.number(),
      })
    ),
    doors: v.array(
      v.object({
        x: v.number(),
        y: v.number(),
        open: v.boolean(),
      })
    ),
    lasers: v.optional(v.array(
      v.object({
        id: v.string(),
        x1: v.number(),
        y1: v.number(),
        x2: v.number(),
        y2: v.number(),
        onDurationMs: v.number(),
        offDurationMs: v.number(),
        phaseOffsetMs: v.number(),
      })
    )),
    paths: v.array(
      v.object({
        points: v.array(v.object({ x: v.number(), y: v.number() })),
        createdAt: v.number(),
      })
    ),
    quickComm: v.optional(v.object({
      messageId: v.string(),
      createdAt: v.number(),
    })),
    exitX: v.number(),
    exitY: v.number(),
    phase: v.union(
      v.literal("planning"),
      v.literal("heist"),
      v.literal("escaped"),
      v.literal("caught"),
      v.literal("timeout"),
      v.literal("disconnected")
    ),
    difficulty: v.optional(v.union(
      v.literal("casual"),
      v.literal("standard"),
      v.literal("hard")
    )),
    startTime: v.number(),
    heistStartTime: v.optional(v.number()),
  }).index("by_roomId", ["roomId"]),

  leaderboard: defineTable({
    dateKey: v.string(),
    roomCode: v.string(),
    teamName: v.string(),
    score: v.number(),
    timeBonus: v.number(),
    stealthBonus: v.number(),
    stylePoints: v.number(),
    stealthRating: v.number(),
    heistDurationMs: v.number(),
    playStyleTitle: v.string(),
    outcome: v.string(),
    submittedAt: v.number(),
  })
    .index("by_dateKey_score", ["dateKey", "score"])
    .index("by_roomCode", ["roomCode"]),
});
