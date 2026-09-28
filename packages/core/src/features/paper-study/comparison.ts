import { PilotError } from "../research/types.js";
import { simulatePaperBuy, type PaperFill, type PaperOrder } from "../paper/orders.js";
import {
  settlePaperOrder,
  type PaperResolution,
  type PaperSettlement,
} from "../paper/settlement.js";
import {
  quantForecast,
  quantProposal,
  type QuantPolicy,
  type QuantProposal,
  type QuantReview,
} from "./quant.js";
import { sameQuantMarket, type QuantCase, type QuantPorts } from "./quant-session.js";
import type { StudyMarket } from "./study.js";

export const COMPARISON_PROTOCOL = "btc-policy-comparison-v1" as const;
export const COMPARISON_POLICIES = ["conservative-v1", "central-v1"] as const;
export interface PolicyDecision {
  policy: QuantPolicy;
  status: "pending" | "abstained" | "blocked" | "filled" | "failed";
  reasons: string[];
  proposal?: QuantProposal;
  finalProposal?: QuantProposal;
  reviewId?: string;
  fill?: PaperFill;
  settlement?: PaperSettlement;
}
export interface ComparisonReview {
  id: string;
  key: string;
  policies: QuantPolicy[];
  reservedUsd: number;
  result?: QuantReview;
}
export interface ComparisonCase extends Omit<
  QuantCase,
  "status" | "review" | "proposal" | "fill" | "settlement" | "reservedUsd"
> {
  status: "started" | "completed" | "failed" | "interrupted";
  policies: PolicyDecision[];
  reviews: ComparisonReview[];
  resolutions: PaperResolution[];
}
export interface ComparisonSlot {
  kind: "btc-5m" | "btc-15m";
  start: number;
  status: "pending" | "started" | "evaluated" | "failed" | "missed" | "interrupted";
  reason?: string;
  marketId?: string;
}
export interface ComparisonState {
  version: 3;
  protocol: typeof COMPARISON_PROTOCOL;
  id: string;
  createdAt: number;
  deadline: number | null;
  settlementDeadline: number | null;
  priorReservedUsd: number;
  maxNewReservedUsd: number;
  jevInputPerMillion: number;
  paidStopped: string | null;
  probe?: ComparisonCase;
  cases: ComparisonCase[];
  slots: ComparisonSlot[];
  interruptions: { at: number; gapMs: number }[];
}
export interface ComparisonPorts extends QuantPorts {
  reviewerVersion: string;
  /** Host serializes reservation admission and durable writes across concurrent markets. */
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
}
export function comparisonReviews(state: ComparisonState): ComparisonReview[] {
  return [...(state.probe ? [state.probe] : []), ...state.cases].flatMap((r) => r.reviews);
}
export function comparisonReserved(state: ComparisonState): number {
  return comparisonReviews(state).reduce((sum, r) => sum + r.reservedUsd, 0);
}
/** Exact snapshot key, excluding policy name: equivalent purchases may share material review. */
export function comparisonReviewKey(
  row: ComparisonCase,
  proposal: QuantProposal,
  version: string,
): string {
  return JSON.stringify({
    market: row.marketId,
    outcome: proposal.outcomeId,
    limit: proposal.limitPrice,
    budget: "10",
    input: row.input,
    forecast: row.forecast,
    reviewer: version,
  });
}
export function comparisonSlots(start: number, deadline: number): ComparisonSlot[] {
  return (["btc-5m", "btc-15m"] as const)
    .flatMap((kind) => {
      const period = kind === "btc-5m" ? 300000 : 900000;
      const slots: ComparisonSlot[] = [];
      for (
        let window = Math.floor(start / period) * period;
        window + 60000 < deadline;
        window += period
      ) {
        if (window + 60000 >= start) {
          slots.push({ kind, start: window, status: "pending" });
        }
      }
      return slots;
    })
    .sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
}
export function markMissedSlots(state: ComparisonState, now: number): void {
  for (const slot of state.slots) {
    if (slot.status === "pending" && now > slot.start + 90000) {
      slot.status = "missed";
      slot.reason = "ADMISSION_WINDOW_MISSED";
    }
  }
}
export async function runComparisonCase(
  state: ComparisonState,
  item: StudyMarket,
  ports: ComparisonPorts,
  probe = false,
): Promise<void> {
  const now = ports.now();
  if (
    item.kind === "sports" ||
    item.windowStart === null ||
    now < item.windowStart + 60000 ||
    item.windowEnd - now < 90000
  ) {
    return;
  }
  const row = await ports.exclusive(async () => {
    if (
      probe
        ? !!state.probe
        : state.deadline === null ||
          now >= state.deadline ||
          state.cases.some((c) => c.marketId === item.market.id) ||
          state.cases.filter((c) => c.kind === item.kind).length >=
            (item.kind === "btc-5m" ? 24 : 8)
    ) {
      return null;
    }
    const record: ComparisonCase = {
      id: `${state.id}:${probe ? "synthetic-probe" : item.market.id}`,
      kind: item.kind as "btc-5m" | "btc-15m",
      marketId: item.market.id,
      startedAt: now,
      finishedAt: null,
      status: "started",
      reason: null,
      policies: COMPARISON_POLICIES.map((policy) => ({ policy, status: "pending", reasons: [] })),
      reviews: [],
      resolutions: [],
      nextResolutionAt: item.windowEnd,
    };
    if (probe) {
      state.probe = record;
    } else {
      state.cases.push(record);
    }
    await ports.save();
    return record;
  });
  if (!row) {
    return;
  }
  const signal = AbortSignal.timeout(90000);
  try {
    await ports.guard("polymarket");
    await ports.guard("coinbase");
    row.input = await ports.input(item, signal);
    if (
      !sameQuantMarket(item.market, row.input.item.market) ||
      item.windowStart !== row.input.item.windowStart ||
      item.windowEnd !== row.input.item.windowEnd
    ) {
      throw new PilotError("QUANT_INPUT_IDENTITY", "Snapshot mismatch");
    }
    row.forecast = quantForecast(row.input, ports.now());
    row.identities = row.input.conditions.map((c) => {
      if (!c.resolution) {
        throw new PilotError("QUANT_RESOLUTION_IDENTITY", "Missing identity");
      }
      return { ...c.resolution, marketId: item.market.id, outcomeId: c.outcomeId };
    });
    for (const decision of row.policies) {
      const selected = quantProposal(row.input, row.forecast, ports.now(), decision.policy);
      decision.reasons = selected.reasons;
      if (selected.proposal) {
        decision.proposal = selected.proposal;
      } else {
        decision.status = "abstained";
      }
    }
    await ports.save();
    const proposed = row.policies.filter((p) => p.proposal);
    if (!proposed.length) {
      return;
    }
    await ports.guard("jev");
    const admitted = await ports.exclusive(async () => {
      const groups = new Map<string, PolicyDecision[]>();
      for (const decision of proposed) {
        const key = comparisonReviewKey(row, decision.proposal!, ports.reviewerVersion);
        groups.set(key, [...(groups.get(key) ?? []), decision]);
      }
      const reservation = (65536 * state.jevInputPerMillion) / 1e6;
      const total = reservation * groups.size;
      const used = comparisonReserved(state);
      if (
        state.paidStopped ||
        !(reservation > 0) ||
        used + total > Math.min(0.25, state.maxNewReservedUsd) + 1e-12 ||
        state.priorReservedUsd + used + total > 5 + 1e-12 ||
        comparisonReviews(state).length + groups.size > 65 ||
        (probe && groups.size !== 1)
      ) {
        state.paidStopped ??= "API_BUDGET_EXHAUSTED";
        for (const decision of proposed) {
          decision.status = "blocked";
          decision.reasons = [state.paidStopped];
        }
        await ports.save();
        return false;
      }
      for (const [key, decisions] of groups) {
        const id = `${row.id}:review:${row.reviews.length}`;
        row.reviews.push({
          id,
          key,
          policies: decisions.map((d) => d.policy),
          reservedUsd: reservation,
        });
        for (const decision of decisions) {
          decision.reviewId = id;
        }
      }
      await ports.save();
      return true;
    });
    if (!admitted) {
      return;
    }
    for (const review of row.reviews) {
      if (state.paidStopped) {
        break;
      }
      const decision = proposed.find((d) => d.reviewId === review.id)!;
      try {
        await ports.guard("jev");
        review.result = await ports.review(
          row.input,
          row.forecast,
          decision.proposal!,
          signal,
          async (result) => {
            review.result = result;
            await ports.save();
          },
        );
        if (review.result.status !== "completed") {
          throw new PilotError("JEV_REVIEW_INCOMPLETE", "Incomplete review");
        }
      } catch (error) {
        state.paidStopped = error instanceof PilotError ? error.code : "JEV_REVIEW_FAILED";
        review.result ??= {
          status: "failed",
          inputTokens: null,
          outputTokens: null,
          reason: state.paidStopped,
        };
        await ports.save();
      }
    }
    for (const decision of proposed) {
      const result = row.reviews.find((r) => r.id === decision.reviewId)!.result;
      if (state.paidStopped || result?.status !== "completed") {
        decision.status = "blocked";
        decision.reasons = [state.paidStopped ?? "JEV_REVIEW_INCOMPLETE"];
      } else if (result.veto) {
        decision.status = "abstained";
        decision.reasons = ["JEV_MATERIAL_CONTRADICTION"];
      }
    }
    if (probe && proposed.some((p) => p.status !== "pending")) {
      state.paidStopped ??= "JEV_PROBE_VETO";
    }
    if (!proposed.some((p) => p.status === "pending")) {
      return;
    }
    const fresh = await ports.refresh(item, signal);
    if (
      !sameQuantMarket(item.market, fresh.market) ||
      fresh.windowStart !== item.windowStart ||
      fresh.windowEnd !== item.windowEnd
    ) {
      throw new PilotError("QUANT_RULES_CHANGED", "Rules changed");
    }
    row.refreshedInput = await ports.input(fresh, signal);
    if (
      !sameQuantMarket(fresh.market, row.refreshedInput.item.market) ||
      row.refreshedInput.item.windowStart !== item.windowStart ||
      row.refreshedInput.item.windowEnd !== item.windowEnd ||
      row.refreshedInput.rule.lookbackSeconds !== row.input.rule.lookbackSeconds ||
      row.refreshedInput.opening.price !== row.input.opening.price
    ) {
      throw new PilotError("QUANT_RULES_CHANGED", "Resolution changed");
    }
    row.refreshedForecast = quantForecast(row.refreshedInput, ports.now());
    for (const decision of proposed.filter((d) => d.status === "pending")) {
      const final = quantProposal(
        row.refreshedInput,
        row.refreshedForecast,
        ports.now(),
        decision.policy,
      ).proposal;
      if (!final || final.outcomeId !== decision.proposal!.outcomeId) {
        decision.status = "abstained";
        decision.reasons = ["EDGE_CHANGED_AFTER_REVIEW"];
        continue;
      }
      decision.finalProposal = final;
      const capped = simulatePaperBuy(
        fresh.market,
        row.refreshedInput.books.find((b) => b.outcomeId === final.outcomeId)!,
        row.refreshedInput.conditions.find((c) => c.outcomeId === final.outcomeId)!,
        String(Math.min(Number(final.limitPrice), Number(decision.proposal!.limitPrice))),
        ports.now(),
      );
      if (!capped.fill) {
        decision.status = "abstained";
        decision.reasons = [capped.reason ?? "REFRESH_NOT_FILLED"];
        continue;
      }
      await ports.guard("polymarket");
      await ports.guard("coinbase");
      await ports.guard("jev");
      signal.throwIfAborted();
      if (state.paidStopped) {
        decision.status = "blocked";
        decision.reasons = [state.paidStopped];
        continue;
      }
      decision.fill = capped.fill;
      decision.status = "filled";
      decision.reasons = [];
    }
  } catch (error) {
    row.status = "failed";
    row.reason = error instanceof PilotError ? error.code : "QUANT_PROVIDER_FAILURE";
    for (const decision of row.policies.filter((d) => d.status === "pending")) {
      decision.status = "failed";
      decision.reasons = [row.reason];
    }
    if (probe) {
      state.paidStopped ??= row.reason;
    }
  } finally {
    if (row.status === "started") {
      row.status = "completed";
    }
    row.finishedAt = ports.now();
    await ports.save();
  }
}
/** Only actual virtual fills receive settlement arithmetic; forecasts need no fictitious order. */
export function settleComparisonCase(row: ComparisonCase, now: number): void {
  for (const decision of row.policies) {
    if (!decision.fill || decision.settlement) {
      continue;
    }
    const resolution = row.resolutions.find((r) => r.outcomeId === decision.fill!.book.outcomeId);
    if (!resolution) {
      continue;
    }
    const order: PaperOrder = {
      id: `${row.id}:${decision.policy}`,
      tenantId: "local-comparison",
      agentId: decision.policy,
      runId: row.id,
      marketId: row.marketId,
      outcomeId: decision.fill.book.outcomeId,
      status: "filled",
      virtualBudget: "10",
      createdAt: row.startedAt,
      finishedAt: row.finishedAt,
      reason: null,
      fill: decision.fill,
    };
    decision.settlement = settlePaperOrder(order, resolution, now);
  }
}
