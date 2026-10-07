import { PilotError, type PerpSymbol } from "@pickler/core";
import {
  validatePaperFrame,
  simulatePerpsFill,
  type PerpsPaperFrame,
} from "../perps-paper/simulation.js";
import type { PerpsPaperView } from "../perps-paper/types.js";
import type { PerpsStudyMap } from "./types.js";
import { paperUnits, paperDecimal } from "../perps-paper/decimal.js";
import {
  perpsRules,
  perpsJevDecisions,
  perpsJevReviewed,
  type PerpsJevAnswers,
} from "../perps-strategies/policy.js";
import {
  perpsStrategies,
  type PerpsStudyView,
  type PerpsStudyStrategy,
  type PerpsProposal,
} from "./types.js";

export interface AuditDiagnostic {
  at?: number;
  operation?: string;
  symbol?: string;
  attempt?: number;
  tickerAt?: number;
  bookAt?: number;
  skewMs?: number;
  durationMs?: number;
  status?: number;
  code?: string | null;
  kind?: string;
}
export function canonicalAudit(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalAudit).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalAudit(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function resultObject(value: unknown): { answers?: PerpsJevAnswers; proposals?: PerpsProposal[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PilotError("MODEL_OUTPUT_INVALID", "Missing structured result");
  }
  return value as { answers?: PerpsJevAnswers; proposals?: PerpsProposal[] };
}
function checkedAnswers(value: unknown, review: boolean): PerpsJevAnswers {
  const answers = resultObject(value).answers;
  if (!answers) {
    throw new PilotError("JEV_ANSWERS_INVALID", "Missing answers");
  }
  for (const symbol of ["BTC", "ETH"]) {
    for (const kind of review ? ["identity", "evidence", "costs"] : ["long", "short", "thesis"]) {
      const a = answers[`${symbol}_${kind}`];
      const labels = review
        ? ["CONSISTENT", "CONTRADICTED", "UNKNOWN"]
        : kind === "thesis"
          ? ["INVALIDATED", "INTACT", "UNKNOWN"]
          : ["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "UNKNOWN"];
      if (
        !a ||
        !labels.includes(a.choice) ||
        !Number.isFinite(a.confidence) ||
        a.confidence < 0 ||
        a.confidence > 1 ||
        Object.keys(a.probabilities).length !== labels.length ||
        labels.some(
          (l) =>
            !Number.isFinite(a.probabilities[l]) ||
            a.probabilities[l]! < 0 ||
            a.probabilities[l]! > 1,
        ) ||
        Math.abs(Object.values(a.probabilities).reduce((x, y) => x + y, 0) - 1) > 0.001 ||
        a.probabilities[a.choice]! + 1e-6 < Math.max(...Object.values(a.probabilities))
      ) {
        throw new PilotError("JEV_ANSWERS_INVALID", "Invalid recorded distribution");
      }
    }
  }
  return answers;
}
function proposals(value: unknown): PerpsProposal[] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    new Set(value.map((v) => v?.symbol)).size !== 2 ||
    value.some(
      (v) =>
        !["BTC", "ETH"].includes(v?.symbol) ||
        !["hold", "open-long", "open-short", "close"].includes(v?.action) ||
        typeof v.reason !== "string" ||
        !Array.isArray(v.sourceIds),
    )
  ) {
    throw new PilotError("MODEL_OUTPUT_INVALID", "Invalid recorded proposals");
  }
  return value;
}
function validity(
  frame: PerpsPaperFrame | undefined,
  network: string,
  symbol: PerpSymbol,
  at: number,
) {
  if (!frame) {
    return "NOT_VERIFIABLE";
  }
  try {
    validatePaperFrame(frame, network, symbol, at);
    return "VALID";
  } catch (error) {
    return error instanceof PilotError ? error.code : "NOT_VERIFIABLE";
  }
}
/** Pure replay of frozen policy. It never trades, changes a snapshot or obtains new data. */
export function auditPerpsDecisions(
  study: PerpsStudyView,
  diagnostics: AuditDiagnostic[],
  hash: (v: unknown) => string,
  accounts?: PerpsStudyMap<PerpsPaperView>,
) {
  const { record, rounds, events } = study;
  const candleHistory = new Map<string, { hash: string; last: number | null }>();
  const slots = Array.from({ length: record.config.hours * 4 }, (_, slot) => slot);
  const rows = slots.flatMap((slot) => {
    const slotRows = [];
    const round = rounds.find((r) => r.slot === slot);
    const omitted = events.find(
      (e) => e.kind === "data-unavailable" && (e.data as { slot?: number }).slot === slot,
    );
    const omission = omitted?.data as { phase?: string; cause?: string } | undefined;
    const initialAt = round?.evidence?.observedAt;
    const refreshed = events.find((e) => e.key === `${round?.key}:execution-input`);
    const frames = (refreshed?.data as { frames?: PerpsPaperFrame[] } | undefined)?.frames;
    const start = (record.startedAt ?? 0) + slot * 900000;
    const end = start + 900000;
    const local = diagnostics.filter((d) => d.at !== undefined && d.at >= start && d.at < end);
    // Time-correlated evidence, not a fabricated request/episode identifier.
    const omissionDiagnostics = omitted
      ? local.filter((d) => d.at! <= omitted.at && d.at! >= omitted.at - 20000)
      : [];
    for (const symbol of ["BTC", "ETH"] as const) {
      const initial = round?.evidence?.frames?.find((f) => f?.snapshot?.market?.symbol === symbol);
      const final = frames?.find((f) => f?.snapshot?.market?.symbol === symbol);
      const series = round?.evidence?.candles?.find((c) => c?.market?.symbol === symbol);
      const candles = series?.candles ?? [];
      const candleHash = series ? hash(series.candles) : null;
      const previous = candleHistory.get(symbol);
      const last = candles.at(-1)?.openTime ?? null;
      const candleState =
        !series || initialAt === undefined
          ? "NOT_VERIFIABLE"
          : series.resolution !== 3600 ||
              series.market.provenance.network !== record.config.network ||
              (initial !== undefined &&
                (series.market.marketId !== initial.snapshot.market.marketId ||
                  series.market.perpetualId !== initial.snapshot.market.perpetualId ||
                  series.market.configVersion !== initial.snapshot.market.configVersion)) ||
              !Array.isArray(series.missingOpenTimes) ||
              series.missingOpenTimes.length ||
              candles.length !== 60 ||
              candles.some(
                (c, i) =>
                  !c.closed ||
                  c.openTime + 3600000 > initialAt ||
                  (i > 0 && c.openTime - candles[i - 1]!.openTime !== 3600000),
              )
            ? "INVALID_CANDLES"
            : last! + 3600000 !== Math.floor(initialAt / 3600000) * 3600000
              ? "STALE_CANDLES"
              : "VALID";
      const repeat = !!candleHash && previous?.hash === candleHash;
      const closed = candles
        .filter((c) => c.closed && c.openTime + 3600000 <= (initialAt ?? 0))
        .slice(-50);
      const sma20 =
        closed.length === 50
          ? paperDecimal(closed.slice(-20).reduce((s, c) => s + paperUnits(c.close), 0n) / 20n)
          : null;
      const sma50 =
        closed.length === 50
          ? paperDecimal(closed.reduce((s, c) => s + paperUnits(c.close), 0n) / 50n)
          : null;
      for (const strategy of perpsStrategies(record.config)) {
        const context =
          round?.evidence &&
          Array.isArray(round.evidence.frames) &&
          Array.isArray(round.evidence.candles) &&
          Array.isArray(round.accounts?.[strategy]?.positions)
            ? { evidence: round.evidence, account: round.accounts[strategy]! }
            : null;
        const recorded = round?.proposals?.[strategy]?.find((p) => p.symbol === symbol);
        let recalculated: PerpsProposal | undefined;
        let conversion = "NOT_VERIFIABLE";
        let original: PerpsProposal | undefined;
        let answers: PerpsJevAnswers | undefined;
        try {
          if (context) {
            let replay: PerpsProposal[];
            if (strategy === "rules") {
              replay = perpsRules(context);
            } else if (strategy === "jev" && record.config.version === 2) {
              answers = checkedAnswers(round!.calls.jev?.result, false);
              replay = perpsJevDecisions(context, answers);
              const saved = proposals(resultObject(round!.calls.jev?.result).proposals);
              if (canonicalAudit(saved) !== canonicalAudit(replay)) {
                conversion = "RESULT_DIVERGENCE";
              }
            } else if (strategy === "combined") {
              answers = checkedAnswers(round!.calls.review?.result, true);
              const proposed = proposals(round!.calls.fallback?.result);
              original = proposed.find((p) => p.symbol === symbol);
              replay = perpsJevReviewed(proposed, answers);
              if (
                canonicalAudit(proposals(resultObject(round!.calls.review?.result).proposals)) !==
                canonicalAudit(replay)
              ) {
                conversion = "RESULT_DIVERGENCE";
              }
            } else if (strategy === "deepseek") {
              replay = proposals(round!.calls.direct?.result);
              original = replay.find((p) => p.symbol === symbol);
            } else {
              // Legacy routing is retained as observed; do not invent a four-way interpretation.
              replay = [];
            }
            recalculated = replay.find((p) => p.symbol === symbol);
            if (recalculated && recorded && conversion !== "RESULT_DIVERGENCE") {
              conversion =
                canonicalAudit(recalculated) === canonicalAudit(recorded)
                  ? "MATCH"
                  : "PROPOSAL_DIVERGENCE";
            }
          }
        } catch (error) {
          conversion = error instanceof PilotError ? error.code : "NOT_VERIFIABLE";
        }
        const executions = events.filter(
          (e) =>
            e.kind === "execution" &&
            e.key.startsWith(`${strategy}:${round?.key}:`) &&
            (e.data as { proposal?: PerpsProposal }).proposal?.symbol === symbol,
        );
        const execution = executions.map((e) => ({ key: e.key, at: e.at, data: e.data }));
        const callLanes =
          strategy === "deepseek"
            ? ["direct"]
            : strategy === "jev"
              ? record.config.version === 2
                ? ["jev"]
                : ["jev", "fallback"]
              : strategy === "combined"
                ? ["fallback", "review"]
                : [];
        const marketChanges =
          initial &&
          final &&
          validity(initial, record.config.network, symbol, initialAt!) === "VALID" &&
          validity(final, record.config.network, symbol, refreshed!.at) === "VALID"
            ? {
                markDelta: paperDecimal(
                  paperUnits(final.snapshot.ticker.mark) - paperUnits(initial.snapshot.ticker.mark),
                ),
                tickerAgeInitialMs:
                  initialAt! - initial.snapshot.ticker.provenance.providerTimestamp!,
                tickerAgeFinalMs:
                  refreshed!.at - final.snapshot.ticker.provenance.providerTimestamp!,
                bookAgeInitialMs: initialAt! - initial.book.provenance.providerTimestamp!,
                bookAgeFinalMs: refreshed!.at - final.book.provenance.providerTimestamp!,
                initialSkewMs: Math.abs(
                  initial.snapshot.ticker.provenance.providerTimestamp! -
                    initial.book.provenance.providerTimestamp!,
                ),
                finalSkewMs: Math.abs(
                  final.snapshot.ticker.provenance.providerTimestamp! -
                    final.book.provenance.providerTimestamp!,
                ),
                bookChanged: hash(initial.book) !== hash(final.book),
                initialSpread:
                  initial.book.asks.length && initial.book.bids.length
                    ? paperDecimal(
                        paperUnits(initial.book.asks[0]!.price) -
                          paperUnits(initial.book.bids[0]!.price),
                      )
                    : null,
                finalSpread:
                  final.book.asks.length && final.book.bids.length
                    ? paperDecimal(
                        paperUnits(final.book.asks[0]!.price) -
                          paperUnits(final.book.bids[0]!.price),
                      )
                    : null,
                initialBidDepth: paperDecimal(
                  initial.book.bids.reduce((s, l) => s + paperUnits(l.size), 0n),
                ),
                initialAskDepth: paperDecimal(
                  initial.book.asks.reduce((s, l) => s + paperUnits(l.size), 0n),
                ),
                finalBidDepth: paperDecimal(
                  final.book.bids.reduce((s, l) => s + paperUnits(l.size), 0n),
                ),
                finalAskDepth: paperDecimal(
                  final.book.asks.reduce((s, l) => s + paperUnits(l.size), 0n),
                ),
                fundingChanged: hash(initial.snapshot.funding) !== hash(final.snapshot.funding),
              }
            : null;
        const calls = callLanes
          .map((lane) => round?.calls?.[lane as keyof typeof round.calls])
          .filter((c) => !!c);
        const trace = execution.map((event) => {
          const attemptKey = event.key.slice(strategy.length + 1);
          const attempt = accounts?.[strategy]?.attempts.find((a) => a.key === attemptKey);
          let simulation = "NOT_VERIFIABLE";
          if (attempt?.status === "filled" && context && final && attempt.finishedAt !== null) {
            try {
              const fill = simulatePerpsFill(
                context.account,
                attempt.intent,
                final,
                attempt.finishedAt,
              );
              simulation =
                hash(fill.evidence) === hash(attempt.evidence) ? "MATCH" : "FILL_DIVERGENCE";
            } catch (error) {
              simulation = error instanceof PilotError ? error.code : "NOT_VERIFIABLE";
            }
          }
          return {
            ...event,
            attempt: attempt ?? null,
            simulation,
            riskReplay: "NOT_VERIFIABLE_WITHOUT_EXECUTION_TIME_ACCOUNT_AND_PENDING_ATTEMPTS",
          };
        });
        const noPositionClose =
          recorded?.action === "close" &&
          context &&
          !context.account.positions.some((p) => p.symbol === symbol && p.closedAt === null);
        const admittedActionMissing =
          recorded &&
          recorded.action !== "hold" &&
          round?.executionStatus === "complete" &&
          !execution.length &&
          !noPositionClose;
        slotRows.push({
          slot,
          symbol,
          strategy: strategy as PerpsStudyStrategy,
          executionStatus:
            round?.executionStatus ?? (omitted ? "skipped_data_unavailable" : "NOT_VERIFIABLE"),
          phase: omission?.phase ?? null,
          cause: omission?.cause ?? null,
          initialAt: initialAt ?? null,
          finalAt: refreshed?.at ?? null,
          initialValidity:
            initialAt === undefined
              ? "NOT_VERIFIABLE"
              : validity(initial, record.config.network, symbol, initialAt),
          finalValidity: refreshed
            ? validity(final, record.config.network, symbol, refreshed.at)
            : "NOT_VERIFIABLE",
          candles: {
            resolution: series?.resolution ?? null,
            count: candles.length,
            first: candles[0]?.openTime ?? null,
            last,
            validity: candleState,
            hash: candleHash,
            repeated: repeat,
            repeatInterpretation: repeat
              ? candleState === "VALID"
                ? "EXPECTED_SAME_HOUR"
                : "NOT_VERIFIABLE_OR_STALE"
              : "CHANGED_OR_FIRST",
            sma20,
            sma50,
          },
          marketChanges,
          initialMarket: initial ?? null,
          finalMarket: final ?? null,
          originalProposal: original ?? recorded ?? null,
          recordedProposal: recorded ?? null,
          recalculatedProposal: recalculated ?? null,
          conversion,
          answers: answers
            ? Object.fromEntries(
                Object.entries(answers).filter(([k]) => k.startsWith(`${symbol}_`)),
              )
            : null,
          execution: trace,
          executionExplanation: noPositionClose ? "NO_POSITION_CLOSE_NOT_EXECUTED" : null,
          unexplainedAction: !!admittedActionMissing,
          calls: calls.map((c) => ({
            lane: c!.lane,
            status: c!.status,
            error: c!.error,
            requestHash: c!.requestHash ?? null,
            inputBytes: c!.inputBytes ?? null,
            inputTokens: c!.inputTokens,
            outputTokens: c!.outputTokens,
            costUsd: c!.costUsd,
            reservationUsd: c!.reservationUsd,
            latencyMs:
              c!.startedAt !== null && c!.finishedAt !== null
                ? c!.finishedAt! - c!.startedAt!
                : null,
          })),
          diagnostics: omissionDiagnostics.filter((d) => d.symbol === symbol),
          diagnosis: omission
            ? "DATA_UNAVAILABLE"
            : conversion !== "MATCH"
              ? "NOT_VERIFIABLE_OR_DIVERGENCE"
              : recorded?.action === "hold"
                ? "VALID_POLICY_HOLD"
                : "RECORDED_ACTION",
        });
      }
      if (candleHash) {
        candleHistory.set(symbol, { hash: candleHash, last });
      }
    }
    return slotRows;
  });
  return {
    version: 1 as const,
    protocol: "perps-decision-audit-v1",
    sessionId: record.config.sessionId,
    originalMetadata: record.metadata,
    completeSlots: rounds.filter((r) => r.executionStatus === "complete").map((r) => r.slot),
    omissions: events.filter((e) => e.kind === "data-unavailable"),
    summary: {
      policyMatches: rows.filter((r) => r.conversion === "MATCH").length,
      divergences: rows.filter((r) => r.conversion.includes("DIVERGENCE")).length,
      unexplainedActions: rows.filter((r) => r.unexplainedAction).length,
      validModelHolds: rows.filter(
        (r) =>
          r.strategy !== "rules" &&
          r.conversion === "MATCH" &&
          r.recordedProposal?.action === "hold",
      ).length,
      uniqueCandleSets: Object.fromEntries(
        (["BTC", "ETH"] as const).map((symbol) => [
          symbol,
          new Set(
            rows.filter((r) => r.symbol === symbol && r.candles.hash).map((r) => r.candles.hash),
          ).size,
        ]),
      ),
      omissions: events
        .filter((e) => e.kind === "data-unavailable")
        .map((e) => {
          const episode = diagnostics.filter(
            (d) => d.at !== undefined && d.at <= e.at && d.at >= e.at - 20000 && d.symbol,
          );
          return {
            key: e.key,
            at: e.at,
            data: e.data,
            correlation: "TIMESTAMP_WINDOW_PRECEDING_EVENT_NOT_REQUEST_ID",
            acquisitionLimitMs: 20000,
            requestDuration: "NOT_VERIFIABLE",
            attemptsObserved: episode.length,
            firstDiagnosticAt: episode[0]?.at ?? null,
            lastDiagnosticAt: episode.at(-1)?.at ?? null,
            bySymbol: Object.fromEntries(
              (["BTC", "ETH"] as const).map((symbol) => {
                const items = episode.filter((d) => d.symbol === symbol);
                return [
                  symbol,
                  {
                    samples: items.length,
                    validSamples: items.filter((d) => d.code === null).length,
                    maximumSkewMs: items.length
                      ? Math.max(...items.map((d) => d.skewMs ?? 0))
                      : null,
                    tickerTimestamps: [...new Set(items.map((d) => d.tickerAt))],
                    codes: [...new Set(items.map((d) => d.code))],
                  },
                ];
              }),
            ),
          };
        }),
    },
    rows,
    limitations: [
      "Recorded context is not a byte-identical model request; request hashes cannot reconstruct missing bytes.",
      "A valid hold demonstrates policy compliance, not that avoiding a trade was economically optimal.",
      "Repeated closed hourly candles within one hour are expected. No future evidence is used.",
      "Diagnostic rows without timestamps cannot be assigned to an omission; provider-request timing remains unavailable.",
      "Historical execution and costs are unchanged. Controlled fills are not live model decisions.",
    ],
  };
}
