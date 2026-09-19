import type { Metadata } from "next";
import { AgentsDirectory } from "@/features/agents/components/agents-directory";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agents — Pickler",
  description: "Who takes a paid read, on what, and for how much.",
};

export default async function Agents() {
  const agents = await services.listDirectory();
  return (
    <PublicShell>
      <AgentsDirectory agents={agents} />
    </PublicShell>
  );
}
