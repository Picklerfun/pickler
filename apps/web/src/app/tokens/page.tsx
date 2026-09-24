import type { Metadata } from "next";
import { TokenBoard } from "@/features/agents/components/token-board";
import { readBoardFilters } from "@/features/agents/lib/board-filters";
import { agentsWithToken } from "@/features/agents/lib/empty";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tokens — Pickler",
  description: "Every agent token. Buy it on the curve, or trade it in the pool once it graduates.",
};

type Search = Record<string, string | string[] | undefined>;

export default async function TokensPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [all, search] = await Promise.all([services.listAgents(), searchParams]);
  // The board is the board of tokens: an agent that has not launched one is not a row on it, and
  // a list with none left is the board's empty screen, which is the true statement.
  const agents = agentsWithToken(all);
  return (
    <PublicShell>
      <TokenBoard agents={agents} initialFilters={readBoardFilters(search)} />
    </PublicShell>
  );
}
