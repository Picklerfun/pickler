import { PilotError } from "@pickler/core";
import type { PaperOrder } from "../paper/orders.js";
import { settlePaperOrder } from "../paper/settlement.js";
import type { PaperResolution, PaperResolutionIdentity } from "../paper/settlement.js";
import type { QuantState } from "../paper-study/quant-session.js";
import type { ComparisonCase } from "../paper-study/comparison.js";
export interface ResolutionReader {
  resolutionFor(
    identity: PaperResolutionIdentity,
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<PaperResolution | null>;
  resolution(
    order: PaperOrder,
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<PaperResolution | null>;
}
export interface QuantReconciliationPorts {
  resolver: ResolutionReader;
  guard(): Promise<void>;
  save(): Promise<void>;
  now(): number;
  signal: AbortSignal;
}
export async function reconcileQuant(state: QuantState, deps: QuantReconciliationPorts) {
  for (const row of state.cases
    .filter((r) => r.forecast && r.identities && !r.resolution && r.nextResolutionAt <= deps.now())
    .slice(0, 4)) {
    try {
      const up = row.forecast!.probabilities.find((p) => p.label === "Up")!;
      const identity = row.identities!.find((i) => i.outcomeId === up.outcomeId)!;
      const result = await deps.resolver.resolutionFor(
        identity,
        AbortSignal.any([deps.signal, AbortSignal.timeout(20000)]),
        () => deps.guard(),
      );
      if (result) {
        if (row.fill) {
          const order: PaperOrder = {
            id: row.id,
            tenantId: `local-study:${state.id}`,
            agentId: row.kind,
            runId: row.id,
            marketId: row.marketId,
            outcomeId: row.fill.book.outcomeId,
            status: "filled",
            virtualBudget: "10",
            createdAt: row.startedAt,
            finishedAt: row.finishedAt,
            reason: null,
            fill: row.fill,
          };
          const resolution =
            order.outcomeId === up.outcomeId
              ? result
              : await deps.resolver.resolution(
                  order,
                  AbortSignal.any([deps.signal, AbortSignal.timeout(20000)]),
                  () => deps.guard(),
                );
          if (!resolution) {
            throw new PilotError("PAPER_RESOLUTION_UNAVAILABLE", "Other outcome pending");
          }
          const settled = settlePaperOrder(order, resolution, deps.now());
          row.settlement = { payout: settled.payout, realizedPnl: settled.realizedPnl };
        }
        row.resolution = result;
        delete row.resolutionError;
      }
    } catch (error) {
      row.resolutionError = error instanceof PilotError ? error.code : "RESOLUTION_FAILED";
    }
    row.nextResolutionAt = deps.now() + 60000;
    await deps.save();
  }
}

type ResolvableCase = Pick<
  ComparisonCase,
  "forecast" | "identities" | "nextResolutionAt" | "resolutions" | "resolutionError"
>;
export async function reconcileCases<Row extends ResolvableCase>(
  cases: Row[],
  deps: QuantReconciliationPorts & { settle(row: Row, now: number): void },
) {
  for (const row of cases
    .filter(
      (r) =>
        r.forecast &&
        r.identities &&
        r.nextResolutionAt <= deps.now() &&
        r.resolutions.length < r.identities.length,
    )
    .slice(0, 4)) {
    deps.signal.throwIfAborted();
    try {
      for (const identity of row.identities!) {
        if (row.resolutions.some((r) => r.outcomeId === identity.outcomeId)) {
          continue;
        }
        const result = await deps.resolver.resolutionFor(
          identity,
          AbortSignal.any([deps.signal, AbortSignal.timeout(20000)]),
          deps.guard,
        );
        if (result) {
          row.resolutions.push(result);
        }
      }
      deps.settle(row, deps.now());
      delete row.resolutionError;
    } catch (error) {
      row.resolutionError = error instanceof PilotError ? error.code : "RESOLUTION_FAILED";
    }
    row.nextResolutionAt = deps.now() + 60000;
    await deps.save();
  }
}
