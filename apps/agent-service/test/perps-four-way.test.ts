import test from "node:test";
import assert from "node:assert/strict";
import {
  perpsJevDecisions,
  perpsRules,
  perpsJevReviewed,
  perpsStrategies,
  type PerpsJevAnswers,
  type PerpsStudyConfig,
  type PerpsStudyMap,
} from "@pickler/trading/evaluation";
import { executePerpsStrategy, PERPS_STRATEGIES } from "@pickler/trading/strategies";
import { PostgresPerpsStudyStore, PostgresPerpsPaperStore } from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { studyConfig, studyContext, studyEvidence } from "./perps-study-fixtures.js";
import { createPerpsStudyModels } from "@pickler/agent-runtime/composition/perps-study-model";

const answer = (choice: string, probability = 1, confidence = 1) => ({
  choice,
  confidence,
  probabilities: { [choice]: probability },
});
function answers(): PerpsJevAnswers {
  return Object.fromEntries(
    ["BTC", "ETH"].flatMap((s) => [
      [`${s}_long`, answer("UNSUPPORTED")],
      [`${s}_short`, answer("UNSUPPORTED")],
      [`${s}_thesis`, answer("UNKNOWN")],
    ]),
  );
}
test("Jev decisions use selected support at the exact threshold, not confidence", () => {
  const a = answers();
  a.BTC_long = answer("SUPPORTED", 0.7, 0.01);
  a.ETH_short = answer("SUPPORTED", 0.7);
  assert.deepEqual(
    perpsJevDecisions(studyContext(), a).map((p) => p.action),
    ["open-long", "open-short"],
  );
  a.BTC_long = answer("SUPPORTED", 0.699);
  assert.equal(perpsJevDecisions(studyContext(), a)[0]!.action, "hold");
  a.BTC_long = answer("SUPPORTED", 0.9);
  a.BTC_short = answer("SUPPORTED", 0.2);
  assert.equal(perpsJevDecisions(studyContext(), a)[0]!.reason, "JEV_CONFLICTING_DIRECTIONS");
  assert.throws(() => perpsJevDecisions(studyContext(), {}));
});
test("Jev closes an invalidated position and never reverses", () => {
  const ctx = studyContext();
  ctx.account.positions.push({
    id: "p",
    symbol: "BTC",
    side: "short",
    quantity: "1",
    entryPrice: "100",
    entryNotional: "100",
    openedAt: 0,
    entryBlock: 1,
    mark: "100",
    markAt: ctx.evidence.observedAt,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
  });
  const a = answers();
  a.BTC_long = answer("SUPPORTED");
  assert.equal(perpsJevDecisions(ctx, a)[0]!.action, "hold");
  a.BTC_thesis = answer("INVALIDATED", 0.7);
  assert.equal(perpsJevDecisions(ctx, a)[0]!.action, "close");
});
test("review uncertainty preserves proposal; veto requires both original thresholds", () => {
  const proposal = [
    { symbol: "BTC" as const, action: "open-long" as const, reason: "test", sourceIds: [] },
  ];
  const a = Object.fromEntries(
    ["identity", "evidence", "costs"].map((k) => [`BTC_${k}`, answer("UNKNOWN")]),
  );
  assert.deepEqual(perpsJevReviewed(proposal, a), proposal);
  a.BTC_evidence = answer("CONTRADICTED", 0.9, 0.899);
  assert.deepEqual(perpsJevReviewed(proposal, a), proposal);
  a.BTC_evidence = answer("CONTRADICTED", 0.9, 0.9);
  assert.equal(perpsJevReviewed(proposal, a)[0]!.action, "hold");
});
test("PostgreSQL reserves four independent lanes, keeps history and rejects unacknowledged new unknown usage", async (t) => {
  let now = 1800000000000;
  const db = await createTestStore(t, () => now);
  const store = new PostgresPerpsStudyStore(db.pool, () => now);
  const paper = new PostgresPerpsPaperStore(db.pool, () => now);
  const cfg: PerpsStudyConfig = {
    ...studyConfig,
    version: 2,
    protocol: "perps-four-way-v2",
    hours: 2,
    sessionId: "four-way",
  };
  const initialized = await store.initialize(cfg, {});
  const lease = await store.claim(cfg);
  const accounts = {} as PerpsStudyMap<ReturnType<typeof studyContext>["account"]>;
  for (const s of perpsStrategies(cfg)) {
    accounts[s] = (await paper.view({ ...cfg, agentId: initialized.record.agentIds[s]! })).account;
  }
  assert.equal(new Set(Object.values(initialized.record.agentIds)).size, 4);
  const round = await store.reserve(cfg, lease, 0, studyEvidence(now), accounts, []);
  assert.equal(Object.keys(round!.calls).length, 4);
  await store.startCall(cfg, lease, round!.key, "review", { sha256: "a".repeat(64), bytes: 10 });
  await store.finishCall(cfg, lease, round!.key, "review", null, "MODEL_TIMEOUT");
  const stopped = await store.view(cfg);
  assert.equal(stopped.record.status, "closing");
  assert.equal(stopped.record.decisionStopReason, "MODEL_TIMEOUT");
  assert.equal(stopped.record.graceUntil, now + 900000);
  await store.finishRound(cfg, lease, round!.key, {});
  await store.release(cfg, lease);
  const ack = {
    sessionId: cfg.sessionId,
    roundKey: round!.key,
    lane: "review" as const,
    requestHash: "a".repeat(64),
    reservationUsd: round!.calls.review!.reservationUsd,
  };
  const continuation = { ...cfg, sessionId: "four-next", acknowledgedUnknownCalls: [ack] };
  const next = await store.initialize(continuation, {});
  const nextLease = await store.claim(continuation);
  for (const s of perpsStrategies(cfg)) {
    accounts[s] = (
      await paper.view({ ...continuation, agentId: next.record.agentIds[s]! })
    ).account;
  }
  const admitted = await store.reserve(
    continuation,
    nextLease,
    0,
    studyEvidence(now),
    accounts,
    [],
  );
  assert.ok(admitted);
  await store.startCall(continuation, nextLease, admitted.key, "direct");
  await store.finishCall(continuation, nextLease, admitted.key, "direct", null, "MODEL_TIMEOUT");
  await store.finishRound(continuation, nextLease, admitted.key, {});
  await store.release(continuation, nextLease);
  now += 1000;
  const third = { ...continuation, sessionId: "four-third" };
  const thirdView = await store.initialize(third, {});
  const thirdLease = await store.claim(third);
  for (const s of perpsStrategies(cfg)) {
    accounts[s] = (await paper.view({ ...third, agentId: thirdView.record.agentIds[s]! })).account;
  }
  assert.equal(await store.reserve(third, thirdLease, 0, studyEvidence(now), accounts, []), null);
  assert.equal((await store.view(third)).record.decisionStopReason, "CAMPAIGN_USAGE_UNVERIFIED");
  assert.equal((await store.view(cfg)).rounds[0]!.calls.review!.costUsd, null);
  await store.release(third, thirdLease);
});
test("atomic Jev sends separate questions, no foreign proposals, and preserves strict answer diagnostics", async () => {
  let payload: { questions: Record<string, unknown>; state: object } | undefined;
  const models = createPerpsStudyModels(
    { ...studyConfig, version: 2, protocol: "perps-four-way-v2", hours: 2 },
    { deepseek: "test", jev: "test" },
    async (_url, input) => {
      payload = JSON.parse(String(input?.body));
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          usage: { input_tokens: 10, output_tokens: 2 },
          answers: {},
        }),
        { status: 200 },
      );
    },
  );
  let usage = false;
  await assert.rejects(
    models.decide!(studyContext(), new AbortController().signal, {
      before: async () => {},
      usage: async () => {
        usage = true;
      },
    }),
  );
  assert.equal(Object.keys(payload!.questions).length, 6);
  assert.equal(Object.hasOwn(payload!.state, "proposals"), false);
  assert.equal(usage, true);
});
test("four-way round keeps independent portfolios and one common final refresh", async (t) => {
  const { createPerpsStudyRunner } = await import("@pickler/trading/evaluation");
  const now = 1800000000000;
  const db = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(db.pool, () => now);
  const paper = new PostgresPerpsPaperStore(db.pool, () => now);
  const config: PerpsStudyConfig = {
    ...studyConfig,
    version: 2,
    protocol: "perps-four-way-v2",
    hours: 2,
    sessionId: "four-runner",
  };
  const view = await study.initialize(config, {});
  const lease = await study.claim(config);
  const holds = ["BTC", "ETH"].map((symbol) => ({
    symbol: symbol as "BTC" | "ETH",
    action: "hold" as const,
    reason: "controlled",
    sourceIds: [`${symbol}:candles`],
  }));
  const seen: string[] = [];
  let finalRefreshes = 0;
  const called = async (
    ctx: ReturnType<typeof studyContext>,
    hooks: import("@pickler/trading/evaluation").PerpsModelHooks,
    label: string,
  ) => {
    assert.equal(ctx.evidence.sourceIds.length, 6);
    seen.push(ctx.account.scope.agentId);
    await hooks.before({ sha256: label.repeat(64), bytes: 10 });
    await hooks.usage(100, 1);
  };
  const runner = createPerpsStudyRunner({
    study,
    paper,
    now: () => now,
    data: {
      async observe() {
        const e = studyEvidence(now);
        return {
          frames: e.frames,
          funding: e.frames.map((f) => ({
            market: f.book.market,
            from: now,
            to: now,
            complete: true,
            events: [],
            pages: [f.book.provenance],
          })),
        };
      },
      async evidence() {
        return studyEvidence(now);
      },
      async execution() {
        finalRefreshes++;
        assert.equal(seen.length, 4);
        return studyEvidence(now).frames;
      },
    },
    models: {
      metadata: {},
      async direct(ctx, _signal, hooks) {
        await called(ctx, hooks, "a");
        return holds;
      },
      async readiness() {
        throw new Error("Legacy readiness must not run");
      },
      async decide(ctx, _signal, hooks) {
        await called(ctx, hooks, "b");
        return { proposals: holds, answers: {} };
      },
      async review(ctx, proposals, _signal, hooks) {
        await called(ctx, hooks, "c");
        assert.deepEqual(proposals, holds);
        return { proposals, answers: {} };
      },
    },
  });
  await runner.cycle(config, lease, new AbortController().signal);
  assert.equal(finalRefreshes, 1);
  assert.deepEqual(seen.slice(0, 3), [
    view.record.agentIds.deepseek,
    view.record.agentIds.jev,
    view.record.agentIds.combined,
  ]);
  assert.equal(new Set(seen).size, 3);
  assert.equal(seen.filter((id) => id === view.record.agentIds.combined).length, 2);
  const saved = await study.view(config);
  assert.equal(saved.rounds[0]!.executionStatus, "complete");
  assert.equal(
    Object.values(saved.rounds[0]!.calls).filter((c) => c.status === "completed").length,
    4,
  );
  await study.release(config, lease);
});
test("valid atomic Jev answers pass strict runtime contracts and preserve positive output usage", async () => {
  const usage: number[] = [];
  const models = createPerpsStudyModels(
    { ...studyConfig, version: 2, protocol: "perps-four-way-v2", hours: 2 },
    { deepseek: "test", jev: "test" },
    async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([key, value]) => {
          const labels = Object.keys((value as { criteria: object }).criteria);
          const chosen = key.endsWith("thesis")
            ? "UNKNOWN"
            : labels.includes("SUPPORTED")
              ? "UNSUPPORTED"
              : "CONSISTENT";
          return [
            key,
            {
              type: "choice",
              choice: chosen,
              confidence: 1,
              probabilities: Object.fromEntries(
                labels.map((label) => [label, label === chosen ? 1 : 0]),
              ),
            },
          ];
        }),
      );
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          usage: { input_tokens: 100, output_tokens: 12 },
          answers,
        }),
        { status: 200 },
      );
    },
  );
  const hooks = {
    before: async () => {},
    usage: async (_input: number, output: number) => {
      usage.push(output);
    },
  };
  const decided = await models.decide!(studyContext(), new AbortController().signal, hooks);
  assert.deepEqual(
    decided.proposals.map((p) => p.action),
    ["hold", "hold"],
  );
  const reviewed = await models.review!(
    studyContext(),
    decided.proposals,
    new AbortController().signal,
    hooks,
  );
  assert.deepEqual(reviewed.proposals, decided.proposals);
  assert.deepEqual(usage, [12, 12]);
});

test("registry rules preserve exact SMA boundaries and never use model capabilities", async () => {
  assert.deepEqual(
    new Set(PERPS_STRATEGIES.map((s) => s.id)),
    new Set(perpsStrategies({ version: 2 })),
  );
  for (const [first, last, expected] of [
    ["2998", "3003", "hold"],
    ["2998", "3003.000001", "open-long"],
    ["3002", "2997", "hold"],
    ["3002", "2996.999999", "open-short"],
  ] as const) {
    const input = studyContext();
    for (const series of input.evidence.candles) {
      series.candles = series.candles.slice(-50);
      series.candles.forEach((candle, index) => {
        candle.close = index < 30 ? first : last;
      });
    }
    const proposals = await executePerpsStrategy({ id: "rules", version: "1.0.0" }, input, {
      models: {},
      signal: new AbortController().signal,
      calls: {
        async run() {
          throw new Error("Rules called a model");
        },
      },
    });
    assert.deepEqual(
      proposals.map((p) => p.action),
      [expected, expected],
    );
    assert.deepEqual(proposals, perpsRules(input));
  }
});
