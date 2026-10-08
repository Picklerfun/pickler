import { PilotError, type PerpSymbol } from "@pickler/core";
import { paperRisk, applyPaperFill } from "./policy.js";
import { paperUnits as u, paperDecimal as d, PAPER_SCALE } from "./decimal.js";
import { simulatePerpsFill, type PerpsPaperFrame } from "./simulation.js";
import type { PerpsPaperAccount, PerpsPaperAttempt } from "./types.js";
export interface SelectiveReduction {
  status: "not-required" | "planned" | "pending";
  symbols: PerpSymbol[];
  exposure: string | null;
  equity: string | null;
  projectedExposure: string | null;
  projectedEquity: string | null;
  exitCost: string | null;
  candidates: number;
  reason: string;
}
/** Exact ledger projections, at most 32 subsets; no future prices or partial closes. */
export function selectiveReduction(
  account: PerpsPaperAccount,
  frames: readonly PerpsPaperFrame[],
  at: number,
): SelectiveReduction {
  const risk = paperRisk(account, [], at);
  const base = {
    symbols: [],
    exposure: risk.exposure,
    equity: risk.equity,
    projectedExposure: risk.exposure,
    projectedEquity: risk.equity,
    exitCost: "0",
    candidates: 0,
  };
  if (account.riskManagement !== "buffered-selective-1x-v1") {
    return { ...base, status: "not-required", reason: "LEGACY_POLICY" };
  }
  if (risk.equity === null || risk.exposure === null || u(risk.equity) <= 0n) {
    return { ...base, status: "pending", reason: "VALUATION_UNAVAILABLE" };
  }
  if (u(risk.exposure) * 2n <= u(risk.equity)) {
    return { ...base, status: "not-required", reason: "WITHIN_HARD_LIMIT" };
  }
  const marketId = (symbol: PerpSymbol) =>
    frames.find((f) => f.snapshot.market.symbol === symbol)?.snapshot.market.marketId ??
    Number.MAX_SAFE_INTEGER;
  const positions = account.positions
    .filter((p) => p.closedAt === null)
    .sort((a, b) => marketId(a.symbol) - marketId(b.symbol));
  if (positions.length > 5) {
    throw new PilotError("RISK_REJECTED", "Selective planner admits at most five positions");
  }
  let best:
    | { symbols: PerpSymbol[]; ids: number[]; cost: bigint; exposure: string; equity: string }
    | undefined;
  let candidates = 0;
  for (let mask = 1; mask < 1 << positions.length; mask++) {
    let projected = structuredClone(account),
      cost = 0n,
      valid = true;
    const selected = positions.filter((_, i) => mask & (1 << i));
    for (const position of selected) {
      const frame = frames.find((f) => f.snapshot.market.symbol === position.symbol);
      if (!frame || position.mark === null) {
        valid = false;
        break;
      }
      const intent = {
        kind: "close" as const,
        symbol: position.symbol,
        side: position.side,
        notional: "0",
        feeReserve: "0",
      };
      const attempt: PerpsPaperAttempt = {
        key: `projection:${position.id}`,
        intent,
        status: "pending",
        reserved: "0",
        createdAt: at,
        finishedAt: null,
        reason: null,
        evidence: null,
      };
      try {
        const fill = simulatePerpsFill(projected, intent, frame, at);
        const adverse =
          position.side === "long"
            ? u(position.mark) - u(fill.price)
            : u(fill.price) - u(position.mark);
        cost += u(fill.fee) + (adverse > 0n ? (adverse * u(fill.quantity)) / PAPER_SCALE : 0n);
        projected = applyPaperFill(projected, attempt, fill, at).account;
      } catch (error) {
        if (!(error instanceof PilotError)) {
          throw error;
        }
        valid = false;
        break;
      }
    }
    if (!valid) {
      continue;
    }
    const r = paperRisk(projected, [], at);
    if (
      r.exposure === null ||
      r.equity === null ||
      u(r.equity) <= 0n ||
      u(r.exposure) * 5n > u(r.equity) * 2n
    ) {
      continue;
    }
    candidates++;
    const ids = selected.map((p) => marketId(p.symbol));
    const earlier =
      best &&
      ids.some(
        (id, i) =>
          id !== best!.ids[i] &&
          ids.slice(0, i).every((v, j) => v === best!.ids[j]) &&
          id < best!.ids[i]!,
      );
    if (
      !best ||
      selected.length < best.symbols.length ||
      (selected.length === best.symbols.length &&
        (cost < best.cost || (cost === best.cost && earlier)))
    ) {
      best = {
        symbols: selected.map((p) => p.symbol),
        ids,
        cost,
        exposure: r.exposure,
        equity: r.equity,
      };
    }
  }
  return best
    ? {
        ...base,
        status: "planned",
        symbols: best.symbols,
        projectedExposure: best.exposure,
        projectedEquity: best.equity,
        exitCost: d(best.cost),
        candidates,
        reason: "HARD_LIMIT_REDUCTION",
      }
    : { ...base, status: "pending", candidates, reason: "EXECUTABLE_REDUCTION_UNAVAILABLE" };
}
