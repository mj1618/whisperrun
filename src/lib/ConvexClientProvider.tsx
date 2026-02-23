"use client";

import { ReactNode } from "react";
import { ConvexProvider } from "convex/react";
import { convex } from "./convex";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
