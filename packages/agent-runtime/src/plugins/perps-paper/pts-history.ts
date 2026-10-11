import { PilotError, type Scope, type AgentRecord, type PerpCandles } from "@pickler/core";
import { createUniversePerplReader } from "./universe.js";
import {
  PerplRequestSchedule,
  type PerplDataOptions,
  type PerplPublicResponse,
} from "@pickler/infrastructure/perpl-public";
import {
  DAY,
  periodStart,
  nextPeriod,
  PTS_CATALOG,
  type PtsReplayInput,
  type PtsHistory,
} from "@pickler/trading/pts";
/** One explicit bounded public preparation; no environment, database, model, signer or scheduler. */
export async function preparePtsHistory(
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  scope: Scope,
  parent: AbortSignal,
  options: PerplDataOptions & {
    commit: string;
    capture: (response: PerplPublicResponse) => Promise<void>;
  },
) {
  const now = options.now ?? Date.now,
    capturedAt = now(),
    to = periodStart(capturedAt, "1d"),
    from = to - 30 * DAY;
  const deadline = new AbortController();
  const signal = AbortSignal.any([parent, deadline.signal, AbortSignal.timeout(600000)]);
  const guard = async () => {
    if (now() - capturedAt >= 600000) {
      deadline.abort(
        new PilotError(
          "PTS_PREPARATION_TIMEOUT",
          "The single history preparation deadline expired",
        ),
      );
    }
    signal.throwIfAborted();
    await options.guard?.();
  };
  let requests = 0,
    sessionRequests = 0;
  const diagnostics: { symbol: string | null; resolution: number | null; code: string }[] = [];
  const transport: typeof fetch = async (input, init) => {
    signal.throwIfAborted();
    if (requests >= 96) {
      throw new PilotError(
        "PTS_PREPARATION_LIMIT",
        "PTS preparation exhausted its 96-request allowance",
      );
    }
    requests++;
    sessionRequests++;
    return (options.transport ?? fetch)(input, init);
  };
  const reader = createUniversePerplReader(agents, {
    ...options,
    transport,
    schedule: options.schedule ?? new PerplRequestSchedule(),
    acquisitionPolicy: "rest-universe-20s-v1",
    onResponse: options.capture,
  });
  const markets: PtsHistory[] = [];
  let selected: import("@pickler/core").PerpMarketInfo[] = [];
  let fatalCode: string | null = null;
  try {
    let session = await reader.session(scope, signal, guard);
    const catalog = await session.listPerpMarkets();
    selected = PTS_CATALOG.map((m) => {
      const found = catalog.markets.find((c) => c.symbol === m.symbol && c.marketId === m.marketId);
      if (!found || found.collateral.symbol !== "AUSD" || found.provenance.provider !== "perpl") {
        throw new PilotError(
          "PERPL_MARKET_IDENTITY",
          "Frozen eleven-market catalog differs from current public metadata",
        );
      }
      return found;
    });
    for (const market of selected) {
      const series: PerpCandles[] = [];
      markets.push({ market, series, capturedAt });
      for (const resolution of [86400, 14400, 3600] as const) {
        const start =
          resolution === 86400
            ? Math.min(
                nextPeriod(periodStart(from, "1M"), "1M", -24),
                nextPeriod(periodStart(from, "1w"), "1w", -104),
                from - 240 * DAY,
              )
            : from - (resolution === 14400 ? 180 : 168) * resolution * 1000;
        try {
          if (sessionRequests >= 20) {
            sessionRequests = 0;
            session = await reader.session(scope, signal, guard);
          }
          signal.throwIfAborted();
          const s = await session.getPerpCandles({
            symbol: market.symbol,
            resolution,
            from: start,
            to,
          });
          if (
            s.market.marketId !== market.marketId ||
            s.market.perpetualId !== market.perpetualId
          ) {
            throw new PilotError("PERPL_MARKET_IDENTITY", "History identity differs from metadata");
          }
          series.push(s);
        } catch (error) {
          parent.throwIfAborted();
          const code =
            error instanceof PilotError
              ? error.code
              : signal.aborted
                ? "PTS_PREPARATION_TIMEOUT"
                : "PERPL_TRANSPORT_FAILURE";
          if (
            !/^(PERPL_TIMEOUT|PERPL_TRANSPORT_FAILURE|PERPL_HTTP_(408|429|5[0-9][0-9])|PTS_PREPARATION_LIMIT|PTS_PREPARATION_TIMEOUT|DATA_UNAVAILABLE)$/.test(
              code,
            )
          ) {
            throw error;
          }
          diagnostics.push({ symbol: market.symbol, resolution, code });
          if (signal.aborted || requests >= 96) {
            break;
          }
        }
      }
      if (signal.aborted || requests >= 96) {
        break;
      }
    }
  } catch (error) {
    fatalCode =
      error instanceof PilotError
        ? error.code
        : signal.aborted
          ? "PTS_PREPARATION_TIMEOUT"
          : "PERPL_TRANSPORT_FAILURE";
    diagnostics.push({ symbol: null, resolution: null, code: fatalCode });
  } finally {
    try {
      await reader.close();
    } catch {
      fatalCode = "PTS_RESOURCE_CLOSE_FAILED";
      diagnostics.push({ symbol: null, resolution: null, code: fatalCode });
    }
  }
  const history: PtsReplayInput = {
    format: "perps-pts-history-v1",
    capturedAt,
    from,
    to,
    commit: options.commit,
    markets,
  };
  return {
    history,
    catalog: selected,
    requests,
    diagnostics,
    preparationEndedAt: now(),
    exhausted: signal.aborted || requests >= 96,
    fatalCode,
  };
}
