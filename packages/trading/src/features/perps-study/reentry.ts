import { PilotError, type PerpSymbol } from "@pickler/core";
import type { PerpsPaperAccount, PerpsPaperIntent } from "../perps-paper/types.js";
import type { PerpsEvidence, PerpsProposal, SmaReentryVariant } from "./types.js";

export const SMA_ENTRY_POLICIES = {
  "sma-reference": "unrestricted-hourly-v1",
  "sma-once-bar": "once-hourly-bar-v1",
} as const;

/** The final closed hourly bar is authoritative, not the decision or receipt timestamp. */
export function hourlyEntryKey(
  evidence: PerpsEvidence,
  symbol: PerpSymbol,
  side: "long" | "short",
) {
  const series = evidence.candles.find((s) => s.market.symbol === symbol && s.resolution === 3600);
  const candle = series?.candles.at(-1);
  const frame = evidence.frames.find((f) => f.snapshot.market.symbol === symbol);
  if (
    !candle ||
    !frame ||
    series!.market.marketId !== frame.snapshot.market.marketId ||
    !candle.closed ||
    !Number.isSafeInteger(candle.openTime) ||
    candle.openTime % 3600000 !== 0 ||
    candle.openTime + 3600000 !== Math.floor(evidence.observedAt / 3600000) * 3600000
  ) {
    throw new PilotError("DATA_UNAVAILABLE", "Final closed hourly evidence required");
  }
  return `${symbol}:${side}:3600:${candle.openTime}`;
}

/** Apply only after original selection. A veto never promotes a replacement candidate. */
export function reentryGate<T extends PerpsProposal>(
  selected: T[],
  account: PerpsPaperAccount,
  evidence: PerpsEvidence,
  variant: SmaReentryVariant,
): (T & { entryKey?: string })[] {
  if (account.entryPolicy !== SMA_ENTRY_POLICIES[variant]) {
    throw new PilotError("CONFIG_CHANGED", "Trusted entry policy differs from variant");
  }
  return selected.map((proposal) => {
    if (!proposal.action.startsWith("open-")) {
      return proposal;
    }
    const key = hourlyEntryKey(
      evidence,
      proposal.symbol,
      proposal.action === "open-long" ? "long" : "short",
    );
    const blocked = variant === "sma-once-bar" && account.consumedEntryKeys?.includes(key);
    return {
      ...proposal,
      entryKey: key,
      ...(blocked ? { action: "hold" as const, reason: "HOURLY_ENTRY_ALREADY_CONSUMED" } : {}),
    };
  });
}

/** Infrastructure calls under the account lock with the persisted final snapshot. */
export function assertEntryEvidence(
  account: PerpsPaperAccount,
  intent: PerpsPaperIntent,
  final: PerpsEvidence,
  at: number,
) {
  if (!account.entryPolicy || intent.kind !== "open") {
    return null;
  }
  const reference = intent.entryEvidence;
  const key = hourlyEntryKey(final, intent.symbol, intent.side);
  if (
    !reference ||
    reference.resolution !== 3600 ||
    key !== `${intent.symbol}:${intent.side}:3600:${reference.candleOpenTime}` ||
    final.observedAt > at + 5000 ||
    at - final.observedAt > 30000
  ) {
    throw new PilotError("DATA_UNAVAILABLE", "Opening requires trusted fresh final evidence");
  }
  if (account.entryPolicy === "once-hourly-bar-v1" && account.consumedEntryKeys?.includes(key)) {
    throw new PilotError(
      "HOURLY_ENTRY_ALREADY_CONSUMED",
      "Confirmed entry consumed this hourly key",
    );
  }
  return key;
}
