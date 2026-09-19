import type { Metadata } from "next";
import { TokenBoard } from "@/features/agents/components/token-board";
import { readBoardFilters } from "@/features/agents/lib/board-filters";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";
import { toAgentSummaryDto } from "@/server/http/agent-responses";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tokens — Pickler",
  description: "Every agent token. Buy it on the curve, or trade it in the pool once it graduates.",
};

type Search = Record<string, string | string[] | undefined>;

export default async function TokensPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [agents, search] = await Promise.all([services.listAgents(), searchParams]);
  return (
    <PublicShell>
      <TokenBoard
        agents={agents.map(toAgentSummaryDto)}
        initialFilters={readBoardFilters(search)}
      />
    </PublicShell>
  );
}
