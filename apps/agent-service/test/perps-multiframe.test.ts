import test from "node:test";
import assert from "node:assert/strict";
import {
  validateMultiframeEvidence,
  perpsMultiframeRules,
  perpsRules,
  gateMultiframeProposal,
  multiframeFeatures,
  executePerpsStrategy,
  PERPS_MULTIFRAME_POLICY,
  type PerpsDecisionContext,
  type PerpsProposal,
} from "@pickler/trading/strategies";
import { simulatePerpsFill } from "@pickler/trading/perps";
import { contractContext } from "../src/perps-study/contract-context.js";
import {
  createPerpsStudyModels,
  perpsForecastPrompt,
  perpsMultiframeForecastPrompt,
} from "@pickler/agent-runtime/composition/perps-study-model";
import type { PerpsStudyConfig } from "@pickler/trading/evaluation";

function fixture(direction = 1): PerpsDecisionContext {
  const ctx = contractContext(1800000000000, true);
  for (const frame of ctx.evidence.frames) {
    frame.snapshot.funding = {
      rate: "0.00001",
      intervalSeconds: 3600,
      intervalBlocks: 3600,
      appliesAt: ctx.evidence.observedAt + 3600000,
      eventBlock: 10,
      applicationTimeEstimated: true,
      provenance: frame.book.provenance,
    };
  }
  for (const series of ctx.evidence.candles) {
    series.candles.forEach((c, i) => {
      c.close = (100 + direction * (i - 59) * 0.8).toFixed(2);
      c.open = c.close;
      c.high = (Number(c.close) + 1).toFixed(2);
      c.low = (Number(c.close) - 1).toFixed(2);
    });
  }
  return ctx;
}
const opening = (symbol: "BTC" | "ETH" = "BTC"): PerpsProposal => ({
  symbol,
  action: "open-long",
  reason: "controlled",
  sourceIds: [`${symbol}:market`],
});

test("multiframe preserves baseline and confirms long/short with the real fill simulator", () => {
  for (const sign of [1, -1]) {
    const ctx = fixture(sign);
    validateMultiframeEvidence(ctx.evidence);
    const proposals = perpsMultiframeRules(ctx);
    assert.ok(proposals.every((p) => p.action === (sign === 1 ? "open-long" : "open-short")));
    const fill = simulatePerpsFill(
      ctx.account,
      {
        kind: "open",
        symbol: "BTC",
        side: sign === 1 ? "long" : "short",
        notional: "100",
        feeReserve: "1",
      },
      ctx.evidence.frames[0]!,
      ctx.evidence.observedAt,
    );
    assert.ok(Number(fill.quantity) > 0);
    assert.ok(Number(fill.fee) > 0);
  }
  const ctx = fixture();
  const before = perpsRules(ctx);
  perpsMultiframeRules(ctx);
  assert.deepEqual(perpsRules(ctx), before);
  assert.equal(PERPS_MULTIFRAME_POLICY.horizonMs, 1800000);
});

test("countertrend, missing costs, shallow depth and insufficient recent movement block entries", () => {
  const ctx = fixture();
  const five = ctx.evidence.candles.find((s) => s.market.symbol === "BTC" && s.resolution === 300)!;
  five.candles.at(-1)!.close = "96";
  assert.equal(gateMultiframeProposal(ctx, opening()).reason, "DIRECTION_NOT_CONFIRMED");
  const noFunding = fixture();
  noFunding.evidence.frames[0]!.snapshot.funding = null;
  assert.equal(gateMultiframeProposal(noFunding, opening()).reason, "COST_DATA_UNAVAILABLE");
  const thin = fixture();
  thin.evidence.frames[0]!.book.asks[0]!.size = "0.001";
  assert.equal(gateMultiframeProposal(thin, opening()).reason, "INSUFFICIENT_DEPTH");
  const costly = fixture();
  costly.evidence.frames[0]!.snapshot.market.fees.taker = "0.1";
  assert.equal(gateMultiframeProposal(costly, opening()).reason, "RECENT_MOVE_BELOW_COST_HURDLE");
  assert.equal(multiframeFeatures(costly, "BTC").activityIsNotExpectedReturn, true);
});

test("final refresh removes an entry without another model call and horizon closes without reversal", () => {
  const ctx = fixture();
  assert.equal(gateMultiframeProposal(ctx, opening()).action, "open-long");
  ctx.evidence.frames[0]!.book.asks[0]!.price = "110";
  assert.equal(gateMultiframeProposal(ctx, opening()).action, "hold");
  const holding = fixture();
  holding.account.positions.push({
    symbol: "BTC",
    side: "long",
    openedAt: holding.evidence.observedAt - 1800000,
    closedAt: null,
  } as never);
  assert.equal(gateMultiframeProposal(holding, { ...opening(), action: "hold" }).action, "close");
  assert.equal(gateMultiframeProposal(holding, opening()).reason, "HORIZON_EXIT");
});

test("missing, stale, duplicate and wrong-identity short candles fail before paid admission", async () => {
  for (const mutate of [
    (c: PerpsDecisionContext) => c.evidence.candles.pop(),
    (c: PerpsDecisionContext) => {
      c.evidence.candles[2]!.to -= 300000;
    },
    (c: PerpsDecisionContext) => {
      c.evidence.candles[2]!.candles[1]!.openTime = c.evidence.candles[2]!.candles[0]!.openTime;
    },
    (c: PerpsDecisionContext) => {
      c.evidence.candles[2]!.market = { ...c.evidence.candles[2]!.market, marketId: 999 };
    },
  ]) {
    const ctx = fixture();
    mutate(ctx);
    let calls = 0;
    await assert.rejects(
      executePerpsStrategy({ id: "deepseek", version: "1.1.0" }, ctx, {
        models: { metadata: { strategyVersion: "1.1.0" }, direct: async () => [] },
        signal: new AbortController().signal,
        calls: {
          run: async () => {
            calls++;
            return [] as never;
          },
        },
      }),
    );
    assert.equal(calls, 0);
  }
});

test("versioned model context is bounded, explicit and preserves original responses", async () => {
  const config: PerpsStudyConfig = {
    version: 2,
    protocol: "perps-multiframe-v3",
    strategyVersion: "1.1.0",
    tenantId: "controlled",
    sessionId: "controlled",
    network: "mainnet",
    hours: 2,
    budgetUsd: "5",
    deepseek: {
      model: "controlled",
      baseUrl: "https://example.invalid/v1",
      inputPerMillion: "0.3",
      outputPerMillion: "1.2",
    },
    jev: { model: "jev-1.13.0", inputPerMillion: "0.042", outputPerMillion: "0" },
    pricingVerifiedAt: "2026-10-04T00:00:00Z",
    pricingSources: ["a", "b"],
  };
  let payload: { messages: { content: string }[] } = { messages: [] };
  const transport: typeof fetch = async (_url, init) => {
    assert.ok(new TextEncoder().encode(String(init!.body)).length < 30000);
    payload = JSON.parse(String(init!.body));
    return Response.json({
      model: "controlled",
      usage: { prompt_tokens: 100, completion_tokens: 30 },
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ actions: [opening(), opening("ETH")] }) },
        },
      ],
    });
  };
  const models = createPerpsStudyModels(config, { deepseek: "fixture", jev: "fixture" }, transport);
  const result = await models.direct(fixture(), new AbortController().signal, {
    before: async () => {},
    usage: async () => {},
  });
  const state = JSON.parse(payload.messages[1]!.content) as {
    policy: { horizonMs: number };
    features: unknown[];
    candles: { rows: unknown[]; columns: string[] }[];
  };
  assert.equal(state.policy.horizonMs, 1800000);
  assert.equal(state.features.length, 2);
  assert.equal(state.candles.length, 6);
  assert.ok(state.candles.every((s) => s.rows.length === 60 && s.columns.length === 2));
  assert.equal(result[0]!.action, "open-long");
  assert.notEqual(perpsForecastPrompt.sha256, perpsMultiframeForecastPrompt.sha256);
  assert.equal(perpsForecastPrompt.version, "1.0.0");
});

test("new protocol runs four independent accounts through the PostgreSQL coordinator and simulator", async (t) => {
  const { createTestStore } = await import("@pickler/infrastructure/testing");
  const { PostgresPerpsStudyStore, PostgresPerpsPaperStore } =
    await import("@pickler/infrastructure");
  const { createPerpsStudyRunner, perpsStrategies } = await import("@pickler/trading/evaluation");
  const { studyConfig } = await import("./perps-study-fixtures.js");
  let now = 1800000000000;
  const db = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(db.pool, () => now);
  const paper = new PostgresPerpsPaperStore(db.pool, () => now);
  const cfg: PerpsStudyConfig = {
    ...studyConfig,
    version: 2,
    protocol: "perps-multiframe-v3",
    strategyVersion: "1.1.0",
    hours: 2,
    sessionId: "multiframe-controlled",
  };
  await study.initialize(cfg, { controlled: true });
  let lease = await study.claim(cfg);
  let paidCalls = 0;
  let refreshes = 0;
  const recordCall = async (hooks: import("@pickler/trading/strategies").PerpsModelHooks) => {
    paidCalls++;
    await hooks.before({ sha256: "a".repeat(64), bytes: 100 });
    await hooks.usage(100, 1);
  };
  const evidence = () => {
    const ctx = fixture();
    const shift = now - ctx.evidence.observedAt;
    ctx.evidence.observedAt = now;
    for (const series of ctx.evidence.candles) {
      const end = Math.floor(now / (series.resolution * 1000)) * series.resolution * 1000;
      series.to = end;
      series.from = end - 60 * series.resolution * 1000;
      for (const [i, candle] of series.candles.entries()) {
        candle.openTime = series.from + i * series.resolution * 1000;
      }
    }
    for (const frame of ctx.evidence.frames) {
      frame.snapshot.ticker.provenance.providerTimestamp = now;
      frame.book.provenance.providerTimestamp = now;
      frame.snapshot.funding!.appliesAt! += shift;
    }
    return ctx.evidence;
  };
  const runner = createPerpsStudyRunner({
    study,
    paper,
    now: () => now,
    data: {
      observe: async () => ({ frames: evidence().frames, funding: [] }),
      evidence: async () => evidence(),
      execution: async () => {
        refreshes++;
        return evidence().frames;
      },
    },
    models: {
      metadata: { strategyVersion: "1.1.0" },
      direct: async (ctx, _signal, hooks) => {
        await recordCall(hooks);
        return (["BTC", "ETH"] as const).map((symbol) => ({
          ...opening(symbol),
          action: ctx.account.positions.some((p) => p.symbol === symbol && p.closedAt === null)
            ? ("close" as const)
            : ("open-long" as const),
        }));
      },
      decide: async (ctx, _signal, hooks) => {
        await recordCall(hooks);
        return {
          proposals: (["BTC", "ETH"] as const).map((symbol) => ({
            ...opening(symbol),
            action: ctx.account.positions.some((p) => p.symbol === symbol && p.closedAt === null)
              ? ("close" as const)
              : ("open-long" as const),
          })),
          answers: {},
        };
      },
      review: async (_ctx, proposals, _signal, hooks) => {
        await recordCall(hooks);
        return { proposals, answers: {} };
      },
      readiness: async () => {
        throw new Error("No legacy routing");
      },
    },
  });
  await runner.cycle(cfg, lease, new AbortController().signal);
  assert.equal(refreshes, 1);
  assert.equal(paidCalls, 4);
  const view = await study.view(cfg);
  for (const strategy of perpsStrategies(cfg)) {
    const account = (await paper.view({ ...cfg, agentId: view.record.agentIds[strategy]! }))
      .account;
    assert.equal(account.positions.filter((p) => p.closedAt === null).length, 2);
  }
  await study.release(cfg, lease);
  now += 15 * 60000;
  lease = await study.claim(cfg);
  await runner.cycle(cfg, lease, new AbortController().signal);
  for (const strategy of ["jev", "deepseek", "combined"] as const) {
    const account = (await paper.view({ ...cfg, agentId: view.record.agentIds[strategy]! }))
      .account;
    assert.equal(account.positions.filter((p) => p.closedAt === null).length, 0);
  }
  assert.equal(paidCalls, 8);
  await study.release(cfg, lease);
  now += 15 * 60000;
  lease = await study.claim(cfg);
  await runner.cycle(cfg, lease, new AbortController().signal);
  assert.ok(
    (await study.view(cfg)).events.some(
      (e) =>
        e.kind === "execution" &&
        (e.data as { proposal: PerpsProposal }).proposal.reason === "HORIZON_EXIT",
    ),
  );
  await study.release(cfg, lease);
});
