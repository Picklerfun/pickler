import { createHash } from "node:crypto";
import {
  PilotError,
  type AgentRecord,
  type AgentConfig,
  type PerpSymbol,
  type Scope,
  type Source,
} from "@pickler/core";
import { PostgresPerpsCheckCostStore, PostgresPerpsPaperStore } from "@pickler/infrastructure";
import {
  runStudioPerpsCheck,
  parseCheckDecision,
  type PerpsCheck,
  type PerpsCheckLease,
  type PerpsPaperFrame,
  type PerpsRuntimeRepository,
} from "@pickler/trading/perps";

/** Legacy captured answers are translated only in tests; product execution never consumes them. */
export interface FixtureCheckAnswer {
  content: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: string | null;
  requestSha256: string;
}
export interface FixtureCheckDependencies {
  store: PerpsRuntimeRepository;
  paper: PostgresPerpsPaperStore;
  agents: { agent(scope: Scope): Promise<AgentRecord> };
  wallets: { findAgentWallet(id: string): Promise<{ address: string } | null> };
  balances: { read(address: string): Promise<number> };
  market: {
    open(
      scope: Scope,
      signal: AbortSignal,
    ): Promise<{
      read(symbol: PerpSymbol): Promise<{
        frame: PerpsPaperFrame;
        candles: unknown;
        sources: { id: string; name: string; url: string; observedAt: string }[];
      }>;
      frame(symbol: PerpSymbol): Promise<PerpsPaperFrame>;
    }>;
  };
  marks: unknown;
  web: {
    search(
      web: NonNullable<NonNullable<AgentConfig["sources"]>["web"]>,
      query: string,
      signal: AbortSignal,
    ): Promise<{ sources: Source[]; costMicros: string | null }>;
  };
  model: { decide(): Promise<FixtureCheckAnswer> };
  clock: () => number;
}
export async function runControlledStudioCheck(
  deps: FixtureCheckDependencies,
  check: PerpsCheck,
  holder: { lease: PerpsCheckLease },
  signal: AbortSignal,
) {
  const now = deps.clock;
  const base = {
    provider: "controlled",
    model: "controlled",
    promptVersion: "2.0.0",
    promptSha256: "a".repeat(64),
    maxInputTokens: 120000,
    maxOutputTokens: 4096,
    inputMicrosPerMillion: "1500000",
    outputMicrosPerMillion: "0",
  };
  return runStudioPerpsCheck(
    {
      store: deps.store,
      agents: deps.agents,
      now,
      costs: new PostgresPerpsCheckCostStore(deps.paper.pool, now),
      policy: {
        version: 1,
        enabled: true,
        reviewedAt: new Date(now()).toISOString(),
        perOperationMicros: "1000000",
        perDayMicros: "100000000",
      },
      callPlans: [
        { ...base, key: "direct" },
        ...["search-1", "search-2"].map((key) => ({ ...base, key, maximumMicros: "100000" })),
      ],
      hash: (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
      paper: (scope, version, owner, currentSignal) =>
        new PostgresPerpsPaperStore(deps.paper.pool, now, undefined, () => ({
          scope,
          configVersion: version,
          lease: owner.lease,
          requireReservation: true,
          signal: currentSignal,
        })),
      initialCash: async (id) => {
        const wallet = await deps.wallets.findAgentWallet(id);
        if (!wallet) {
          throw new PilotError("WALLET_UNFUNDED", "Missing controlled wallet");
        }
        const balance = await deps.balances.read(wallet.address);
        if (balance < 10) {
          throw new PilotError("WALLET_UNFUNDED", "Controlled wallet is underfunded");
        }
        return balance.toFixed(6);
      },
      data: async (scope, currentSignal) => {
        const session = await deps.market.open(scope, currentSignal);
        return {
          frame: (symbol) => session.frame(symbol),
          async funding(symbol, from, to) {
            const frame = await session.frame(symbol);
            return {
              market: frame.snapshot.market,
              from,
              to,
              complete: true,
              events: [],
              pages: [frame.book.provenance],
            };
          },
          async read(symbol) {
            const read = await session.read(symbol);
            const last = Math.floor(now() / 3600000) * 3600000 - 3600000;
            return {
              ...read,
              candles: {
                market: read.frame.snapshot.market,
                resolution: 3600,
                from: last - 59 * 3600000,
                to: last + 3600000,
                missingOpenTimes: [],
                provenance: read.frame.book.provenance,
                candles: Array.from({ length: 60 }, (_, index) => ({
                  openTime: last - (59 - index) * 3600000,
                  open: "100",
                  high: "100",
                  low: "100",
                  close: "100",
                  volumeCollateral: "100",
                  trades: 1,
                  closed: true,
                })),
              },
            };
          },
        };
      },
      web: async (web, currentSignal, hooks) => {
        await hooks.before("search-1", { sha256: "a".repeat(64), bytes: 100 });
        const result = await deps.web.search(web, "controlled", currentSignal);
        await hooks.usage("search-1", result.costMicros);
        return result.sources;
      },
      models: {
        async direct(context, _currentSignal, hooks) {
          await hooks.before({ sha256: "b".repeat(64), bytes: 100 });
          const reply = await deps.model.decide();
          if (reply.inputTokens !== null && reply.outputTokens !== null) {
            await hooks.usage(reply.inputTokens, reply.outputTokens);
          }
          let raw: unknown;
          try {
            raw = JSON.parse(reply.content ?? "");
          } catch {
            throw new PilotError("MODEL_OUTPUT_INVALID", "Invalid captured answer");
          }
          const parsed = parseCheckDecision(raw);
          if (!parsed.ok) {
            throw new PilotError("MODEL_OUTPUT_INVALID", "Invalid captured answer");
          }
          const decision = parsed.decision;
          if (!context.markets.includes(decision.instrument)) {
            throw new PilotError("STRATEGY_RESPONSE_INVALID", "Unauthorized captured market");
          }
          return context.markets.map((symbol) => {
            const sourceIds =
              symbol === decision.instrument ? decision.sources : [`${symbol}:candles`];
            const finding = (index: number, state: "met" | "not-met") => ({
              index,
              state,
              reason: "controlled captured condition",
              sourceIds: sourceIds.slice(0, 1),
            });
            return {
              symbol,
              action: symbol === decision.instrument ? decision.action : ("hold" as const),
              reason: decision.rationale,
              sourceIds,
              brief: {
                entries: context.brief.entersWhen.map((_line, i) =>
                  finding(
                    i + 1,
                    decision.entries.some((item) => item.index === i + 1 && item.met)
                      ? "met"
                      : "not-met",
                  ),
                ),
                exits: context.brief.exitsWhen.map((_line, i) =>
                  finding(
                    i + 1,
                    decision.exits.some(
                      (item) =>
                        item.index === i + 1 &&
                        item.met &&
                        (item.instrument ?? decision.instrument) === symbol,
                    )
                      ? "met"
                      : "not-met",
                  ),
                ),
                never: context.brief.never.map((_line, i) =>
                  finding(
                    i + 1,
                    decision.never.some((item) => item.index === i + 1 && item.broken)
                      ? "met"
                      : "not-met",
                  ),
                ),
              },
            };
          });
        },
      },
    },
    check,
    holder,
    signal,
  );
}
