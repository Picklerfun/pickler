import { PilotError } from "@pickler/core";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  PERPS_STUDY_STRATEGIES,
  perpsCallCost,
  perpsRules,
  perpsAccountedUsd,
  type PerpsStrategy,
  type PerpsStudyLease,
  type PerpsProposal,
} from "@pickler/trading/evaluation";
import { type PerpsPaperAccount, type PerpsPaperView } from "@pickler/trading/perps";
import { PostgresPerpsStudyStore, PostgresPerpsPaperStore } from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import {
  createPerpsStudyModels,
  perpsModelState,
} from "@pickler/agent-runtime/composition/perps-study-model";
import type { PerpsModels } from "@pickler/trading/evaluation";
import { createPerpsStudyRunner } from "@pickler/trading/evaluation";
import { perpsStudyReport, renderPerpsReport } from "../src/perps-study/report.js";
import { studyConfig, studyContext, studyEvidence } from "./perps-study-fixtures.js";
const holds: PerpsProposal[] = (["BTC", "ETH"] as const).map((symbol) => ({
  symbol,
  action: "hold",
  reason: "controlled",
  sourceIds: [],
}));
async function setup(t: TestContext) {
  let now = 1800000000000;
  const research = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(research.pool, () => now);
  const paper = new PostgresPerpsPaperStore(research.pool, () => now);
  const scope = studyConfig;
  const view = await study.initialize(scope, { fixture: true });
  const accounts = {} as Record<PerpsStrategy, PerpsPaperAccount>;
  for (const s of PERPS_STUDY_STRATEGIES) {
    accounts[s] = (await paper.view({ ...scope, agentId: view.record.agentIds[s] })).account;
  }
  return {
    research,
    study,
    paper,
    scope,
    accounts,
    view,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("rules use 50 contiguous closed candles, threshold and no same-round reversal", () => {
  const context = studyContext();
  assert.deepEqual(
    perpsRules(context).map((p) => p.action),
    ["open-long", "open-long"],
  );
  context.evidence.candles[0]!.candles[45]!.closed = false;
  assert.equal(perpsRules(context)[0]!.action, "hold");
  context.account.positions.push({
    id: "p",
    symbol: "ETH",
    side: "short",
    quantity: "1",
    entryPrice: "100",
    entryNotional: "100",
    openedAt: 0,
    entryBlock: 1,
    mark: "100",
    markAt: context.evidence.observedAt,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
  });
  assert.equal(perpsRules(context)[1]!.action, "close");
  context.evidence.candles[1]!.candles = [];
  assert.equal(perpsRules(context)[1]!.action, "hold");
  assert.ok(Buffer.byteLength(JSON.stringify(perpsModelState(context))) < 30000);
});
test("tariffs reserve both DeepSeek arms and Jev; invalid usage cannot erase a reserve", () => {
  assert.equal(perpsCallCost(studyConfig, "direct", 65536, 4096), "0.024576");
  assert.equal(perpsCallCost(studyConfig, "jev", 65536, 0), "0.002752512");
  assert.throws(() => perpsCallCost(studyConfig, "direct", 65537, 0));
  assert.throws(() => perpsCallCost(studyConfig, "direct", 0, 4097));
});
test("real PostgreSQL isolates dedicated agents, serializes admissions and recovers unknown costs", async (t) => {
  const x = await setup(t);
  const original = await x.research.agent({ tenantId: "alpha", agentId: "pickle-alpha" });
  assert.equal(original.version, 1);
  await x.study.initialize(x.scope, { fixture: true });
  for (const s of PERPS_STUDY_STRATEGIES) {
    assert.equal(
      (await x.paper.view({ ...x.scope, agentId: x.view.record.agentIds[s] })).movements.length,
      1,
    );
  }
  await assert.rejects(x.study.view({ ...x.scope, tenantId: "beta" }));
  await assert.rejects(
    x.study.initialize(
      { ...x.scope, deepseek: { ...x.scope.deepseek, model: "changed" } },
      { fixture: true },
    ),
  );
  const peer = new PostgresPerpsStudyStore(x.research.connectPeer().pool, x.now);
  const claims = await Promise.allSettled([x.study.claim(x.scope), peer.claim(x.scope)]);
  assert.equal(claims.filter((v) => v.status === "fulfilled").length, 1);
  const lease = claims.find((v) => v.status === "fulfilled")!.value;
  const evidence = studyEvidence(x.now());
  const rounds = await Promise.all([
    x.study.reserve(x.scope, lease, 0, evidence, x.accounts, holds),
    peer.reserve(x.scope, lease, 0, evidence, x.accounts, holds),
  ]);
  assert.equal(rounds.filter(Boolean).length, 1);
  const round = rounds.find(Boolean)!;
  await x.study.startCall(x.scope, lease, round.key, "direct");
  x.advance(90001);
  const replacement = await peer.claim(x.scope);
  await assert.rejects(x.study.usage(x.scope, lease, round.key, "direct", 100, 1));
  const after = await x.study.view(x.scope);
  assert.equal(after.record.startedAt, x.view.record.createdAt);
  assert.equal(after.rounds[0]!.status, "interrupted");
  assert.equal(after.rounds[0]!.calls.direct.costUsd, null);
  assert.equal(perpsAccountedUsd(after.rounds), "0.024576");
  assert.equal(await peer.reserve(x.scope, replacement, 1, evidence, x.accounts, holds), null);
});
test("parallel known usage commits independently; budget exhaustion admits neither arm", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  const round = (await x.study.reserve(
    x.scope,
    lease,
    0,
    studyEvidence(x.now()),
    x.accounts,
    holds,
  ))!;
  await Promise.all(
    ["direct", "jev"].map(async (lane) => {
      const l = lane as "direct" | "jev";
      await x.study.startCall(x.scope, lease, round.key, l);
      await x.study.usage(x.scope, lease, round.key, l, 1000, 10);
      await x.study.finishCall(
        x.scope,
        lease,
        round.key,
        l,
        l === "jev" ? { skip: true } : holds,
        null,
      );
    }),
  );
  await x.study.finishRound(x.scope, lease, round.key, {
    rules: holds,
    deepseek: holds,
    jev: holds,
  });
  await x.study.finishExecution(x.scope, lease, round.key, "complete");
  assert.equal((await x.study.view(x.scope)).rounds[0]!.calls.fallback.status, "skipped");
  const expensive = {
    ...x.scope,
    sessionId: "expensive",
    deepseek: { ...x.scope.deepseek, inputPerMillion: "100", outputPerMillion: "100" },
  };
  const v = await x.study.initialize(expensive, { fixture: true });
  const l = await x.study.claim(expensive);
  assert.equal(
    await x.study.reserve(expensive, l, 0, studyEvidence(x.now()), x.accounts, holds),
    null,
  );
  assert.equal((await x.study.view(expensive)).record.decisionStopReason, "BUDGET_EXHAUSTED");
  assert.ok(v.record.agentIds.rules !== x.view.record.agentIds.rules);
});
test("blind direct proposals persist usage before validation and never retry malformed output", async () => {
  let requests = 0,
    usage = 0;
  const bodies: string[] = [];
  const transport: typeof fetch = async (_url, init) => {
    requests++;
    bodies.push(String(init?.body));
    return Response.json({
      model: studyConfig.deepseek.model,
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify({ actions: holds }) } },
      ],
    });
  };
  const models = createPerpsStudyModels(
    studyConfig,
    { deepseek: "PRIVATE_KEY", jev: "PRIVATE_KEY" },
    transport,
  );
  const context = studyContext();
  const hooks = {
    before: async () => {},
    usage: async () => {
      usage++;
    },
  };
  await models.direct(context, new AbortController().signal, hooks);
  await models.direct(context, new AbortController().signal, hooks);
  assert.equal(bodies[0], bodies[1]);
  assert.ok(!bodies[0]!.includes("PRIVATE_KEY"));
  assert.equal(usage, 2);
  const invalid = createPerpsStudyModels(studyConfig, { deepseek: "key", jev: "key" }, async () => {
    requests++;
    return Response.json({
      model: studyConfig.deepseek.model,
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [{ finish_reason: "stop", message: { content: "invalid" } }],
    });
  });
  await assert.rejects(invalid.direct(context, new AbortController().signal, hooks));
  assert.equal(requests, 3);
  assert.equal(usage, 3);
});
test("only coherent high-confidence Jev insufficiency skips; abort has no repair call", async () => {
  const answer = (choice: string, labels: string[]) => ({
    type: "choice",
    choice,
    confidence: 1,
    probabilities: Object.fromEntries(labels.map((k) => [k, k === choice ? 1 : 0])),
  });
  const answers = {
    readiness: answer("INSUFFICIENT", ["READY", "INSUFFICIENT", "UNKNOWN"]),
    gap: answer("MISSING", ["NONE", "MISSING", "CONFLICT", "UNKNOWN"]),
    scope: answer("MATCH", ["MATCH", "MISMATCH", "UNKNOWN"]),
  };
  const models = createPerpsStudyModels(studyConfig, { deepseek: "key", jev: "key" }, async () =>
    Response.json({
      model: studyConfig.jev.model,
      usage: { input_tokens: 100, output_tokens: 10 },
      answers,
    }),
  );
  const hooks = { before: async () => {}, usage: async () => {} };
  assert.equal(
    (await models.readiness(studyContext(), new AbortController().signal, hooks)).skip,
    true,
  );
  answers.scope = answer("MISMATCH", ["MATCH", "MISMATCH", "UNKNOWN"]);
  assert.equal(
    (await models.readiness(studyContext(), new AbortController().signal, hooks)).skip,
    false,
  );
  let started = 0;
  const hanging = createPerpsStudyModels(studyConfig, { deepseek: "key", jev: "key" }, async () => {
    started++;
    return new Promise(() => {});
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    await assert.rejects(hanging.direct(studyContext(), controller.signal, hooks));
  } finally {
    clearTimeout(timer);
  }
  assert.equal(started, 1);
});
test("deterministic replay shares evidence, executes baseline, and supervises risk after model failure", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  let paid = 0,
    fail = false;
  const models: PerpsModels = {
    metadata: { fixture: true },
    async direct(context, signal, hooks) {
      await hooks.before({ sha256: "a".repeat(64), bytes: 100 });
      paid++;
      await hooks.usage(100, 10);
      if (fail) {
        throw new Error("controlled");
      }
      assert.equal(context.evidence.sourceIds.length, 6);
      return holds;
    },
    async readiness(_context, _signal, hooks) {
      await hooks.before({ sha256: "b".repeat(64), bytes: 100 });
      paid++;
      await hooks.usage(100, 1);
      return { skip: true, answers: { fixture: true } };
    },
  };
  const data = {
    async observe() {
      const e = studyEvidence(x.now());
      return {
        frames: e.frames,
        funding: e.frames.map((f) => ({
          market: f.book.market,
          from: x.view.record.createdAt,
          to: x.now(),
          complete: true,
          events: [],
          pages: [f.book.provenance],
        })),
      };
    },
    async evidence() {
      return studyEvidence(x.now());
    },
    async execution() {
      return studyEvidence(x.now()).frames;
    },
  };
  const runner = createPerpsStudyRunner({
    study: x.study,
    paper: x.paper,
    data,
    models,
    now: x.now,
  });
  assert.equal(await runner.cycle(x.scope, lease, new AbortController().signal), true);
  assert.equal(paid, 2);
  let view = await x.study.view(x.scope);
  assert.equal(view.rounds[0]!.executionStatus, "complete");
  assert.equal(
    (
      await x.paper.view({ ...x.scope, agentId: x.view.record.agentIds.rules })
    ).account.positions.filter((p) => p.closedAt === null).length,
    2,
  );
  x.advance(900000);
  await x.study.release(x.scope, lease);
  const next = await x.study.claim(x.scope);
  fail = true;
  await runner.cycle(x.scope, next, new AbortController().signal);
  view = await x.study.view(x.scope);
  assert.equal(view.record.decisionStopReason, "MODEL_FAILURE");
  const calls = paid;
  x.advance(4 * 3600000);
  await x.study.release(x.scope, next);
  const final = await x.study.claim(x.scope);
  await runner.cycle(x.scope, final, new AbortController().signal);
  assert.equal(paid, calls);
  assert.equal(
    (
      await x.paper.view({ ...x.scope, agentId: x.view.record.agentIds.rules })
    ).account.positions.filter((p) => p.closedAt === null).length,
    0,
  );
  const accounts = {} as Record<PerpsStrategy, PerpsPaperView>;
  for (const s of PERPS_STUDY_STRATEGIES) {
    accounts[s] = await x.paper.view({ ...x.scope, agentId: x.view.record.agentIds[s] });
  }
  const report = perpsStudyReport(await x.study.view(x.scope), accounts, x.now());
  assert.equal(report.comparable, false);
  assert.equal(report.profitabilityRanking, null);
  assert.ok(report.unobservedMs > 0);
  assert.ok(renderPerpsReport(report).csv.includes("modelCostEstimateUSD"));
});

test("completed proposal without execution becomes incomplete on restart; permissions revoke paid work", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  const round = (await x.study.reserve(
    x.scope,
    lease,
    0,
    studyEvidence(x.now()),
    x.accounts,
    holds,
  ))!;
  for (const lane of ["direct", "jev"] as const) {
    await x.study.startCall(x.scope, lease, round.key, lane);
    await x.study.usage(x.scope, lease, round.key, lane, 100, 1);
    await x.study.finishCall(
      x.scope,
      lease,
      round.key,
      lane,
      lane === "jev" ? { skip: true } : holds,
      null,
    );
  }
  await x.study.finishRound(x.scope, lease, round.key, {
    rules: holds,
    deepseek: holds,
    jev: holds,
  });
  await x.study.release(x.scope, lease);
  const next = await x.study.claim(x.scope);
  const recovered = await x.study.view(x.scope);
  assert.equal(recovered.rounds[0]!.executionStatus, "incomplete");
  assert.equal(recovered.record.decisionStopReason, "INTERRUPTED_EXECUTION");
  await x.research.pool.query(
    "UPDATE pickler.agents SET paused=true WHERE tenant_id=$1 AND id=$2",
    [x.scope.tenantId, x.view.record.agentIds.jev],
  );
  await assert.rejects(x.study.guard(x.scope, next));
});
test("expired grace preserves unresolved positions and permanently closes admissions", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  const data = {
    observe: async () => {
      throw new PilotError("PERPL_TIMEOUT", "public outage");
    },
    evidence: async () => studyEvidence(x.now()),
    execution: async () => [],
  };
  const models: PerpsModels = {
    metadata: {},
    direct: async () => {
      throw new Error("must not call");
    },
    readiness: async () => {
      throw new Error("must not call");
    },
  };
  x.advance(86400000 + 900000);
  await x.study.release(x.scope, lease);
  const next = await x.study.claim(x.scope);
  assert.equal(
    await createPerpsStudyRunner({
      study: x.study,
      paper: x.paper,
      data,
      models,
      now: x.now,
    }).cycle(x.scope, next, new AbortController().signal),
    false,
  );
  const view = await x.paper.view({ ...x.scope, agentId: x.view.record.agentIds.rules });
  assert.equal(view.account.admissionsClosed, true);
  assert.equal((await x.study.view(x.scope)).record.status, "completed");
});
test("missing decision slots are not filled retrospectively; public failures create explicit gaps", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  let paid = 0;
  const models: PerpsModels = {
    metadata: {},
    direct: async () => {
      paid++;
      return holds;
    },
    readiness: async () => {
      paid++;
      return { skip: true, answers: {} };
    },
  };
  const data = {
    observe: async () => {
      throw new PilotError("PERPL_TIMEOUT", "public outage");
    },
    evidence: async () => studyEvidence(x.now()),
    execution: async () => [],
  };
  const runner = createPerpsStudyRunner({
    study: x.study,
    paper: x.paper,
    data,
    models,
    now: x.now,
  });
  await runner.cycle(x.scope, lease, new AbortController().signal);
  x.advance(2 * 900000 + 120000);
  await x.study.release(x.scope, lease);
  const next = await x.study.claim(x.scope);
  await runner.cycle(x.scope, next, new AbortController().signal);
  const view = await x.study.view(x.scope);
  assert.equal(paid, 0);
  assert.equal(view.rounds.length, 0);
  assert.equal(view.events.filter((e) => e.kind === "observation-failed").length, 2);
});

test("shared Jev transport preserves request evidence and records usage before rejecting answers", async () => {
  let calls = 0;
  const events: string[] = [];
  const models = createPerpsStudyModels(
    studyConfig,
    { deepseek: "test", jev: "test" },
    async (url, options) => {
      calls++;
      events.push("transport");
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(options?.redirect, "manual");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, studyConfig.jev.model);
      assert.deepEqual(Object.keys(body.questions), ["readiness", "gap", "scope"]);
      assert.equal(body.state.observedAt, studyContext().evidence.observedAt);
      return Response.json({
        model: studyConfig.jev.model,
        usage: { input_tokens: 100, output_tokens: 10 },
        answers: {},
      });
    },
  );
  await assert.rejects(
    models.readiness(studyContext(), new AbortController().signal, {
      before: async ({ sha256, bytes }) => {
        assert.match(sha256, /^[a-f0-9]{64}$/);
        assert.ok(bytes > 0);
        events.push("persist");
      },
      usage: async (input, output) => {
        assert.deepEqual([input, output], [100, 10]);
        events.push("usage");
      },
    }),
    { code: "JEV_ANSWERS_INVALID" },
  );
  assert.equal(calls, 1);
  assert.deepEqual(events, ["persist", "transport", "usage"]);
});

test("concurrent sessions share the original campaign cap, including historical reservations", async (t) => {
  const x = await setup(t);
  const configs = ["campaign-a", "campaign-b"].map((sessionId) => ({
    ...x.scope,
    sessionId,
    deepseek: { ...x.scope.deepseek, inputPerMillion: "20", outputPerMillion: "20" },
  }));
  const leases: PerpsStudyLease[] = [];
  for (const config of configs) {
    await x.study.initialize(config, { fixture: true });
    leases.push(await x.study.claim(config));
  }
  const results = await Promise.all(
    configs.map((config, i) =>
      x.study.reserve(config, leases[i]!, 0, studyEvidence(x.now()), x.accounts, holds),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1);
  const loser = results.findIndex((result) => !result);
  assert.equal((await x.study.view(configs[loser]!)).record.decisionStopReason, "BUDGET_EXHAUSTED");
});

test("unknown historical usage blocks a new session without resetting its reservation", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  const round = (await x.study.reserve(
    x.scope,
    lease,
    0,
    studyEvidence(x.now()),
    x.accounts,
    holds,
  ))!;
  await x.study.startCall(x.scope, lease, round.key, "direct");
  const config = { ...x.scope, sessionId: "continuation" };
  await x.study.initialize(config, { fixture: true });
  const next = await x.study.claim(config);
  assert.equal(
    await x.study.reserve(config, next, 0, studyEvidence(x.now()), x.accounts, holds),
    null,
  );
  assert.equal((await x.study.view(config)).record.decisionStopReason, "CAMPAIGN_USAGE_UNVERIFIED");
  assert.equal((await x.study.view(x.scope)).rounds[0]!.calls.direct.costUsd, null);
});

test("stale evidence is rejected before model spend and invalid execution frames remain inspectable", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  let stale = true;
  let calls = 0;
  const models: PerpsModels = {
    metadata: { fixture: true },
    async direct(_context, _signal, hooks) {
      calls++;
      await hooks.before({ sha256: "a".repeat(64), bytes: 100 });
      await hooks.usage(100, 1);
      return holds;
    },
    async readiness(_context, _signal, hooks) {
      calls++;
      await hooks.before({ sha256: "b".repeat(64), bytes: 100 });
      await hooks.usage(100, 1);
      return { skip: true, answers: {} };
    },
  };
  const runner = createPerpsStudyRunner({
    study: x.study,
    paper: x.paper,
    models,
    now: x.now,
    data: {
      async observe() {
        return { frames: studyEvidence(x.now()).frames, funding: [], marksOnly: true };
      },
      async evidence() {
        return studyEvidence(x.now() - (stale ? 31000 : 0));
      },
      async execution() {
        const frames = studyEvidence(x.now()).frames;
        frames[0]!.snapshot.ticker.provenance = {
          ...frames[0]!.snapshot.ticker.provenance,
          providerTimestamp: x.now() - 10000,
        };
        return frames;
      },
    },
  });
  await runner.cycle(x.scope, lease, new AbortController().signal);
  assert.equal(calls, 0);
  assert.equal((await x.study.view(x.scope)).rounds.length, 0);
  stale = false;
  x.advance(900000);
  await x.study.release(x.scope, lease);
  const next = await x.study.claim(x.scope);
  await runner.cycle(x.scope, next, new AbortController().signal);
  const view = await x.study.view(x.scope);
  assert.equal(calls, 2);
  assert.equal(view.record.decisionStopReason, null);
  assert.equal(view.rounds[0]!.executionStatus, "skipped_data_unavailable");
  assert.ok(view.events.some((event) => event.kind === "execution-input"));
  assert.ok(
    view.events.some(
      (event) =>
        event.kind === "data-unavailable" &&
        (event.data as { cause: string }).cause === "INCONSISTENT_MARKET_DATA",
    ),
  );
});

test("unavailable execution skips one slot, preserves proposals and resumes next slot", async (t) => {
  const x = await setup(t);
  let calls = 0,
    unavailable = true;
  const lease = await x.study.claim(x.scope);
  const models: PerpsModels = {
    metadata: {},
    direct: async (_context, _signal, hooks) => {
      calls++;
      await hooks.before({ sha256: "a".repeat(64), bytes: 1 });
      await hooks.usage(1, 1);
      return holds;
    },
    readiness: async (_context, _signal, hooks) => {
      calls++;
      await hooks.before({ sha256: "b".repeat(64), bytes: 1 });
      await hooks.usage(1, 1);
      return { skip: true, answers: {} };
    },
  };
  const runner = createPerpsStudyRunner({
    study: x.study,
    paper: x.paper,
    now: x.now,
    models,
    data: {
      observe: async () => ({ frames: studyEvidence(x.now()).frames, funding: [] }),
      evidence: async () => studyEvidence(x.now()),
      execution: async () => {
        if (unavailable) {
          throw new PilotError("DATA_UNAVAILABLE", "controlled");
        }
        return studyEvidence(x.now()).frames;
      },
    },
  });
  await runner.cycle(x.scope, lease, new AbortController().signal);
  let view = await x.study.view(x.scope);
  assert.equal(view.record.decisionStopReason, null);
  assert.equal(view.rounds[0]!.executionStatus, "skipped_data_unavailable");
  assert.deepEqual(view.rounds[0]!.proposals.deepseek, holds);
  await runner.cycle(x.scope, lease, new AbortController().signal);
  assert.equal(calls, 2);
  unavailable = false;
  x.advance(900000);
  await x.study.release(x.scope, lease);
  const next = await x.study.claim(x.scope);
  await runner.cycle(x.scope, next, new AbortController().signal);
  view = await x.study.view(x.scope);
  assert.equal(view.rounds[1]!.executionStatus, "complete");
  assert.equal(calls, 4);
});

test("diagnostic lease creates no agents, accounts or paid rounds and expires atomically", async (t) => {
  const x = await setup(t);
  const before = await x.research.pool.query("SELECT count(*)::int AS count FROM pickler.agents");
  const diagnostic = await x.study.initializeDiagnostic(x.scope, "stability-controlled", {
    kind: "test",
  });
  const lease = await x.study.claim(diagnostic);
  await assert.rejects(x.study.guard(diagnostic, lease, true));
  assert.equal(
    (await x.research.pool.query("SELECT count(*)::int AS count FROM pickler.agents")).rows[0]
      .count,
    before.rows[0].count,
  );
  x.advance(20000);
  await x.study.renew(diagnostic, lease);
  assert.equal(lease.expiresAt, x.now() + 90000);
  x.advance(90001);
  await assert.rejects(x.study.renew(diagnostic, lease), { code: "LEASE_LOST" });
  await assert.rejects(x.study.event(diagnostic, lease, "late", "test", {}), {
    code: "LEASE_LOST",
  });
  assert.equal((await x.study.view(diagnostic)).rounds.length, 0);
});

test("paper account writes are fenced by the study lease in their own transaction", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  const bound = new PostgresPerpsPaperStore(x.research.pool, x.now, {
    ...x.scope,
    owner: lease.owner,
  });
  const target = { ...x.scope, agentId: x.view.record.agentIds.rules };
  await bound.observe(target, "owned", { frames: studyEvidence(x.now()).frames, funding: [] });
  x.advance(90001);
  await assert.rejects(
    bound.observe(target, "expired", { frames: studyEvidence(x.now()).frames, funding: [] }),
    { code: "LEASE_LOST" },
  );
  assert.equal(await x.paper.observed(target, "expired"), false);
});

test("study event rolls back if ownership expires during the transaction", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  let reads = 0;
  const delayed = new PostgresPerpsStudyStore(x.research.pool, () => {
    if (++reads === 2) {
      x.advance(90001);
    }
    return x.now();
  });
  await assert.rejects(delayed.event(x.scope, lease, "late-commit", "test", {}), {
    code: "LEASE_LOST",
  });
  assert.ok(!(await x.study.view(x.scope)).events.some((event) => event.key === "late-commit"));
});

test("a partial observation write failure stops instead of skipping or invoking models", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  let writes = 0;
  const original = x.paper.observe.bind(x.paper);
  x.paper.observe = async (...args) => {
    if (++writes === 2) {
      throw new PilotError("DATA_UNAVAILABLE", "failure after first write");
    }
    return original(...args);
  };
  const unexpected = async () => {
    throw new Error("model must not run");
  };
  const runner = createPerpsStudyRunner({
    study: x.study,
    paper: x.paper,
    now: x.now,
    models: { metadata: {}, direct: unexpected, readiness: unexpected },
    data: {
      observe: async () => ({ frames: studyEvidence(x.now()).frames, funding: [] }),
      evidence: async () => studyEvidence(x.now()),
      execution: async () => studyEvidence(x.now()).frames,
    },
  });
  await assert.rejects(runner.cycle(x.scope, lease, new AbortController().signal), {
    code: "DATA_UNAVAILABLE",
  });
  const view = await x.study.view(x.scope);
  assert.equal(view.rounds.length, 0);
  assert.equal(view.events.filter((event) => event.kind === "data-unavailable").length, 0);
});

test("database lock delay cannot renew an expired lease or permit subsequent writes", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  const blocker = await x.research.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM pickler.perps_studies WHERE session_id=$1 FOR UPDATE", [
    x.scope.sessionId,
  ]);
  const renewal = x.study.renew(x.scope, lease);
  const rejected = assert.rejects(renewal, { code: "LEASE_LOST" });
  x.advance(90001);
  await blocker.query("COMMIT");
  blocker.release();
  await rejected;
  await assert.rejects(x.study.event(x.scope, lease, "after-lock", "test", {}), {
    code: "LEASE_LOST",
  });
});

test("a process interruption fences writes even while PostgreSQL still sees a live lease", async (t) => {
  const x = await setup(t);
  const lease = await x.study.claim(x.scope);
  lease.assertActive = () => {
    throw new PilotError("PROCESS_INTERRUPTED", "controlled wakeup gap");
  };
  await assert.rejects(x.study.event(x.scope, lease, "after-wake", "test", {}), {
    code: "PROCESS_INTERRUPTED",
  });
  const bound = new PostgresPerpsPaperStore(x.research.pool, x.now, {
    ...x.scope,
    owner: lease.owner,
    assertActive: lease.assertActive,
  });
  const target = { ...x.scope, agentId: x.view.record.agentIds.rules };
  await assert.rejects(
    bound.observe(target, "after-wake", { frames: studyEvidence(x.now()).frames, funding: [] }),
    { code: "PROCESS_INTERRUPTED" },
  );
  assert.equal(await x.paper.observed(target, "after-wake"), false);
  assert.ok(!(await x.study.view(x.scope)).events.some((event) => event.key === "after-wake"));
});
