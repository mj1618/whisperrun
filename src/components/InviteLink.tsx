"use client";

import { useState } from "react";

export default function InviteLink({ roomCode }: { roomCode: string }) {
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined"
    ? `${window.location.origin}/game/${roomCode}`
    : `/game/${roomCode}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-[#3D2B1E] rounded-xl p-4 flex items-center gap-3">
      <span className="text-[#8B7355] text-sm shrink-0">Invite Link:</span>
      <span className="text-[#E8D5B7] text-sm truncate flex-1 font-mono">
        {url}
      </span>
      <button
        onClick={handleCopy}
        className="shrink-0 px-4 py-1.5 bg-[#FFD700] text-[#2D1B0E] text-sm font-bold rounded-lg
                   hover:bg-[#FFC107] transition-colors"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
