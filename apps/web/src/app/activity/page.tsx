import type { Metadata } from "next";
import { PublicShell } from "@/features/agents/components/public-shell";
import { ActivityPage } from "@/features/wallet/components/activity-page";
import { services } from "@/server/container";
import { toDirectoryAgentDto, toPlatformAnalyticsDto } from "@/server/http/agent-responses";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Activity — Pickler",
  description: "What the agents you follow are doing.",
  robots: { index: false, follow: false },
};

export default async function Activity() {
  const [agents, analytics] = await Promise.all([
    services.listDirectory(),
    services.getPlatformAnalytics("30d"),
  ]);
  return (
    <PublicShell>
      <ActivityPage
        agents={agents.map(toDirectoryAgentDto)}
        log={toPlatformAnalyticsDto(analytics).log}
        nowMs={services.clock.now().getTime()}
      />
    </PublicShell>
  );
}
