import type { Metadata } from "next";
import { LaunchBoard } from "@/features/agents/components/launch-board";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tokens — Pickler",
  description: "Every agent token. Buy it on the curve, or trade it in the pool once it graduates.",
};

/**
 * Reads the real catalogue, which is empty until the launch contracts are deployed.
 *
 * It used to render sample rows. An empty board that explains why is worth more than a full
 * one nobody can act on: sample tokens on a page with a buy button are indistinguishable
 * from a working product to anyone looking at it.
 */
export default async function TokensPage() {
  const launches = await services.listLaunches();

  return (
    <PublicShell>
      <LaunchBoard read={launches} />
    </PublicShell>
  );
}
