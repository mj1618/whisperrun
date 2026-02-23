"use client";

import { useActionState } from "react";
import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import Link from "next/link";
import { api } from "../../convex/_generated/api";

interface RoomJoinerProps {
  roomCode: string;
  sessionId: string;
}

export default function RoomJoiner({ roomCode, sessionId }: RoomJoinerProps) {
  const joinRoom = useMutation(api.rooms.joinRoom);
  const formRef = useRef<HTMLFormElement>(null);

  const [error, submitAction, isPending] = useActionState(
    async () => {
      try {
        await joinRoom({ roomCode, sessionId });
        return null;
      } catch (e: unknown) {
        return e instanceof Error ? e.message : "Failed to join room";
      }
    },
    null
  );

  // Auto-submit on mount
  useEffect(() => {
    formRef.current?.requestSubmit();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2D1B0E]">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg">{error}</p>
          <Link
            href="/"
            className="inline-block px-6 py-2 bg-[#FFD700] text-[#2D1B0E] font-bold rounded-lg
                       hover:bg-[#FFC107] transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#2D1B0E]">
      <form ref={formRef} action={submitAction}>
        <p className="text-[#E8D5B7] text-lg">
          {isPending ? "Joining room..." : "Connecting..."}
        </p>
      </form>
    </div>
  );
}
