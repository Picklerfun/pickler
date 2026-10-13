import type { Metadata } from "next";
import { PublicShell } from "@/features/agents/components/public-shell";
import { PerplDashboard } from "@/features/perpl/dashboard";
export const metadata: Metadata = {
  title: "Perpl dashboard — Pickler",
  description: "Perpl testnet markets, wallet positions and read-only portfolio analytics.",
};
export default function PerplPage() {
  return (
    <PublicShell>
      <PerplDashboard />
    </PublicShell>
  );
}
