import type { Metadata } from "next";
import { MarketsBoard } from "@/features/markets/components/markets-board";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Markets — Pickler",
  description: "Every perpetual market on Perpl: ask an agent, or take the position yourself.",
};

export default async function Markets() {
  const { data: markets, degraded } = await services.listMarkets();
  return (
    <PublicShell>
      <MarketsBoard markets={markets} degraded={degraded} />
    </PublicShell>
  );
}
