import { PilotError, type PerpSymbol } from "@pickler/core";
import { perpsRules } from "../perps-strategies/policy.js";
import { paperUnits as u, paperDecimal as d } from "../perps-paper/decimal.js";
import { paperRisk, applyPaperFill } from "../perps-paper/policy.js";
import { simulatePerpsFill } from "../perps-paper/simulation.js";
import type { PerpsDecisionContext, PerpsProposal } from "../perps-strategies/types.js";
import type { PerpsSmaProfileConfig, SmaProfileVariant } from "./types.js";

export const SMA_PROFILES = {
  hourly: {
    id: "sma-hourly-v1",
    version: "1.0.0",
    requiredResolutions: [3600],
    trendResolution: 3600,
    fastPeriod: 20,
    slowPeriod: 50,
    separationBps: 10,
    decisionsSeconds: 300,
    maxHoldingSeconds: 14400,
  },
  fast: {
    id: "sma-fast-direction-v1",
    version: "1.0.0",
    requiredResolutions: [900, 300],
    trendResolution: 900,
    fastPeriod: 20,
    slowPeriod: 50,
    separationBps: 10,
    decisionsSeconds: 300,
    maxHoldingSeconds: 14400,
  },
} as const;
export const SELECTIVE_RISK = {
  id: "buffered-selective-1x-v1",
  targetPercent: 40,
  ceilingPercent: 50,
  maximumPositions: 5,
} as const;
export function profileDescriptor(variant: SmaProfileVariant) {
  return SMA_PROFILES[variant.startsWith("fast-") ? "fast" : "hourly"];
}
export function profileSignal(
  context: PerpsDecisionContext,
  variant: SmaProfileVariant,
  symbols: readonly PerpSymbol[],
): PerpsProposal[] {
  const resolution = profileDescriptor(variant).trendResolution;
  const signals = perpsRules(context, symbols, resolution);
  return signals.map((p) => {
    if (!p.action.startsWith("open-") || !variant.startsWith("fast-")) {
      return p;
    }
    const confirmation = context.evidence.candles
      .find((s) => s.market.symbol === p.symbol && s.resolution === 300)
      ?.candles.at(-1);
    if (
      !confirmation ||
      !confirmation.closed ||
      confirmation.openTime + 300000 > context.evidence.observedAt
    ) {
      return { ...p, action: "hold", reason: "CONFIRMATION_UNAVAILABLE" };
    }
    const difference = u(confirmation.close) - u(confirmation.open);
    const confirmed = p.action === "open-long" ? difference > 0n : difference < 0n;
    return confirmed ? p : { ...p, action: "hold", reason: "DIRECTION_NOT_CONFIRMED" };
  });
}
export function profileSmaTrace(
  context: PerpsDecisionContext,
  symbol: PerpSymbol,
  resolution: number = 3600,
) {
  const series = context.evidence.candles.find(
    (c) => c.market.symbol === symbol && c.resolution === resolution,
  );
  const candles =
    series?.candles
      .filter((c) => c.closed && c.openTime + resolution * 1000 <= context.evidence.observedAt)
      .slice(-50) ?? [];
  if (
    candles.length !== 50 ||
    candles.some((c, i) => i > 0 && c.openTime - candles[i - 1]!.openTime !== resolution * 1000)
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
    signedNumerator: numerator,
    numerator: numerator < 0n ? -numerator : numerator,
    denominator: slowSum * 20n,
  };
}
/** Pure selection on the account's initial portfolio. Rejected candidates never replace vetoed entries. */
export function profileProposals(
  context: PerpsDecisionContext,
  config: PerpsSmaProfileConfig,
  variant: SmaProfileVariant,
  blockOpenings = false,
  eligibleOpenings?: ReadonlySet<PerpSymbol>,
) {
  const symbols = config.markets.map((m) => m.symbol);
  const original = profileSignal(context, variant, symbols);
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
    (p) =>
      p.action.startsWith("open-") &&
      !excluded.has(p.symbol) &&
      (!eligibleOpenings || eligibleOpenings.has(p.symbol)),
  );
  candidates.sort((a, b) => {
    const x = profileSmaTrace(context, a.symbol, profileDescriptor(variant).trendResolution),
      y = profileSmaTrace(context, b.symbol, profileDescriptor(variant).trendResolution);
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
      const next = applyPaperFill(projected, attempt, fill, context.evidence.observedAt).account;
      assertProfileOpening(next, context.evidence.observedAt);
      Object.assign(projected, next);
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
      const t = profileSmaTrace(context, p.symbol, profileDescriptor(variant).trendResolution);
      const confirmation = context.evidence.candles
        .find((s) => s.market.symbol === p.symbol && s.resolution === 300)
        ?.candles.at(-1);
      return t
        ? {
            profile: profileDescriptor(variant),
            sma20: t.sma20,
            sma50: t.sma50,
            separationBps: t.separationBps,
            confirmation: confirmation
              ? {
                  openTime: confirmation.openTime,
                  open: confirmation.open,
                  close: confirmation.close,
                }
              : null,
          }
        : null;
    })(),
  }));
}
export function profileFinal(
  initial: PerpsProposal[],
  context: PerpsDecisionContext,
  config: PerpsSmaProfileConfig,
  variant: SmaProfileVariant,
  blockOpenings = false,
) {
  const eligible = new Set(
    initial.filter((p) => p.action.startsWith("open-")).map((p) => p.symbol),
  );
  const refreshed = profileProposals(context, config, variant, blockOpenings, eligible);
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
    return p.action.startsWith("open-") ? refreshed.find((v) => v.symbol === p.symbol)! : p;
  });
}

/** Final fill economics are checked again by the transactional repository. */
export function assertProfileOpening(
  account: import("../perps-paper/types.js").PerpsPaperAccount,
  at: number,
) {
  if (account.riskManagement !== "buffered-selective-1x-v1") {
    return;
  }
  const r = paperRisk(account, [], at);
  if (r.equity === null || r.exposure === null || u(r.exposure) * 5n > u(r.equity) * 2n) {
    throw new PilotError("RISK_REJECTED", "Post-fill exposure exceeds buffered target");
  }
}
