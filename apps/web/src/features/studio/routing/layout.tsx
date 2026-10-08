"use client";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Studio } from "../studio";
import { sectionFromSearch } from "../sections/keys";
import { stageFromSearch } from "../home/stage";
import { agentFromSearch } from "../lib/select";
export function StudioLayout({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  const stage = stageFromSearch(process.env.NODE_ENV, search.get("stage") ?? undefined);
  return (
    <Studio
      key={stage ?? "authenticated"}
      stage={stage}
      openAgent={agentFromSearch(search.get("agent") ?? undefined)}
      openSection={sectionFromSearch(process.env.NODE_ENV, search.get("section") ?? undefined)}
      resumeSection={search.get("resume") ?? undefined}
    >
      {children}
    </Studio>
  );
}
