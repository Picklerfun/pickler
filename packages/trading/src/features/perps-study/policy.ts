import { assertPtsConfig } from "../pts/policy.js";
import { PilotError, PERPL_LAB_SYMBOLS } from "@pickler/core";
import { paperUnits as u, paperDecimal as d } from "../perps-paper/decimal.js";
import type { PerpsStudyConfig, PerpsRound, PerpsCallLane, PerpsStudyRecord } from "./types.js";
export const PERPS_INPUT_LIMIT = 65536;
export const PERPS_OUTPUT_LIMIT = 4096;
export function assertPerpsStudyConfig(c: PerpsStudyConfig) {
  if (c.version === 8) {
    return assertPtsConfig(c);
  }
  if (c.version === 6 || c.version === 7) {
    const catalog = [
      ["BTC", 1],
      ["MON", 10],
      ["ETH", 20],
      ["SOL", 31],
      ["HYPE", 40],
      ["ZEC", 50],
      ["LIT", 60],
      ["VVV", 70],
      ["PUMP", 90],
      ["NEAR", 100],
      ["UNI", 110],
    ];
    if (
      c.protocol !==
        (c.version === 7 ? "perps-sma-reentry-latency-v1" : "perps-sma-profile-risk-v1") ||
      c.hours !== 6 ||
      c.budgetUsd !== "5" ||
      !c.tenantId ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(c.sessionId) ||
      !["mainnet", "testnet"].includes(c.network) ||
      !Array.isArray(c.markets) ||
      c.markets.length !== 11 ||
      (c.version === 7 &&
        c.acquisitionPolicy !== undefined &&
        ![
          "rest-universe-20s-v1",
          "rest-universe-coherent-20s-v2",
          "stream-universe-20s-v1",
          "stream-universe-component-20s-v2",
          "stream-universe-component-paper-20s-v1",
        ].includes(c.acquisitionPolicy)) ||
      (c.version === 7 &&
        (c.acquisitionPolicy === "stream-universe-component-paper-20s-v1"
          ? !c.captureQualification ||
            !/^[a-f0-9]{40}$/.test(c.captureQualification.commit) ||
            !/^[a-f0-9]{64}$/.test(c.captureQualification.reportSha256) ||
            Object.keys(c.captureQualification).some(
              (key) => !["commit", "reportSha256"].includes(key),
            )
          : c.captureQualification !== undefined)) ||
      catalog.some(
        ([symbol, id]) => !c.markets.some((m) => m.symbol === symbol && m.marketId === id),
      ) ||
      Object.keys(c).some(
        (k) =>
          ![
            "version",
            "protocol",
            "hours",
            "budgetUsd",
            "tenantId",
            "sessionId",
            "network",
            "markets",
            ...(c.version === 7 ? ["acquisitionPolicy", "captureQualification"] : []),
          ].includes(k),
      )
    ) {
      throw new PilotError("INVALID_INPUT", "Frozen rules-only profile configuration required");
    }
    return;
  }
  if (c.version === 5) {
    assertPerpsStudyConfig({
      ...c,
      version: 4,
      protocol: "perps-sma-jev-exa-v1",
      providerBudgetUSD: "0.50",
    });
    if (
      c.protocol !== "perps-sma-jev-exa-all-markets-v1" ||
      c.providerBudgetUSD !== "2.50" ||
      c.markets.length !== 11 ||
      new Set(c.markets.map((m) => m.symbol)).size !== 11 ||
      new Set(c.markets.map((m) => m.marketId)).size !== 11 ||
      c.markets.some(
        (m) =>
          !(PERPL_LAB_SYMBOLS as readonly string[]).includes(m.symbol) ||
          !Number.isSafeInteger(m.marketId) ||
          m.marketId <= 0,
      ) ||
      new Set(c.historicalUnknownReservations.map((a) => `${a.sessionId}:${a.roundKey}:${a.lane}`))
        .size !== c.historicalUnknownReservations.length ||
      c.historicalUnknownReservations.some(
        (a) => !a.sessionId || a.sessionId === c.sessionId || !a.roundKey || !a.lane,
      ) ||
      !/^[a-f0-9]{64}$/.test(c.historicalBudget.recordHash) ||
      u(c.historicalBudget.upperBoundUSD) < u(c.historicalBudget.databaseAccountedUSD) ||
      u(c.historicalBudget.upperBoundUSD) < 0n ||
      u(c.historicalBudget.databaseAccountedUSD) < 0n ||
      u(c.historicalBudget.upperBoundUSD) + u(c.providerBudgetUSD) > u("5")
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        "Frozen universe and verified campaign upper bound required",
      );
    }
    return;
  }
  if (c.version === 4) {
    if (
      c.protocol !== "perps-sma-jev-exa-v1" ||
      c.hours !== 2 ||
      c.budgetUsd !== "5" ||
      c.providerBudgetUSD !== "0.50" ||
      !c.tenantId ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(c.sessionId) ||
      !["mainnet", "testnet"].includes(c.network) ||
      c.authorization?.jevApproved !== true ||
      c.authorization?.exaApproved !== true ||
      !/^[a-f0-9]{64}$/.test(c.authorization.operatorRecordHash) ||
      c.jev?.model !== "jev-1.13.0" ||
      c.jev.outputPerMillion !== "0" ||
      c.jev.inputPerMillion !== "0.042" ||
      c.exa?.reservationPerSearchUSD !== "0.05" ||
      c.exa.lookbackHours !== 24 ||
      c.exa.results !== 5 ||
      !Number.isFinite(Date.parse(c.pricingVerifiedAt)) ||
      !Array.isArray(c.pricingSources) ||
      c.pricingSources.length < 2 ||
      !Array.isArray(c.historicalUnknownReservations) ||
      (c.historicalAccountedOrReservedUSD !== null && u(c.historicalAccountedOrReservedUSD) < 0n) ||
      c.historicalUnknownReservations.some(
        (a) => !/^[a-f0-9]{64}$/.test(a.requestHash) || u(a.reservationUsd) <= 0n,
      )
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        "Explicit study-specific Jev/Exa authorization required",
      );
    }
    return;
  }
  if (c.version === 3) {
    if (
      c.protocol !== "perps-original-sma-v1" ||
      c.hours !== 24 ||
      c.budgetUsd !== "5" ||
      !c.tenantId ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(c.sessionId) ||
      !["mainnet", "testnet"].includes(c.network) ||
      Object.keys(c).some(
        (k) =>
          ![
            "version",
            "protocol",
            "hours",
            "budgetUsd",
            "tenantId",
            "sessionId",
            "network",
          ].includes(k),
      )
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid original SMA configuration");
    }
    return;
  }
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
    config.version === 3 ||
    config.version === 6 ||
    config.version === 7 ||
    config.version === 8
  ) {
    throw new PilotError("MODELS_DISABLED", "Original SMA cannot reserve model calls");
  }
  if (config.version === 5) {
    const [base, symbol] = lane.split(":");
    if (
      !config.markets.some((m) => m.symbol === symbol) ||
      !["sma-review", "news-review"].includes(base!)
    ) {
      throw new PilotError("MODEL_CONFIG_MISMATCH", "Asset-specific Jev lane required");
    }
    return perpsCallCost(
      { ...config, version: 4, protocol: "perps-sma-jev-exa-v1", providerBudgetUSD: "0.50" },
      base as PerpsCallLane,
      input,
      output,
    );
  }
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0 ||
    input > PERPS_INPUT_LIMIT ||
    output >
      (["jev", "review", "sma-review", "news-review"].includes(lane)
        ? PERPS_INPUT_LIMIT
        : PERPS_OUTPUT_LIMIT)
  ) {
    throw new PilotError("USAGE_UNVERIFIED", "Usage exceeds the pinned reservation");
  }
  if (config.version === 4 && !["sma-review", "news-review"].includes(lane)) {
    throw new PilotError("MODEL_CONFIG_MISMATCH", "Only Jev token lanes allowed");
  }
  const pricing =
    config.version === 4 || lane === "jev" || lane === "review" ? config.jev : config.deepseek;
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
          (sum, c) => sum + (!c || c.status === "skipped" ? 0n : u(c.costUsd ?? c.reservationUsd)),
          0n,
        ),
      0n,
    ),
  );
}

/** Continuations schedule only untouched slots against fresh time; historical start remains intact. */
export function perpsSlotClock(record: PerpsStudyRecord, at: number) {
  const segment = record.continuations?.at(-1);
  const origin = segment?.at ?? record.startedAt!;
  const offset = segment?.fromSlot ?? 0;
  const cadence = record.config.version >= 6 ? 300000 : 900000;
  return {
    slot: offset + Math.floor((at - origin) / cadence),
    withinSlotMs: (at - origin) % cadence,
  };
}
