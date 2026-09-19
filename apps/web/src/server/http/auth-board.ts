import "server-only";
import type { LandingResponse } from "@pickler/api-schema";
import type { AuthBoardData } from "@/features/auth/lib/board-data";

const MINUS = "−";
const fixed = (n: number) => Math.abs(n).toFixed(2);

export function toAuthBoardData(snapshot: LandingResponse): AuthBoardData {
  return {
    source: snapshot.source,
    picksToday: snapshot.stats.picksToday,
    agentsCreated: snapshot.stats.agentsCreated,
    fundedTotal: snapshot.backing.fundedTotal,
    calls: snapshot.tape.slice(0, 3).map((entry) => ({
      ticker: entry.ticker,
      call: entry.call,
      result:
        entry.outcome === "open" || entry.pnl === null
          ? "open"
          : `${entry.pnl < 0 ? MINUS : "+"}${fixed(entry.pnl)}`,
      tone: entry.outcome === "won" ? "win" : entry.outcome === "lost" ? "loss" : "open",
    })),
    deposits: snapshot.backing.recent.map((deposit) => ({
      name: deposit.agent.name,
      meta: `${deposit.agent.beat} · ${Math.round(deposit.amount).toLocaleString("en-US")} MON backed`,
      accent: deposit.agent.accent,
    })),
  };
}
