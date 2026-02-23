import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#2D1B0E]">
      <div className="text-center space-y-8">
        <h1 className="text-6xl font-bold text-[#FFD700] drop-shadow-lg tracking-tight">
          WhisperRun
        </h1>
        <p className="text-xl text-[#E8D5B7] max-w-md mx-auto">
          A cozy two-player co-op micro-heist. One sneaks, one guides.
          Steal the thing. Don&apos;t get caught.
        </p>
        <Link
          href="/game/test"
          className="inline-block px-8 py-4 bg-[#FFD700] text-[#2D1B0E] font-bold text-lg rounded-xl
                     hover:bg-[#FFC107] hover:scale-105 transition-all duration-200
                     shadow-lg hover:shadow-xl"
        >
          Create Game
        </Link>
        <p className="text-sm text-[#8B7355]">
          No account needed — just share the link with a friend
        </p>
      </div>
    </div>
  );
}
