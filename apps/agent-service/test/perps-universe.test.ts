import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DEFAULT_CONFIG,
  PERPL_LAB_SYMBOLS,
  PERP_TOOLS,
  PilotError,
  assertConfig,
  type AgentRecord,
} from "@pickler/core";
import { agentConfigSchema } from "@pickler/api-schema";
import { initialPaperAccount, acquireUniverse, paperRisk } from "@pickler/trading/perps";
import {
  assertPerpsStudyConfig,
  universeProposals,
  universeFinal,
  reviewUniverse,
  createPerpsStudyRunner,
  perpsCallCost,
  type PerpsSmaUniverseConfig,
  type SmaReviewModels,
} from "@pickler/trading/evaluation";
import { createTestStore } from "@pickler/infrastructure/testing";
import {
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
  exportPerpsAudit,
  PerplMarketData,
  PerplRequestSchedule,
} from "@pickler/infrastructure";
import { createSmaReviewModels } from "@pickler/agent-runtime/composition/sma-review-model";
import { createUniversePerplReader } from "@pickler/agent-runtime/plugins/perps-paper";
import { syntheticUniverseEvidence } from "../src/perps-study/universe-contract.js";
import { universeReport } from "../src/perps-study/universe-report.js";
const config: PerpsSmaUniverseConfig = {
  version: 5,
  protocol: "perps-sma-jev-exa-all-markets-v1",
  hours: 2,
  tenantId: "alpha",
  sessionId: "universe",
  network: "mainnet",
  budgetUsd: "5",
  providerBudgetUSD: "2.50",
  authorization: { jevApproved: true, exaApproved: true, operatorRecordHash: "a".repeat(64) },
  historicalAccountedOrReservedUSD: null,
  historicalUnknownReservations: [],
  jev: { model: "jev-1.13.0", inputPerMillion: "0.042", outputPerMillion: "0" },
  exa: { reservationPerSearchUSD: "0.05", lookbackHours: 24, results: 5 },
  pricingVerifiedAt: "2026-10-07T00:00:00Z",
  pricingSources: ["https://docs.typesafe.ai/models", "https://exa.ai/pricing"],
  markets: PERPL_LAB_SYMBOLS.map((symbol, index) => ({
    symbol,
    marketId: [1, 10, 20, 31, 40, 50, 60, 70, 90, 100, 110][index]!,
  })),
  historicalBudget: { upperBoundUSD: "1", databaseAccountedUSD: "0", recordHash: "b".repeat(64) },
};
const now = 1800000000000;
const context = () => ({
  evidence: syntheticUniverseEvidence(config, now),
  account: initialPaperAccount({ ...config, agentId: "fixture" }, 1, now),
});
const answers = (symbol: string, veto = false) =>
  Object.fromEntries(
    ["identity", "evidence", "costs"].map((k) => [
      `${symbol}_${k}`,
      {
        choice: veto && k === "evidence" ? "CONTRADICTED" : "CONSISTENT",
        confidence: 1,
        probabilities: {
          CONSISTENT: veto && k === "evidence" ? 0 : 1,
          CONTRADICTED: veto && k === "evidence" ? 1 : 0,
          UNKNOWN: 0,
        },
      },
    ]),
  );
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
test("private universe config leaves public BTC/ETH configuration unchanged and bounds historical/new reserves", () => {
  assertPerpsStudyConfig(config);
  const privateConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    plugins: { version: 1 as const, enabled: ["perpl" as const] },
    tools: [...PERP_TOOLS],
    perpl: { version: 2 as const, network: "mainnet" as const, markets: [...PERPL_LAB_SYMBOLS] },
  };
  assertConfig(privateConfig);
  assert.equal(agentConfigSchema.safeParse(privateConfig).success, false);
  assert.throws(() =>
    assertPerpsStudyConfig({
      ...config,
      historicalBudget: { ...config.historicalBudget, upperBoundUSD: "2.500000001" },
    }),
  );
  assert.throws(() => assertPerpsStudyConfig({ ...config, markets: config.markets.slice(1) }));
  assert.throws(() =>
    assertPerpsStudyConfig({
      ...config,
      historicalUnknownReservations: [
        {
          sessionId: config.sessionId,
          roundKey: "round-1",
          lane: "direct",
          requestHash: "a".repeat(64),
          reservationUsd: "0.024576",
        },
      ],
    }),
  );
  const synthetic = context().evidence;
  for (const frame of synthetic.frames) {
    assert.equal(frame.hash, digest({ snapshot: frame.snapshot, book: frame.book }));
  }
  assert.equal(perpsCallCost(config, "sma-review:MON", 65536, 0), "0.002752512");
  assert.throws(() => perpsCallCost(config, "direct", 100, 10));
});
test("selection ranks exact hourly separation with market-ID ties, caps five and has no replacement after veto", () => {
  const c = context();
  const result = universeProposals(c, config);
  assert.equal(result.filter((p) => p.action === "open-long").length, 5);
  assert.deepEqual(
    result
      .filter((p) => p.action === "open-long")
      .sort((a, b) => a.rank! - b.rank!)
      .map((p) => p.symbol),
    ["BTC", "MON", "ETH", "SOL", "HYPE"],
  );
  assert.equal(
    universeProposals(c, config, true).filter((p) => p.action.startsWith("open-")).length,
    0,
  );
  c.evidence.candles.push({
    ...structuredClone(c.evidence.candles[0]!),
    resolution: 300,
    candles: [],
  });
  c.evidence.candles.reverse();
  assert.deepEqual(
    universeProposals(c, config).map((p) => p.action),
    result.map((p) => p.action),
  );
  const final = universeFinal(
    result.map((p) =>
      p.symbol === "BTC" ? { ...p, action: "hold", reason: "JEV_MATERIAL_VETO" } : p,
    ),
    c,
    config,
  );
  assert.equal(final.find((p) => p.symbol === "BTC")!.action, "hold");
  assert.equal(final.filter((p) => p.action.startsWith("open-")).length, 4);
});
test("final missing asset and signal changes block only approved openings; no hold becomes an opening", () => {
  const c = context(),
    initial = universeProposals(c, config);
  c.evidence.excluded = [{ symbol: "BTC", code: "STALE_MARKET_DATA", phase: "execution-refresh" }];
  c.evidence.candles
    .find((v) => v.market.symbol === "MON")!
    .candles.forEach((v) => {
      v.close = "100";
    });
  const result = universeFinal(initial, c, config);
  assert.equal(result.find((p) => p.symbol === "BTC")!.reason, "DATA_UNAVAILABLE");
  assert.equal(result.find((p) => p.symbol === "MON")!.reason, "SMA_FINAL_GATE_CHANGED");
  assert.equal(result.find((p) => p.symbol === "UNI")!.action, "hold");
});
test("asset reviews receive isolated evidence and own portfolio, use independent lanes, and do not veto exits", async () => {
  const c = context(),
    selected = universeProposals(c, config);
  const lanes: string[] = [];
  const models: SmaReviewModels = {
    metadata: {},
    news: async (asset) => ({ sources: [], excluded: [], cutoff: asset.evidence.observedAt }),
    review: async (asset, p) => {
      assert.equal(asset.evidence.frames.length, 1);
      assert.equal(asset.evidence.candles.length, 1);
      assert.equal(asset.account.scope.agentId, "fixture");
      return answers(p[0]!.symbol, p[0]!.symbol === "BTC");
    },
  };
  const reviewed = await reviewUniverse(
    "sma-exa-jev",
    c,
    selected,
    models,
    {
      run: async (lane, fn) => {
        lanes.push(lane);
        return fn({ before: async () => {}, usage: async () => {} });
      },
    },
    new AbortController().signal,
  );
  assert.equal(lanes.length, 10);
  assert.equal(new Set(lanes).size, 10);
  assert.equal(reviewed.find((p) => p.symbol === "BTC")!.reason, "JEV_MATERIAL_VETO");
  assert.equal(reviewed.filter((p) => p.action.startsWith("open-")).length, 4);
});
test("joint acquisition excludes stale ETH, recovers ticker skew and never chooses an old matching book", async () => {
  let clock = now;
  const c = context(),
    expected = c.evidence.frames.filter(
      (f) => f.book.market.symbol === "BTC" || f.book.market.symbol === "ETH",
    );
  let btcReads = 0;
  const result = await acquireUniverse({
    network: "mainnet",
    symbols: ["BTC", "ETH"],
    now: () => clock,
    signal: new AbortController().signal,
    guard: async () => {},
    hash: digest,
    wait: async () => {
      clock += 2000;
    },
    book: async (symbol) => {
      clock += 1000;
      const b = structuredClone(expected.find((f) => f.book.market.symbol === symbol)!.book);
      b.provenance.providerTimestamp = clock;
      return b;
    },
    snapshot: async (symbol) => {
      clock += 1000;
      const s = structuredClone(
        expected.find((f) => f.snapshot.market.symbol === symbol)!.snapshot,
      );
      s.ticker.provenance.providerTimestamp =
        symbol === "ETH" ? now - 60000 : ++btcReads === 1 ? clock - 10000 : clock;
      return s;
    },
  });
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0]!.book.market.symbol, "BTC");
  assert.equal(result.excluded[0]!.symbol, "ETH");
  assert.ok(clock - now <= 24000);
  assert.ok(
    Math.abs(
      result.frames[0]!.book.provenance.providerTimestamp! -
        result.frames[0]!.snapshot.ticker.provenance.providerTimestamp!,
    ) <= 5000,
  );
});
test("revocation fails acquisition rather than returning a usable buffer", async () => {
  let calls = 0;
  await assert.rejects(
    acquireUniverse({
      network: "mainnet",
      symbols: ["BTC"],
      now: () => now,
      signal: new AbortController().signal,
      hash: digest,
      guard: async () => {
        if (++calls > 1) {
          throw new PilotError("PLUGIN_DISABLED", "revoked");
        }
      },
      wait: async () => {},
      book: async () => context().evidence.frames[0]!.book,
      snapshot: async () => context().evidence.frames[0]!.snapshot,
    }),
    { code: "PLUGIN_DISABLED" },
  );
});
for (const side of ["long", "short"] as const) {
  test(`real PostgreSQL coordinator executes and closes five independent ${side} positions per arm without paid transport`, async (t) => {
    let clock = now;
    const research = await createTestStore(t, () => clock),
      study = new PostgresPerpsStudyStore(research.pool, () => clock),
      paper = new PostgresPerpsPaperStore(research.pool, () => clock);
    const view = await study.initialize(config, {
        purpose: "contracts-universe-v1",
        acquisitionPolicy: "rest-universe-20s-v1",
      }),
      lease = await study.claim(config);
    const evidence = () => {
      const e = syntheticUniverseEvidence(config, clock);
      if (side === "short") {
        e.candles.slice(0, 5).forEach((s) =>
          s.candles.slice(-20).forEach((c) => {
            c.close = "99";
          }),
        );
      }
      return e;
    };
    let refresh = 0;
    const models: SmaReviewModels = {
      metadata: {},
      news: async (c, _s, h) => {
        await h.before({ sha256: "c".repeat(64), bytes: 10 });
        await h.cost!("0.007");
        return { sources: [], excluded: [], cutoff: c.evidence.observedAt };
      },
      review: async (_c, p, _n, _s, h) => {
        await h.before({ sha256: "d".repeat(64), bytes: 20 });
        await h.usage(100, 10);
        return answers(p[0]!.symbol);
      },
    };
    const runner = createPerpsStudyRunner({
      study,
      paper,
      now: () => clock,
      smaModels: models,
      data: {
        observe: async () => ({
          frames: evidence().frames,
          funding: evidence().frames.map((f) => ({
            market: f.book.market,
            from: view.record.createdAt,
            to: clock,
            complete: true,
            events: [],
            pages: [f.book.provenance],
          })),
        }),
        evidence: async () => evidence(),
        execution: async () => {
          refresh++;
          return evidence().frames;
        },
      },
    });
    await runner.cycle(config, lease, new AbortController().signal);
    const saved = await study.view(config);
    assert.equal(saved.rounds[0]!.executionStatus, "complete");
    assert.equal(Object.values(saved.rounds[0]!.calls).length, 15);
    assert.equal(refresh, 1);
    for (const id of Object.values(view.record.agentIds)) {
      const v = await paper.view({ ...config, agentId: id });
      assert.equal(
        v.account.positions.filter((p) => p.closedAt === null && p.side === side).length,
        5,
      );
      assert.ok(
        Number(paperRisk(v.account, [], clock).exposure) <=
          Number(paperRisk(v.account, [], clock).equity!) * 0.5,
      );
    }
    await runner.cycle(config, lease, new AbortController().signal);
    assert.equal((await study.view(config)).rounds.length, 1);
    await study.stop(config);
    await runner.cycle(config, lease, new AbortController().signal);
    const packet = await exportPerpsAudit(research.pool, config),
      report = universeReport(packet, "finished");
    assert.equal(report.rows.length, 264);
    assert.equal(report.reservationsUSD, "0.27752512");
    for (const variant of ["rules", "sma-jev", "sma-exa-jev"] as const) {
      const entries = report.assetResults.filter((r) => r.variant === variant);
      assert.equal(
        entries.reduce((n, r) => n + r.fills, 0),
        10,
      );
      const ledger = packet.accounts[variant]!.movements.filter((m) => m.kind !== "initial");
      assert.ok(
        Math.abs(
          entries.reduce((n, r) => n + Number(r.netRealizedAUSD), 0) -
            ledger.reduce((n, m) => n + Number(m.delta), 0),
        ) < 1e-9,
      );
    }
    assert.equal(report.html, universeReport(packet, "finished").html);
    for (const account of Object.values(packet.accounts)) {
      assert.ok(account!.account.positions.every((p) => p.closedAt !== null));
      assert.equal(account!.attempts.filter((a) => a.status === "filled").length, 10);
    }
    clock += 90001;
    await assert.rejects(study.event(config, lease, "late", "late", {}), { code: "LEASE_LOST" });
    await study.release(config, lease);
  });
}
test("concurrent Jev queue cancels waiting calls without exceeding two active requests", async () => {
  const c = context(),
    modelContext = {
      ...c,
      evidence: {
        ...c.evidence,
        frames: [c.evidence.frames[0]!],
        candles: [c.evidence.candles[0]!],
      },
    };
  let active = 0,
    max = 0,
    requests = 0;
  const controller = new AbortController();
  const model = createSmaReviewModels(
    config,
    { jev: "fixture", exa: "fixture" },
    { exa: async () => {}, review: async () => {} },
    async (_url, init) => {
      requests++;
      active++;
      max = Math.max(max, active);
      await new Promise<void>((resolve) =>
        init!.signal!.addEventListener("abort", () => resolve(), { once: true }),
      );
      active--;
      throw init!.signal!.reason;
    },
  );
  const pending = Array.from({ length: 5 }, () =>
    model.review(modelContext, [], null, controller.signal, {
      before: async () => {},
      usage: async () => {},
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort(new PilotError("MODEL_TIMEOUT", "controlled"));
  await Promise.allSettled(pending);
  assert.equal(max, 2);
  assert.equal(requests, 2);
});
function wireContext() {
  return {
    chain: { chain_id: 143, gas: { h: 100 } },
    instances: [{ id: 1, address: "0x" + "1".repeat(40), collateral_token_id: 1 }],
    tokens: [{ id: 1, address: "0x" + "2".repeat(40), symbol: "AUSD", decimals: 6 }],
    markets: config.markets.map((m) => ({
      ver: 1,
      id: m.marketId,
      instance_id: 1,
      perpetual_id: m.marketId,
      symbol: "",
      name: m.symbol,
      size_units: m.symbol,
      funding_interval_sec: 3600,
      funding_interval_blocks: 100,
      config: {
        at: { t: now - 86400000, b: 1 },
        is_open: true,
        price_decimals: 1,
        size_decimals: 2,
        initial_margin: 1000,
        maintenance_margin: 2000,
        maker_fee: 45,
        taker_fee: 345,
      },
      funding: { at: { t: now, b: 100 }, feb: 100, rate: 0 },
    })),
  };
}
test("bulk ticker caches raw body for three seconds, preserves per-asset times, guards reuse, and refuses missing keys", async () => {
  let clock = now,
    allowed = true,
    requests = 0;
  const schedule = new PerplRequestSchedule();
  const data = new PerplMarketData({
    universe: true,
    sessionLimit: 24,
    now: () => clock,
    schedule,
    transport: async (input) => {
      schedule.lastStart = -Infinity;
      requests++;
      return String(input).endsWith("context")
        ? Response.json(wireContext())
        : Response.json({
            mt: 9,
            sn: 1,
            d: {
              1: {
                at: { t: now - 1000, b: 100 },
                mrk: 1000,
                orl: 1000,
                lst: 1000,
                bid: 999,
                ask: 1001,
                oi: 100,
              },
              10: {
                at: { t: now - 2000, b: 99 },
                mrk: 2000,
                orl: 2000,
                lst: 2000,
                bid: 1999,
                ask: 2001,
                oi: 100,
              },
            },
          });
    },
  });
  const ctx = {
    signal: new AbortController().signal,
    guard: async () => {
      if (!allowed) {
        throw new PilotError("PLUGIN_DISABLED", "revoked");
      }
    },
  };
  const btc = await data.snapshot("mainnet", "BTC", ctx),
    mon = await data.snapshot("mainnet", "MON", ctx);
  assert.equal(requests, 2);
  assert.equal(mon.ticker.provenance.providerTimestamp, now - 2000);
  assert.equal(btc.ticker.mark, "100");
  await assert.rejects(data.snapshot("mainnet", "ETH", ctx), { code: "DATA_UNAVAILABLE" });
  assert.equal(requests, 2);
  allowed = false;
  await assert.rejects(data.snapshot("mainnet", "BTC", ctx), { code: "PLUGIN_DISABLED" });
  assert.equal(requests, 2);
  allowed = true;
  clock += 3001;
  await data.snapshot("mainnet", "BTC", ctx);
  assert.equal(requests, 3);
});
test("universe reader rejects cross-agent reuse and closed reader before transport", async () => {
  const record: AgentRecord = {
    id: "a",
    tenantId: "alpha",
    version: 1,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
    config: {
      ...structuredClone(DEFAULT_CONFIG),
      plugins: { version: 1, enabled: ["perpl"] },
      tools: [...PERP_TOOLS],
      perpl: { version: 2, network: "mainnet", markets: [...PERPL_LAB_SYMBOLS] },
    },
  };
  let requests = 0;
  const reader = createUniversePerplReader(
    { agent: async (scope) => ({ ...record, id: scope.agentId }) },
    {
      transport: async () => {
        requests++;
        throw new Error("No transport expected");
      },
    },
  );
  await reader.session({ tenantId: "alpha", agentId: "a" }, new AbortController().signal);
  await assert.rejects(
    reader.session({ tenantId: "alpha", agentId: "b" }, new AbortController().signal),
    { code: "CONFIG_CHANGED" },
  );
  await reader.close();
  await assert.rejects(
    reader.session({ tenantId: "alpha", agentId: "a" }, new AbortController().signal),
    { code: "DATA_READER_CLOSED" },
  );
  assert.equal(requests, 0);
});
test("new unknown review consumption blocks every arm and retains joint reservations without replay", async (t) => {
  const research = await createTestStore(t, () => now),
    study = new PostgresPerpsStudyStore(research.pool, () => now),
    paper = new PostgresPerpsPaperStore(research.pool, () => now);
  const view = await study.initialize(config, { purpose: "contracts-universe-v1" }),
    lease = await study.claim(config);
  const models: SmaReviewModels = {
    metadata: {},
    news: async (c, _s, h) => {
      await h.before({ sha256: "c".repeat(64), bytes: 1 });
      await h.cost!("0.007");
      return { sources: [], excluded: [], cutoff: c.evidence.observedAt };
    },
    review: async (_c, _p, _n, _s, h) => {
      await h.before({ sha256: "d".repeat(64), bytes: 1 });
      throw new PilotError("MODEL_TIMEOUT", "controlled");
    },
  };
  const runner = createPerpsStudyRunner({
    study,
    paper,
    now: () => now,
    smaModels: models,
    data: {
      observe: async () => ({ frames: context().evidence.frames, funding: [] }),
      evidence: async () => context().evidence,
      execution: async () => {
        throw new Error("No final execution after failure");
      },
    },
  });
  await runner.cycle(config, lease, new AbortController().signal);
  const saved = await study.view(config);
  assert.equal(saved.record.status, "closing");
  assert.equal(saved.record.decisionStopReason, "MODEL_TIMEOUT");
  assert.equal(saved.rounds[0]!.executionStatus, "incomplete");
  assert.ok(
    Object.values(saved.rounds[0]!.calls).some((c) => c.status === "failed" && c.costUsd === null),
  );
  assert.equal(
    Object.values(saved.rounds[0]!.calls)
      .reduce((sum, c) => sum + Number(c.reservationUsd), 0)
      .toFixed(9),
    "0.277525120",
  );
  for (const id of Object.values(view.record.agentIds)) {
    assert.equal((await paper.view({ ...config, agentId: id })).attempts.length, 0);
  }
  await study.release(config, lease);
  await assert.rejects(
    study.authorizeContinuation(config, {
      hash: "f".repeat(64),
      commit: "a".repeat(40),
      reason: "must not resume v5",
    }),
  );
});
