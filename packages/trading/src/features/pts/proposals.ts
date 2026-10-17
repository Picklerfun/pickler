import { PilotError } from "@pickler/core";
import type { PerpsDecisionContext, PerpsProposal } from "../perps-strategies/types.js";
import { paperRisk, applyPaperFill } from "../perps-paper/policy.js";
import { simulatePerpsFill } from "../perps-paper/simulation.js";
import { assertProfileOpening } from "../perps-study/profiles.js";
import { analyzePts, ptsFillAdmissible } from "./signals.js";
import { ptsManagement, ptsSize, isPtsAccount } from "./account.js";
import { type PtsHistory, type PtsProposal, type PtsVersion, PTS_VERSION } from "./types.js";
import { ptsTemporalProfile, ptsConfigVersion } from "./temporal-profile.js";
import type { PerpsPtsConfig } from "./policy.js";
import { units as u, decimal as d, min } from "./math.js";
export function historyFromEvidence(
  context: PerpsDecisionContext,
  symbol: string,
  version: PtsVersion = PTS_VERSION,
): PtsHistory | null {
  const market =
    context.evidence.frames.find((f) => f.snapshot.market.symbol === symbol)?.snapshot.market ??
    context.evidence.candles.find((s) => s.market.symbol === symbol)?.market;
  return market
    ? {
        market,
        capturedAt: context.evidence.observedAt,
        series: context.evidence.candles.filter(
          (s) =>
            s.market.symbol === symbol && ptsTemporalProfile(version).native.includes(s.resolution),
        ),
      }
    : null;
}
export function ptsProposals(
  context: PerpsDecisionContext,
  config: PerpsPtsConfig,
  blockOpenings = false,
  eligibleOpenings?: ReadonlySet<string>,
): PtsProposal[] {
  const version = ptsConfigVersion(config);
  if (
    !isPtsAccount(context.account) ||
    context.account.positionPolicy !== ptsTemporalProfile(version).accountPolicy
  ) {
    throw new PilotError("CONFIG_CHANGED", "PTS account policy required");
  }
  const proposals = config.markets.map((market): PtsProposal => {
    const history = historyFromEvidence(context, market.symbol, version),
      position = context.account.positions.find(
        (p) => p.symbol === market.symbol && p.closedAt === null,
      );
    if (position) {
      const exit = ptsManagement(
        position,
        position.mark,
        context.evidence.observedAt,
        history ?? undefined,
      );
      return {
        symbol: market.symbol,
        action: exit.action,
        reason: exit.reason,
        sourceIds: context.evidence.sourceIds,
        pts: {
          version,
          ...(exit.quantity ? { quantity: exit.quantity } : {}),
          targets: exit.targets,
          reason: exit.reason,
        },
      };
    }
    if (!history || context.evidence.excluded?.some((e) => e.symbol === market.symbol)) {
      return { symbol: market.symbol, action: "hold", reason: "DATA_UNAVAILABLE", sourceIds: [] };
    }
    const trace = analyzePts(history, context.evidence.observedAt, version);
    return {
      symbol: market.symbol,
      action: trace.action,
      reason: trace.reason,
      sourceIds: context.evidence.sourceIds,
      trace,
      ...(trace.setup ? { pts: { version, setup: trace.setup } } : {}),
    };
  });
  for (const p of proposals) {
    if (eligibleOpenings && p.action.startsWith("open-") && !eligibleOpenings.has(p.symbol)) {
      p.action = "hold";
      p.reason = "INITIAL_OPENING_NOT_SELECTED";
    }
  }
  const candidates = proposals
    .filter((p) => p.action.startsWith("open-"))
    .sort(
      (a, b) =>
        a.pts!.setup!.knownAt - b.pts!.setup!.knownAt ||
        a.pts!.setup!.marketId - b.pts!.setup!.marketId,
    );
  const projected = structuredClone(context.account);
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i]!,
      setup = p.pts!.setup!,
      frame = context.evidence.frames.find((f) => f.snapshot.market.symbol === p.symbol)!;
    p.rank = i + 1;
    const hold = (reason: string) => {
      p.action = "hold";
      p.reason = reason;
    };
    if (blockOpenings) {
      hold("COMMON_POSITION_UNVALUED");
      continue;
    }
    if (projected.consumedPtsSetups?.includes(setup.id)) {
      hold("PTS_SETUP_CONSUMED");
      continue;
    }
    if (!frame) {
      hold("DATA_UNAVAILABLE");
      continue;
    }
    const best = setup.direction === "long" ? frame.book.asks[0]?.price : frame.book.bids[0]?.price;
    if (!best) {
      hold("INSUFFICIENT_DEPTH");
      continue;
    }
    const equity = paperRisk(projected, [], context.evidence.observedAt).equity;
    const size = ptsSize(
      projected,
      setup,
      best,
      frame.book.market.fees.taker,
      equity,
      frame.book.market.sizeDecimals,
    );
    if (!size) {
      hold("PTS_SIZE_UNAVAILABLE");
      continue;
    }
    const intent = {
      kind: "open" as const,
      symbol: p.symbol,
      side: setup.direction,
      notional: "100",
      feeReserve: "1",
      pts: { version, setup, quantity: size.quantity },
    };
    try {
      let fill = simulatePerpsFill(projected, intent, frame, context.evidence.observedAt);
      // Reprice only with this same observed book. Quantity can decrease, never increase.
      // This is pure sizing, not a provider retry or a new slippage parameter.
      for (let pass = 0; pass < 3; pass++) {
        const sized = ptsSize(
          projected,
          setup,
          fill.price,
          frame.book.market.fees.taker,
          equity,
          frame.book.market.sizeDecimals,
        );
        if (!sized) {
          throw new PilotError(
            "PTS_SIZE_UNAVAILABLE",
            "Projected fill cannot meet PTS size/risk limits",
          );
        }
        const quantity = d(min(u(intent.pts.quantity), u(sized.quantity)));
        if (quantity === intent.pts.quantity) {
          break;
        }
        intent.pts.quantity = quantity;
        fill = simulatePerpsFill(projected, intent, frame, context.evidence.observedAt);
      }
      intent.notional = fill.notional;
      const risk = paperRisk(projected, [], context.evidence.observedAt, intent);
      if (!risk.allowed) {
        hold(risk.reasons.join(","));
        continue;
      }
      if (!ptsFillAdmissible(setup, fill.price, context.evidence.observedAt)) {
        hold("PTS_LATE_ENTRY");
        continue;
      }
      const next = applyPaperFill(
        projected,
        {
          key: `selection:${p.symbol}`,
          intent,
          status: "pending",
          reserved: "0",
          createdAt: context.evidence.observedAt,
          finishedAt: null,
          reason: null,
          evidence: null,
        },
        fill,
        context.evidence.observedAt,
      ).account;
      assertProfileOpening(next, context.evidence.observedAt);
      Object.assign(projected, next);
      p.pts = intent.pts;
      p.notional = intent.notional;
    } catch (e) {
      if (!(e instanceof PilotError)) {
        throw e;
      }
      hold(e.code);
    }
  }
  return proposals;
}
/** Re-check the original selection only. No hold promotion, replacement, anchor or direction change. */
export function ptsFinal(
  initial: PerpsProposal[],
  context: PerpsDecisionContext,
  config: PerpsPtsConfig,
  blockOpenings = false,
): PerpsProposal[] {
  const selected = new Set(
    initial.filter((p) => p.action.startsWith("open-")).map((p) => p.symbol),
  );
  const refreshed = ptsProposals(context, config, blockOpenings, selected);
  return initial.map((original) => {
    if (!selected.has(original.symbol)) {
      return original;
    }
    const fresh = refreshed.find((p) => p.symbol === original.symbol)!;
    const setup = original.pts!.setup!;
    if (
      fresh.action !== original.action ||
      JSON.stringify(fresh.pts?.setup) !== JSON.stringify(setup) ||
      context.evidence.observedAt >= setup.expiresAt
    ) {
      return { ...original, action: "hold", reason: "PTS_FINAL_CANCELLED" };
    }
    // Never increase a selected quantity during refresh, even if account risk capacity improves.
    const quantity = d(min(u(original.pts!.quantity!), u(fresh.pts!.quantity!)));
    return { ...original, notional: fresh.notional!, pts: { ...original.pts!, quantity } };
  });
}
