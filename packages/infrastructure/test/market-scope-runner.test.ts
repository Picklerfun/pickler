import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  NFL_SECTIONS,
  GENERAL_SECTIONS,
  createResearchRunner,
  type ResearchModel,
  type ModelAssessment,
  type Market,
} from "@pickler/core";
import { createTestStore } from "./database.js";
const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
const now = Date.parse("2026-09-17T12:00:00Z");
const market: Market = {
  id: "1",
  question: "NFL Lions vs Bills",
  rules: "NFL game winner including overtime",
  sportsMarketType: "moneyline",
  startsAt: "2026-09-18T00:15:00Z",
  timingSource: "polymarket.gameStartTime",
  closesAt: "2026-09-18T04:00:00Z",
  categoryIds: ["1"],
  active: true,
  liquidity: 1,
  outcomes: [
    { id: "2", label: "Lions" },
    { id: "3", label: "Bills" },
  ],
};
for (const scenario of [
  "nfl",
  "match",
  "award",
  "trade",
  "changed",
  "offscope",
  "empty",
] as const) {
  const kind = scenario === "nfl" || scenario === "match" ? scenario : "award";
  const trade = scenario === "trade" || scenario === "changed";
  const disabled = false;
  const protocol = kind === "nfl" ? "nfl-winner-v1" : "general-market-v1";
  const selectedMarket: Market = {
    ...market,
    question: kind === "nfl" ? market.question : "Soccer fixture",
    classification: {
      version: 1,
      category: "sports",
      subcategory: kind === "nfl" ? "american-football" : "soccer",
      temporalClass: kind === "award" ? "award" : "match",
      ...(kind === "nfl" ? { league: "nfl" as const } : {}),
      provenance: {
        provider: "polymarket",
        mappingVersion: "1.0.0",
        tagIds: ["fixture"],
        temporalBasis: "controlled fixture",
      },
    },
    ...(kind === "award" ? { startsAt: null, closesAt: "2026-12-01T00:00:00Z" } : {}),
  };
  test(`v4 ${scenario}: isolated migration, protocol and nonapplicable sports credentials`, async (t) => {
    const repository = await createTestStore(t);
    const { categoryIds: _legacy, ...defaults } = DEFAULT_CONFIG;
    void _legacy;
    await repository.updateConfig(scope, 1, {
      ...defaults,
      marketScope: {
        version: 1,
        category: "sports",
        subcategories: [kind === "nfl" ? "american-football" : "soccer"],
      },
      plugins: {
        version: 1,
        enabled:
          kind === "nfl"
            ? ["polymarket", "exa"]
            : ["polymarket", "exa", "balldontlie", "the-odds-api"],
      },
    });
    await repository.enqueue(scope, "nfl", scenario === "empty" ? null : "1", now);
    const run = (await repository.claim(now))!;
    let modelCalls = 0;
    let sportsCalls = 0;
    const source = {
      id: "e",
      url: "https://example.com/e",
      content: "Fixture research",
      title: "Fixture",
      provider: "fixture",
      retrievedAt: new Date(now).toISOString(),
      publishedAt: null,
      truncated: false,
    };
    const assessment: ModelAssessment = {
      action: "ABSTAIN",
      marketId: "1",
      outcomeId: null,
      thesis: "No edge",
      counterEvidence: "Contradictory",
      uncertainty: "Medium",
      sourceIds: ["e"],
      probability: null,
      uncertaintyLevel: "MEDIUM",
      missingInformation: [],
      observedPrice: null,
      limitPrice: null,
      expiresAt: null,
      abstentionReason: "No edge",
      report: {
        protocol,
        forecast: {
          outcomeId: "2",
          probability: { lower: 0.4, estimate: 0.5, upper: 0.6 },
          inabilityReason: null,
        },
        sections: (kind === "nfl" ? NFL_SECTIONS : GENERAL_SECTIONS).map((section) => ({
          section,
          status: "missing",
          explanation: "No structured sports plugin enabled; fixture web evidence only",
          sourceIds: ["e"],
        })),
      },
    };
    if (trade) {
      Object.assign(assessment, {
        action: "TRADE",
        outcomeId: "2",
        probability: { lower: 0.68, estimate: 0.7, upper: 0.72 },
        uncertaintyLevel: "LOW",
        observedPrice: "0.5",
        limitPrice: "0.55",
        expiresAt: new Date(now + 600000).toISOString(),
        abstentionReason: null,
      });
      assessment.report!.forecast.probability = assessment.probability;
    }
    let marketLoads = 0;
    const model: ResearchModel = {
      metadata: () => ({
        model: "fixture",
        provider: "fixture",
        prompts: {
          research: { id: "r", version: "1", sha256: "fixture", instructions: "fixture" },
          marketSelection: { id: "s", version: "1", sha256: "fixture", instructions: "fixture" },
        },
      }),
      select: async () => {
        throw new Error("Manual fixture");
      },
      research: async ({ tools, availability, evidence }) => {
        modelCalls++;
        assert.equal(tools.getSportsContext, undefined);
        assert.equal(availability?.balldontlie, kind === "nfl" ? "disabled" : "not_applicable");
        assert.equal(tools.getExternalOdds, undefined);
        assert.equal(
          availability?.["the-odds-api"],
          kind === "nfl" ? "disabled" : "not_applicable",
        );
        await tools.searchWeb!("support", "supporting");
        await tools.searchWeb!("against", "contradicting");
        const references = evidence!().references!;
        assert.equal(references.find((r) => r.kind === "availability")!.data !== undefined, true);
        for (const section of assessment.report!.sections) {
          const reference = references.find(
            (r) =>
              r.sections.includes(section.section) &&
              (section.section !== "quotes" || r.kind === "quote"),
          );
          if (reference) {
            section.status = "supported";
            section.sourceIds = [reference.id];
          }
        }
        return { decision: assessment, usage: {} };
      },
    };
    const runner = createResearchRunner({
      repository,
      model,
      now: () => now,
      sports: {
        context: async () => {
          sportsCalls++;
          throw new Error("Must not call disabled plugin");
        },
      },
      search: { search: async () => ({ sources: [source], usage: {} }) },
      reader: { read: async () => source },
      markets: {
        categories: async () => [],
        list: async () => [selectedMarket],
        listScope: async () => [
          {
            ...selectedMarket,
            classification: { ...selectedMarket.classification!, subcategory: "tennis" },
          },
        ],
        get: async () => {
          marketLoads++;
          return scenario === "offscope" || (scenario === "changed" && marketLoads > 1)
            ? {
                ...selectedMarket,
                classification: { ...selectedMarket.classification!, subcategory: "tennis" },
              }
            : selectedMarket;
        },
        book: async (id) => ({
          outcomeId: id,
          observedAt: new Date(now).toISOString(),
          asks: [{ price: "0.5", size: "100" }],
          bids: [],
        }),
      },
    });
    await runner(run);
    const result = await repository.run("alpha", run.id);
    assert.equal(sportsCalls, 0);
    assert.equal(modelCalls, scenario === "offscope" || scenario === "empty" ? 0 : 1);
    if (["changed", "offscope", "empty"].includes(scenario)) {
      assert.equal(result.status, "failed");
      assert.equal(
        result.error,
        scenario === "empty" ? "NO_ELIGIBLE_MARKETS" : "SUBCATEGORY_NOT_ALLOWED",
      );
      assert.equal(result.decision, null);
      return;
    }
    if (disabled) {
      assert.equal(result.error, "PLUGIN_DISABLED");
    } else {
      assert.equal(result.status, "completed");
      assert.equal(result.decision!.action, trade ? "TRADE" : "ABSTAIN");
      assert.ok(result.decision && "forecast" in result.decision);
      assert.equal(result.decision.schemaVersion, 4);
      assert.equal(result.decision.schemaVersion === 4 && result.decision.protocol, protocol);
      assert.equal(result.decision.forecast.outcomeId, "2");
      const events = await repository.events("alpha", run.id);
      const references = events.find((event) => event.type === "research_references");
      assert.ok(references);
      assert.ok(JSON.stringify(references.data).includes("context:market:1"));
      await assert.rejects(repository.events("beta", run.id), { code: "NOT_FOUND" });
    }
    await assert.rejects(repository.run("beta", run.id), { code: "NOT_FOUND" });
  });
}
