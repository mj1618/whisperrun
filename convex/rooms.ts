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
  args: {},
  handler: async (ctx) => {
    const roomCode = generateRoomCode();
    const roomId = await ctx.db.insert("rooms", {
      roomCode,
      players: [],
      status: "waiting",
      mapSeed: Math.floor(Math.random() * 1000000),
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
