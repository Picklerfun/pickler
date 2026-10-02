import { PilotError } from "@pickler/core";
import { paperUnits as u, paperDecimal as d } from "../perps-paper/decimal.js";
import type {
  PerpsStudyConfig,
  PerpsRound,
  PerpsDecisionContext,
  PerpsProposal,
  PerpsCallLane,
} from "./types.js";
export const PERPS_INPUT_LIMIT = 65536;
export const PERPS_OUTPUT_LIMIT = 4096;
export function assertPerpsStudyConfig(c: PerpsStudyConfig) {
  if (
    !(
      (c.version === 1 && c.protocol === "perps-comparison-v1" && c.hours === 24) ||
      (c.version === 2 && c.protocol === "perps-four-way-v2" && c.hours === 2)
    ) ||
    c.budgetUsd !== "5" ||
    !c.tenantId ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(c.sessionId) ||
    !["mainnet", "testnet"].includes(c.network) ||
    c.jev.model !== "jev-1.13.0" ||
    c.jev.outputPerMillion !== "0" ||
    !c.deepseek.model ||
    !Number.isFinite(Date.parse(c.pricingVerifiedAt)) ||
    c.pricingSources.length < 2
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid perpetual comparison config");
  }
  const acknowledgments = c.acknowledgedUnknownCalls ?? [];
  if (
    acknowledgments.length > 2 ||
    (c.version === 1 && acknowledgments.length > 0) ||
    new Set(acknowledgments.map((a) => `${a.sessionId}:${a.roundKey}:${a.lane}`)).size !==
      acknowledgments.length ||
    acknowledgments.some(
      (a) =>
        a.sessionId === c.sessionId ||
        !/^[a-f0-9]{64}$/.test(a.requestHash) ||
        u(a.reservationUsd) <= 0n,
    )
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid historical unknown-call acknowledgment");
  }
  const endpoint = new URL(c.deepseek.baseUrl);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid model endpoint");
  }
  for (const price of [
    c.deepseek.inputPerMillion,
    c.deepseek.outputPerMillion,
    c.jev.inputPerMillion,
  ]) {
    if (u(price) <= 0n || u(price) > u("1000")) {
      throw new PilotError("INVALID_INPUT", "Explicit positive verified pricing is required");
    }
  }
}
export function perpsCallCost(
  config: PerpsStudyConfig,
  lane: PerpsCallLane,
  input: number,
  output: number,
) {
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0 ||
    input > PERPS_INPUT_LIMIT ||
    output > (lane === "jev" || lane === "review" ? PERPS_INPUT_LIMIT : PERPS_OUTPUT_LIMIT)
  ) {
    throw new PilotError("USAGE_UNVERIFIED", "Usage exceeds the pinned reservation");
  }
  const pricing = lane === "jev" || lane === "review" ? config.jev : config.deepseek;
  return d(
    (BigInt(input) * u(pricing.inputPerMillion) + BigInt(output) * u(pricing.outputPerMillion)) /
      1000000n,
  );
}
export function perpsAccountedUsd(rounds: PerpsRound[]): string {
  return d(
    rounds.reduce(
      (total, r) =>
        total +
        Object.values(r.calls).reduce(
          (sum, c) => sum + (c.status === "skipped" ? 0n : u(c.costUsd ?? c.reservationUsd)),
          0n,
        ),
      0n,
    ),
  );
}
export function perpsRules(context: PerpsDecisionContext): PerpsProposal[] {
  return (["BTC", "ETH"] as const).map((symbol) => {
    const series = context.evidence.candles.find((c) => c.market.symbol === symbol);
    const closed =
      series?.candles
        .filter((c) => c.closed && c.openTime + 3600000 <= context.evidence.observedAt)
        .slice(-50) ?? [];
    const position = context.account.positions.find(
      (p) => p.symbol === symbol && p.closedAt === null,
    );
    const valid =
      closed.length === 50 &&
      closed.every((c, i) => i === 0 || c.openTime - closed[i - 1]!.openTime === 3600000);
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
      closed.every((c, i) => i === 0 || c.openTime - closed[i - 1]!.openTime === 3600000)
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
): PerpsProposal[] {
  return (["BTC", "ETH"] as const).map((symbol) => {
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
