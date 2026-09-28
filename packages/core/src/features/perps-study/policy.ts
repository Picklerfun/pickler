import { PilotError } from "../research/types.js";
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
    c.version !== 1 ||
    c.protocol !== "perps-comparison-v1" ||
    c.hours !== 24 ||
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
    output > (lane === "jev" ? PERPS_INPUT_LIMIT : PERPS_OUTPUT_LIMIT)
  ) {
    throw new PilotError("USAGE_UNVERIFIED", "Usage exceeds the pinned reservation");
  }
  const pricing = lane === "jev" ? config.jev : config.deepseek;
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
