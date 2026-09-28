import { PilotError } from "../research/types.js";
import { simulatePaperBuy } from "../paper/orders.js";
import {
  comparisonReviewKey,
  settleComparisonCase,
  type ComparisonCase,
  type ComparisonSlot,
  type PolicyDecision,
} from "./comparison.js";
import {
  quantForecast,
  quantProposal,
  type QuantInput,
  type QuantForecast,
  type QuantProposal,
  type QuantReview,
} from "./quant.js";
import { sameQuantMarket, type QuantPorts } from "./quant-session.js";
import type { StudyMarket } from "./study.js";

export const BENCHMARK_PROTOCOL = "btc-decision-benchmark-v1" as const;
export const BENCHMARK_VARIANTS = [
  { id: "A", policy: "conservative-v1", reviewer: "current" },
  { id: "B", policy: "central-v1", reviewer: "current" },
  { id: "C", policy: "central-v1", reviewer: "compact" },
  { id: "D", policy: "central-v1", reviewer: null },
] as const;
export type BenchmarkVariant = (typeof BENCHMARK_VARIANTS)[number]["id"];
export type BenchmarkReviewer = "current" | "compact";
export interface BenchmarkDecision extends PolicyDecision {
  variant: BenchmarkVariant;
  finalEdge?: number;
  edgeChange?: number;
  priceChange?: number;
}
export interface BenchmarkReview {
  id: string;
  phase: "contract" | "development" | "heldout" | "prospective";
  caseId: string;
  reviewer: BenchmarkReviewer;
  version: string;
  contextHash: string;
  reservedUsd: number;
  startedAt: number | null;
  result?: QuantReview;
}
export interface BenchmarkCase extends Omit<ComparisonCase, "policies" | "reviews"> {
  variants: BenchmarkDecision[];
  reviewIds: string[];
  reviewedAt?: number;
  refreshedAt?: number;
  waitMs?: number;
}
export interface BenchmarkState {
  version: 4;
  protocol: typeof BENCHMARK_PROTOCOL;
  id: string;
  createdAt: number;
  deadline: number | null;
  settlementDeadline: number | null;
  priorReservedUsd: number;
  priorBenchmarkReservedUsd?: number;
  priorBenchmarkReviewCount?: number;
  maxNewReservedUsd: number;
  jevInputPerMillion: number;
  paidStopped: string | null;
  evaluation: "pending" | "started" | "completed" | "failed";
  reviews: BenchmarkReview[];
  cases: BenchmarkCase[];
  slots: ComparisonSlot[];
  interruptions: { at: number; gapMs: number }[];
}
export interface BenchmarkPorts extends Omit<QuantPorts, "review"> {
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
  hash(value: string): Promise<string>;
  versions: Record<BenchmarkReviewer, string>;
  review(
    reviewer: BenchmarkReviewer,
    input: QuantInput,
    forecast: QuantForecast,
    proposal: QuantProposal,
    signal: AbortSignal,
    report: (result: QuantReview) => Promise<void>,
  ): Promise<QuantReview>;
}
export function benchmarkReserved(state: BenchmarkState): number {
  return state.reviews.reduce((sum, review) => sum + review.reservedUsd, 0);
}
/** Explicit host recovery under the writer lock. Never retries or releases reservations. */
export function recoverBenchmark(state: BenchmarkState, now: number): void {
  let interrupted = state.evaluation === "started";
  if (interrupted) {
    state.evaluation = "failed";
  }
  for (const review of state.reviews) {
    if (review.startedAt !== null && review.result?.status === "started") {
      review.result = { ...review.result, status: "failed", reason: "INTERRUPTED" };
      interrupted = true;
    }
  }
  for (const row of state.cases.filter((r) => r.status === "started")) {
    interrupted = true;
    row.status = "interrupted";
    row.reason = "INTERRUPTED";
    row.finishedAt = now;
    for (const d of row.variants.filter((d) => d.status === "pending")) {
      d.status = "blocked";
      d.reasons = ["INTERRUPTED"];
    }
  }
  for (const slot of state.slots) {
    if (slot.status === "started") {
      slot.status = "interrupted";
      slot.reason = "INTERRUPTED";
      interrupted = true;
    } else if (slot.status === "pending" && now > slot.start + 90000) {
      slot.status = "missed";
      slot.reason = "ADMISSION_WINDOW_MISSED";
    }
  }
  if (interrupted) {
    state.paidStopped ??= "INTERRUPTED";
    state.interruptions.push({ at: now, gapMs: 0 });
  }
}
export type ReviewRequest = Pick<
  BenchmarkReview,
  "id" | "phase" | "caseId" | "reviewer" | "version" | "contextHash"
>;
/** All-or-none durable reservations; never release an unused or failed reservation. */
export async function reserveBenchmarkReviews(
  state: BenchmarkState,
  requests: ReviewRequest[],
  ports: Pick<BenchmarkPorts, "exclusive" | "save">,
): Promise<boolean> {
  return ports.exclusive(async () => {
    if (
      new Set(requests.map((r) => r.id)).size !== requests.length ||
      requests.some((r) => state.reviews.some((s) => s.id === r.id))
    ) {
      throw new PilotError("REVIEW_ALREADY_RESERVED", "No repeated reviews");
    }
    const perCall = (65536 * state.jevInputPerMillion) / 1e6;
    const total = benchmarkReserved(state) + perCall * requests.length;
    if (
      state.paidStopped ||
      !(perCall > 0) ||
      total > Math.min(1.25, state.maxNewReservedUsd) + 1e-12 ||
      total + (state.priorBenchmarkReservedUsd ?? 0) > 1.25 + 1e-12 ||
      state.priorReservedUsd + total > 5 + 1e-12 ||
      state.reviews.length + requests.length + (state.priorBenchmarkReviewCount ?? 0) > 386
    ) {
      state.paidStopped ??= "API_BUDGET_EXHAUSTED";
      await ports.save();
      return false;
    }
    state.reviews.push(...requests.map((r) => ({ ...r, reservedUsd: perCall, startedAt: null })));
    await ports.save();
    return true;
  });
}
export async function performBenchmarkReview(
  state: BenchmarkState,
  review: BenchmarkReview,
  input: QuantInput,
  forecast: QuantForecast,
  proposal: QuantProposal,
  ports: BenchmarkPorts,
  signal: AbortSignal,
): Promise<void> {
  if (state.paidStopped) {
    return;
  }
  if (review.startedAt !== null) {
    throw new PilotError("REVIEW_ALREADY_STARTED", "No repeated calls");
  }
  try {
    await ports.guard("jev");
    signal.throwIfAborted();
    if (state.paidStopped) {
      return;
    }
    review.startedAt = ports.now();
    review.result = { status: "started", inputTokens: null, outputTokens: null };
    await ports.save();
    review.result = await ports.review(
      review.reviewer,
      input,
      forecast,
      proposal,
      signal,
      async (r) => {
        review.result = structuredClone(r);
        await ports.save();
      },
    );
    if (
      review.result.status !== "completed" ||
      review.result.inputTokens === null ||
      review.result.outputTokens === null
    ) {
      throw new PilotError("JEV_REVIEW_INCOMPLETE", "Incomplete review");
    }
  } catch (error) {
    state.paidStopped ??= error instanceof PilotError ? error.code : "JEV_REVIEW_FAILED";
    review.result = {
      ...review.result,
      status: "failed",
      inputTokens: review.result?.inputTokens ?? null,
      outputTokens: review.result?.outputTokens ?? null,
      reason: state.paidStopped,
    };
  }
  await ports.save();
}
function assertInput(item: StudyMarket, input: QuantInput, original?: QuantInput) {
  if (
    !sameQuantMarket(item.market, input.item.market) ||
    input.item.windowStart !== item.windowStart ||
    input.item.windowEnd !== item.windowEnd ||
    (original &&
      (input.rule.lookbackSeconds !== original.rule.lookbackSeconds ||
        input.opening.price !== original.opening.price ||
        JSON.stringify(input.conditions.map((c) => c.resolution)) !==
          JSON.stringify(original.conditions.map((c) => c.resolution))))
  ) {
    throw new PilotError("QUANT_INPUT_IDENTITY", "Snapshot identity changed");
  }
}
export async function runBenchmarkCase(
  state: BenchmarkState,
  item: StudyMarket,
  ports: BenchmarkPorts,
): Promise<void> {
  const now = ports.now();
  if (
    item.kind === "sports" ||
    item.windowStart === null ||
    now < item.windowStart + 60000 ||
    now > item.windowStart + 90000 ||
    item.windowEnd - now < 90000
  ) {
    return;
  }
  const row = await ports.exclusive(async () => {
    if (
      state.deadline === null ||
      now >= state.deadline ||
      state.cases.some((c) => c.marketId === item.market.id) ||
      state.cases.filter((c) => c.kind === item.kind).length >= (item.kind === "btc-5m" ? 72 : 24)
    ) {
      return null;
    }
    const record: BenchmarkCase = {
      id: `${state.id}:${item.market.id}`,
      marketId: item.market.id,
      kind: item.kind as "btc-5m" | "btc-15m",
      startedAt: now,
      finishedAt: null,
      status: "started",
      reason: null,
      variants: BENCHMARK_VARIANTS.map((v) => ({
        variant: v.id,
        policy: v.policy,
        status: "pending",
        reasons: [],
      })),
      reviewIds: [],
      resolutions: [],
      nextResolutionAt: item.windowEnd,
    };
    state.cases.push(record);
    await ports.save();
    return record;
  });
  if (!row) {
    return;
  }
  const signal = AbortSignal.timeout(120000);
  try {
    await ports.guard("polymarket");
    await ports.guard("coinbase");
    row.input = await ports.input(item, signal);
    assertInput(item, row.input);
    row.forecast = quantForecast(row.input, ports.now());
    row.identities = row.input.conditions.map((c) => {
      if (!c.resolution) {
        throw new PilotError("QUANT_RESOLUTION_IDENTITY", "Missing identity");
      }
      return { ...c.resolution, marketId: row.marketId, outcomeId: c.outcomeId };
    });
    for (const decision of row.variants) {
      const selected = quantProposal(row.input, row.forecast, ports.now(), decision.policy);
      if (selected.proposal) {
        decision.proposal = selected.proposal;
      }
      decision.reasons = selected.reasons;
      if (!selected.proposal) {
        decision.status = "abstained";
      }
    }
    await ports.save();
    const proposed = row.variants.filter((d) => d.proposal);
    if (!proposed.length) {
      return;
    }
    const requests: ReviewRequest[] = [];
    for (const d of proposed) {
      const reviewer = BENCHMARK_VARIANTS.find((v) => v.id === d.variant)!.reviewer;
      if (!reviewer) {
        continue;
      }
      const contextHash = await ports.hash(
        comparisonReviewKey(
          { marketId: row.marketId, input: row.input, forecast: row.forecast } as ComparisonCase,
          d.proposal!,
          ports.versions[reviewer],
        ),
      );
      let request = requests.find((r) => r.reviewer === reviewer && r.contextHash === contextHash);
      if (!request) {
        request = {
          id: `${row.id}:review:${requests.length}`,
          phase: "prospective",
          caseId: row.id,
          reviewer,
          contextHash,
          version: ports.versions[reviewer],
        };
        requests.push(request);
      }
      d.reviewId = request.id;
    }
    if (!(await reserveBenchmarkReviews(state, requests, ports))) {
      for (const d of proposed) {
        d.status = "blocked";
        d.reasons = [state.paidStopped!];
      }
      return;
    }
    row.reviewIds = requests.map((r) => r.id);
    for (const request of requests) {
      const review = state.reviews.find((r) => r.id === request.id)!;
      const decision = proposed.find((d) => d.reviewId === review.id)!;
      await performBenchmarkReview(
        state,
        review,
        row.input,
        row.forecast,
        decision.proposal!,
        ports,
        signal,
      );
    }
    row.reviewedAt = ports.now();
    if (state.paidStopped) {
      row.status = "failed";
      row.reason = state.paidStopped;
      for (const d of proposed) {
        d.status = "blocked";
        d.reasons = [state.paidStopped];
      }
      return;
    }
    // Refresh also for vetoed proposals. D receives exactly the same delayed snapshot.
    await ports.guard("polymarket");
    await ports.guard("coinbase");
    const fresh = await ports.refresh(item, signal);
    if (
      !sameQuantMarket(item.market, fresh.market) ||
      fresh.windowStart !== item.windowStart ||
      fresh.windowEnd !== item.windowEnd
    ) {
      throw new PilotError("QUANT_RULES_CHANGED", "Rules changed");
    }
    row.refreshedInput = await ports.input(fresh, signal);
    assertInput(item, row.refreshedInput, row.input);
    const finalNow = ports.now();
    row.refreshedAt = finalNow;
    row.waitMs = finalNow - row.input.observedAt;
    row.refreshedForecast = quantForecast(row.refreshedInput, finalNow);
    const outcomes: BenchmarkDecision[] = [];
    for (const d of proposed) {
      const decision = structuredClone(d);
      const final = quantProposal(
        row.refreshedInput,
        row.refreshedForecast,
        finalNow,
        d.policy,
      ).proposal;
      if (final) {
        decision.finalProposal = final;
      }
      if (final?.outcomeId === d.proposal!.outcomeId) {
        decision.finalEdge = final.decisionEdge ?? final.conservativeEdge;
        decision.edgeChange =
          (final.decisionEdge ?? final.conservativeEdge) -
          (d.proposal!.decisionEdge ?? d.proposal!.conservativeEdge);
        decision.priceChange = final.effectiveCost - d.proposal!.effectiveCost;
      }
      const originalOutcome = d.proposal!.outcomeId;
      const condition = row.refreshedInput.conditions.find((c) => c.outcomeId === originalOutcome)!;
      const tick = Number(condition.tickSize);
      const quote = simulatePaperBuy(
        fresh.market,
        row.refreshedInput.books.find((b) => b.outcomeId === originalOutcome)!,
        condition,
        (Math.floor((1 - 1e-10) / tick) * tick).toFixed(8),
        finalNow,
      );
      if (quote.fill) {
        const cost = Number(quote.fill.totalCost) / Number(quote.fill.quantity);
        const probability = row.refreshedForecast.probabilities.find(
          (p) => p.outcomeId === originalOutcome,
        )!;
        decision.finalEdge =
          (d.policy === "central-v1" ? probability.estimate : probability.lower) - cost;
        decision.edgeChange =
          decision.finalEdge - (d.proposal!.decisionEdge ?? d.proposal!.conservativeEdge);
        decision.priceChange = cost - d.proposal!.effectiveCost;
      }
      const review = state.reviews.find((r) => r.id === d.reviewId)?.result;
      if (review?.veto) {
        decision.status = "abstained";
        decision.reasons = ["JEV_MATERIAL_CONTRADICTION"];
      } else if (!final || final.outcomeId !== d.proposal!.outcomeId) {
        decision.status = "abstained";
        decision.reasons = ["EDGE_CHANGED_AFTER_REVIEW"];
      } else if (fresh.windowEnd - finalNow < 90000) {
        decision.status = "abstained";
        decision.reasons = ["WINDOW_TOO_LATE_AFTER_REVIEW"];
      } else {
        const filled = simulatePaperBuy(
          fresh.market,
          row.refreshedInput.books.find((b) => b.outcomeId === final.outcomeId)!,
          row.refreshedInput.conditions.find((c) => c.outcomeId === final.outcomeId)!,
          String(Math.min(Number(final.limitPrice), Number(d.proposal!.limitPrice))),
          finalNow,
        );
        if (filled.fill) {
          decision.fill = filled.fill;
        }
        decision.status = filled.fill ? "filled" : "abstained";
        decision.reasons = filled.fill ? [] : [filled.reason ?? "REFRESH_NOT_FILLED"];
      }
      outcomes.push(decision);
    }
    await ports.guard("polymarket");
    await ports.guard("coinbase");
    await ports.guard("jev");
    signal.throwIfAborted();
    await ports.exclusive(async () => {
      for (const outcome of outcomes) {
        const d = row.variants.find((v) => v.variant === outcome.variant)!;
        if (state.paidStopped) {
          d.status = "blocked";
          d.reasons = [state.paidStopped];
        } else {
          Object.assign(d, outcome);
        }
      }
      await ports.save();
    });
  } catch (error) {
    row.status = "failed";
    row.reason = error instanceof PilotError ? error.code : "QUANT_PROVIDER_FAILURE";
    for (const d of row.variants.filter((d) => d.status === "pending")) {
      d.status = "failed";
      d.reasons = [row.reason];
    }
  } finally {
    if (row.status === "started") {
      row.status = "completed";
    }
    row.finishedAt = ports.now();
    await ports.save();
  }
}
export function settleBenchmarkCase(row: BenchmarkCase, now: number): void {
  // The wrapper is internal settlement arithmetic; no synthetic provider order is sent.
  settleComparisonCase({ ...row, policies: row.variants, reviews: [] }, now);
}
