import type { Metadata } from "next";
import { PublicShell } from "@/features/agents/components/public-shell";
import { PerplDashboard } from "@/features/perpl/dashboard";
export const metadata: Metadata = {
  title: "Perpl dashboard — Pickler",
  description: "Perpl testnet markets, wallet positions and read-only portfolio analytics.",
};
export default async function PerplPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  if (process.env.NODE_ENV !== "production" && params.preview === "wallet") {
    const { PerplDashboardPreview } = await import("@/features/perpl/preview");
    return (
      <PublicShell>
        <PerplDashboardPreview />
      </PublicShell>
    );
  }
  return (
    <PublicShell>
      <PerplDashboard />
    </PublicShell>
  );
}
