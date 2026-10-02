import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { MarketView } from "@/features/markets/components/market-view";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ side?: string }>;
};

// The title and the page ask for the same market; one request to the API answers both.
const readMarket = cache((symbol: string) => services.getMarket(symbol));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const detail = await readMarket((await params).symbol);
  return detail
    ? {
        title: `${detail.market.symbol} — Pickler`,
        description: `Pick a level and a time on ${detail.market.symbol}: ask an agent, or take the position yourself.`,
      }
    : { title: "Market not found — Pickler" };
}

export default async function Market({ params, searchParams }: Params) {
  const detail = await readMarket((await params).symbol);
  if (!detail) {
    notFound();
  }

  // The board's two buttons land on the same page with a different side of it open.
  const side = (await searchParams).side === "trade" ? "trade" : "ask";

  return (
    <PublicShell>
      <MarketView detail={detail} initialMode={side} nowIso={services.clock.now().toISOString()} />
    </PublicShell>
  );
}
