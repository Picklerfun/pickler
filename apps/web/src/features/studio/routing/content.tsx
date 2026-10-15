"use client";
import { createContext, useContext, type ReactNode } from "react";
import { StudioSkeleton } from "../skeleton";

export const StudioContentContext = createContext<{ section: string; content: ReactNode } | null>(
  null,
);
/** Each App Router page owns an outlet. Its controller and shell remain in the layout. */
export function StudioRouteContent({ section }: { section?: string }) {
  const current = useContext(StudioContentContext);
  if (!current || (section && section !== current.section)) {
    return <StudioSkeleton />;
  }
  return current.content;
}
