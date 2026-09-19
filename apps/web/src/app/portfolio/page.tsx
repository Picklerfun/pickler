import type { Metadata } from "next";
import { PublicShell } from "@/features/agents/components/public-shell";
import { PortfolioPage } from "@/features/wallet/components/portfolio-page";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio — Pickler",
  description: "What your wallet holds and what it has spent on reads.",
  robots: { index: false, follow: false },
};

export default async function Portfolio() {
  const [agents, reads] = await Promise.all([services.listAgents(), services.listReads()]);
  return (
    <PublicShell>
      <PortfolioPage agents={agents} reads={reads} />
    </PublicShell>
  );
}
