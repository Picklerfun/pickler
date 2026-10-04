import type { PerpSymbol } from "@pickler/core";
import { perpsRules } from "./policy.js";
import {
  gateSmaEntry,
  multiframeFeatures,
  traceMultiframeProposal,
  validateMultiframeEvidence,
  PERPS_MULTIFRAME_POLICY,
} from "./multiframe.js";
import type { PerpsDecisionContext, PerpsProposal } from "./types.js";
import type { SmaVariant } from "../perps-study/types.js";

export function commonSmaExit(
  context: PerpsDecisionContext,
  symbol: PerpSymbol,
): PerpsProposal | null {
  const position = context.account.positions.find(
    (p) => p.symbol === symbol && p.closedAt === null,
  );
  if (!position) {
    return null;
  }
  const f = multiframeFeatures(context, symbol);
  const due = context.evidence.observedAt - position.openedAt >= PERPS_MULTIFRAME_POLICY.horizonMs;
  const invalid =
    f.trend !== position.side || f.momentum5Bps * (position.side === "long" ? 1 : -1) < 0;
  return {
    symbol,
    action: due || invalid ? "close" : "hold",
    reason: due ? "HORIZON_EXIT" : invalid ? "THESIS_EXIT" : "POSITION_INTACT",
    sourceIds: context.evidence.sourceIds.filter((id) => id.startsWith(`${symbol}:`)),
  };
}

export function smaAblationProposal(context: PerpsDecisionContext, variant: SmaVariant) {
  validateMultiframeEvidence(context.evidence);
  const hourly = {
    ...context,
    evidence: {
      ...context.evidence,
      candles: context.evidence.candles.filter((s) => s.resolution === 3600),
    },
  };
  return perpsRules(hourly).map((raw) => {
    const original = commonSmaExit(context, raw.symbol) ?? raw;
    const proposal = gateSmaEntry(context, original, variant);
    const trace = traceMultiframeProposal(context, original);
    return {
      original,
      proposal,
      trace: {
        ...trace,
        executable: proposal,
        firstBlock:
          original.action.startsWith("open-") && proposal.action === "hold"
            ? proposal.reason
            : null,
        checks: trace.checks.map((c) => ({
          ...c,
          enforced:
            c.code === "DIRECTION_NOT_CONFIRMED"
              ? variant !== "sma-hourly"
              : c.code === "RECENT_MOVE_BELOW_COST_HURDLE"
                ? variant === "sma-multiframe"
                : true,
        })),
      },
    };
  });
}

/** Revalidation can remove an entry or close a position, but never introduce a new entry. */
export function finalSmaProposal(
  context: PerpsDecisionContext,
  variant: SmaVariant,
  initial: PerpsProposal,
): PerpsProposal {
  const exit = commonSmaExit(context, initial.symbol);
  if (exit?.action === "close") {
    return exit;
  }
  return gateSmaEntry(context, initial, variant);
}
