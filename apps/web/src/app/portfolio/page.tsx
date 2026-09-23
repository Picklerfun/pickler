import type { Metadata } from "next";
import { PublicShell } from "@/features/agents/components/public-shell";
import { PortfolioPage } from "@/features/wallet/components/portfolio-page";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

const TABS = ["positions", "backed", "reads"] as const;

export const metadata: Metadata = {
  title: "Portfolio — Pickler",
  description: "What your wallet holds and what it has spent on reads.",
  robots: { index: false, follow: false },
};

export default async function Portfolio({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[]; tab?: string | string[] }>;
}) {
  const [agents, reads, search] = await Promise.all([
    services.listAgents(),
    services.listReads(),
    searchParams,
  ]);
  /**
   * The connected screen, without a wallet. Everything below the heading sits behind a connect
   * gate, and no headless browser has a wallet to pass it with — so every design check that has
   * ever run on /portfolio measured the gate and reported green for a screen nobody had seen.
   *
   * Never in a production build, and the page says on itself that it is a preview. The studio uses
   * ?state=empty for the same reason and in the same shape.
   */
  const preview = process.env.NODE_ENV !== "production" && search.state === "connected";
  // Which tab to open on. A person can link to one, and every tab is then a screen a check can
  // reach — including the two the data never opens on, which are the two with nothing behind them.
  const openTab = TABS.find((key) => key === search.tab);
  return (
    <PublicShell>
      <PortfolioPage agents={agents} reads={reads} openTab={openTab} preview={preview} />
    </PublicShell>
  );
}
