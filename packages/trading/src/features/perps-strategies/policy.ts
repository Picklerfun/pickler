import { PilotError, type PerpSymbol } from "@pickler/core";
import { paperUnits as u } from "../perps-paper/decimal.js";
import type { PerpsDecisionContext, PerpsProposal } from "./types.js";
export function perpsRules(
  context: PerpsDecisionContext,
  symbols: readonly PerpSymbol[] = ["BTC", "ETH"],
  resolution: 3600 | 900 = 3600,
): PerpsProposal[] {
  return symbols.map((symbol) => {
    const series = context.evidence.candles.find(
      (c) => c.market.symbol === symbol && c.resolution === resolution,
    );
    const closed =
      series?.candles
        .filter((c) => c.closed && c.openTime + resolution * 1000 <= context.evidence.observedAt)
        .slice(-50) ?? [];
    const position = context.account.positions.find(
      (p) => p.symbol === symbol && p.closedAt === null,
    );
    const valid =
      closed.length === 50 &&
      closed.every((c, i) => i === 0 || c.openTime - closed[i - 1]!.openTime === resolution * 1000);
    if (!valid) {
      return {
        symbol,
        action: "hold",
        reason: "INSUFFICIENT_CLOSED_CANDLES",
        sourceIds: [`${symbol}:candles`],
      };
    }
    let direction: "long" | "short" | null = null;
    if (
      closed.length === 50 &&
      closed.every((c, i) => i === 0 || c.openTime - closed[i - 1]!.openTime === resolution * 1000)
    ) {
      const fast = closed.slice(-20).reduce((s, c) => s + u(c.close), 0n) * 50n;
      const slow = closed.reduce((s, c) => s + u(c.close), 0n) * 20n;
      if (fast * 1000n > slow * 1001n) {
        direction = "long";
      } else if (fast * 1000n < slow * 999n) {
        direction = "short";
      }
    }
    const action: PerpsProposal["action"] = position
      ? position.side === direction
        ? "hold"
        : "close"
      : direction === "long"
        ? "open-long"
        : direction === "short"
          ? "open-short"
          : "hold";
    return {
      symbol,
      action,
      reason:
        closed.length < 50 ? "INSUFFICIENT_CLOSED_CANDLES" : `SMA20_50_${direction ?? "neutral"}`,
      sourceIds: [`${symbol}:candles`],
    };
  });
}

export interface PerpsJevAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export type PerpsJevAnswers = Record<string, PerpsJevAnswer>;
/** Experimental answer thresholds are not financial win probabilities. */
export function perpsJevDecisions(
  context: PerpsDecisionContext,
  answers: PerpsJevAnswers,
  symbols: readonly PerpSymbol[] = ["BTC", "ETH"],
): PerpsProposal[] {
  return symbols.map((symbol) => {
    const position = context.account.positions.find(
      (p) => p.symbol === symbol && p.closedAt === null,
    );
    const long = answers[`${symbol}_long`];
    const short = answers[`${symbol}_short`];
    const thesis = answers[`${symbol}_thesis`];
    if (!long || !short || !thesis) {
      throw new PilotError("JEV_ANSWERS_INVALID", "Missing atomic answer");
    }
    let action: PerpsProposal["action"] = "hold";
    let reason = "JEV_UNCERTAIN_OR_UNSUPPORTED";
    if (position) {
      if (thesis.choice === "INVALIDATED" && thesis.probabilities.INVALIDATED! >= 0.7) {
        action = "close";
        reason = "JEV_THESIS_INVALIDATED";
      }
    } else if (long.choice === "SUPPORTED" && short.choice === "SUPPORTED") {
      reason = "JEV_CONFLICTING_DIRECTIONS";
    } else if (long.choice === "SUPPORTED" && long.probabilities.SUPPORTED! >= 0.7) {
      action = "open-long";
      reason = "JEV_LONG_SUPPORTED";
    } else if (short.choice === "SUPPORTED" && short.probabilities.SUPPORTED! >= 0.7) {
      action = "open-short";
      reason = "JEV_SHORT_SUPPORTED";
    }
    return {
      symbol,
      action,
      reason,
      sourceIds: context.evidence.sourceIds.filter((id) => id.startsWith(`${symbol}:`)),
    };
  });
}
export function perpsJevReviewed(
  proposals: PerpsProposal[],
  answers: PerpsJevAnswers,
): PerpsProposal[] {
  return proposals.map((proposal) => {
    const veto = ["identity", "evidence", "costs"].some((kind) => {
      const a = answers[`${proposal.symbol}_${kind}`];
      if (!a) {
        throw new PilotError("JEV_ANSWERS_INVALID", "Missing review answer");
      }
      return (
        a.choice === "CONTRADICTED" && a.confidence >= 0.9 && a.probabilities.CONTRADICTED! >= 0.9
      );
    });
    return veto && proposal.action !== "hold"
      ? { ...proposal, action: "hold", reason: "JEV_MATERIAL_VETO" }
      : proposal;
  });
}
