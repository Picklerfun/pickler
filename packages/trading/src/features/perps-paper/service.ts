import { PilotError } from "@pickler/core";
import type { PerpSymbol } from "@pickler/core";
import type {
  PerpsPaperExits,
  PerpsPaperFill,
  PerpsPaperRepository,
  PerpsPaperScope,
  PerpsPaperSide,
  PerpsPaperIntent,
} from "./types.js";
import { paperRisk } from "./policy.js";
import {
  simulatePerpsFill,
  type PerpsPaperFrame,
  type PerpsPaperObservation,
} from "./simulation.js";
export interface PerpsPaperData {
  observation(
    scope: PerpsPaperScope,
    from: number,
    signal: AbortSignal,
  ): Promise<PerpsPaperObservation>;
  frame(scope: PerpsPaperScope, symbol: PerpSymbol, signal: AbortSignal): Promise<PerpsPaperFrame>;
}
/** How an open is sized and what it records; the operator default is 100 at 1x, no exits. */
export interface PerpsPaperTradeOptions {
  notional?: string | undefined;
  leverage?: number | undefined;
  checkId?: string | undefined;
  /** The position's exits from its fill (product sessions; R10). */
  exits?: ((fill: PerpsPaperFill) => PerpsPaperExits) | undefined;
}
export function createPerpsPaperService(
  repository: PerpsPaperRepository,
  data: PerpsPaperData,
  clock: () => number = Date.now,
) {
  async function trade(
    scope: PerpsPaperScope,
    key: string,
    kind: "open" | "close",
    symbol: PerpSymbol,
    side: PerpsPaperSide,
    signal: AbortSignal,
    frame?: PerpsPaperFrame,
    options: PerpsPaperTradeOptions = {},
  ) {
    signal.throwIfAborted();
    let view = await repository.view(scope);
    const intent: PerpsPaperIntent = {
      kind,
      symbol,
      side,
      notional: kind === "open" ? (options.notional ?? "100") : "0",
      feeReserve: "1",
    };
    if (kind === "open" && options.leverage !== undefined) {
      intent.leverage = options.leverage;
    }
    if (options.checkId !== undefined) {
      intent.checkId = options.checkId;
    }
    // Durable admission precedes fetching execution evidence; repeat keys make no provider call.
    const admitted = await repository.begin(scope, view.account.agentVersion, key, intent);
    if (!admitted.lease) {
      return repository.view(scope);
    }
    const lease = admitted.lease;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(55000)]);
    let evidence: PerpsPaperFrame | undefined;
    try {
      await repository.assertLease(scope, lease);
      const current = frame ?? (await data.frame(scope, symbol, deadline));
      evidence = current;
      deadline.throwIfAborted();
      await repository.assertLease(scope, lease);
      view = await repository.view(scope);
      const fill = simulatePerpsFill(view.account, intent, current, clock());
      deadline.throwIfAborted();
      const exits = kind === "open" ? options.exits?.(fill) : undefined;
      return await repository.complete(scope, lease, fill, exits);
    } catch (error) {
      const code =
        error instanceof PilotError && /^[A-Z_]{1,80}$/.test(error.code)
          ? error.code
          : "SIMULATION_FAILED";
      try {
        await repository.fail(scope, lease, code, evidence ?? null);
      } catch (failure) {
        if (!(failure instanceof PilotError) || failure.code !== "LEASE_LOST") {
          throw failure;
        }
      }
      throw error;
    }
  }
  return {
    trade,
    async tick(
      scope: PerpsPaperScope,
      key: string,
      signal: AbortSignal,
      observation?: PerpsPaperObservation,
    ) {
      if (await repository.observed(scope, key)) {
        return repository.view(scope);
      }
      const previous = await repository.view(scope);
      const from = previous.account.createdAt;
      const snapshot = observation ?? (await data.observation(scope, from, signal));
      signal.throwIfAborted();
      let view = await repository.observe(scope, key, snapshot);
      const risk = paperRisk(view.account, view.attempts, clock());
      for (const symbol of risk.closeSymbols) {
        const position = view.account.positions.find(
          (p) => p.symbol === symbol && p.closedAt === null,
        );
        if (position) {
          try {
            view = await trade(
              scope,
              `${key}:exit:${symbol}`,
              "close",
              symbol,
              position.side,
              signal,
            );
          } catch (error) {
            if (!(error instanceof PilotError)) {
              throw error;
            }
            view = await repository.view(scope);
          }
        }
      }
      return view;
    },
    report: async (scope: PerpsPaperScope) => {
      const view = await repository.view(scope);
      return { ...view, risk: paperRisk(view.account, view.attempts, clock()) };
    },
  };
}
