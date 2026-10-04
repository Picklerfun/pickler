import { PilotError } from "@pickler/core";
import { paperUnits as u, paperDecimal as d } from "../perps-paper/decimal.js";
import type { PerpsStudyConfig, PerpsRound, PerpsCallLane } from "./types.js";
export const PERPS_INPUT_LIMIT = 65536;
export const PERPS_OUTPUT_LIMIT = 4096;
export function assertPerpsStudyConfig(c: PerpsStudyConfig) {
  if (c.version === 3) {
    if (
      c.protocol !== "perps-sma-ablation-v1" ||
      c.hours !== 6 ||
      c.acquisitionPolicy !== "rest-paced-20s-v1" ||
      c.entryPolicyVersion !== "sma-ablation-entries-v1" ||
      c.exitPolicyVersion !== "multiframe-common-exits-v1" ||
      c.strategyVersion !== "sma-ablation-v1" ||
      !c.tenantId ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(c.sessionId) ||
      !["mainnet", "testnet"].includes(c.network)
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid SMA ablation configuration");
    }
    return;
  }
  if (
    !(
      (c.version === 1 && c.protocol === "perps-comparison-v1" && c.hours === 24) ||
      (c.version === 2 &&
        c.protocol === "perps-four-way-v2" &&
        c.hours === 2 &&
        c.strategyVersion === undefined) ||
      (c.version === 2 &&
        c.protocol === "perps-multiframe-v3" &&
        c.hours === 2 &&
        c.strategyVersion === "1.1.0")
    ) ||
    (c.strategyVersion !== undefined && (c.version !== 2 || c.strategyVersion !== "1.1.0")) ||
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
  if (config.version === 3) {
    throw new PilotError("PAID_CALL_FORBIDDEN", "SMA ablation cannot reserve model calls");
  }
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
