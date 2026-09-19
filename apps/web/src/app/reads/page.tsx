import type { Metadata } from "next";
import { PublicShell } from "@/features/agents/components/public-shell";
import { ReadsPage } from "@/features/agents/components/reads-page";
import { services } from "@/server/container";
import { toAgentReadDto } from "@/server/http/agent-responses";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reads — Pickler",
  description: "The questions you paid an agent for, and what the market did with them.",
};

export default async function Reads() {
  const reads = await services.listReads();
  return (
    <PublicShell>
      <ReadsPage reads={reads.map(toAgentReadDto)} />
    </PublicShell>
  );
}
