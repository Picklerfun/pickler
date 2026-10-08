import test from "node:test";
import assert from "node:assert/strict";
import { PERPL_LAB_SYMBOLS, type PerpSymbol } from "@pickler/core";
import {
  assertPerpsStudyConfig,
  profileSignal,
  profileProposals,
  profileFinal,
  perpsRules,
  SMA_PROFILE_VARIANTS,
  createProfileStudyRunner,
  perpsCallCost,
  EVALUATION_PROTOCOLS,
  type PerpsSmaProfileConfig,
  type PerpsEvidence,
} from "@pickler/trading/evaluation";
import {
  initialPaperAccount,
  paperRisk,
  selectiveReduction,
  type PerpsPaperAccount,
} from "@pickler/trading/perps";
import { createPerpsStudyModels } from "@pickler/agent-runtime/composition/perps-study-model";
import {
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
  exportPerpsAudit,
} from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { studyFrame } from "./perps-study-fixtures.js";
import { renderProfileReport } from "../src/perps-study/profiles-report.js";
import { perpsStudyReport } from "../src/perps-study/report.js";
const config: PerpsSmaProfileConfig = {
  version: 6,
  protocol: "perps-sma-profile-risk-v1",
  tenantId: "alpha",
  sessionId: "profile-test",
  network: "mainnet",
  hours: 6,
  budgetUsd: "5",
  markets: PERPL_LAB_SYMBOLS.map((symbol, i) => ({
    symbol,
    marketId: [1, 10, 20, 31, 40, 50, 60, 70, 90, 100, 110][i]!,
  })),
};
const at = 1800000000000;
function evidence(time = at): PerpsEvidence {
  const frames = config.markets.map((m) => {
    const f = studyFrame(time, m.symbol);
    f.snapshot.market.marketId = m.marketId;
    f.snapshot.market.perpetualId = m.marketId;
    f.book.market = f.snapshot.market;
    return f;
  });
  return {
    observedAt: time,
    frames,
    sourceIds: config.markets.map((m) => `${m.symbol}:candles`),
    candles: frames.flatMap((f) =>
      [3600, 900, 300].map((resolution) => {
        const end = Math.floor(time / (resolution * 1000)) * resolution * 1000;
        return {
          market: f.snapshot.market,
          resolution: resolution as 3600 | 900 | 300,
          from: end - 60 * resolution * 1000,
          to: end,
          missingOpenTimes: [],
          provenance: f.book.provenance,
          candles: Array.from({ length: 60 }, (_, i) => ({
            openTime: end - (60 - i) * resolution * 1000,
            open: "100",
            close: i >= 40 ? "101" : "100",
            high: "102",
            low: "99",
            volumeCollateral: "1000",
            trades: 10,
            closed: true,
          })),
        };
      }),
    ),
  };
}
function account(selective = false): PerpsPaperAccount {
  const a = initialPaperAccount({ ...config, agentId: "fixture" }, 1, at);
  a.riskManagement = selective ? "buffered-selective-1x-v1" : "legacy-1x-v1";
  return a;
}
function position(a: PerpsPaperAccount, symbol: PerpSymbol, qty = "1", mark = "100", entry = mark) {
  a.positions.push({
    id: symbol,
    symbol,
    side: "long",
    quantity: qty,
    entryPrice: entry,
    entryNotional: String(Number(qty) * Number(entry)),
    openedAt: at,
    entryBlock: 1,
    mark,
    markAt: at,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
  });
}
test("frozen profile config rejects models and a changed catalog", () => {
  assertPerpsStudyConfig(config);
  assert.throws(() => assertPerpsStudyConfig({ ...config, hours: 2 } as never));
  assert.throws(() => assertPerpsStudyConfig({ ...config, deepseek: {} } as never));
  assert.throws(() => perpsCallCost(config, "direct", 1, 1), /cannot reserve/);
  let calls = 0;
  assert.throws(() =>
    createPerpsStudyModels(config, { deepseek: "", jev: "" }, async () => {
      calls++;
      throw Error();
    }),
  );
  assert.equal(calls, 0);
  assert.ok(EVALUATION_PROTOCOLS[config.protocol].commands.includes("audit-export"));
  assert.deepEqual(EVALUATION_PROTOCOLS[config.protocol].paidCommands, []);
});
test("hourly parity, fast independence, strict 10bps and 5m equality", () => {
  const e = evidence(),
    a = account();
  assert.deepEqual(
    profileSignal({ evidence: e, account: a }, "hourly-legacy", ["BTC"]),
    perpsRules({ evidence: e, account: a }, ["BTC"]),
  );
  e.candles.reverse();
  assert.equal(
    profileSignal({ evidence: e, account: a }, "fast-legacy", ["BTC"])[0]!.action,
    "open-long",
  );
  e.candles = e.candles.filter((s) => s.resolution !== 3600);
  assert.equal(
    profileSignal({ evidence: e, account: a }, "fast-legacy", ["BTC"])[0]!.action,
    "open-long",
  );
  const c = e.candles
    .find((s) => s.market.symbol === "BTC" && s.resolution === 300)!
    .candles.at(-1)!;
  c.close = c.open;
  assert.equal(
    profileSignal({ evidence: e, account: a }, "fast-legacy", ["BTC"])[0]!.reason,
    "DIRECTION_NOT_CONFIRMED",
  );
  const s = e.candles.find((s) => s.market.symbol === "BTC" && s.resolution === 900)!;
  s.candles.forEach((c, i) => (c.close = i >= 40 ? "3003" : "2998"));
  c.close = "101";
  assert.equal(
    profileSignal({ evidence: e, account: a }, "fast-legacy", ["BTC"])[0]!.action,
    "hold",
  );
  s.candles.at(-1)!.close = "3003.000001";
  assert.equal(
    profileSignal({ evidence: e, account: a }, "fast-legacy", ["BTC"])[0]!.action,
    "open-long",
  );
  s.candles.forEach((c, i) => (c.close = i >= 40 ? "2997" : "3002"));
  c.close = "99";
  assert.equal(
    profileSignal({ evidence: e, account: a }, "fast-legacy", ["BTC"])[0]!.action,
    "hold",
  );
  s.candles.at(-1)!.close = "2996.999999";
  assert.equal(
    profileSignal({ evidence: e, account: a }, "fast-legacy", ["BTC"])[0]!.action,
    "open-short",
  );
});
test("confirmation conditions only openings, own trend invalidates positions", () => {
  const e = evidence(),
    a = account();
  position(a, "BTC");
  e.candles.find((s) => s.market.symbol === "BTC" && s.resolution === 300)!.candles.at(-1)!.close =
    "90";
  assert.equal(
    profileSignal({ evidence: e, account: a }, "fast-selective", ["BTC"])[0]!.action,
    "hold",
  );
  e.candles
    .find((s) => s.market.symbol === "BTC" && s.resolution === 900)!
    .candles.forEach((c) => (c.close = "100"));
  assert.equal(
    profileSignal({ evidence: e, account: a }, "fast-selective", ["BTC"])[0]!.action,
    "close",
  );
});
test("40% and 50% exact boundaries, no collective close for selective, daily emergency intact", () => {
  const a = account(true);
  position(a, "BTC", "4");
  assert.equal(paperRisk(a, [], at).closeSymbols.length, 0);
  assert.equal(
    paperRisk(a, [], at, {
      kind: "open",
      symbol: "ETH",
      side: "long",
      notional: "0.000001",
      feeReserve: "1",
    }).allowed,
    false,
  );
  a.positions[0]!.quantity = "5";
  assert.equal(selectiveReduction(a, evidence().frames, at).status, "not-required");
  a.positions[0]!.quantity = "5.000001";
  assert.equal(paperRisk(a, [], at).closeSymbols.length, 0);
  const legacy = structuredClone(a);
  delete legacy.riskManagement;
  assert.deepEqual(paperRisk(legacy, [], at).closeSymbols, ["BTC"]);
  a.dailyBlocked = true;
  assert.deepEqual(paperRisk(a, [], at).closeSymbols, ["BTC"]);
});
test("selective planner uses minimum cardinality then cost and IDs, excludes missing depth", () => {
  const a = account(true),
    e = evidence();
  for (const m of config.markets.slice(0, 5)) {
    position(a, m.symbol, "1.01");
  }
  const plan = selectiveReduction(a, e.frames, at);
  assert.equal(plan.status, "planned");
  assert.equal(plan.symbols.length, 2);
  assert.deepEqual(plan.symbols, ["BTC", "MON"]);
  e.frames.find((f) => f.snapshot.market.symbol === "BTC")!.book.bids = [];
  assert.ok(!selectiveReduction(a, e.frames, at).symbols.includes("BTC"));
  assert.equal(selectiveReduction(a, [], at).status, "pending");
  a.positions[0]!.markAt = at - 30001;
  assert.equal(selectiveReduction(a, e.frames, at).reason, "VALUATION_UNAVAILABLE");
});
test("ranking and common final gate never promote hold or change side", () => {
  const e = evidence(),
    a = account(true),
    initial = profileProposals({ evidence: e, account: a }, config, "fast-selective");
  assert.ok(initial.filter((p) => p.action.startsWith("open-")).length <= 4);
  assert.equal(initial.find((p) => p.rank === 1)?.symbol, "BTC");
  const first = initial.find((p) => p.action.startsWith("open-"))!;
  e.candles
    .find((s) => s.market.symbol === first.symbol && s.resolution === 300)!
    .candles.at(-1)!.close = "99";
  const final = profileFinal(initial, { evidence: e, account: a }, config, "fast-selective");
  assert.equal(final.find((p) => p.symbol === first.symbol)!.action, "hold");
  initial.forEach((p, i) => {
    if (p.action === "hold") {
      assert.equal(final[i]!.action, "hold");
    }
  });
});
test("final capacity ignores newly available candidates that were initial holds", () => {
  const e = evidence(),
    a = account(true);
  const initial = profileProposals({ evidence: e, account: a }, config, "hourly-selective");
  const withheld = initial.find((p) => p.action === "hold")!;
  e.candles
    .find((s) => s.market.symbol === withheld.symbol && s.resolution === 3600)!
    .candles.slice(-20)
    .forEach((c) => {
      c.close = "110";
      c.high = "110";
    });
  const final = profileFinal(initial, { evidence: e, account: a }, config, "hourly-selective");
  assert.deepEqual(
    final.filter((p) => p.action.startsWith("open-")).map((p) => p.symbol),
    initial.filter((p) => p.action.startsWith("open-")).map((p) => p.symbol),
  );
  assert.equal(final.find((p) => p.symbol === withheld.symbol)!.action, "hold");
});
test("PostgreSQL stores four distinct trusted policies, rejects changed policy and paid access", async (t) => {
  let time = at;
  const db = await createTestStore(t, () => time);
  const study = new PostgresPerpsStudyStore(db.pool, () => time),
    paper = new PostgresPerpsPaperStore(db.pool, () => time);
  const v = await study.initialize(config, { acquisitionPolicy: "rest-universe-20s-v1" });
  assert.deepEqual(Object.keys(v.record.agentIds).sort(), [...SMA_PROFILE_VARIANTS].sort());
  for (const variant of SMA_PROFILE_VARIANTS) {
    const s = { ...config, agentId: v.record.agentIds[variant]! };
    assert.equal(
      (await paper.view(s)).account.riskManagement,
      variant.endsWith("selective") ? "buffered-selective-1x-v1" : "legacy-1x-v1",
    );
  }
  const lease = await study.claim(config);
  const start = (await study.view(config)).record.startedAt!;
  while (time < start) {
    time = Math.min(start, time + 20000);
    await study.renew(config, lease);
  }
  await assert.rejects(study.guard(config, lease, true), /cannot access paid/);
  const s = { ...config, agentId: v.record.agentIds["fast-selective"]! };
  await db.pool.query(
    "UPDATE pickler.perps_paper_accounts SET document=jsonb_set(document,'{riskManagement}','\"legacy-1x-v1\"') WHERE agent_id=$1",
    [s.agentId],
  );
  await assert.rejects(
    paper.begin(s, 1, "forged", {
      kind: "open",
      symbol: "BTC",
      side: "long",
      notional: "100",
      feeReserve: "1",
    }),
    /risk management changed/,
  );
});
test("real coordinator and simulator open and close all four arms, shared final snapshot, read-only export and 3168 identities", async (t) => {
  let time = at;
  const db = await createTestStore(t, () => time);
  const study = new PostgresPerpsStudyStore(db.pool, () => time),
    paper = new PostgresPerpsPaperStore(db.pool, () => time);
  const v = await study.initialize(
    { ...config, sessionId: "cycle" },
    { acquisitionPolicy: "rest-universe-20s-v1" },
  );
  const lease = await study.claim(v.record.config);
  const start = (await study.view(v.record.config)).record.startedAt!;
  while (time < start) {
    time = Math.min(start, time + 20000);
    await study.renew(v.record.config, lease);
  }
  let finalCaptures = 0;
  const snapshot = () => evidence(time);
  const data = {
    observe: async () => ({ frames: snapshot().frames, funding: [] }),
    evidence: async () => snapshot(),
    execution: async () => snapshot().frames,
    finalEvidence: async () => {
      finalCaptures++;
      return snapshot();
    },
  };
  const runner = createProfileStudyRunner({ study, paper, data, now: () => time });
  await runner.cycle(v.record.config, lease, new AbortController().signal);
  assert.equal(finalCaptures, 1);
  for (const variant of SMA_PROFILE_VARIANTS) {
    const view = await paper.view({ ...v.record.config, agentId: v.record.agentIds[variant]! });
    assert.ok(view.account.positions.length > 0);
  }
  const frozen = await exportPerpsAudit(db.pool, v.record.config);
  const rendered = renderProfileReport(
    frozen,
    perpsStudyReport(frozen.study, frozen.accounts, time),
    "active",
  );
  assert.equal(rendered.rows.length, 3168);
  const again = renderProfileReport(
    frozen,
    perpsStudyReport(frozen.study, frozen.accounts, time),
    "active",
  );
  assert.equal(again.html, rendered.html);
  assert.equal(again.roundsCsv, rendered.roundsCsv);
  assert.ok(rendered.rows.some((r) => r.status === "SCHEDULED" && r.initialAction === null));
  const unsafe = structuredClone(frozen);
  unsafe.study.rounds[0]!.proposals["hourly-legacy"]![0]!.reason = "=<script>alert(1)</script>";
  const safe = renderProfileReport(
    unsafe,
    perpsStudyReport(unsafe.study, unsafe.accounts, time),
    "active",
  );
  assert.ok(!safe.html.includes("<script>alert(1)</script>"));
  assert.ok(safe.roundsCsv.includes("'=\u003cscript>"));
  assert.equal(frozen.study.rounds[0]!.executionStatus, "complete");
  assert.deepEqual(frozen.study.rounds[0]!.calls, {});
  await runner.cycle(v.record.config, lease, new AbortController().signal);
  assert.equal(finalCaptures, 1);
  await study.stop(v.record.config);
  time += 1000;
  await runner.cycle(v.record.config, lease, new AbortController().signal);
  for (const variant of SMA_PROFILE_VARIANTS) {
    const view = await paper.view({ ...v.record.config, agentId: v.record.agentIds[variant]! });
    assert.ok(view.account.positions.every((p) => p.closedAt !== null));
  }
});

test("post-fill selective exposure is rejected transactionally even when initial notional fits", async (t) => {
  const db = await createTestStore(t, () => at),
    study = new PostgresPerpsStudyStore(db.pool, () => at),
    paper = new PostgresPerpsPaperStore(db.pool, () => at);
  const v = await study.initialize(
    { ...config, sessionId: "postfill" },
    { acquisitionPolicy: "rest-universe-20s-v1" },
  );
  const scope = { ...v.record.config, agentId: v.record.agentIds["hourly-selective"]! };
  const a = (await paper.view(scope)).account;
  position(a, "MON", "3", "100");
  await db.pool.query("UPDATE pickler.perps_paper_accounts SET document=$2 WHERE agent_id=$1", [
    scope.agentId,
    a,
  ]);
  const opened = await paper.begin(scope, 1, "boundary", {
    kind: "open",
    symbol: "BTC",
    side: "long",
    notional: "100",
    feeReserve: "1",
  });
  assert.ok(opened.lease);
  await assert.rejects(
    paper.complete(scope, opened.lease!, {
      quantity: "1",
      price: "100",
      notional: "100",
      fee: "1",
      timestamp: at,
      block: 1,
      evidence: {},
    }),
    /buffered target/,
  );
  const after = await paper.view(scope);
  assert.equal(after.account.cash, "1000");
  assert.equal(after.account.positions.length, 1);
});

test("shared final-data failure preserves proposals, skips all arms, and next slot continues", async (t) => {
  let time = at;
  const db = await createTestStore(t, () => time),
    study = new PostgresPerpsStudyStore(db.pool, () => time),
    paper = new PostgresPerpsPaperStore(db.pool, () => time);
  const config2 = { ...config, sessionId: "refresh-failure" };
  const v = await study.initialize(config2, { acquisitionPolicy: "rest-universe-20s-v1" }),
    lease = await study.claim(config2);
  const start = (await study.view(config2)).record.startedAt!;
  while (time < start) {
    time = Math.min(start, time + 20000);
    await study.renew(config2, lease);
  }
  let fail = true;
  const data = {
    observe: async () => ({ frames: evidence(time).frames, funding: [] }),
    evidence: async () => evidence(time),
    execution: async () => evidence(time).frames,
    finalEvidence: async () => {
      const e = evidence(time);
      if (fail) {
        e.frames[0]!.book.provenance.providerTimestamp = time - 30001;
      }
      return e;
    },
  };
  const runner = createProfileStudyRunner({ study, paper, data, now: () => time });
  await runner.cycle(config2, lease, new AbortController().signal);
  const skipped = await study.view(config2);
  assert.equal(skipped.rounds[0]!.executionStatus, "skipped_data_unavailable");
  assert.equal(Object.keys(skipped.rounds[0]!.proposals).length, 4);
  for (const v2 of SMA_PROFILE_VARIANTS) {
    assert.equal(
      (await paper.view({ ...config2, agentId: v.record.agentIds[v2]! })).attempts.length,
      0,
    );
  }
  const next = time + 300000;
  while (time < next) {
    time = Math.min(next, time + 20000);
    await study.renew(config2, lease);
  }
  fail = false;
  await runner.cycle(config2, lease, new AbortController().signal);
  assert.equal((await study.view(config2)).rounds[1]!.executionStatus, "complete");
});

test("expired study lease rejects observations and release writes", async (t) => {
  let time = at;
  const db = await createTestStore(t, () => time),
    study = new PostgresPerpsStudyStore(db.pool, () => time);
  const c = { ...config, sessionId: "lease-expired" };
  await study.initialize(c, { acquisitionPolicy: "rest-universe-20s-v1" });
  const lease = await study.claim(c);
  const before = await exportPerpsAudit(db.pool, c);
  time += 90001;
  const paper = new PostgresPerpsPaperStore(db.pool, () => time, { ...c, owner: lease.owner });
  await assert.rejects(
    paper.observe({ ...c, agentId: before.study.record.agentIds["hourly-legacy"]! }, "late", {
      frames: evidence(time).frames,
      funding: [],
    }),
    /ownership expired/,
  );
  await assert.rejects(study.event(c, lease, "late", "late", {}), /ownership expired/);
  await study.release(c, lease, "LEASE_LOST");
  assert.deepEqual(await exportPerpsAudit(db.pool, c), before);
});

test("selective choice measures closing cost, not accumulated losses", () => {
  const a = account(true),
    e = evidence();
  for (const m of config.markets.slice(0, 5)) {
    position(a, m.symbol, "1.001");
  }
  a.cash = "1005";
  a.positions[0]!.entryPrice = "110";
  a.positions[0]!.entryNotional = "110.11";
  const plan = selectiveReduction(a, e.frames, at);
  assert.equal(plan.status, "planned");
  assert.ok(plan.symbols.includes("BTC"));
  const cheaper = e.frames.find((f) => f.snapshot.market.symbol === "ETH")!;
  cheaper.book.market.fees.taker = "0";
  cheaper.book.bids[0]!.price = "100";
  assert.ok(selectiveReduction(a, e.frames, at).symbols.includes("ETH"));
});

test("public-only host rejects paid opt-in before reading configuration or credentials", async () => {
  const { readFile } = await import("node:fs/promises");
  const host = await readFile(
    new URL("../src/perps-study/profiles-host.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!/MODEL_API_KEY|TYPESAFE_API_KEY|EXA_API_KEY|TRADING_PRIVATE_KEY/.test(host));
  const { runSmaProfiles } = await import("../src/perps-study/profiles-host.js");
  await assert.rejects(
    runSmaProfiles(
      { command: "run", configPath: "missing", allowPaid: true },
      new AbortController().signal,
    ),
    /paid calls are forbidden/,
  );
});

test("resource cleanup continues after reader and diagnostic failures", async () => {
  const { closeProfileResources } = await import("../src/perps-study/profiles-resources.js");
  const calls: string[] = [];
  const failures = await closeProfileResources([
    () => {
      calls.push("awake");
    },
    async () => {
      calls.push("reader");
      throw new Error("fixture reader failure");
    },
    async () => {
      calls.push("diagnostics");
      throw new Error("fixture file failure");
    },
    async () => {
      calls.push("postgres");
    },
  ]);
  assert.deepEqual(calls, ["awake", "reader", "diagnostics", "postgres"]);
  assert.deepEqual(failures, [1, 2]);
});

test("read-only reporting preserves completion, historical data and final exits outside admission slots", async (t) => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runSmaProfiles } = await import("../src/perps-study/profiles-host.js");
  const { runPerpsAudit } = await import("../src/perps-study/audit.js");
  const db = await createTestStore(t, () => at);
  const study = new PostgresPerpsStudyStore(db.pool, () => at);
  const c = { ...config, sessionId: "finished-report" };
  await study.initialize(c, {
    acquisitionPolicy: "rest-universe-20s-v1",
    commit: "frozen-fixture",
  });
  const lease = await study.claim(c);
  await study.event(c, lease, "closing-fixture", "profile-execution", {
    variant: "hourly-legacy",
    slot: 72,
    symbol: "BTC",
    action: "close",
    reason: "SESSION_END",
    status: "filled",
    before: { reasons: [] },
    after: {},
    openSymbolsAfter: [],
  });
  await study.event(c, lease, "observe-fixture:missed", "observation-missed", {
    code: "OBSERVATION_WINDOW_MISSED",
  });
  await study.complete(c, lease);
  await study.release(c, lease);
  const before = await exportPerpsAudit(db.pool, c);
  const directory = await mkdtemp(join(tmpdir(), "profile-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "study.json");
  const envFile = join(directory, "database.env");
  await writeFile(configPath, JSON.stringify(c));
  await writeFile(envFile, `DATABASE_URL=${db.pool.options.connectionString}\n`, { mode: 0o600 });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Network is forbidden");
  });

  await runSmaProfiles(
    { command: "report", configPath, envFile, output: directory },
    new AbortController().signal,
  );

  const rendered = JSON.parse(await readFile(join(directory, "report.json"), "utf8"));
  assert.equal(rendered.processState, "finished");
  assert.equal(rendered.metadata.commit, "frozen-fixture");
  assert.equal(typeof rendered.reportCommit, "string");
  assert.deepEqual(await exportPerpsAudit(db.pool, c), before);
  const executions = JSON.parse(await readFile(join(directory, "executions.json"), "utf8"));
  assert.equal(executions[0].slot, 72);
  assert.equal(executions[0].reason, "SESSION_END");
  assert.ok((await readFile(join(directory, "executions.csv"), "utf8")).includes('"SESSION_END"'));
  const html = await readFile(join(directory, "report.html"), "utf8");
  assert.ok(html.includes("All executions, including final exits"));
  assert.ok(html.includes("OBSERVATION_WINDOW_MISSED"));
  const exportDirectory = join(directory, "export");
  await runPerpsAudit({ command: "audit-export", configPath, envFile, output: exportDirectory });
  const state = join(exportDirectory, "audit-export.json");
  const packet = JSON.parse(await readFile(state, "utf8"));
  assert.equal(packet.payload.study.record.config.version, 6);
  assert.deepEqual(packet.payload.study, before.study);
  assert.deepEqual(await exportPerpsAudit(db.pool, c), before);
  await assert.rejects(
    runPerpsAudit({ command: "audit", state, output: join(directory, "unsupported") }),
    /model decision analyzer supports only/,
  );
});
