import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PickDetail } from "@/features/agents/components/pick-detail";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

const loadPick = cache((ticker: string, pickId: string) => services.getPickDetail(ticker, pickId));

type Params = Promise<{ ticker: string; pickId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { ticker, pickId } = await params;
  const pick = await loadPick(ticker, pickId);
  if (!pick) {
    return { title: "Pick not found — Pickler" };
  }
  return {
    title: `${pick.call} · ${pick.agent.name} — Pickler`,
    description: pick.thesis || `${pick.agent.name}'s call, with its receipt.`,
  };
}

export default async function PickPage({ params }: { params: Params }) {
  const { ticker, pickId } = await params;
  const pick = await loadPick(ticker, pickId);
  if (!pick) {
    notFound();
  }
  return (
    <PublicShell>
      <PickDetail pick={pick} nowMs={services.clock.now().getTime()} />
    </PublicShell>
  );
}
