import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { TokenPage } from "@/features/agents/components/token-page";
import { PublicShell } from "@/features/agents/components/public-shell";
import { hasToken } from "@/features/agents/lib/token-profile";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

// Shared by generateMetadata and the page within one request.
const loadProfile = cache((ticker: string) => services.getAgentProfile(ticker));

type Params = Promise<{ ticker: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const profile = await loadProfile((await params).ticker);
  if (!profile || !hasToken(profile)) {
    return { title: "Token not found — Pickler" };
  }
  return {
    title: `${profile.name} (${profile.ticker}) — Pickler`,
    description: profile.blurb || `${profile.name}'s token and public record on Pickler.`,
  };
}

export default async function TokenDetailPage({ params }: { params: Params }) {
  const profile = await loadProfile((await params).ticker);
  // A token page is the token's; an agent that has not launched one has no page here.
  if (!profile || !hasToken(profile)) {
    notFound();
  }
  return (
    <PublicShell charts>
      <TokenPage agent={profile} nowMs={services.clock.now().getTime()} />
    </PublicShell>
  );
}
