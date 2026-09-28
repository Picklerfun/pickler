import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createResearchRunner,
  MAX_LIMITS,
  type ResearchModel,
  type ResearchObserver,
  type AgentRecord,
  type RunRecord,
  type Market,
  type ModelAssessment,
  type Decision,
  type Source,
} from "../src/index.ts";

const now = Date.parse("2026-09-27T12:00:00Z");
const market: Market = {
  id: "market",
  question: "A wins?",
  rules: "Official result",
  categoryIds: ["1"],
  active: true,
  closesAt: "2026-09-28T12:00:00Z",
  liquidity: 10,
  outcomes: [{ id: "yes", label: "Yes" }],
};
const source: Source = {
  id: "source",
  url: "https://example.com/status",
  title: "Status",
  content: "Uncertain availability",
  retrievedAt: new Date(now).toISOString(),
  publishedAt: null,
  provider: "fixture",
  truncated: false,
};
const assessment: ModelAssessment = {
  action: "ABSTAIN",
  marketId: "market",
  outcomeId: null,
  thesis: "Insufficient evidence",
  counterEvidence: "No result",
  uncertainty: "High",
  sourceIds: ["source"],
  probability: null,
  observedPrice: null,
  limitPrice: null,
  expiresAt: null,
  abstentionReason: "No result",
  uncertaintyLevel: "HIGH",
  missingInformation: ["Availability"],
};
const prompt = { id: "test", version: "1.0.0", sha256: "0".repeat(64), instructions: "fixture" };
const metadata: ReturnType<ResearchModel["metadata"]> = {
  model: "fixture",
  provider: "fixture",
  prompts: { research: prompt, marketSelection: prompt },
};

async function run(observer?: ResearchObserver, fail = false, capture = true) {
  const agent: AgentRecord = {
    id: "agent",
    tenantId: "tenant",
    version: 1,
    config: {
      limits: { ...MAX_LIMITS },
      profile: "private profile",
      categoryIds: ["1"],
      tools: ["searchWeb", "getMarketRules", "getOrderBook"],
      intervalHours: 24,
    },
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
  };
  const record: RunRecord = {
    id: "run",
    tenantId: "tenant",
    agentId: "agent",
    configVersion: 1,
    config: agent.config,
    marketId: "market",
    trigger: "manual",
    status: "running",
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    decision: null,
    error: null,
  };
  const finishes: { decision: Decision | null; error: string | null }[] = [];
  const repository = {
    agent: async () => agent,
    event: async () => {},
    assertOwnership: async () => {},
    finish: async (_run: RunRecord, decision: Decision | null, error: string | null) => {
      finishes.push({ decision, error });
    },
  };
  const model: ResearchModel = {
    metadata: () => metadata,
    select: async () => {
      throw new Error("manual selection only");
    },
    async research(input) {
      await input.tools.searchWeb!("support", "supporting");
      await input.tools.searchWeb!("against", "contradicting");
      const evidence = input.evidence!();
      if (capture) {
        input.onDecisionInput?.({
          observedAt: new Date(now).toISOString(),
          market: input.market,
          evidence,
        });
      }
      // Changes made after the finalizer receives its input must not change the observation.
      evidence.sources[0]!.content = "later mutation";
      if (fail) {
        throw new Error("model failed");
      }
      return { decision: structuredClone(assessment), usage: { inputTokens: 10 } };
    },
  };
  await createResearchRunner({
    repository,
    model,
    ...(observer ? { observer } : {}),
    now: () => now,
    search: { search: async () => ({ sources: [structuredClone(source)], usage: {} }) },
    reader: { read: async () => structuredClone(source) },
    markets: {
      get: async () => market,
      categories: async () => [],
      list: async () => [],
      book: async () => ({
        outcomeId: "yes",
        observedAt: new Date(now).toISOString(),
        bids: [],
        asks: [],
      }),
    },
  })(record);
  return finishes;
}

test("observation preserves the finalizer snapshot and cannot change the completed decision", async () => {
  let called = 0;
  const observed = await run({
    completed: async (snapshot) => {
      called++;
      assert.equal(snapshot.evidence.sources[0]!.content, source.content);
      assert.equal(snapshot.scope.configVersion, 1);
      assert.equal("profile" in snapshot, false);
      snapshot.primary.decision.action = "TRADE";
      throw new Error("disk failure");
    },
    failed: () => {
      throw new Error("logger failure");
    },
  });
  const disabled = await run();
  assert.equal(called, 1);
  assert.deepEqual(observed, disabled);
  assert.equal(observed.length, 1);
  assert.equal(observed[0]!.error, null);
  assert.equal(observed[0]!.decision!.action, "ABSTAIN");
});

test("failed primary research never runs its observer", async () => {
  let called = false;
  const result = await run(
    {
      completed: async () => {
        called = true;
      },
    },
    true,
  );
  assert.equal(called, false);
  assert.equal(result[0]!.decision, null);
});

test("missing finalizer capture is diagnostic only, with no reconstruction from later evidence", async () => {
  let failures = 0;
  const result = await run(
    {
      completed: async () => {
        assert.fail();
      },
      failed: () => {
        failures++;
      },
    },
    false,
    false,
  );
  assert.equal(failures, 1);
  assert.equal(result[0]!.error, null);
});
