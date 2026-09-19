import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  ModelFailure,
  effectivePlugins,
  pluginEnabled,
  toolEnabled,
  requireTool,
  validateReport,
  researchReferences,
  NFL_SECTIONS,
  nflMarketEligible,
  uniqueSources,
  type ModelAssessment,
  type Market,
  type Source,
} from "../src/index.js";
const market: Market = {
  id: "1",
  question: "NFL Lions vs. Bills",
  sportsMarketType: "moneyline",
  rules: "NFL full-game winner including overtime",
  active: true,
  closesAt: null,
  categoryIds: [],
  liquidity: 1,
  outcomes: [{ id: "2", label: "Lions" }],
};
const evidence: Source = {
  id: "e",
  url: "https://example.com/a",
  content: "Evidence",
  title: "Fixture",
  provider: "fixture",
  retrievedAt: "2026-09-17T00:00:00Z",
  publishedAt: null,
  truncated: false,
};
function assessment(): ModelAssessment {
  return {
    action: "ABSTAIN",
    marketId: "1",
    outcomeId: null,
    thesis: "No edge",
    counterEvidence: "Conflicting",
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
        status: "supported",
        explanation: "Fixture evidence",
        sourceIds: ["e"],
      })),
    },
  };
}
test("legacy permissions never implicitly enable new providers", () => {
  assert.deepEqual(effectivePlugins(DEFAULT_CONFIG).enabled, ["exa", "polymarket"]);
  assert.equal(pluginEnabled(DEFAULT_CONFIG, "balldontlie"), false);
  assert.equal(toolEnabled(DEFAULT_CONFIG, "getSportsContext"), false);
  const config = { ...DEFAULT_CONFIG, plugins: { version: 1 as const, enabled: [] } };
  assert.equal(toolEnabled(config, "searchWeb"), false);
  assert.throws(() => requireTool(config, "searchWeb"), { code: "PLUGIN_DISABLED" });
});
test("each provider independently combines plugin and tool permission", () => {
  for (const [plugin, tool] of [
    ["exa", "searchWeb"],
    ["polymarket", "getMarketRules"],
    ["balldontlie", "getSportsContext"],
    ["the-odds-api", "getExternalOdds"],
  ] as const) {
    const config = { ...DEFAULT_CONFIG, plugins: { version: 1 as const, enabled: [plugin] } };
    assert.equal(toolEnabled(config, tool), true);
    assert.equal(toolEnabled({ ...config, tools: [] }, tool), false);
  }
});
test("abstention preserves a separate forecast and missing forecasts require explanation", () => {
  const a = assessment();
  assert.equal(validateReport(a, market, [evidence]).forecast.outcomeId, "2");
  a.report!.forecast.probability = null;
  assert.throws(() => validateReport(a, market, [evidence]));
  a.report!.forecast.inabilityReason = "No reliable estimate";
  assert.equal(validateReport(a, market, [evidence]).forecast.probability, null);
});
test("reject unsupported claims, invalid citations, probabilities and differing trade outcomes", () => {
  const a = assessment();
  a.report!.sections[0]!.sourceIds = ["invented"];
  assert.throws(() => validateReport(a, market, [evidence]));
  a.report!.sections[0]!.sourceIds = [];
  assert.throws(() => validateReport(a, market, [evidence]));
  const b = assessment();
  b.report!.forecast.probability!.lower = 0.9;
  assert.throws(() => validateReport(b, market, [evidence]));
  const c = assessment();
  c.action = "TRADE";
  c.outcomeId = "wrong";
  assert.throws(() => validateReport(c, market, [evidence]));
});
test("NFL protocol excludes other sports and partial game markets", () => {
  assert.equal(nflMarketEligible(market), true);
  assert.equal(nflMarketEligible({ ...market, sportsMarketType: "spread" }), false);
  assert.equal(nflMarketEligible({ ...market, question: "NFL first half winner" }), false);
  assert.equal(nflMarketEligible({ ...market, question: "NBA winner", rules: "NBA rules" }), false);
});
test("identical content and canonical URLs are not independent evidence", () => {
  assert.equal(
    uniqueSources([evidence, { ...evidence, id: "b", url: "https://other.example/a" }]).length,
    1,
  );
  assert.equal(
    uniqueSources([
      evidence,
      { ...evidence, id: "b", url: "https://example.com/a#section", content: "different" },
    ]).length,
    1,
  );
});

test("execution references support metadata without masquerading as sports evidence", () => {
  const a = assessment();
  const references = researchReferences(
    market,
    [
      {
        outcomeId: "2",
        observedAt: "2026-09-17T12:00:00Z",
        asks: [{ price: "0.4", size: "10" }],
        bids: [],
      },
    ],
    { balldontlie: "disabled" },
  );
  for (const section of a.report!.sections) {
    if (["identity", "schedule", "rules"].includes(section.section)) {
      section.sourceIds = [references[0]!.id];
    } else if (section.section === "quotes") {
      section.sourceIds = [references[2]!.id, references[0]!.id];
    } else if (section.section === "limitations") {
      section.sourceIds = [references[1]!.id];
    }
  }
  assert.equal(validateReport(a, market, [evidence], references), a.report);
  assert.throws(() => validateReport(a, market, [evidence]), {
    code: "INVALID_RESEARCH_REPORT_ATTRIBUTION",
  });
  const injuries = a.report!.sections.find((section) => section.section === "injuries")!;
  injuries.sourceIds = [references[1]!.id];
  assert.throws(() => validateReport(a, market, [evidence], references), {
    code: "INVALID_RESEARCH_REPORT_ATTRIBUTION",
  });
  injuries.sourceIds = ["e"];
  a.report!.sections.find((section) => section.section === "quotes")!.sourceIds = [
    references[0]!.id,
  ];
  assert.throws(() => validateReport(a, market, [evidence], references), {
    code: "INVALID_RESEARCH_REPORT_ATTRIBUTION",
  });
  injuries.sourceIds = ["context:invented"];
  assert.throws(() => validateReport(a, market, [evidence], references), {
    code: "INVALID_RESEARCH_REPORT_ATTRIBUTION",
  });
});

test("invalid report attribution includes a safe path without citation values", () => {
  const a = assessment();
  a.report!.sections[0]!.sourceIds = ["private-provider-value"];
  assert.throws(
    () => validateReport(a, market, [evidence]),
    (error: unknown) => {
      assert.ok(error instanceof ModelFailure);
      assert.deepEqual(error.details, {
        stage: "decision",
        validation: [{ code: "attribution", path: "report.sections[0].sourceIds" }],
      });
      assert.equal(JSON.stringify(error).includes("private-provider-value"), false);
      return true;
    },
  );
});
