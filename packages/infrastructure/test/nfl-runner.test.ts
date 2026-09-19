import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  NFL_SECTIONS,
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
for (const disabled of [false, true]) {
  test(`NFL protocol: optional sports off and required Exa disabled=${disabled}`, async (t) => {
    const repository = await createTestStore(t);
    await repository.updateConfig(scope, 1, {
      ...DEFAULT_CONFIG,
      categoryIds: ["1"],
      plugins: { version: 1, enabled: disabled ? ["polymarket"] : ["polymarket", "exa"] },
      researchProtocol: "nfl-winner-v1",
      discoveryPolicy: { version: 1, mode: "pre-event", minLeadMinutes: 15, maxHorizonDays: 7 },
    });
    await repository.enqueue(scope, "nfl", "1", now);
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
        protocol: "nfl-winner-v1",
        forecast: {
          outcomeId: "2",
          probability: { lower: 0.4, estimate: 0.5, upper: 0.6 },
          inabilityReason: null,
        },
        sections: NFL_SECTIONS.map((section) => ({
          section,
          status: "missing",
          explanation: "No structured sports plugin enabled; fixture web evidence only",
          sourceIds: ["e"],
        })),
      },
    };
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
        assert.equal(availability?.balldontlie, "disabled");
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
        list: async () => [market],
        get: async () => market,
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
    assert.equal(modelCalls, disabled ? 0 : 1);
    if (disabled) {
      assert.equal(result.error, "PLUGIN_DISABLED");
    } else {
      assert.equal(result.status, "completed");
      assert.ok(result.decision && "forecast" in result.decision);
      assert.equal(result.decision.schemaVersion, 3);
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
