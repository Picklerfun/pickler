import { PilotError, type Market } from "@pickler/core";
import { simulatePaperBuy, type PaperFill } from "../paper/orders.js";
import type { PaperResolution, PaperResolutionIdentity } from "../paper/settlement.js";
import {
  quantForecast,
  quantProposal,
  type QuantInput,
  type QuantForecast,
  type QuantProposal,
  type QuantReview,
  type QuantPlugin,
} from "./quant.js";
import type { StudyMarket } from "./study.js";
export interface QuantCase {
  id: string;
  kind: "btc-5m" | "btc-15m";
  marketId: string;
  startedAt: number;
  finishedAt: number | null;
  status: "started" | "abstained" | "filled" | "failed" | "interrupted";
  reason: string | null;
  input?: QuantInput;
  forecast?: QuantForecast;
  proposal?: QuantProposal;
  refreshedInput?: QuantInput;
  refreshedForecast?: QuantForecast;
  review?: QuantReview;
  fill?: PaperFill;
  reservedUsd: number;
  resolution?: PaperResolution;
  settlement?: { payout: string; realizedPnl: string };
  identities?: PaperResolutionIdentity[];
  nextResolutionAt: number;
  resolutionError?: string;
}
export interface QuantState {
  version: 2;
  protocol: "btc-quant-jev-v1";
  id: string;
  createdAt: number;
  deadline: number;
  settlementDeadline: number;
  priorReservedUsd: number;
  maxNewReservedUsd: number;
  jevInputPerMillion: number;
  cases: QuantCase[];
  paidStopped: boolean;
}
export interface QuantPorts {
  now(): number;
  save(): Promise<void>;
  guard(plugin: QuantPlugin): Promise<void>;
  input(item: StudyMarket, signal: AbortSignal): Promise<QuantInput>;
  refresh(item: StudyMarket, signal: AbortSignal): Promise<StudyMarket>;
  review(
    input: QuantInput,
    forecast: QuantForecast,
    proposal: QuantProposal,
    signal: AbortSignal,
    report: (r: QuantReview) => Promise<void>,
  ): Promise<QuantReview>;
}
export function sameQuantMarket(a: Market, b: Market): boolean {
  return (
    a.id === b.id &&
    a.rules === b.rules &&
    JSON.stringify(a.outcomes) === JSON.stringify(b.outcomes)
  );
}
export async function runQuantCase(
  state: QuantState,
  item: StudyMarket,
  ports: QuantPorts,
): Promise<void> {
  const now = ports.now();
  if (
    item.kind === "sports" ||
    state.paidStopped ||
    now >= state.deadline ||
    state.cases.some((c) => c.marketId === item.market.id) ||
    state.cases.filter((c) => c.kind === item.kind).length >= (item.kind === "btc-5m" ? 24 : 8)
  ) {
    return;
  }
  if (item.windowStart === null || now < item.windowStart + 60000 || item.windowEnd - now < 90000) {
    return;
  }
  await ports.guard("polymarket");
  await ports.guard("coinbase");
  await ports.guard("jev");
  const row: QuantCase = {
    id: `${state.id}:${item.market.id}`,
    kind: item.kind,
    marketId: item.market.id,
    startedAt: now,
    finishedAt: null,
    status: "started",
    reason: null,
    reservedUsd: 0,
    nextResolutionAt: item.windowEnd,
  };
  state.cases.push(row);
  await ports.save();
  const signal = AbortSignal.timeout(90000);
  try {
    row.input = await ports.input(item, signal);
    row.forecast = quantForecast(row.input, ports.now());
    row.identities = row.input.conditions.map((c) => {
      if (!c.resolution) {
        throw new PilotError("QUANT_RESOLUTION_IDENTITY", "Missing condition identity");
      }
      return { ...c.resolution, marketId: item.market.id, outcomeId: c.outcomeId };
    });
    const selected = quantProposal(row.input, row.forecast, ports.now());
    await ports.save();
    if (!selected.proposal) {
      row.status = "abstained";
      row.reason = selected.reasons.join(";");
      return;
    }
    row.proposal = selected.proposal;
    const reservation = (65536 * state.jevInputPerMillion) / 1e6;
    const used = state.cases.reduce((sum, c) => sum + c.reservedUsd, 0);
    if (
      !(state.jevInputPerMillion > 0) ||
      used + reservation > state.maxNewReservedUsd + 1e-12 ||
      state.priorReservedUsd + used + reservation > 5 + 1e-12
    ) {
      row.status = "abstained";
      row.reason = "API_BUDGET_EXHAUSTED";
      return;
    }
    row.reservedUsd = reservation;
    await ports.save();
    await ports.guard("jev");
    row.review = await ports.review(
      row.input,
      row.forecast,
      row.proposal,
      signal,
      async (review) => {
        row.review = review;
        await ports.save();
      },
    );
    if (row.review.status !== "completed") {
      throw new PilotError("JEV_REVIEW_INCOMPLETE", "Invalid review lifecycle");
    }
    if (row.review.veto) {
      row.status = "abstained";
      row.reason = "JEV_MATERIAL_CONTRADICTION";
      return;
    }
    const fresh = await ports.refresh(item, signal);
    if (!sameQuantMarket(item.market, fresh.market)) {
      throw new PilotError("QUANT_RULES_CHANGED", "Rules changed");
    }
    row.refreshedInput = await ports.input(fresh, signal);
    if (
      row.refreshedInput.rule.lookbackSeconds !== row.input.rule.lookbackSeconds ||
      row.refreshedInput.opening.price !== row.input.opening.price
    ) {
      throw new PilotError("QUANT_RULES_CHANGED", "Resolution changed");
    }
    row.refreshedForecast = quantForecast(row.refreshedInput, ports.now());
    const final = quantProposal(row.refreshedInput, row.refreshedForecast, ports.now()).proposal;
    await ports.guard("polymarket");
    await ports.guard("coinbase");
    await ports.guard("jev");
    signal.throwIfAborted();
    if (
      !final ||
      final.outcomeId !== row.proposal.outcomeId ||
      final.fill.levels.some((l) => Number(l.price) > Number(row.proposal!.limitPrice))
    ) {
      row.status = "abstained";
      row.reason = "EDGE_CHANGED_AFTER_REVIEW";
      return;
    }
    const capped = simulatePaperBuy(
      fresh.market,
      row.refreshedInput.books.find((b) => b.outcomeId === final.outcomeId)!,
      row.refreshedInput.conditions.find((c) => c.outcomeId === final.outcomeId)!,
      String(Math.min(Number(final.limitPrice), Number(row.proposal.limitPrice))),
      ports.now(),
    );
    if (!capped.fill) {
      row.status = "abstained";
      row.reason = capped.reason;
      return;
    }
    row.fill = capped.fill;
    row.status = "filled";
    row.reason = null;
  } catch (error) {
    row.status = "failed";
    row.reason = error instanceof PilotError ? error.code : "QUANT_PROVIDER_FAILURE";
    if (row.review?.status === "failed" || row.reservedUsd > 0) {
      state.paidStopped = true;
    }
  } finally {
    row.finishedAt = ports.now();
    await ports.save();
  }
}
