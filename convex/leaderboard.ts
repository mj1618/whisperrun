import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const submitScore = mutation({
  args: {
    roomCode: v.string(),
    dateKey: v.string(),
    teamName: v.string(),
    score: v.number(),
    timeBonus: v.number(),
    stealthBonus: v.number(),
    stylePoints: v.number(),
    stealthRating: v.number(),
    heistDurationMs: v.number(),
    playStyleTitle: v.string(),
    outcome: v.string(),
  },
  handler: async (ctx, args) => {
    // Only accept "escaped" outcomes for leaderboard
    if (args.outcome !== "escaped") return null;

    // Server computes dateKey to prevent client from submitting to arbitrary dates
    const now = new Date();
    const serverDateKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

    // Check for duplicate submission (same roomCode)
    const existing = await ctx.db
      .query("leaderboard")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", args.roomCode))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("leaderboard", {
      ...args,
      dateKey: serverDateKey,
      submittedAt: Date.now(),
    });
  },
});

export const getDailyLeaderboard = query({
  args: { dateKey: v.string() },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("leaderboard")
      .withIndex("by_dateKey_score", (q) => q.eq("dateKey", args.dateKey))
      .order("desc")
      .take(20);
    return entries;
  },
});
