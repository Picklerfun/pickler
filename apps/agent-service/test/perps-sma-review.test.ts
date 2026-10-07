import test from "node:test";
import assert from "node:assert/strict";
import { PilotError } from "@pickler/core";
import { createTestStore } from "@pickler/infrastructure/testing";
import {
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
  exportPerpsAudit,
} from "@pickler/infrastructure";
import {
  createPerpsStudyRunner,
  assertPerpsStudyConfig,
  executeSmaReviewVariant,
  smaFinalProposals,
  perpsStrategies,
  type PerpsSmaReviewConfig,
  type SmaReviewModels,
} from "@pickler/trading/evaluation";
import { createSmaReviewModels } from "@pickler/agent-runtime/composition/sma-review-model";
import { perpsStudyReport } from "../src/perps-study/report.js";
import { studyContext, studyEvidence } from "./perps-study-fixtures.js";
export const config: PerpsSmaReviewConfig = {
  version: 4,
  protocol: "perps-sma-jev-exa-v1",
  hours: 2,
  tenantId: "alpha",
  sessionId: "sma-review",
  network: "mainnet",
  budgetUsd: "5",
  providerBudgetUSD: "0.50",
  authorization: { jevApproved: true, exaApproved: true, operatorRecordHash: "a".repeat(64) },
  historicalAccountedOrReservedUSD: null,
  historicalUnknownReservations: [{ requestHash: "b".repeat(64), reservationUsd: "0.024576" }],
  jev: { model: "jev-1.13.0", inputPerMillion: "0.042", outputPerMillion: "0" },
  exa: { reservationPerSearchUSD: "0.05", lookbackHours: 24, results: 5 },
  pricingVerifiedAt: "2026-10-06T00:00:00Z",
  pricingSources: ["https://docs.typesafe.ai/models", "https://exa.ai/pricing"],
};
const answers = (veto = false) =>
  Object.fromEntries(
    ["BTC", "ETH"].flatMap((s) =>
      ["identity", "evidence", "costs"].map((k) => [
        `${s}_${k}`,
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
    ),
  );
test("explicit bounded local spending authorization does not accept legacy or missing authorization", () => {
  assertPerpsStudyConfig(config);
  assert.deepEqual(perpsStrategies(config), ["rules", "sma-jev", "sma-exa-jev"]);
  assert.throws(() =>
    assertPerpsStudyConfig({
      ...config,
      providerBudgetUSD: null,
    } as unknown as PerpsSmaReviewConfig),
  );
  assert.throws(() =>
    assertPerpsStudyConfig({
      ...config,
      authorization: { ...config.authorization, exaApproved: false },
    } as unknown as PerpsSmaReviewConfig),
  );
});
test("review preserves SMA direction, ignores veto on exits, skips paid work without openings", async () => {
  const context = studyContext();
  let news = 0,
    review = 0;
  const models: SmaReviewModels = {
    metadata: {},
    news: async () => {
      news++;
      return { sources: [], excluded: [], cutoff: context.evidence.observedAt };
    },
    review: async () => {
      review++;
      return answers(true);
    },
  };
  const hooks = { before: async () => {}, usage: async () => {} };
  const calls = {
    run: async <T>(_lane: unknown, fn: (h: typeof hooks) => Promise<T>) => fn(hooks),
  };
  const result = await executeSmaReviewVariant(
    "sma-exa-jev",
    context,
    models,
    calls,
    new AbortController().signal,
  );
  assert.ok(result.every((p) => p.action === "hold" && p.reason === "JEV_MATERIAL_VETO"));
  assert.equal(news, 1);
  assert.equal(review, 1);
  for (const c of context.evidence.candles) {
    for (const row of c.candles) {
      row.close = "100";
    }
  }
  const neutral = await executeSmaReviewVariant(
    "sma-jev",
    context,
    models,
    calls,
    new AbortController().signal,
  );
  assert.ok(neutral.every((p) => p.action === "hold"));
  assert.equal(review, 1);
});
test("final gate never creates or reverses an opening", () => {
  const context = studyContext();
  const initial = [
    { symbol: "BTC" as const, action: "hold" as const, reason: "veto", sourceIds: [] },
    { symbol: "ETH" as const, action: "open-short" as const, reason: "sma", sourceIds: [] },
  ];
  const final = smaFinalProposals(initial, context);
  assert.equal(final[0]!.action, "hold");
  assert.equal(final[1]!.action, "hold");
});
for (const side of ["long", "short"] as const) {
  test(`three independent ${side} portfolios share final frames, account paid calls once, and close`, async (t) => {
    const now = 1800000000000;
    const research = await createTestStore(t, () => now);
    const study = new PostgresPerpsStudyStore(research.pool, () => now);
    const paper = new PostgresPerpsPaperStore(research.pool, () => now);
    const view = await study.initialize(config, { acquisitionPolicy: "rest-paced-20s-v1" });
    const lease = await study.claim(config);
    let refresh = 0;
    const hashes: string[] = [];
    const evidence = () => {
      const e = studyEvidence(now);
      if (side === "short") {
        for (const s of e.candles) {
          for (const c of s.candles.slice(-20)) {
            c.close = "99";
          }
        }
      }
      return e;
    };
    const models: SmaReviewModels = {
      metadata: {},
      news: async (c, _s, h) => {
        await h.before({ sha256: "c".repeat(64), bytes: 10 });
        await h.cost!("0.007");
        return { sources: [], excluded: [], cutoff: c.evidence.observedAt };
      },
      review: async (c, _p, _n, _s, h) => {
        hashes.push(JSON.stringify(c.evidence));
        await h.before({ sha256: "d".repeat(64), bytes: 20 });
        await h.usage(100, 12);
        return answers();
      },
    };
    const runner = createPerpsStudyRunner({
      study,
      paper,
      now: () => now,
      smaModels: models,
      data: {
        observe: async () => {
          const e = evidence();
          return {
            frames: e.frames,
            funding: e.frames.map((f) => ({
              market: f.book.market,
              from: view.record.createdAt,
              to: now,
              complete: true,
              events: [],
              pages: [f.book.provenance],
            })),
          };
        },
        evidence: async () => evidence(),
        execution: async () => {
          refresh++;
          return evidence().frames;
        },
      },
    });
    await runner.cycle(config, lease, new AbortController().signal);
    assert.equal(refresh, 1);
    assert.equal(hashes[0], hashes[1]);
    const saved = await study.view(config);
    assert.equal(saved.rounds[0]!.executionStatus, "complete");
    assert.equal(Object.keys(saved.rounds[0]!.calls).length, 3);
    assert.ok(Object.values(saved.rounds[0]!.calls).every((c) => c.status === "completed"));
    for (const id of Object.values(view.record.agentIds)) {
      const v = await paper.view({ ...config, agentId: id });
      assert.equal(
        v.account.positions.filter((p) => p.closedAt === null && p.side === side).length,
        2,
      );
      assert.equal(v.attempts.filter((a) => a.status === "filled").length, 2);
    }
    await runner.cycle(config, lease, new AbortController().signal);
    assert.equal((await study.view(config)).rounds.length, 1);
    await study.stop(config);
    await runner.cycle(config, lease, new AbortController().signal);
    const packet = await exportPerpsAudit(research.pool, config);
    const report = perpsStudyReport(packet.study, packet.accounts, now);
    assert.equal(report.rows.length, 3);
    for (const row of report.rows) {
      assert.equal(row.openPositions, 0);
      assert.equal(row.fills, 4);
      assert.ok(Number(row.feesVirtualAUSD) < 0);
    }
    assert.equal(report.rows[0]!.modelCalls, 0);
    assert.equal(report.rows[1]!.modelCalls, 1);
    assert.equal(report.rows[2]!.modelCalls, 1);
    assert.equal(report.rows[2]!.exaCalls, 1);
    await study.release(config, lease);
  });
}
test("technical review failure blocks all openings and preserves unknown cost", async (t) => {
  let now = 1800000000000;
  const research = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(research.pool, () => now);
  const paper = new PostgresPerpsPaperStore(research.pool, () => now);
  const view = await study.initialize(config, {});
  const lease = await study.claim(config);
  const models: SmaReviewModels = {
    metadata: {},
    news: async (c, _s, h) => {
      await h.before({ sha256: "e".repeat(64), bytes: 1 });
      await h.cost!("0.007");
      return { sources: [], excluded: [], cutoff: c.evidence.observedAt };
    },
    review: async (_c, _p, _n, _s, h) => {
      await h.before({ sha256: "f".repeat(64), bytes: 1 });
      throw new PilotError("MODEL_TIMEOUT", "controlled");
    },
  };
  const runner = createPerpsStudyRunner({
    study,
    paper,
    now: () => now,
    smaModels: models,
    data: {
      observe: async () => ({ frames: studyEvidence(now).frames, funding: [] }),
      evidence: async () => studyEvidence(now),
      execution: async () => {
        throw new Error("Must not execute");
      },
    },
  });
  await runner.cycle(config, lease, new AbortController().signal);
  const saved = await study.view(config);
  assert.equal(saved.record.status, "closing");
  assert.equal(saved.record.decisionStopReason, "MODEL_TIMEOUT");
  assert.equal(saved.rounds[0]!.executionStatus, "incomplete");
  assert.ok(
    Object.values(saved.rounds[0]!.calls).some(
      (c) => c.status === "failed" && c.costUsd === null && Number(c.reservationUsd) > 0,
    ),
  );
  for (const id of Object.values(view.record.agentIds)) {
    assert.equal((await paper.view({ ...config, agentId: id })).attempts.length, 0);
  }
  now += 90001;
  await assert.rejects(study.event(config, lease, "late", "late", {}), { code: "LEASE_LOST" });
  await study.release(config, lease);
});
test("guarded Exa request pins window, preserves cost and excludes future or undated news", async () => {
  const c = studyContext();
  let cost: string | undefined;
  let before = 0;
  let guard = 0;
  const model = createSmaReviewModels(
    config,
    { jev: "fixture", exa: "fixture" },
    {
      exa: async () => {
        guard++;
      },
      review: async () => {},
    },
    async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.endPublishedDate, new Date(c.evidence.observedAt).toISOString());
      assert.equal(request.numResults, 5);
      assert.equal(request.type, "auto");
      return Response.json({
        costDollars: { total: 0.007 },
        results: [
          {
            url: "https://example.com/valid",
            text: "A factual event",
            publishedDate: new Date(c.evidence.observedAt - 1000).toISOString(),
          },
          {
            url: "https://example.com/future",
            text: "future",
            publishedDate: new Date(c.evidence.observedAt + 1).toISOString(),
          },
          { url: "https://example.com/undated", text: "undated" },
        ],
      });
    },
  );
  const result = await model.news(c, new AbortController().signal, {
    before: async () => {
      before++;
    },
    usage: async () => {
      throw new Error("Not model tokens");
    },
    cost: async (v) => {
      cost = v;
    },
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.excluded.length, 2);
  assert.equal(cost, "0.007000000");
  assert.equal(before, 1);
  assert.ok(guard >= 2);
});
test("strict Jev reviewer retains usage on invalid response and never retries", async () => {
  let called = 0,
    usage = 0;
  const model = createSmaReviewModels(
    config,
    { jev: "fixture", exa: "fixture" },
    { exa: async () => {}, review: async () => {} },
    async () => {
      called++;
      return Response.json({
        model: "jev-1.13.0",
        usage: { input_tokens: 100, output_tokens: 12 },
        answers: {},
      });
    },
  );
  await assert.rejects(
    model.review(studyContext(), [], null, new AbortController().signal, {
      before: async () => {},
      usage: async () => {
        usage++;
      },
    }),
    { code: "JEV_ANSWERS_INVALID" },
  );
  assert.equal(called, 1);
  assert.equal(usage, 1);
});
