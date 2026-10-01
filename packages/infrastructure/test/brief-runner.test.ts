import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  createResearchRunner,
  type AgentBrief,
  type BriefEvaluation,
  type Market,
  type MarketData,
  type ModelAssessment,
  type ResearchModel,
  type Source,
} from "@pickler/core";
import { createTestStore } from "./database";

const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
const brief: AgentBrief = {
  thesis: "Injury news moves the books first.",
  reads: [],
  entersWhen: ["A starter is ruled out", "The market has not moved"],
  exitsWhen: [],
  never: ["Trade within an hour of kickoff"],
};
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
const held: BriefEvaluation = {
  entries: [
    { rule: "A starter is ruled out", fired: true, why: "Listed out on Thursday." },
    { rule: "The market has not moved", fired: false, why: "It moved 4 points." },
  ],
  exitArmed: null,
  neverChecked: [{ rule: "Trade within an hour of kickoff", respected: true }],
};
const abstain: ModelAssessment = {
  action: "ABSTAIN",
  marketId: "1",
  outcomeId: null,
  thesis: "The market already moved",
  counterEvidence: "The report is late",
  uncertainty: "Result unknown",
  sourceIds: ["source"],
  probability: null,
  uncertaintyLevel: "LOW",
  missingInformation: [],
  observedPrice: null,
  limitPrice: null,
  expiresAt: null,
  abstentionReason: "An entry rule did not fire",
};

async function setup(t: TestContext, decision: ModelAssessment) {
  const repository = await createTestStore(t);
  await repository.updateConfig(scope, 1, { ...DEFAULT_CONFIG, categoryIds: ["7"], brief });
  await repository.enqueue(scope, "brief", null, 100);
  const run = (await repository.claim(101))!;
  const received: (AgentBrief | undefined)[] = [];
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
    metadata: () => ({ model: "test", provider: "test", prompts: {} as never }),
    select: async () => ({ marketId: "1", reason: "Researchable rules", usage: {} }),
    research: async ({ tools, brief: given }) => {
      received.push(given);
      await tools.searchWeb!("supporting evidence", "supporting");
      await tools.searchWeb!("contrary evidence", "contradicting");
      return { decision: structuredClone(decision), usage: {} };
    },
  };
  const execute = createResearchRunner({
    repository,
    markets,
    model,
    search: { search: async () => ({ sources: [source], usage: null }) },
    reader: { read: async () => source },
    now: () => 200,
  });
  await execute(run);
  return { repository, run, received };
}

test("the model is handed the brief, and the run records which rule held", async (t) => {
  const { repository, run, received } = await setup(t, { ...abstain, brief: held });
  const saved = await repository.run("alpha", run.id);
  assert.equal(saved.status, "completed");
  assert.deepEqual(received, [brief]);
  const events = await repository.events("alpha", run.id);
  const evaluation = events.find((event) => event.type === "brief_evaluation");
  assert.ok(evaluation);
  assert.deepEqual(evaluation.data, {
    ...held,
    stoppedBy: { kind: "entry", rule: "The market has not moved" },
  });
  assert.deepEqual(
    saved.decision && "modelAssessment" in saved.decision
      ? saved.decision.modelAssessment.brief
      : null,
    held,
  );
});

test("a decision without the brief's answers fails the run", async (t) => {
  const { repository, run } = await setup(t, abstain);
  const saved = await repository.run("alpha", run.id);
  assert.equal(saved.status, "failed");
  assert.equal(saved.error, "INVALID_DECISION");
});
