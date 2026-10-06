import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PilotError } from "@pickler/core";
import {
  PERPS_SMA_STRATEGIES,
  smaAblationProposal,
  finalSmaProposal,
  commonSmaExit,
  createPerpsStudyRunner,
  startLeaseHeartbeat,
  smaStudyReport,
  perpsCallCost,
  perpsDataFailureDiagnostic,
  canonicalAudit,
  type SmaStudyConfig,
  type PerpsStudyMap,
} from "@pickler/trading/evaluation";
import { perpsMultiframeRules } from "@pickler/trading/strategies";
import { type PerpsPaperView, simulatePerpsFill, applyPaperFill } from "@pickler/trading/perps";
import {
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
  exportPerpsAudit,
} from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { contractContext } from "../src/perps-study/contract-context.js";
import { writeSmaReport, runSmaStudy } from "../src/perps-study/sma-host.js";

const config: SmaStudyConfig = {
  version: 3,
  protocol: "perps-sma-ablation-v1",
  tenantId: "alpha",
  sessionId: "sma-controlled",
  network: "mainnet",
  hours: 6,
  acquisitionPolicy: "rest-paced-20s-v1",
  strategyVersion: "sma-ablation-v1",
  entryPolicyVersion: "sma-ablation-entries-v1",
  exitPolicyVersion: "multiframe-common-exits-v1",
};
function context(now = 1800000060000, sign = 1, step = 0.8) {
  const ctx = contractContext(now, true);
  for (const f of ctx.evidence.frames) {
    f.snapshot.funding = {
      rate: "0.00001",
      intervalSeconds: 3600,
      intervalBlocks: 3600,
      appliesAt: now + 3600000,
      eventBlock: 10,
      applicationTimeEstimated: true,
      provenance: f.book.provenance,
    };
  }
  for (const series of ctx.evidence.candles) {
    for (const [i, c] of series.candles.entries()) {
      c.close = (100 + sign * (i - 59) * (series.resolution === 3600 ? 0.8 : step)).toFixed(6);
      c.open = c.close;
      c.high = (Number(c.close) + 1).toFixed(6);
      c.low = (Number(c.close) - 1).toFixed(6);
    }
  }
  return ctx;
}
test("ablation isolates activity and direction while preserving hourly selection and historical gates", () => {
  for (const sign of [1, -1]) {
    const ctx = context(undefined, sign, 0.001);
    const hourly = smaAblationProposal(ctx, "sma-hourly");
    const direction = smaAblationProposal(ctx, "sma-direction");
    const full = smaAblationProposal(ctx, "sma-multiframe");
    assert.equal(hourly[0]!.proposal.action, sign === 1 ? "open-long" : "open-short");
    assert.equal(direction[0]!.proposal.action, hourly[0]!.proposal.action);
    assert.equal(full[0]!.proposal.reason, "RECENT_MOVE_BELOW_COST_HURDLE");
    assert.equal(full[0]!.trace.firstBlock, "RECENT_MOVE_BELOW_COST_HURDLE");
    assert.deepEqual(hourly[0]!.trace.coincidentBlocks, []);
    assert.deepEqual(direction[0]!.trace.coincidentBlocks, []);
    assert.equal(
      direction[0]!.trace.checks.find((c) => c.code === "RECENT_MOVE_BELOW_COST_HURDLE")!.enforced,
      false,
    );
    assert.deepEqual(
      full.map((c) => c.proposal.action),
      perpsMultiframeRules(ctx).map((p) => p.action),
    );
    ctx.evidence.candles.reverse();
    assert.deepEqual(smaAblationProposal(ctx, "sma-hourly"), hourly);
  }
  const flat = context(undefined, 1, 0);
  assert.equal(
    smaAblationProposal(flat, "sma-direction")[0]!.proposal.reason,
    "DIRECTION_NOT_CONFIRMED",
  );
  for (const s of flat.evidence.candles.filter((s) => s.resolution === 3600)) {
    for (const c of s.candles) {
      c.close = "100";
      c.open = "100";
      c.high = "101";
      c.low = "99";
    }
  }
  assert.equal(smaAblationProposal(flat, "sma-hourly")[0]!.proposal.action, "hold");
});
test("all variants retain known costs and sufficient depth, and final refresh cannot introduce an entry", () => {
  for (const variant of PERPS_SMA_STRATEGIES) {
    const ctx = context();
    ctx.evidence.frames[0]!.snapshot.funding = null;
    assert.equal(smaAblationProposal(ctx, variant)[0]!.proposal.reason, "COST_DATA_UNAVAILABLE");
    const thin = context();
    thin.evidence.frames[0]!.book.asks[0]!.size = "0.0001";
    assert.equal(smaAblationProposal(thin, variant)[0]!.proposal.reason, "INSUFFICIENT_DEPTH");
    const fresh = context();
    const initial = {
      ...smaAblationProposal(fresh, variant)[0]!.proposal,
      action: "hold" as const,
      reason: "initial hold",
    };
    assert.equal(finalSmaProposal(fresh, variant, initial).action, "hold");
  }
  const ctx = context();
  const p = smaAblationProposal(ctx, "sma-direction")[0]!.proposal;
  const five = ctx.evidence.candles.find((s) => s.resolution === 300 && s.market.symbol === "BTC")!;
  five.candles.at(-1)!.close = five.candles.at(-4)!.close;
  assert.equal(finalSmaProposal(ctx, "sma-direction", p).reason, "DIRECTION_NOT_CONFIRMED");
  assert.throws(() => perpsCallCost(config, "direct", 1, 1), { code: "PAID_CALL_FORBIDDEN" });
});
test("real simulator opens and common exits close long/short with identical horizon boundaries", () => {
  for (const sign of [1, -1]) {
    for (const variant of PERPS_SMA_STRATEGIES) {
      const ctx = context(undefined, sign);
      const startingCash = ctx.account.cash;
      const p = smaAblationProposal(ctx, variant)[0]!.proposal;
      const intent = {
        kind: "open" as const,
        symbol: "BTC" as const,
        side: sign === 1 ? ("long" as const) : ("short" as const),
        notional: "100",
        feeReserve: "1",
      };
      const fill = simulatePerpsFill(
        ctx.account,
        intent,
        ctx.evidence.frames[0]!,
        ctx.evidence.observedAt,
      );
      const opened = applyPaperFill(
        ctx.account,
        {
          key: "open-1",
          intent,
          status: "pending",
          reserved: "101",
          createdAt: ctx.evidence.observedAt,
          finishedAt: null,
          reason: null,
          evidence: null,
        },
        fill,
        ctx.evidence.observedAt,
      );
      ctx.account = opened.account;
      assert.equal(p.action, sign === 1 ? "open-long" : "open-short");
      ctx.evidence.observedAt += 1799999;
      assert.equal(commonSmaExit(ctx, "BTC")!.action, "hold");
      ctx.evidence.observedAt++;
      assert.equal(commonSmaExit(ctx, "BTC")!.reason, "HORIZON_EXIT");
      assert.equal(finalSmaProposal(ctx, variant, p).action, "close");

      const closeIntent = { ...intent, kind: "close" as const, notional: "0" };
      const refreshed = context(ctx.evidence.observedAt, sign);
      const closeFill = simulatePerpsFill(
        ctx.account,
        closeIntent,
        refreshed.evidence.frames[0]!,
        ctx.evidence.observedAt,
      );
      const closed = applyPaperFill(
        ctx.account,
        {
          key: "close-1",
          intent: closeIntent,
          status: "pending",
          reserved: "0",
          createdAt: ctx.evidence.observedAt,
          finishedAt: null,
          reason: null,
          evidence: null,
        },
        closeFill,
        ctx.evidence.observedAt,
      );
      assert.equal(
        closed.account.positions.filter((position) => position.closedAt === null).length,
        0,
      );
      assert.equal(closed.account.positions[0]!.closedAt, ctx.evidence.observedAt);
      assert.ok(Number(closed.account.cash) < Number(startingCash));
    }
  }
});

async function fixture(t: TestContext, initialNow = 1800000060000, keepPreparationClock = false) {
  let now = initialNow;
  const research = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(research.pool, () => now);
  const paper = new PostgresPerpsPaperStore(research.pool, () => now);
  await study.initialize(config, { acquisitionPolicy: "rest-paced-20s-v1", fixture: true });
  const lease = await study.claim(config);
  if (!keepPreparationClock) {
    now = (await study.view(config)).record.startedAt!;
  }
  const accounts = async () => {
    const view = await study.view(config);
    const result: PerpsStudyMap<PerpsPaperView> = {};
    for (const v of PERPS_SMA_STRATEGIES) {
      result[v] = await paper.view({ ...config, agentId: view.record.agentIds[v]! });
    }
    return result;
  };
  return {
    research,
    study,
    paper,
    lease,
    accounts,
    now: () => now,
    set: (value: number) => {
      now = value;
    },
  };
}
test("PostgreSQL coordinator opens three independent portfolios, closes identically, and never calls models", async (t) => {
  const f = await fixture(t);
  let refreshes = 0;
  const data = {
    observe: async () => ({ frames: context(f.now()).evidence.frames, funding: [] }),
    evidence: async () => context(f.now()).evidence,
    execution: async () => {
      refreshes++;
      return context(f.now()).evidence.frames;
    },
  };
  const runner = createPerpsStudyRunner({
    study: f.study,
    paper: f.paper,
    models: new Proxy({} as NonNullable<Parameters<typeof createPerpsStudyRunner>[0]["models"]>, {
      get() {
        throw new Error("Model transport is forbidden");
      },
    }),
    data,
    now: f.now,
    paperForLease: (scope, lease, signal) =>
      new PostgresPerpsPaperStore(f.research.pool, f.now, { ...scope, owner: lease.owner, signal }),
  });
  await runner.cycle(config, f.lease, new AbortController().signal);
  assert.equal(refreshes, 1);
  for (const v of PERPS_SMA_STRATEGIES) {
    assert.equal(
      (await f.accounts())[v]!.account.positions.filter((p) => p.closedAt === null).length,
      2,
    );
  }
  const first = await f.study.view(config);
  await assert.rejects(() => f.study.startCall(config, f.lease, first.rounds[0]!.key, "direct"), {
    code: "INVALID_INPUT",
  });
  assert.deepEqual(first.rounds[0]!.calls, {});
  assert.deepEqual(Object.keys(first.record.agentIds).sort(), [...PERPS_SMA_STRATEGIES].sort());
  for (let i = 0; i < 90; i++) {
    f.set(f.now() + 20000);
    await f.study.renew(config, f.lease);
  }
  await runner.cycle(config, f.lease, new AbortController().signal);
  for (const a of Object.values(await f.accounts())) {
    assert.equal(a.account.positions.filter((p) => p.closedAt === null).length, 0);
    assert.equal(a.attempts.filter((a) => a.intent.kind === "open").length, 2);
  }
  f.set(f.now() + 90001);
  // A real expired owner cannot continue or reclaim the started comparison.
  await assert.rejects(() => runner.cycle(config, f.lease, new AbortController().signal), {
    code: "LEASE_LOST",
  });
  const snapshot = await exportPerpsAudit(f.research.pool, config);
  assert.equal(snapshot.study.rounds.length, 2);
  await assert.rejects(() => f.study.claim(config), { code: "STUDY_ALREADY_STARTED" });
});
test("invalid final ETH omits the entire slot, preserves proposals and permits the next slot", async (t) => {
  const f = await fixture(t);
  let invalid = true;
  const runner = createPerpsStudyRunner({
    study: f.study,
    paper: f.paper,
    now: f.now,
    data: {
      observe: async () => ({ frames: context(f.now()).evidence.frames, funding: [] }),
      evidence: async () => context(f.now()).evidence,
      execution: async () => {
        const frames = context(f.now()).evidence.frames;
        if (invalid) {
          frames[1]!.book.provenance.providerTimestamp =
            frames[1]!.book.provenance.providerTimestamp! - 60000;
        }
        return frames;
      },
    },
  });
  await runner.cycle(config, f.lease, new AbortController().signal);
  let view = await f.study.view(config);
  assert.equal(view.rounds[0]!.executionStatus, "skipped_data_unavailable");
  assert.equal(Object.keys(view.rounds[0]!.proposals).length, 3);
  for (const a of Object.values(await f.accounts())) {
    assert.equal(a.account.positions.length, 0);
  }
  for (let i = 0; i < 45; i++) {
    f.set(f.now() + 20000);
    await f.study.renew(config, f.lease);
  }
  invalid = false;
  await runner.cycle(config, f.lease, new AbortController().signal);
  view = await f.study.view(config);
  assert.equal(view.rounds[1]!.executionStatus, "complete");
  const count = view.rounds.length;
  await runner.cycle(config, f.lease, new AbortController().signal);
  assert.equal((await f.study.view(config)).rounds.length, count);
});
test("missed slots persist once, cannot be recovered, and failed evidence never creates calls", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 2; i++) {
    f.set(f.now() + 20000);
    await f.study.renew(config, f.lease);
  }
  assert.equal(await f.study.claimSlot(config, f.lease, 0), false);
  const before = await f.study.view(config);
  assert.equal(before.events.filter((e) => e.kind === "slot-missed").length, 1);
  const runner = createPerpsStudyRunner({
    study: f.study,
    paper: f.paper,
    now: f.now,
    data: {
      observe: async () => ({ frames: context(f.now()).evidence.frames, funding: [] }),
      evidence: async () => {
        throw new PilotError("DATA_UNAVAILABLE", "controlled gap");
      },
      execution: async () => {
        throw new Error("No execution allowed");
      },
    },
  });
  for (let i = 0; i < 43; i++) {
    f.set(f.now() + 20000);
    await f.study.renew(config, f.lease);
  }
  await runner.cycle(config, f.lease, new AbortController().signal);
  const view = await f.study.view(config);
  assert.equal(view.rounds.length, 0);
  assert.equal(view.events.filter((e) => e.kind === "data-unavailable").length, 1);
});
test("reports are deterministic, escaped, 144 rows, and preserve pending funding", async (t) => {
  const f = await fixture(t);
  const view = await f.study.view(config);
  const accounts = await f.accounts();
  accounts["sma-hourly"]!.account.fundingPending = true;
  const report = smaStudyReport(view, accounts, f.now());
  assert.equal(report.rows.length, 144);
  assert.equal(report.modelCalls, 0);
  assert.equal(report.metrics[0]!.netRealizedCashPnlAUSD, null);
  assert.equal(report.metrics[0]!.equityAUSD, null);
  assert.deepEqual(report, smaStudyReport(view, accounts, f.now()));
  report.rows[0]!.initial = {
    proposal: { symbol: "BTC", action: "hold", reason: "<script>bad</script>" },
    trace: "=bad",
  };
  const directory = await mkdtemp(join(tmpdir(), "sma-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeSmaReport(directory, report);
  assert.ok(
    !(await readFile(join(directory, "report.html"), "utf8")).includes("<script>bad</script>"),
  );
  const first = await readFile(join(directory, "report.json"));
  await writeSmaReport(directory, report);
  assert.deepEqual(await readFile(join(directory, "report.json")), first);
});

test("strict ten-basis-point hourly boundary and refresh trend reversal are never promoted", () => {
  const ctx = context();
  for (const series of ctx.evidence.candles.filter((s) => s.resolution === 3600)) {
    for (const [i, c] of series.candles.entries()) {
      c.close = i < 40 ? "29980" : "30030";
      c.open = c.close;
      c.high = "30040";
      c.low = "29970";
    }
  }
  assert.equal(smaAblationProposal(ctx, "sma-hourly")[0]!.proposal.action, "hold");
  for (const series of ctx.evidence.candles.filter((s) => s.resolution === 3600)) {
    for (const c of series.candles.slice(-20)) {
      c.close = "30031";
      c.open = c.close;
    }
  }
  const p = smaAblationProposal(ctx, "sma-hourly")[0]!.proposal;
  assert.equal(p.action, "open-long");
  const opposite = context(undefined, -1);
  assert.equal(finalSmaProposal(opposite, "sma-hourly", p).reason, "TREND_NOT_CONFIRMED");
});

test("host rejects paid overrides and model/signing environment fields before database or transport", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sma-admission-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "study.json");
  const envFile = join(directory, "database.env");
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(
    envFile,
    "DATABASE_URL=postgresql://localhost/missing\nMODEL_API_KEY=controlled-placeholder\n",
  );
  await assert.rejects(
    () =>
      runSmaStudy({
        command: "prepare",
        configPath,
        envFile,
        allowPaid: false,
        signal: new AbortController().signal,
      }),
    { code: "INVALID_INPUT" },
  );
  await assert.rejects(
    () =>
      runSmaStudy({
        command: "run",
        configPath,
        envFile,
        allowPaid: true,
        signal: new AbortController().signal,
      }),
    { code: "INVALID_INPUT" },
  );
});

test("supervision failure projects remaining slots as not admitted without rewriting the study", async (t) => {
  const f = await fixture(t);
  const directory = await mkdtemp(join(tmpdir(), "sma-death-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "study.json");
  const envFile = join(directory, "database.env");
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(envFile, `DATABASE_URL=${f.research.pool.options.connectionString}\n`, {
    mode: 0o600,
  });
  await writeFile(
    join(directory, "SMA_STUDY"),
    JSON.stringify({
      sessionId: config.sessionId,
      configHash: createHash("sha256").update(canonicalAudit(config)).digest("hex"),
    }),
  );
  await writeFile(
    join(directory, "supervision-failure.json"),
    JSON.stringify({ at: Date.now(), code: "RUNNER_DIED" }),
  );

  await runSmaStudy({ command: "report", configPath, envFile, output: directory });
  const report = JSON.parse(await readFile(join(directory, "report.json"), "utf8"));

  assert.equal(report.status, "interrupted");
  assert.equal(report.persistedStatus, "running");
  assert.equal(report.rows.length, 144);
  assert.ok(report.rows.every((row: { status: string }) => row.status === "NOT_ADMITTED"));
  assert.equal((await f.study.view(config)).record.status, "running");
  assert.equal(report.modelCalls, 0);
});

test("pre-start observations preserve the daily baseline across UTC midnight without early entries", async (t) => {
  const f = await fixture(t, Date.parse("2026-10-04T23:59:10Z"), true);
  const runner = createPerpsStudyRunner({
    study: f.study,
    paper: f.paper,
    now: f.now,
    data: {
      observe: async () => ({ frames: context(f.now()).evidence.frames, funding: [] }),
      evidence: async () => context(f.now()).evidence,
      execution: async () => context(f.now()).evidence.frames,
    },
  });
  await runner.cycle(config, f.lease, new AbortController().signal);
  assert.equal((await f.study.view(config)).rounds.length, 0);
  for (let i = 0; i < 3; i++) {
    f.set(f.now() + 20000);
    await f.study.renew(config, f.lease);
  }
  await runner.cycle(config, f.lease, new AbortController().signal);
  for (const a of Object.values(await f.accounts())) {
    assert.equal(a.account.dayEquity, "1000");
    assert.equal(a.account.positions.length, 0);
  }
  for (let i = 0; i < 3; i++) {
    f.set(f.now() + 20000);
    await f.study.renew(config, f.lease);
  }
  await runner.cycle(config, f.lease, new AbortController().signal);
  assert.equal((await f.study.view(config)).rounds[0]!.executionStatus, "complete");
  for (const a of Object.values(await f.accounts())) {
    assert.equal(a.account.positions.length, 2);
  }
});
test("missing the midnight baseline stops admission instead of running a comparison that cannot open", async (t) => {
  const f = await fixture(t, Date.parse("2026-10-04T23:59:10Z"), true);
  for (let i = 0; i < 6; i++) {
    f.set(f.now() + 20000);
    await f.study.renew(config, f.lease);
  }
  const runner = createPerpsStudyRunner({
    study: f.study,
    paper: f.paper,
    now: f.now,
    data: {
      observe: async () => ({ frames: context(f.now()).evidence.frames, funding: [] }),
      evidence: async () => {
        throw new Error("No proposals admitted");
      },
      execution: async () => {
        throw new Error("No execution admitted");
      },
    },
  });
  await runner.cycle(config, f.lease, new AbortController().signal);
  const view = await f.study.view(config);
  assert.equal(view.record.decisionStopReason, "DAY_BASELINE_PENDING");
  assert.equal(view.record.status, "closing");
  assert.equal(view.rounds.length, 0);
  for (const a of Object.values(await f.accounts())) {
    assert.equal(a.account.dayEquity, null);
    assert.equal(a.account.positions.length, 0);
  }
  const report = smaStudyReport(view, await f.accounts(), f.now());
  assert.equal(report.rows[0]!.status, "STARTUP_BLOCKED");
  assert.ok(report.rows.filter((r) => r.slot > 0).every((r) => r.status === "NOT_ADMITTED"));
});

test("the runner itself samples before its first slot across midnight, opens, stops and releases", async (t) => {
  let now = Date.parse("2026-10-04T23:59:10Z");
  const research = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(research.pool, () => now);
  const paper = new PostgresPerpsPaperStore(research.pool, () => now);
  await study.initialize(config, { acquisitionPolicy: "rest-paced-20s-v1" });
  let timer: ReturnType<typeof startLeaseHeartbeat>;
  const runner = createPerpsStudyRunner({
    study,
    paper,
    now: () => now,
    data: {
      observe: async () => ({ frames: context(now).evidence.frames, funding: [] }),
      evidence: async () => context(now).evidence,
      execution: async () => context(now).evidence.frames,
    },
    heartbeat: (input) => {
      timer = startLeaseHeartbeat(input);
      void timer.stop();
      return timer;
    },
    wait: async (delay, signal) => {
      while (delay > 0) {
        signal.throwIfAborted();
        const step = Math.min(delay, 20000);
        now += step;
        delay -= step;
        timer.tick();
        await timer.stop();
      }
    },
    onCycle: async () => {
      const v = await study.view(config);
      if (v.rounds.length && !v.record.stopRequested) {
        await study.stop(config);
      }
    },
  });
  await runner.run(config, new AbortController().signal);
  const view = await study.view(config);
  assert.equal(view.rounds.length, 1);
  assert.deepEqual(view.rounds[0]!.calls, {});
  for (const v of PERPS_SMA_STRATEGIES) {
    const a = await paper.view({ ...config, agentId: view.record.agentIds[v]! });
    assert.equal(a.account.dayEquity, "1000");
    assert.equal(
      a.attempts.filter((x) => x.status === "filled" && x.intent.kind === "open").length,
      2,
    );
    assert.equal(a.account.positions.filter((p) => p.closedAt === null).length, 0);
  }
  const owner = await research.pool.query(
    "SELECT owner,expires_at FROM pickler.perps_studies WHERE session_id=$1",
    [config.sessionId],
  );
  assert.equal(owner.rows[0].owner, null);
  assert.equal(owner.rows[0].expires_at, null);
});

test("a public observation crossing the exit deadline cannot close positions", async (t) => {
  const f = await fixture(t);
  let crossDeadline = false;
  const runner = createPerpsStudyRunner({
    study: f.study,
    paper: f.paper,
    now: f.now,
    data: {
      observe: async () => {
        if (crossDeadline) {
          f.set(f.now() + 2000);
        }
        return { frames: context(f.now()).evidence.frames, funding: [] };
      },
      evidence: async () => context(f.now()).evidence,
      execution: async () => context(f.now()).evidence.frames,
    },
  });
  await runner.cycle(config, f.lease, new AbortController().signal);
  const record = (await f.study.view(config)).record;
  const beforeDeadline = record.graceUntil! - 1000;
  while (f.now() < beforeDeadline) {
    f.set(Math.min(f.now() + 20000, beforeDeadline));
    await f.study.renew(config, f.lease);
  }
  crossDeadline = true;
  const result = await runner.cycle(config, f.lease, new AbortController().signal);
  for (const account of Object.values(await f.accounts())) {
    assert.equal(account.attempts.filter((a) => a.intent.kind === "close").length, 0);
    assert.equal(account.account.positions.filter((p) => p.closedAt === null).length, 2);
  }
  assert.equal(result, false);
});

test("SMA data failure diagnostics preserve phase and allowlisted predicate without raw errors", () => {
  const error = new PilotError("INVALID_MARKET_DATA", "Crossed order book");
  assert.deepEqual(perpsDataFailureDiagnostic(error, "evidence-validation", 123), {
    kind: "data-failure",
    version: 1,
    at: 123,
    phase: "evidence-validation",
    code: "INVALID_MARKET_DATA",
    predicate: "CROSSED_BOOK",
  });
  for (const unknown of [
    new Error("private-key-secret"),
    new PilotError("INVALID_MARKET_DATA", "private-key-secret"),
  ]) {
    const diagnostic = perpsDataFailureDiagnostic(unknown, "evidence-read", 123);
    assert.equal(diagnostic.predicate, "NOT_VERIFIABLE");
    assert.equal(JSON.stringify(diagnostic).includes("private-key-secret"), false);
  }
});

test("SMA coordinator records rejected evidence phase before propagating the unchanged error", async (t) => {
  const f = await fixture(t);
  const failures: ReturnType<typeof perpsDataFailureDiagnostic>[] = [];
  const evidence = context(f.now()).evidence;
  evidence.frames[0]!.book.bids[0]!.price = "1000000";
  const runner = createPerpsStudyRunner({
    study: f.study,
    paper: f.paper,
    now: f.now,
    dataDiagnostic: (event) => {
      failures.push(event);
      throw new Error("secondary diagnostic sink failure");
    },
    data: {
      observe: async () => ({ frames: context(f.now()).evidence.frames, funding: [] }),
      evidence: async () => evidence,
      execution: async () => {
        throw new Error("must not execute rejected evidence");
      },
    },
  });
  await assert.rejects(() => runner.cycle(config, f.lease, new AbortController().signal), {
    code: "INVALID_MARKET_DATA",
    message: "Crossed order book",
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.phase, "evidence-validation");
  assert.equal(failures[0]!.predicate, "CROSSED_BOOK");
  for (const account of Object.values(await f.accounts())) {
    assert.equal(account.attempts.length, 0);
  }
});
