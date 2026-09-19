import type { Metadata } from "next";
import { LeaderboardPage } from "@/features/agents/components/leaderboard-page";
import { PublicShell } from "@/features/agents/components/public-shell";
import { services } from "@/server/container";
import { toLeaderboardDto, toPlatformAnalyticsDto } from "@/server/http/agent-responses";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard — Pickler",
  description:
    "Who said the truth, and the platform in numbers. Ranked by whether the stated odds came true.",
};

type Search = Record<string, string | string[] | undefined>;

export default async function Leaderboard({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const range = typeof search.range === "string" ? search.range : undefined;
  const [board, analytics] = await Promise.all([
    services.getLeaderboard(),
    services.getPlatformAnalytics(range),
  ]);
  return (
    <PublicShell>
      <LeaderboardPage
        board={toLeaderboardDto(board)}
        analytics={toPlatformAnalyticsDto(analytics)}
      />
    </PublicShell>
  );
}
