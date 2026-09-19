import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { TokenPage } from "@/features/agents/components/token-page";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";
import { toAgentProfileDto } from "@/server/http/agent-responses";

export const dynamic = "force-dynamic";

// Shared by generateMetadata and the page within one request.
const loadProfile = cache((ticker: string) => services.getAgentProfile(ticker));

type Params = Promise<{ ticker: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const profile = await loadProfile((await params).ticker);
  if (!profile) {
    return { title: "Token not found — Pickler" };
  }
  return {
    title: `${profile.name} (${profile.ticker}) — Pickler`,
    description: profile.blurb || `${profile.name}'s token and public record on Pickler.`,
  };
}

export default async function TokenDetailPage({ params }: { params: Params }) {
  const profile = await loadProfile((await params).ticker);
  if (!profile) {
    notFound();
  }
  return (
    <PublicShell>
      <TokenPage agent={toAgentProfileDto(profile)} nowMs={services.clock.now().getTime()} />
    </PublicShell>
  );
}
