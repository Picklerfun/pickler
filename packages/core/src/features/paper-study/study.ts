import {
  PilotError,
  type Market,
  type OrderBook,
  type ModelAssessment,
  type Source,
  type DecisionV2,
} from "../research/types.js";
import { evaluateDecision } from "../research/decision-policy.js";
import { assertPaperMarket } from "../paper/sports.js";
import { simulatePaperBuy, type PaperConditions, type PaperOrder } from "../paper/orders.js";
import { settlePaperOrder, type PaperResolution } from "../paper/settlement.js";
import { marketExclusion } from "../research/eligibility.js";

export const STUDY_PLUGINS = [
  {
    id: "polymarket",
    version: "1.0.0",
    capabilities: ["discovery", "quotes", "resolution"],
    credentials: [],
  },
  { id: "coinbase", version: "1.0.0", capabilities: ["btc-reference-candles"], credentials: [] },
  { id: "exa", version: "1.0.0", capabilities: ["sports-research"], credentials: ["EXA_API_KEY"] },
] as const;
export type StudyKind = "btc-5m" | "btc-15m" | "sports";
export type StudyPlugin = (typeof STUDY_PLUGINS)[number]["id"];
export interface StudyConfig {
  version: 1;
  id: string;
  hours: number;
  settlementGraceHours: number;
  maxCases: number;
  maxApiUsd: number;
  pricing: { inputPerMillion: number; outputPerMillion: number; exaPerSearch: number } | null;
  agents: { kind: StudyKind; enabled: boolean; plugins: StudyPlugin[] }[];
}
export interface StudyMarket {
  kind: StudyKind;
  market: Market;
  windowStart: number | null;
  windowEnd: number;
  slug: string;
}
export interface StudyEvidence {
  sources: Source[];
  books: OrderBook[];
  limitations: string[];
}
export interface StudyUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  exaReportedUsd: number | null;
}
export interface StudyCase {
  id: string;
  kind: StudyKind;
  marketId: string;
  startedAt: number;
  finishedAt: number | null;
  status: "started" | "abstained" | "filled" | "not_filled" | "failed" | "interrupted";
  reservedApiUsd: number;
  usage: StudyUsage;
  snapshot: StudyMarket;
  evidence?: StudyEvidence;
  decision?: DecisionV2;
  paper?: PaperOrder;
  reason: string | null;
  checkedAt: number | null;
  nextCheckAt: number;
  resolutionAttempts: number;
  resolutionError: string | null;
}
export interface StudyState {
  plugins?: typeof STUDY_PLUGINS;
  version: 1;
  config: StudyConfig;
  createdAt: number;
  updatedAt: number;
  cases: StudyCase[];
  events: { time: number; kind: StudyKind | "session"; code: string }[];
  model: { id: string; promptVersion: string; promptHash: string } | null;
}
export interface StudyPorts {
  now(): number;
  save(): Promise<void>;
  guard(kind: StudyKind, plugin?: StudyPlugin): Promise<void>;
  discover(kind: StudyKind, signal: AbortSignal): Promise<StudyMarket[]>;
  evidence(
    market: StudyMarket,
    signal: AbortSignal,
    onUsage: (usd: number | null) => Promise<void>,
  ): Promise<StudyEvidence>;
  forecast(
    market: StudyMarket,
    evidence: StudyEvidence,
    signal: AbortSignal,
    usage: (data: StudyUsage) => Promise<void>,
  ): Promise<ModelAssessment>;
  refresh(market: StudyMarket, signal: AbortSignal): Promise<StudyMarket>;
  book(outcomeId: string, signal: AbortSignal): Promise<OrderBook>;
  conditions(marketId: string, outcomeId: string, signal: AbortSignal): Promise<PaperConditions>;
  resolution(
    order: PaperOrder,
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<PaperResolution | null>;
}
/** USD is a conservative configured-rate reservation, never an assertion of billed cost. */
export function caseReservation(config: StudyConfig, kind: StudyKind): number {
  if (!config.pricing) {
    throw new PilotError("STUDY_PRICING_REQUIRED", "Set provider rates before paid execution");
  }
  const { inputPerMillion, outputPerMillion, exaPerSearch } = config.pricing;
  const calls = kind === "sports" ? 2 : 1;
  // Input is byte-bounded by the runtime; reserve extra space for SDK formatting/schema.
  return (
    (calls * (65536 * inputPerMillion + 4096 * outputPerMillion)) / 1e6 +
    (kind === "sports" ? 2 * exaPerSearch : 0)
  );
}
export function assertStudyMarket(item: StudyMarket, now: number): void {
  const market = item.market;
  if (
    !market.active ||
    !market.rules.trim() ||
    item.windowEnd <= now ||
    !Number.isFinite(item.windowEnd)
  ) {
    throw new PilotError("STUDY_MARKET_CLOSED", "Market is not eligible");
  }
  if (item.kind === "sports") {
    assertPaperMarket(market);
    const reason = marketExclusion(market, now, {
      version: 1,
      mode: "pre-event",
      minLeadMinutes: 15,
      maxHorizonDays: 7,
    });
    if (reason) {
      throw new PilotError(reason, "Sporting event no longer eligible");
    }
    return;
  }
  const minutes = item.kind === "btc-5m" ? 5 : 15;
  const start = item.windowStart;
  if (
    start === null ||
    !Number.isFinite(start) ||
    start % (minutes * 60000) !== 0 ||
    item.windowEnd !== start + minutes * 60000 ||
    item.slug !== `btc-updown-${minutes}m-${start / 1000}` ||
    now < start ||
    item.windowEnd - now < 90000 ||
    Date.parse(market.closesAt ?? "") !== item.windowEnd ||
    market.outcomes.length !== 2 ||
    new Set(market.outcomes.map((o) => o.label.toLowerCase())).size !== 2 ||
    !market.outcomes.every((o) => ["up", "down"].includes(o.label.toLowerCase())) ||
    !/bitcoin/i.test(market.question) ||
    !/chainlink/i.test(market.rules) ||
    !/greater than or equal/i.test(market.rules)
  ) {
    throw new PilotError(
      "STUDY_CRYPTO_RULES",
      "Requires a verified BTC 5/15 minute Up/Down window and reviewed Chainlink tie rule",
    );
  }
}
export function recoverStudy(state: StudyState, now: number): void {
  for (const row of state.cases) {
    if (row.status === "started") {
      row.status = "interrupted";
      row.reason = "INTERRUPTED";
      row.finishedAt = now;
    }
  }
}
function code(error: unknown): string {
  return error instanceof PilotError ? error.code : "STUDY_PROVIDER_FAILURE";
}
export async function runStudyCase(
  state: StudyState,
  item: StudyMarket,
  ports: StudyPorts,
): Promise<void> {
  const now = ports.now();
  assertStudyMarket(item, now);
  if (state.cases.some((row) => row.marketId === item.market.id)) {
    return;
  }
  const reservation = caseReservation(state.config, item.kind);
  if (
    now >= state.createdAt + state.config.hours * 3600000 ||
    state.cases.length >= state.config.maxCases ||
    state.cases.reduce((sum, row) => sum + row.reservedApiUsd, 0) + reservation >
      state.config.maxApiUsd ||
    (item.kind === "sports" &&
      state.cases.filter((row) => row.kind === "sports" && row.startedAt > now - 86400000).length >=
        6)
  ) {
    return;
  }
  await ports.guard(item.kind, "polymarket");
  await ports.guard(item.kind, item.kind === "sports" ? "exa" : "coinbase");
  const row: StudyCase = {
    id: `${state.config.id}:${item.market.id}`,
    kind: item.kind,
    marketId: item.market.id,
    startedAt: now,
    finishedAt: null,
    status: "started",
    reservedApiUsd: reservation,
    usage: { inputTokens: null, outputTokens: null, exaReportedUsd: null },
    snapshot: item,
    reason: null,
    checkedAt: null,
    nextCheckAt: item.windowEnd,
    resolutionAttempts: 0,
    resolutionError: null,
  };
  state.cases.push(row);
  await ports.save(); // Persist before any paid request. Interrupted attempts are never replayed.
  const signal = AbortSignal.timeout(item.kind === "sports" ? 240000 : 45000);
  try {
    row.evidence = await ports.evidence(item, signal, async (usd) => {
      row.usage.exaReportedUsd = usd;
      await ports.save();
    });
    await ports.save();
    await ports.guard(item.kind);
    const assessment = await ports.forecast(item, row.evidence, signal, async (usage) => {
      row.usage.inputTokens = usage.inputTokens;
      row.usage.outputTokens = usage.outputTokens;
      await ports.save();
    });
    if (
      assessment.marketId !== item.market.id ||
      (assessment.outcomeId !== null &&
        !item.market.outcomes.some((o) => o.id === assessment.outcomeId)) ||
      !assessment.sourceIds.length ||
      assessment.sourceIds.some((id) => !row.evidence!.sources.some((source) => source.id === id))
    ) {
      throw new PilotError("INVALID_DECISION", "Unattributed or mismatched forecast");
    }
    await ports.guard(item.kind, "polymarket");
    const refreshed = await ports.refresh(item, signal);
    if (
      refreshed.market.rules !== item.market.rules ||
      JSON.stringify(refreshed.market.outcomes) !== JSON.stringify(item.market.outcomes)
    ) {
      throw new PilotError("STUDY_RULES_CHANGED", "Market rules changed during research");
    }
    assertStudyMarket(refreshed, ports.now());
    let book: OrderBook | null = null;
    if (assessment.action === "TRADE") {
      if (
        !assessment.outcomeId ||
        !assessment.expiresAt ||
        !Number.isFinite(Date.parse(assessment.expiresAt)) ||
        Date.parse(assessment.expiresAt) <= ports.now() ||
        Date.parse(assessment.expiresAt) > item.windowEnd
      ) {
        throw new PilotError("INVALID_DECISION", "Expired or incomplete trade proposal");
      }
      await ports.guard(item.kind, "polymarket");
      book = await ports.book(assessment.outcomeId, signal);
      if (!book.asks[0]) {
        throw new PilotError("NO_QUOTE", "No current ask");
      }
    }
    row.decision = evaluateDecision(
      assessment,
      book?.asks[0]?.price ?? null,
      undefined,
      ports.now(),
    );
    await ports.save();
    if (row.decision.action === "ABSTAIN") {
      row.status = "abstained";
      row.reason = row.decision.abstentionReason;
    } else {
      await ports.guard(item.kind, "polymarket");
      const conditions = await ports.conditions(item.market.id, assessment.outcomeId!, signal);
      assertStudyMarket(refreshed, ports.now());
      if (Date.parse(assessment.expiresAt!) <= ports.now()) {
        throw new PilotError("STUDY_EXPIRED", "Proposal expired before virtual fill");
      }
      const simulation = simulatePaperBuy(
        refreshed.market,
        book!,
        conditions,
        assessment.limitPrice!,
        ports.now(),
      );
      await ports.guard(item.kind);
      signal.throwIfAborted();
      row.status = simulation.fill ? "filled" : "not_filled";
      row.reason = simulation.reason;
      if (simulation.fill) {
        row.paper = {
          id: row.id,
          tenantId: `local-study:${state.config.id}`,
          agentId: item.kind,
          runId: row.id,
          marketId: item.market.id,
          outcomeId: assessment.outcomeId!,
          status: "filled",
          virtualBudget: "10",
          createdAt: now,
          finishedAt: ports.now(),
          reason: null,
          fill: simulation.fill,
          settlement: null,
        };
      }
    }
  } catch (error) {
    row.status = "failed";
    row.reason = code(error);
  }
  row.finishedAt = ports.now();
  state.updatedAt = ports.now();
  await ports.save();
}
export async function settleStudy(state: StudyState, ports: StudyPorts): Promise<void> {
  const due = state.cases
    .filter((row) => row.paper && !row.paper.settlement && row.nextCheckAt <= ports.now())
    .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
    .slice(0, 3);
  for (const row of due) {
    const signal = AbortSignal.timeout(55000);
    const guard = () => ports.guard(row.kind, "polymarket");
    try {
      await guard();
      const result = await ports.resolution(row.paper!, signal, guard);
      await guard();
      signal.throwIfAborted();
      if (result) {
        row.paper!.settlement = settlePaperOrder(row.paper!, result, ports.now());
      }
      row.resolutionError = null;
    } catch (error) {
      row.resolutionError = code(error);
    }
    row.checkedAt = ports.now();
    row.resolutionAttempts++;
    row.nextCheckAt =
      ports.now() + Math.min(900000, 60000 * 2 ** Math.min(row.resolutionAttempts - 1, 4));
    await ports.save();
  }
}
