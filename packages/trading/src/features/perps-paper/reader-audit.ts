import { PERPL_LAB_SYMBOLS, PilotError, type PerpSymbol } from "@pickler/core";

type CaptureAttempt = {
  symbol: PerpSymbol;
  at: number;
  tickerAt: number | null;
  bookAt: number | null;
  skewMs: number | null;
  code: string | null;
};

export interface UniverseReaderAuditRow {
  slot: number;
  symbol: PerpSymbol;
  slotOutcome?:
    | "ACQUIRED"
    | "NOT_ADMITTED_AFTER_INTERRUPTION"
    | "WINDOW_MISSED"
    | "DATA_UNAVAILABLE"
    | "TECHNICAL_FAILURE";
  finalValid: boolean | null;
  checks: number;
  initialCode: string | null;
  firstCheckMs: number | null;
  firstInvalidCheckMs: number | null;
  firstRecoveryCheckMs: number | null;
  recoveryDelayMs: number | null;
  lastTickerAt: number | null;
  lastBookAt: number | null;
  lastSkewMs: number | null;
  repeatedTickerDateChecks: number;
  cacheReads: number | null;
  networkReads: number | null;
}

export interface UniverseReaderAudit {
  version: 2 | 3;
  protocol: "perpl-reader-audit-v2" | "perpl-reader-audit-v3";
  streamEvidence?: {
    adapterVersion: string;
    bytes: number;
    truncated: boolean;
    hash: string;
    connections: number;
    disconnects: number;
    messages: number;
    socketClosed: boolean;
    reconstructionErrors: number;
    leaseReleased: boolean;
    acquisitionMs: { observations: number; median: number | null; p95: number | null };
  };
  sourceCommit: string;
  sourceConfigurationHash: string;
  acquisitionPolicy: string;
  startedAt: number;
  endsAt: number;
  counts: {
    cycles: number;
    validCycles: number;
    missedCycles: number;
    attemptedCycles?: number;
    notAdmittedCycles?: number;
    windowMissedCycles?: number;
    validMarkets: number;
    marketObservations: number;
    ownershipFailures: number;
    requestDiagnostics: number;
    http200: number;
    http400: number;
    http429: number;
    noHttpStatus: number;
  };
  recoveryChecks: {
    observations: number;
    medianMs: number | null;
    p95Ms: number | null;
    btcObservations: number;
    btcMinimumMs: number | null;
    btcMaximumMs: number | null;
  };
  rows: UniverseReaderAuditRow[];
  requests: {
    slot: number;
    requestId: number;
    operation: string;
    marketId: number | null;
    startedAt: number | null;
    status: number | null;
    queueMs: number | null;
    headersMs: number | null;
    bodyMs: number | null;
    durationMs: number | null;
    phase: string;
    code: string | null;
  }[];
  limitations: readonly string[];
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PilotError("INVALID_INPUT", "Expected a public capture object");
  }
  return value as Record<string, unknown>;
};
const number = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PilotError("INVALID_INPUT", "Expected a nonnegative finite capture number");
  }
  return value;
};
const nullableNumber = (value: unknown) => (value == null ? null : number(value));
const nullableMarketId = (value: unknown): number | null => {
  if (value == null) {
    return null;
  }
  const id = number(value);
  if (!Number.isSafeInteger(id) || id === 0) {
    throw new PilotError("INVALID_INPUT", "Invalid recorded request market identity");
  }
  return id;
};
const array = (value: unknown, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new PilotError("INVALID_INPUT", "Invalid or oversized public capture array");
  }
  return value;
};
const safeCode = (value: unknown): string | null => {
  if (value == null) {
    return null;
  }
  if (
    typeof value === "string" &&
    (/^PERPL_HTTP_[1-5]\d{2}$/.test(value) ||
      [
        "VALID",
        "DATA_UNAVAILABLE",
        "WINDOW_MISSED",
        "STALE_MARKET_DATA",
        "INCONSISTENT_MARKET_DATA",
        "INVALID_MARKET_DATA",
        "PERPL_CANCELLED",
        "PERPL_TIMEOUT",
        "PERPL_TRANSPORT_FAILURE",
        "PERPL_SESSION_LIMIT",
        "PERPL_INVALID_RESPONSE",
        "PERPL_MARKET_IDENTITY",
        "PERMISSION_DENIED",
        "CONFIG_CHANGED",
        "LEASE_LOST",
      ].includes(value))
  ) {
    return value;
  }
  return "NOT_VERIFIABLE";
};
const symbol = (value: unknown): PerpSymbol => {
  if (!PERPL_LAB_SYMBOLS.includes(value as PerpSymbol)) {
    throw new PilotError("INVALID_INPUT", "Unknown capture market");
  }
  return value as PerpSymbol;
};
const hash = (value: unknown, length: number): string => {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) {
    throw new PilotError("INVALID_INPUT", "Capture provenance hash is missing or invalid");
  }
  return value;
};
const percentile = (values: number[], fraction: number): number | null => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
};

function streamSlotOutcome(
  cycle: Record<string, unknown>,
): NonNullable<UniverseReaderAuditRow["slotOutcome"]> {
  if (cycle.valid === true) {
    return "ACQUIRED";
  }
  if (cycle.code === "NOT_ADMITTED_AFTER_INTERRUPTION") {
    return "NOT_ADMITTED_AFTER_INTERRUPTION";
  }
  if (cycle.code === "WINDOW_MISSED") {
    return "WINDOW_MISSED";
  }
  if (cycle.code === "DATA_UNAVAILABLE") {
    return "DATA_UNAVAILABLE";
  }
  return "TECHNICAL_FAILURE";
}

/** Facts from recorded checks, not counterfactual replay of unavailable provider responses. */
export function auditUniverseCapture(input: unknown): UniverseReaderAudit {
  const capture = object(input);
  if (
    !["perps-universe-stability-v1", "perpl-reader-check-v1"].includes(
      capture.protocol as string,
    ) ||
    ![1, 2, 3].includes(capture.version as number)
  ) {
    throw new PilotError("INVALID_INPUT", "Expected a versioned eleven-market public capture");
  }
  const cycles = array(capture.cycles, 30);
  const diagnosticOnly = capture.protocol === "perpl-reader-check-v1";
  if (
    diagnosticOnly &&
    (capture.version !== 2 ||
      capture.qualification !== "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE" ||
      capture.expectedCycles !== 3 ||
      capture.requiredValid !== null ||
      capture.passed !== false ||
      cycles.length > 3 ||
      capture.acquisitionPolicy !== "rest-universe-coherent-20s-v2")
  ) {
    throw new PilotError("INVALID_INPUT", "Reader diagnostics cannot establish qualification");
  }
  const acquisitionPolicy = capture.acquisitionPolicy ?? "rest-universe-20s-v1";
  const streaming = capture.version === 3;
  if (streaming && (acquisitionPolicy !== "stream-universe-20s-v1" || diagnosticOnly)) {
    throw new PilotError("INVALID_INPUT", "Stream capture protocol mismatch");
  }
  if (
    ![
      "rest-universe-20s-v1",
      "rest-universe-coherent-20s-v2",
      ...(streaming ? ["stream-universe-20s-v1"] : []),
    ].includes(acquisitionPolicy as string)
  ) {
    throw new PilotError("INVALID_INPUT", "Unknown capture acquisition policy");
  }
  const rows: UniverseReaderAuditRow[] = [];
  const requests: UniverseReaderAudit["requests"] = [];
  const slots = new Set<number>();
  let validCycles = 0;
  let missedCycles = 0;
  for (const value of cycles) {
    const cycle = object(value);
    const slot = number(cycle.slot);
    if (!Number.isInteger(slot) || slot >= 30 || slots.has(slot)) {
      throw new PilotError("INVALID_INPUT", "Duplicate or invalid capture slot");
    }
    slots.add(slot);
    if (typeof cycle.valid !== "boolean" || typeof cycle.missed !== "boolean") {
      throw new PilotError("INVALID_INPUT", "Missing recorded cycle outcome");
    }
    validCycles += Number(cycle.valid);
    missedCycles += Number(cycle.missed);
    const at = number(cycle.at);
    const attempts = array(cycle.acquisition ?? [], 1000).map((value): CaptureAttempt => {
      const attempt = object(value);
      return {
        symbol: symbol(attempt.symbol),
        at: number(attempt.at),
        tickerAt: nullableNumber(attempt.tickerAt),
        bookAt: nullableNumber(attempt.bookAt),
        skewMs: nullableNumber(attempt.skewMs),
        code: safeCode(attempt.code),
      };
    });
    const markets = new Map<PerpSymbol, boolean>();
    for (const value of array(cycle.markets, 11)) {
      const market = object(value);
      const name = symbol(market.symbol);
      if (markets.has(name) || typeof market.valid !== "boolean") {
        throw new PilotError("INVALID_INPUT", "Duplicate or missing final market outcome");
      }
      markets.set(name, market.valid);
    }
    const tickerReads =
      cycle.tickerReads === undefined
        ? null
        : array(cycle.tickerReads, 1000).map((value) => {
            const read = object(value);
            if (read.source !== "network" && read.source !== "cache") {
              throw new PilotError("INVALID_INPUT", "Unverifiable ticker read attribution");
            }
            return read;
          });
    for (const name of PERPL_LAB_SYMBOLS) {
      const checks = attempts.filter((a) => a.symbol === name);
      if (checks.some((check, i) => i > 0 && check.at < checks[i - 1]!.at)) {
        throw new PilotError("INVALID_INPUT", "Capture check dates regress");
      }
      const first = checks[0];
      const invalidIndex = checks.findIndex(
        (check) =>
          check.code !== null &&
          check.code !== "VALID" &&
          check.tickerAt !== null &&
          check.bookAt !== null,
      );
      const invalid = invalidIndex < 0 ? undefined : checks[invalidIndex];
      const recovery = invalidIndex < 0 ? undefined : checks[invalidIndex + 1];
      const last = checks.at(-1);
      const reads = tickerReads?.filter((read) => {
        if (read.requestedSymbols !== undefined) {
          return array(read.requestedSymbols, 11).map(symbol).includes(name);
        }
        return array(read.symbols, 11).some((value) => symbol(object(value).symbol) === name);
      });
      rows.push({
        slot,
        symbol: name,
        ...(streaming ? { slotOutcome: streamSlotOutcome(cycle) } : {}),
        finalValid: markets.get(name) ?? null,
        checks: checks.length,
        initialCode: first?.code ?? null,
        firstCheckMs: first ? first.at - at : null,
        firstInvalidCheckMs: invalid ? invalid.at - at : null,
        firstRecoveryCheckMs: recovery ? recovery.at - at : null,
        recoveryDelayMs: recovery && invalid ? recovery.at - invalid.at : null,
        lastTickerAt: last?.tickerAt ?? null,
        lastBookAt: last?.bookAt ?? null,
        lastSkewMs: last?.skewMs ?? null,
        repeatedTickerDateChecks: checks.filter(
          (check, i) =>
            i > 0 && check.tickerAt !== null && check.tickerAt === checks[i - 1]!.tickerAt,
        ).length,
        cacheReads: reads ? reads.filter((read) => read.source === "cache").length : null,
        networkReads: reads ? reads.filter((read) => read.source === "network").length : null,
      });
    }
    for (const [requestId, value] of array(cycle.requests ?? [], 100).entries()) {
      const request = object(value);
      requests.push({
        slot,
        requestId,
        operation: ["metadata", "ticker", "book", "candles", "funding"].includes(
          request.operation as string,
        )
          ? (request.operation as string)
          : "NOT_VERIFIABLE",
        marketId: nullableMarketId(request.marketId),
        startedAt: nullableNumber(request.startedAt),
        status: nullableNumber(request.status),
        queueMs: nullableNumber(request.queueMs),
        headersMs: nullableNumber(request.headersMs),
        bodyMs: nullableNumber(request.bodyMs),
        durationMs: nullableNumber(request.durationMs),
        phase: [
          "request_queue",
          "response_headers",
          "response_body",
          "validation",
          "complete",
        ].includes(request.phase as string)
          ? (request.phase as string)
          : "NOT_VERIFIABLE",
        code: safeCode(request.code),
      });
    }
  }
  rows.sort((a, b) => a.slot - b.slot || a.symbol.localeCompare(b.symbol));
  requests.sort((a, b) => a.slot - b.slot || a.requestId - b.requestId);
  const delays = rows.flatMap((row) => (row.recoveryDelayMs === null ? [] : [row.recoveryDelayMs]));
  const btcDelays = rows.flatMap((row) =>
    row.symbol !== "BTC" || row.recoveryDelayMs === null ? [] : [row.recoveryDelayMs],
  );
  return {
    version: streaming ? 3 : 2,
    protocol: streaming ? "perpl-reader-audit-v3" : "perpl-reader-audit-v2",
    ...(streaming ? { streamEvidence: streamEvidence(capture, cycles) } : {}),
    sourceCommit: hash(capture.commit, 40),
    sourceConfigurationHash: hash(capture.configurationHash, 64),
    acquisitionPolicy: acquisitionPolicy as string,
    startedAt: number(capture.startedAt),
    endsAt: number(capture.endsAt),
    counts: {
      cycles: cycles.length,
      validCycles,
      missedCycles,
      ...(streaming
        ? {
            attemptedCycles: cycles.filter((value) => !object(value).missed).length,
            notAdmittedCycles: cycles.filter(
              (value) => object(value).code === "NOT_ADMITTED_AFTER_INTERRUPTION",
            ).length,
            windowMissedCycles: cycles.filter((value) => object(value).code === "WINDOW_MISSED")
              .length,
          }
        : {}),
      validMarkets: rows.filter((row) => row.finalValid === true).length,
      marketObservations: rows.length,
      ownershipFailures: number(capture.ownershipFailures),
      requestDiagnostics: requests.length,
      http200: requests.filter((r) => r.status === 200).length,
      http400: requests.filter((r) => r.status === 400).length,
      http429: requests.filter((r) => r.status === 429).length,
      noHttpStatus: requests.filter((r) => r.status === null).length,
    },
    recoveryChecks: {
      observations: delays.length,
      medianMs: percentile(delays, 0.5),
      p95Ms: percentile(delays, 0.95),
      btcObservations: btcDelays.length,
      btcMinimumMs: percentile(btcDelays, 0),
      btcMaximumMs: percentile(btcDelays, 1),
    },
    rows,
    requests,
    limitations: [
      "Checks are logical acquisition observations; a second check does not prove a new HTTP request.",
      "Recovery intervals require both source dates; initial ticker-only preparation is excluded.",
      "Historical captures lack explicit cache/network attribution; missing attribution is null.",
      "Repeated source dates do not identify the provider's internal publication or cache policy.",
      "Recorded responses cannot establish what an unmade earlier request would have returned.",
      "Controlled before/after regressions do not establish prospective 29/30 availability or profitability.",
      ...(streaming
        ? [
            "Stream cadence and replay cover only the retained contiguous public capture; truncation never implies missing updates were absent.",
            "Local reception and first valid checks do not establish the exact publication time or source of provider delays.",
          ]
        : []),
    ],
  };
}

function streamEvidence(
  capture: Record<string, unknown>,
  cycles: unknown[],
): NonNullable<UniverseReaderAudit["streamEvidence"]> {
  const stream = object(capture.stream);
  if (
    capture.adapterVersion !== "public-universe-stream-v1" ||
    typeof stream.truncated !== "boolean" ||
    typeof stream.socketClosed !== "boolean" ||
    typeof capture.leaseReleased !== "boolean"
  ) {
    throw new PilotError("INVALID_INPUT", "Missing stream lifecycle evidence");
  }
  const durations = cycles
    .map(object)
    .filter((c) => c.missed === false && c.valid === true)
    .map((c) => number(c.durationMs));
  return {
    adapterVersion: capture.adapterVersion,
    bytes: number(stream.bytes),
    truncated: stream.truncated,
    hash: hash(stream.hash, 64),
    connections: number(stream.connections),
    disconnects: number(stream.disconnects),
    messages: number(stream.messages),
    socketClosed: stream.socketClosed,
    reconstructionErrors: number(capture.reconstructionErrors),
    leaseReleased: capture.leaseReleased,
    acquisitionMs: {
      observations: durations.length,
      median: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
    },
  };
}
