import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  createResearchRunner,
  PilotError,
  ModelFailure,
  type ResearchModel,
  type Market,
  type Source,
  type ModelAssessment,
  type DecisionV2,
  type MarketData,
} from "@pickler/core";
import { createTestStore } from "./database";
const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
const market: Market = {
  id: "1",
  question: "Test?",
  rules: "Resolve according to the official test source.",
  categoryIds: ["7"],
  active: true,
  closesAt: new Date(100000).toISOString(),
  liquidity: 10,
  outcomes: [
    { id: "99", label: "Yes" },
    { id: "100", label: "No" },
  ],
};
const source: Source = {
  id: "source",
  url: "https://example.com",
  title: "Test evidence",
  content: "Test content",
  provider: "test",
  publishedAt: null,
  retrievedAt: new Date(100).toISOString(),
  truncated: false,
};
const decision: ModelAssessment = {
  action: "ABSTAIN",
  marketId: "1",
  outcomeId: null,
  thesis: "Evidence does not establish a result",
  counterEvidence: "Test source gives conflicting evidence",
  uncertainty: "Result unknown",
  sourceIds: ["source"],
  probability: null,
  uncertaintyLevel: "LOW" as const,
  missingInformation: [],
  observedPrice: null,
  limitPrice: null,
  expiresAt: null,
  abstentionReason: "Insufficient evidence",
};
async function setup(t: TestContext) {
  const repository = await createTestStore(t);
  await repository.updateConfig(scope, 1, { ...DEFAULT_CONFIG, categoryIds: ["7"] });
  await repository.enqueue(scope, "test", null, 100);
  const run = (await repository.claim(101))!;
  const markets: MarketData = {
    categories: async () => [{ id: "7", label: "Test" }],
    list: async () => [market],
    get: async () => market,
    book: async (id) => ({
      outcomeId: id,
      observedAt: new Date(100).toISOString(),
      bids: [],
      asks: [{ price: "0.4", size: "2" }],
    }),
  };
  const model: ResearchModel = {
    metadata: () => ({
      model: "test",
      provider: "test",
      prompts: {
        research: {
          id: "fixture-research",
          version: "1.0.0",
          sha256: "fixture",
          instructions: "Fixture research instructions",
        },
        marketSelection: {
          id: "fixture-selection",
          version: "1.0.0",
          sha256: "fixture",
          instructions: "Fixture selection instructions",
        },
      },
    }),
    select: async () => ({ marketId: "1", reason: "Researchable rules", usage: {} }),
    research: async ({ tools }) => {
      await tools.searchWeb!("supporting evidence", "supporting");
      await tools.searchWeb!("contrary evidence", "contradicting");
      return { decision: { ...decision }, usage: {} };
    },
  };
  const deps = {
    repository,
    markets,
    model,
    search: { search: async () => ({ sources: [source], usage: null }) },
    reader: { read: async () => source },
    now: () => 200,
  };
  return { ...deps, run, execute: () => createResearchRunner(deps)(run) };
}
test("decision and attributed evidence persist before completion", async (t) => {
  const f = await setup(t);
  await f.execute();
  const saved = await f.repository.run("alpha", f.run.id);

  assert.equal(saved.status, "completed");
  assert.equal(saved.decision?.action, "ABSTAIN");
  const events = await f.repository.events("alpha", f.run.id);

  assert.equal(events[0]?.type, "runtime");
  assert.deepEqual((events[0]!.data as { prompts: unknown }).prompts, f.model.metadata().prompts);
  assert.equal(saved.config.profile, f.run.config.profile);
  assert.ok(events.some((e) => e.type === "sources"));
  assert.ok(events.some((e) => e.type === "selection"));
  assert.ok(events.some((e) => e.type === "market"));
});

test("live configuration changes block the next tool call and retain partial evidence", async (t) => {
  const f = await setup(t);
  let calls = 0;
  f.search.search = async () => {
    calls++;
    return { sources: [source], usage: null };
  };
  f.model.research = async ({ tools }) => {
    await tools.searchWeb!("first", "supporting");
    await f.repository.updateConfig(scope, 2, {
      ...f.run.config,
      tools: ["getMarketRules", "getOrderBook"],
    });
    await assert.rejects(tools.searchWeb!("second", "supporting"), { code: "CONFIG_CHANGED" });
    return { decision: { ...decision }, usage: {} };
  };
  await f.execute();

  assert.equal(calls, 1);
  assert.equal((await f.repository.run("alpha", f.run.id)).error, "CONFIG_CHANGED");
  assert.ok((await f.repository.events("alpha", f.run.id)).some((e) => e.type === "sources"));
});

test("disabled tool blocks work before external requests", async (t) => {
  const f = await setup(t);
  await f.repository.updateConfig(scope, 2, { ...f.run.config, tools: [] });
  let called = false;
  f.markets.list = async () => {
    called = true;
    return [market];
  };
  await f.execute();

  const events = await f.repository.events("alpha", f.run.id);
  assert.equal(events.length, 0, "Revoked configuration cannot append new runtime events");
  assert.equal(called, false);
  assert.equal((await f.repository.run("alpha", f.run.id)).status, "failed");
});

test("provider error cannot be turned into a valid abstention by the model", async (t) => {
  const f = await setup(t);
  f.search.search = async () => {
    throw new PilotError("PROVIDER_HTTP_429", "Test provider failure");
  };
  f.model.research = async ({ tools }) => {
    await tools.searchWeb!("test", "supporting").catch(() => {});
    return { decision: { ...decision }, usage: {} };
  };
  await f.execute();

  assert.equal((await f.repository.run("alpha", f.run.id)).error, "PROVIDER_FAILURE");
});

test("fabricated citations fail rather than entering the decision history", async (t) => {
  const f = await setup(t);
  f.model.research = async () => ({
    decision: { ...decision, sourceIds: ["invented"] },
    usage: {},
  });
  await f.execute();

  assert.equal((await f.repository.run("alpha", f.run.id)).error, "INVALID_DECISION");
});

test("trade proposal refreshes actual ask and abstains when it exceeds the limit", async (t) => {
  const f = await setup(t);
  let quotes = 0;
  f.markets.book = async (id) => {
    quotes++;
    return {
      outcomeId: id,
      observedAt: new Date(200).toISOString(),
      bids: [],
      asks: [{ price: "0.40000001", size: "2" }],
    };
  };
  f.model.research = async ({ tools }) => {
    await tools.searchWeb!("evidence", "supporting");
    await tools.searchWeb!("contrary evidence", "contradicting");
    return {
      decision: {
        ...decision,
        action: "TRADE",
        outcomeId: "99",
        probability: { lower: 0.6, estimate: 0.7, upper: 0.8 },
        limitPrice: "0.4",
        observedPrice: "0.1",
        expiresAt: new Date(10000).toISOString(),
        abstentionReason: null,
      },
      usage: {},
    };
  };
  await f.execute();
  const saved = await f.repository.run("alpha", f.run.id);

  assert.equal(quotes, 3);
  assert.equal(saved.decision?.observedPrice, "0.40000001");
  assert.equal(saved.decision?.action, "ABSTAIN");
});

test("missing final quotation is an execution failure", async (t) => {
  const f = await setup(t);
  f.markets.book = async (id) => ({
    outcomeId: id,
    observedAt: new Date(200).toISOString(),
    bids: [],
    asks: [],
  });
  f.model.research = async ({ tools }) => {
    await tools.searchWeb!("evidence", "supporting");
    await tools.searchWeb!("contrary evidence", "contradicting");
    return {
      decision: {
        ...decision,
        action: "TRADE",
        outcomeId: "99",
        probability: { lower: 0.6, estimate: 0.7, upper: 0.8 },
        limitPrice: "0.4",
        expiresAt: new Date(10000).toISOString(),
      },
      usage: {},
    };
  };
  await f.execute();

  assert.equal((await f.repository.run("alpha", f.run.id)).error, "NO_QUOTE");
});

test("tool quotas bound actual provider calls even if the model keeps asking", async (t) => {
  const f = await setup(t);
  let searches = 0,
    reads = 0;
  f.search.search = async () => {
    searches++;
    return { sources: [source], usage: null };
  };
  f.reader.read = async () => {
    reads++;
    return source;
  };
  f.model.research = async ({ tools }) => {
    await tools.searchWeb!("support", "supporting");
    await tools.searchWeb!("oppose", "contradicting");
    await tools.searchWeb!("follow-up", "supporting");
    await assert.rejects(tools.searchWeb!("over-budget", "supporting"), { code: "TOOL_LIMIT" });
    for (let i = 0; i < 5; i++) {
      await tools.readPage!(source.url);
    }
    await assert.rejects(tools.readPage!(source.url), { code: "TOOL_LIMIT" });
    return { decision: { ...decision }, usage: {} };
  };
  await f.execute();

  assert.equal(searches, 3);
  assert.equal(reads, 5);
});

test("a one-sided search cannot complete and market scope is checked before research", async (t) => {
  const f = await setup(t);
  f.model.research = async ({ tools }) => {
    await tools.searchWeb!("support", "supporting");
    return { decision: { ...decision }, usage: {} };
  };
  await f.execute();

  assert.equal((await f.repository.run("alpha", f.run.id)).error, "INCOMPLETE_RESEARCH");
  await f.repository.enqueue(scope, "outside", "2", 201);
  const outside = (await f.repository.claim(202))!;
  f.markets.get = async () => ({ ...market, id: "2", categoryIds: ["88"] });
  let called = false;
  f.model.research = async () => {
    called = true;
    return { decision, usage: {} };
  };
  await createResearchRunner(f)(outside);

  assert.equal(called, false);
  assert.equal((await f.repository.run("alpha", outside.id)).error, "MARKET_NOT_ALLOWED");
});

test("discovery filters past, boundary, missing and invalid dates before selecting with the injected clock", async (t) => {
  const f = await setup(t);
  f.markets.list = async () => [
    ...[null, "invalid", new Date(199).toISOString(), new Date(200).toISOString()].map(
      (closesAt, i) => ({ ...market, id: String(i + 2), closesAt, liquidity: 100 }),
    ),
    market,
  ];
  f.model.select = async (candidates, _profile, _signal, _limits, now) => {
    assert.deepEqual(candidates, [market]);
    assert.equal(now, new Date(200).toISOString());
    return { marketId: "1", reason: "Future market", usage: {} };
  };
  await f.execute();
  assert.equal((await f.repository.run("alpha", f.run.id)).status, "completed");
  const events = await f.repository.events("alpha", f.run.id);
  assert.equal((events.find((e) => e.type === "candidates")!.data as unknown[]).length, 5);
  assert.deepEqual(events.find((e) => e.type === "eligible_candidates")!.data, [market]);
});

test("no future candidates fails without a model call", async (t) => {
  const f = await setup(t);
  f.markets.list = async () => [{ ...market, closesAt: new Date(200).toISOString() }];
  f.model.select = async () => {
    throw new Error("Must not call model");
  };
  await f.execute();
  assert.equal((await f.repository.run("alpha", f.run.id)).error, "NO_ELIGIBLE_MARKETS");
});

test("manual markets and refreshed selected markets must still be open before research", async (t) => {
  const f = await setup(t);
  f.markets.get = async () => ({ ...market, closesAt: new Date(200).toISOString() });
  let calls = 0;
  f.model.research = async () => {
    calls++;
    throw new Error("Must not research");
  };
  await f.execute();
  assert.equal((await f.repository.run("alpha", f.run.id)).error, "MARKET_NOT_OPEN");
  await f.repository.enqueue(scope, "manual-expired", "1", 201);
  const manual = (await f.repository.claim(202))!;
  await createResearchRunner(f)(manual);
  assert.equal((await f.repository.run("alpha", manual.id)).error, "MARKET_NOT_OPEN");
  assert.equal(calls, 0);
});

test("a market closing during research blocks the final trade proposal", async (t) => {
  const f = await setup(t);
  const research = f.model.research;
  f.model.research = async (input) => {
    await research(input);
    f.markets.get = async () => ({ ...market, closesAt: new Date(200).toISOString() });
    return {
      decision: {
        ...decision,
        action: "TRADE",
        outcomeId: "99",
        probability: { lower: 0.6, estimate: 0.7, upper: 0.8 },
        limitPrice: "0.5",
        expiresAt: new Date(1000).toISOString(),
        abstentionReason: null,
      },
      usage: {},
    };
  };
  await f.execute();
  const saved = await f.repository.run("alpha", f.run.id);
  assert.equal(saved.error, "MARKET_NOT_OPEN");
  assert.equal(saved.decision, null);
});

test("model failures retain stage metadata and partial evidence without becoming abstentions", async (t) => {
  for (const stage of ["selection", "research"] as const) {
    const f = await setup(t);
    const details = { stage, finishReason: "length", outputTokens: 2000 };
    if (stage === "selection") {
      f.model.select = async () => {
        throw new ModelFailure("MODEL_OUTPUT_TRUNCATED", details);
      };
    } else {
      f.model.research = async ({ tools }) => {
        await tools.searchWeb!("partial evidence", "supporting");
        throw new ModelFailure("MODEL_OUTPUT_TRUNCATED", details);
      };
    }
    await f.execute();
    const saved = await f.repository.run("alpha", f.run.id);
    assert.equal(saved.error, "MODEL_OUTPUT_TRUNCATED");
    assert.equal(saved.decision, null);
    const events = await f.repository.events("alpha", f.run.id);
    assert.deepEqual(events.find((e) => e.type === "model_failure")!.data, {
      code: "MODEL_OUTPUT_TRUNCATED",
      ...details,
    });
    assert.ok(events.some((e) => e.type === (stage === "selection" ? "candidates" : "sources")));
  }
});

test("policy persists an unchanged proposal and final abstention in tenant-scoped JSONB", async (t) => {
  const f = await setup(t);
  const research = f.model.research;
  const proposed: ModelAssessment = {
    ...decision,
    action: "TRADE",
    outcomeId: "99",
    probability: { lower: 0.0005, estimate: 0.003, upper: 0.01 },
    uncertaintyLevel: "HIGH",
    missingInformation: ["Unverified sports facts"],
    limitPrice: "0.001",
    expiresAt: new Date(10000).toISOString(),
    abstentionReason: null,
  };
  f.markets.book = async (id) => ({
    outcomeId: id,
    observedAt: new Date(200).toISOString(),
    bids: [],
    asks: [{ price: "0.001", size: "10" }],
  });
  f.model.research = async (input) => {
    await research(input);
    return { decision: proposed, usage: {} };
  };
  await f.execute();
  const saved = await f.repository.run("alpha", f.run.id);
  assert.equal(saved.status, "completed");
  const result = saved.decision as DecisionV2;
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.action, "ABSTAIN");
  assert.deepEqual(result.modelAssessment, proposed);
  assert.equal(proposed.action, "TRADE");
  assert.ok(result.policyEvaluation.reasonCodes.includes("HIGH_UNCERTAINTY"));
  const events = await f.repository.events("alpha", f.run.id);
  assert.deepEqual(events.find((e) => e.type === "model_assessment")?.data, proposed);
  assert.deepEqual(
    events.find((e) => e.type === "policy_evaluation")?.data,
    result.policyEvaluation,
  );
  await assert.rejects(f.repository.run("beta", f.run.id));
  await assert.rejects(f.repository.events("beta", f.run.id));
});

test("malformed uncertainty is failed research with original evidence retained", async (t) => {
  const f = await setup(t);
  const research = f.model.research;
  f.model.research = async (input) => {
    await research(input);
    return {
      decision: { ...decision, probability: { lower: 0.8, estimate: 0.2, upper: 0.9 } },
      usage: {},
    };
  };
  await f.execute();
  const saved = await f.repository.run("alpha", f.run.id);
  assert.equal(saved.status, "failed");
  assert.equal(saved.error, "INVALID_DECISION");
  assert.equal(saved.decision, null);
  assert.ok(
    (await f.repository.events("alpha", f.run.id)).some((e) => e.type === "model_assessment"),
  );
});

test("resolution links can be read without search but do not authorize siblings or private destinations", async (t) => {
  const f = await setup(t);
  f.markets.get = async () => ({
    ...market,
    resolutionUrls: ["https://example.com/rules", "http://127.0.0.1/private"],
  });
  const reads: string[] = [];
  f.reader.read = async () => {
    reads.push("read");
    return { ...source, url: "https://example.com/rules" };
  };
  f.model.research = async ({ tools, evidence }) => {
    await assert.rejects(tools.readPage!("https://example.com/other"), { code: "INVALID_INPUT" });
    await assert.rejects(tools.readPage!("http://127.0.0.1/private"), { code: "INVALID_INPUT" });
    const read = await tools.readPage!("https://example.com/rules#result");
    assert.equal(read.provenance, "resolution-rule-link");
    assert.equal(read.requestedUrl, "https://example.com/rules");
    assert.equal(evidence?.().sources[0]?.id, source.id);
    assert.equal(evidence?.().quotes.length, 2);
    await tools.searchWeb!("support", "supporting");
    await tools.searchWeb!("opposition", "contradicting");
    return { decision, usage: {} };
  };
  await f.execute();
  assert.equal(reads.length, 1);
  assert.equal((await f.repository.run("alpha", f.run.id)).status, "completed");
  const events = await f.repository.events("alpha", f.run.id);
  assert.ok(
    events.some(
      (event) =>
        event.type === "source" && (event.data as Source).provenance === "resolution-rule-link",
    ),
  );
});

test("pre-event discovery excludes started games before any model call and preserves exclusions", async (t) => {
  const f = await setup(t);
  // Persisted config is updated before claiming a new run; historical snapshots stay unchanged.
  await f.repository.finish(f.run, null, "FIXTURE_SETUP", 201);
  const policy = {
    version: 1 as const,
    mode: "pre-event" as const,
    minLeadMinutes: 15,
    maxHorizonDays: 7,
  };
  await f.repository.updateConfig(scope, 2, { ...f.run.config, discoveryPolicy: policy });
  await f.repository.enqueue(scope, "pre-event", null, 202);
  const run = (await f.repository.claim(203))!;
  f.model.select = async () => {
    assert.fail("No model selection should run");
  };
  f.markets.list = async () => [
    { ...market, startsAt: new Date(100).toISOString(), timingSource: "polymarket.gameStartTime" },
  ];
  await createResearchRunner(f)(run);
  assert.equal((await f.repository.run("alpha", run.id)).error, "NO_ELIGIBLE_MARKETS");
  const events = await f.repository.events("alpha", run.id);
  assert.ok(
    events.some(
      (event) =>
        event.type === "discovery_exclusions" &&
        JSON.stringify(event.data).includes("EVENT_STARTED_OR_TOO_SOON"),
    ),
  );
});

test("manual pre-event markets and final trade refresh use the same lead window", async (t) => {
  for (const mode of ["manual", "refresh"] as const) {
    await t.test(mode, async (t) => {
      const f = await setup(t);
      await f.repository.finish(f.run, null, "FIXTURE_SETUP", 201);
      await f.repository.updateConfig(scope, 2, {
        ...f.run.config,
        discoveryPolicy: { version: 1, mode: "pre-event", minLeadMinutes: 15, maxHorizonDays: 7 },
      });
      await f.repository.enqueue(scope, "timing", "1", 202);
      const run = (await f.repository.claim(203))!;
      let clock = 200;
      f.now = () => clock;
      f.markets.get = async () => ({
        ...market,
        closesAt: new Date(3000000).toISOString(),
        startsAt: new Date(mode === "manual" ? 100 : 900500).toISOString(),
        timingSource: "polymarket.gameStartTime",
      });
      f.model.select = async () => {
        assert.fail("Manual selection must skip the model");
      };
      f.model.research = async ({ tools }) => {
        assert.equal(mode, "refresh");
        await tools.searchWeb!("support", "supporting");
        await tools.searchWeb!("opposition", "contradicting");
        clock = 1000;
        return {
          decision: {
            ...decision,
            action: "TRADE",
            outcomeId: "99",
            probability: { lower: 0.6, estimate: 0.7, upper: 0.8 },
            limitPrice: "0.4",
            expiresAt: new Date(10000).toISOString(),
            abstentionReason: null,
          },
          usage: {},
        };
      };
      await createResearchRunner(f)(run);
      assert.equal((await f.repository.run("alpha", run.id)).error, "NO_ELIGIBLE_MARKETS");
    });
  }
});
