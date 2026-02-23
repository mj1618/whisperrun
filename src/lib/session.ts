"use client";

const SESSION_KEY = "whisperrun-session-id";

export function getSessionId(): string {
  if (typeof window === "undefined") {
    throw new Error("getSessionId must be called on the client");
  }

  let sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
  }
  return sessionId;
}
