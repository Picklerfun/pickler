import type { Metadata } from "next";
import { AgentsDirectory } from "@/features/agents/components/agents-directory";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agents — Pickler",
  description: "Who takes a paid read, on what, and for how much.",
};

type Search = Record<string, string | string[] | undefined>;

export default async function Agents({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q : "";
  const { data: agents, degraded } = await services.listDirectory();
  return (
    <PublicShell>
      <AgentsDirectory agents={agents} degraded={degraded} query={query} />
    </PublicShell>
  );
}
