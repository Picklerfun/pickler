import { PilotError, type PerpSymbol } from "@pickler/core";
import { perpsRules, perpsJevReviewed } from "../perps-strategies/policy.js";
import { paperUnits as u, paperDecimal as d } from "../perps-paper/decimal.js";
import { paperRisk, applyPaperFill } from "../perps-paper/policy.js";
import { simulatePerpsFill } from "../perps-paper/simulation.js";
import type {
  PerpsDecisionContext,
  PerpsProposal,
  PerpsStrategyCalls,
} from "../perps-strategies/types.js";
import type { PerpsSmaUniverseConfig } from "./types.js";
import type { SmaReviewModels } from "./sma-review.js";

export const SMA_UNIVERSE_POLICY = "sma-separation-rank-v1";
export function hourlySmaTrace(context: PerpsDecisionContext, symbol: PerpSymbol) {
  const series = context.evidence.candles.find(
    (c) => c.market.symbol === symbol && c.resolution === 3600,
  );
  const candles =
    series?.candles
      .filter((c) => c.closed && c.openTime + 3600000 <= context.evidence.observedAt)
      .slice(-50) ?? [];
  if (
    candles.length !== 50 ||
    candles.some((c, i) => i > 0 && c.openTime - candles[i - 1]!.openTime !== 3600000)
  ) {
    return null;
  }
  const fastSum = candles.slice(-20).reduce((s, c) => s + u(c.close), 0n);
  const slowSum = candles.reduce((s, c) => s + u(c.close), 0n);
  if (slowSum <= 0n) {
    return null;
  }
  const numerator = fastSum * 50n - slowSum * 20n;
  return {
    sma20: d(fastSum / 20n),
    sma50: d(slowSum / 50n),
    separationBps: d((numerator * u("10000")) / (slowSum * 20n)),
    numerator: numerator < 0n ? -numerator : numerator,
    denominator: slowSum * 20n,
  };
}
/** Pure selection on the account's initial portfolio. Rejected candidates never replace vetoed entries. */
export function universeProposals(
  context: PerpsDecisionContext,
  config: PerpsSmaUniverseConfig,
  blockOpenings = false,
) {
  const symbols = config.markets.map((m) => m.symbol);
  const original = perpsRules(context, symbols);
  const projected = structuredClone(context.account);
  const excluded = new Set(context.evidence.excluded?.map((e) => e.symbol));
  for (const proposal of original.filter((p) => p.action === "close" && !excluded.has(p.symbol))) {
    const frame = context.evidence.frames.find((f) => f.snapshot.market.symbol === proposal.symbol);
    const position = projected.positions.find(
      (p) => p.symbol === proposal.symbol && p.closedAt === null,
    );
    if (!frame || !position) {
      continue;
    }
    const intent = {
      kind: "close" as const,
      symbol: proposal.symbol,
      side: position.side,
      notional: "0",
      feeReserve: "0",
    };
    const attempt = {
      key: `selection-close:${proposal.symbol}`,
      status: "pending" as const,
      intent,
      reserved: "0",
      createdAt: context.evidence.observedAt,
      finishedAt: null,
      reason: null,
      evidence: null,
    };
    try {
      Object.assign(
        projected,
        applyPaperFill(
          projected,
          attempt,
          simulatePerpsFill(projected, intent, frame, context.evidence.observedAt),
          context.evidence.observedAt,
        ).account,
      );
    } catch (error) {
      if (!(error instanceof PilotError)) {
        throw error;
      }
    }
  }
  const candidates = original.filter(
    (p) => p.action.startsWith("open-") && !excluded.has(p.symbol),
  );
  candidates.sort((a, b) => {
    const x = hourlySmaTrace(context, a.symbol),
      y = hourlySmaTrace(context, b.symbol);
    if (!x || !y) {
      throw new PilotError("INVALID_INPUT", "Opening requires valid hourly SMA");
    }
    const diff = x.numerator * y.denominator - y.numerator * x.denominator;
    return diff > 0n
      ? -1
      : diff < 0n
        ? 1
        : config.markets.find((m) => m.symbol === a.symbol)!.marketId -
          config.markets.find((m) => m.symbol === b.symbol)!.marketId;
  });
  const blocked = new Map<PerpSymbol, string>();
  const ranks = new Map(candidates.map((p, i) => [p.symbol, i + 1]));
  for (const p of candidates) {
    if (blockOpenings) {
      blocked.set(p.symbol, "COMMON_POSITION_UNVALUED");
      continue;
    }
    if (projected.positions.filter((v) => v.closedAt === null).length >= 5) {
      blocked.set(p.symbol, "PORTFOLIO_CAPACITY");
      continue;
    }
    const intent = {
      kind: "open" as const,
      symbol: p.symbol,
      side: p.action === "open-long" ? ("long" as const) : ("short" as const),
      notional: "100",
      feeReserve: "1",
    };
    const risk = paperRisk(projected, [], context.evidence.observedAt, intent);
    if (!risk.allowed) {
      blocked.set(p.symbol, risk.reasons.join(","));
      continue;
    }
    const frame = context.evidence.frames.find((f) => f.snapshot.market.symbol === p.symbol);
    if (!frame) {
      blocked.set(p.symbol, "DATA_UNAVAILABLE");
      continue;
    }
    try {
      const fill = simulatePerpsFill(projected, intent, frame, context.evidence.observedAt);
      const attempt = {
        key: `selection:${p.symbol}`,
        status: "pending" as const,
        intent,
        reserved: "101",
        createdAt: context.evidence.observedAt,
        finishedAt: null,
        reason: null,
        evidence: null,
      };
      Object.assign(
        projected,
        applyPaperFill(projected, attempt, fill, context.evidence.observedAt).account,
      );
    } catch (error) {
      if (!(error instanceof PilotError)) {
        throw error;
      }
      blocked.set(p.symbol, error.code);
    }
  }
  return original.map((p) => ({
    ...p,
    ...(excluded.has(p.symbol)
      ? { action: "hold" as const, reason: "DATA_UNAVAILABLE" }
      : blocked.has(p.symbol)
        ? { action: "hold" as const, reason: blocked.get(p.symbol)! }
        : {}),
    rank: ranks.get(p.symbol) ?? null,
    trace: (() => {
      const t = hourlySmaTrace(context, p.symbol);
      return t ? { sma20: t.sma20, sma50: t.sma50, separationBps: t.separationBps } : null;
    })(),
  }));
}
export function universeFinal(
  initial: PerpsProposal[],
  context: PerpsDecisionContext,
  config: PerpsSmaUniverseConfig,
  blockOpenings = false,
) {
  const refreshed = perpsRules(
    context,
    config.markets.map((m) => m.symbol),
  );
  const excluded = new Set(context.evidence.excluded?.map((e) => e.symbol));
  return initial.map((p) => {
    if (excluded.has(p.symbol)) {
      return { ...p, action: "hold" as const, reason: "DATA_UNAVAILABLE" };
    }
    if (
      p.action.startsWith("open-") &&
      (blockOpenings || refreshed.find((v) => v.symbol === p.symbol)?.action !== p.action)
    ) {
      return {
        ...p,
        action: "hold" as const,
        reason: blockOpenings ? "COMMON_POSITION_UNVALUED" : "SMA_FINAL_GATE_CHANGED",
      };
    }
    return p;
  });
}
/** The host supplies provider queues; every asset call has an independently reserved identity. */
export async function reviewUniverse(
  variant: "sma-jev" | "sma-exa-jev",
  context: PerpsDecisionContext,
  initial: PerpsProposal[],
  models: SmaReviewModels,
  calls: PerpsStrategyCalls,
  signal: AbortSignal,
) {
  const results = await Promise.allSettled(
    initial.map(async (p) => {
      if (!p.action.startsWith("open-")) {
        return p;
      }
      const assetContext = {
        account: structuredClone(context.account),
        evidence: {
          ...context.evidence,
          frames: context.evidence.frames.filter((f) => f.snapshot.market.symbol === p.symbol),
          candles: context.evidence.candles.filter((c) => c.market.symbol === p.symbol),
          sourceIds: context.evidence.sourceIds.filter((id) => id.startsWith(`${p.symbol}:`)),
        },
      };
      const news =
        variant === "sma-exa-jev"
          ? await calls.run(`exa:${p.symbol}`, (h) => models.news(assetContext, signal, h))
          : null;
      signal.throwIfAborted();
      const answers = await calls.run(
        `${variant === "sma-jev" ? "sma-review" : "news-review"}:${p.symbol}`,
        (h) => models.review(assetContext, [p], news, signal, h),
      );
      return perpsJevReviewed([p], answers)[0]!;
    }),
  );
  const failure = results.find((r) => r.status === "rejected");
  if (failure?.status === "rejected") {
    throw failure.reason;
  }
  return results.map((r) => (r as PromiseFulfilledResult<PerpsProposal>).value);
}
