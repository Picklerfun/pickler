import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BRIEF, STARTER_CAPS, prepareDraft, type PerpMarketInfo } from "@pickler/core";
import {
  initialPaperAccount,
  runStudioPerpsCheck,
  type PerpsCheck,
  type PerpsCheckLease,
  type PerpsPaperFrame,
  type StudioPerpsCheckDependencies,
} from "@pickler/trading/perps";

async function run({ delay = 0, invalid = false, remaining = 24 } = {}) {
  let clock = Date.UTC(2026, 9, 6, 12);
  const scope = {
    tenantId: "tenant",
    agentId: "agent",
    sessionId: "product",
    network: "testnet" as const,
  };
  const config = prepareDraft({
    markets: ["SOL"],
    name: "Controlled",
    handle: "controlled",
    voice: "analyst",
    avatar: { accent: "lime", pattern: 0 },
    sources: { web: null },
    brief: { ...DEFAULT_BRIEF, entersWhen: ["Controlled trend"], exitsWhen: [], never: [] },
    caps: STARTER_CAPS,
    walletId: "controlled",
  }).config;
  const provenance = {
    provider: "perpl" as const,
    pluginVersion: "1.1.0" as const,
    network: "testnet" as const,
    chainId: 10143,
    url: "https://controlled.invalid",
    receivedAt: clock,
    providerTimestamp: clock,
    block: 100,
  };
  const market: PerpMarketInfo = {
    symbol: "SOL",
    marketId: 3,
    perpetualId: 3,
    instanceId: 1,
    exchangeAddress: "0xexchange",
    collateral: { tokenId: 1, address: "0xcollateral", symbol: "AUSD", decimals: 6 },
    configVersion: 1,
    priceDecimals: 2,
    sizeDecimals: 4,
    open: true,
    fundingIntervalSeconds: 3600,
    fundingIntervalBlocks: 100,
    initialMarginRaw: 100,
    maintenanceMarginRaw: 50,
    fees: { basis: "public-base-tier", maker: "0", taker: "0.0002" },
    provenance,
  };
  const frame: PerpsPaperFrame = {
    snapshot: {
      market,
      ticker: {
        mark: "100",
        index: "100",
        last: "100",
        bid: "99",
        ask: "101",
        openInterestBase: "20",
        freshness: "fresh",
        provenance,
      },
      funding: null,
    },
    book: {
      market,
      requestedLevels: 20,
      depthLimited: true,
      freshness: "fresh",
      provenance,
      bids: [{ price: "99", size: "100", orders: 1 }],
      asks: [{ price: "101", size: "100", orders: 1 }],
    },
    hash: "a".repeat(64),
  };
  const last = clock - 3600000;
  const candles = {
    market: invalid ? { ...market, perpetualId: 999 } : market,
    resolution: 3600,
    from: last - 59 * 3600000,
    to: last,
    missingOpenTimes: [],
    provenance,
    candles: Array.from({ length: 60 }, (_, index) => ({
      openTime: last - (59 - index) * 3600000,
      open: "100",
      high: "101",
      low: "99",
      close: "100",
      volume: "1",
      trades: 1,
      closed: true,
    })),
  };
  const account = initialPaperAccount(scope, 1, clock);
  account.cash = "100";
  account.fundingPending = false;
  const view = { account, attempts: [], movements: [] };
  const check = {
    id: "check",
    productAgentId: "product",
    ...scope,
    trigger: "manual",
    configVersion: 1,
  } as unknown as PerpsCheck;
  const lease = { checkId: "check", owner: "owner", expiresAt: clock + 120000 } as PerpsCheckLease;
  const calls: string[] = [];
  const forbidden = async () => {
    throw new Error("No execution or external transport is allowed");
  };
  const deps = {
    now: () => clock,
    hash: () => "a".repeat(64),
    requestLimit: 24,
    agents: {
      agent: async () => ({ id: "agent", tenantId: "tenant", version: 1, config, paused: false }),
    },
    store: {
      renewAgent: async (current: PerpsCheckLease) => current,
      appendStep: async () => {},
      finishCheck: async (_lease: PerpsCheckLease, result: Record<string, unknown>) => ({
        ...check,
        ...result,
      }),
    },
    paper: () => ({ view: async () => view, observe: async () => view, closePosition: forbidden }),
    initialCash: forbidden,
    data: async () => ({
      read: async () => ({ frame, candles, sources: [] }),
      frame: async () => frame,
      funding: forbidden,
      remainingRequests: () => remaining,
    }),
    web: forbidden,
    policy: {
      version: 1,
      enabled: true,
      reviewedAt: "controlled",
      perOperationMicros: "1000",
      perDayMicros: "1000",
    },
    callPlans: ["fallback", "review"].map((key) => ({ key })),
    costs: {
      reserve: async () => {},
      evidence: async () => {},
      unknown: forbidden,
      start: async (_scope: unknown, key: string) => {
        calls.push(key);
      },
      complete: async () => {
        clock += delay;
      },
      finish: async () => ({
        costMicros: String(calls.length * 11),
        accountedMicros: String(calls.length * 11),
      }),
    },
    models: {
      direct: async (
        _context: unknown,
        _signal: AbortSignal,
        hooks: {
          before(value: unknown): Promise<void>;
          usage(input: number, output: number): Promise<void>;
        },
      ) => {
        await hooks.before({ sha256: "a".repeat(64), bytes: 10 });
        await hooks.usage(100, 10);
        return [
          {
            symbol: "SOL",
            action: "hold",
            reason: "Controlled",
            sourceIds: ["SOL:candles"],
            brief: {
              entries: [
                { index: 1, state: "met", reason: "Controlled", sourceIds: ["SOL:candles"] },
              ],
              exits: [],
              never: [],
            },
          },
        ];
      },
      review: async (
        _context: unknown,
        _proposals: unknown,
        _signal: AbortSignal,
        hooks: {
          before(value: unknown): Promise<void>;
          usage(input: number, output: number): Promise<void>;
        },
      ) => {
        await hooks.before({ sha256: "a".repeat(64), bytes: 10 });
        await hooks.usage(100, 10);
        return {
          answers: Object.fromEntries(
            ["identity", "evidence", "costs"].map((key) => [
              `SOL_${key}`,
              { choice: "CONSISTENT", confidence: 1, probabilities: { CONSISTENT: 1 } },
            ]),
          ),
        };
      },
    },
  } as unknown as StudioPerpsCheckDependencies;
  const result = await runStudioPerpsCheck(deps, check, { lease }, new AbortController().signal);
  return { result, calls };
}

test("dynamic combined revalidates evidence before its independent review; stale evidence never causes another call", async () => {
  const complete = await run();
  assert.deepEqual(complete.calls, ["fallback", "review"]);
  assert.equal(complete.result.outcome, "held");

  const stale = await run({ delay: 31000 });
  assert.deepEqual(stale.calls, ["fallback"]);
  assert.equal(stale.result.outcome, "failed");
  assert.equal(stale.result.error, "STALE_MARKET_DATA");
});

test("invalid candle identity or insufficient remaining execution transport blocks all paid lanes", async () => {
  for (const settings of [{ invalid: true }, { remaining: 0 }]) {
    const { result, calls } = await run(settings);
    assert.equal(result.outcome, "failed");
    assert.deepEqual(calls, []);
    assert.equal(result.error, "DATA_UNAVAILABLE");
  }
});
