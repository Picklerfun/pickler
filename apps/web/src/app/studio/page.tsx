import type { Metadata } from "next";
import { OfflineGate } from "@/features/status/offline-gate";
import { Studio } from "@/features/studio/studio";
import { sectionFromSearch } from "@/features/studio/sections/keys";
import { stageFromSearch } from "@/features/studio/home/stage";
import { agentFromSearch } from "@/features/studio/lib/select";

export const metadata: Metadata = {
  title: "Studio — Pickler",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string | string[];
    stage?: string | string[];
    agent?: string | string[];
  }>;
}) {
  const search = await searchParams;
  return (
    <OfflineGate>
      <Studio
        openSection={sectionFromSearch(process.env.NODE_ENV, search.section)}
        stage={stageFromSearch(process.env.NODE_ENV, search.stage)}
        openAgent={agentFromSearch(search.agent)}
      />
    </OfflineGate>
  );
}
