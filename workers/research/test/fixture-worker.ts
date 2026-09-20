import {
  createResearchRunner,
  GENERAL_SECTIONS,
  PilotError,
  type Market,
  type ModelAssessment,
} from "@pickler/core";
import { ControlledResearchStore } from "./fixture-repository.js";
import { createResearchWorker } from "../src/worker.js";

/** Local-only compiled test entry. Production never imports this module. */
const repository = (env: { DATABASE_URL: string; CONTROLLED_TEST_DATABASE_ID?: string }) =>
  new ControlledResearchStore(env.DATABASE_URL, env.CONTROLLED_TEST_DATABASE_ID);
export default createResearchWorker({
  repository,
  runtime(env) {
    const store = repository(env);
    const now = Date.now();
    const source = {
      id: "controlled-evidence",
      url: "https://example.com/controlled-evidence",
      content: "Controlled evidence for integration testing; not a real forecast.",
      title: "Controlled evidence",
      provider: "controlled-test",
      retrievedAt: new Date(now).toISOString(),
      publishedAt: new Date(now).toISOString(),
      truncated: false,
    };
    const market = (id: string): Market => ({
      id,
      question: "Controlled soccer award",
      rules: "The named candidate wins the award; otherwise the opposing outcome wins.",
      startsAt: null,
      closesAt: new Date(now + 86400000).toISOString(),
      categoryIds: ["controlled"],
      active: true,
      liquidity: 100,
      outcomes: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      classification: {
        version: 1,
        category: "sports",
        subcategory: "soccer",
        temporalClass: "award",
        provenance: {
          provider: "polymarket",
          mappingVersion: "1.0.0",
          tagIds: ["controlled"],
          temporalBasis: "Controlled fixture, not a provider response",
        },
      },
    });
    return {
      repository: store,
      execute: createResearchRunner({
        repository: store,
        search: { search: async () => ({ sources: [source], usage: {} }) },
        reader: { read: async () => source },
        markets: {
          categories: async () => [],
          list: async () => [market("1")],
          get: async (id) => market(id),
          book: async (id) => ({
            outcomeId: id,
            observedAt: new Date().toISOString(),
            asks: [{ price: "0.5", size: "100" }],
            bids: [],
          }),
        },
        model: {
          metadata: () => ({
            model: "controlled-test",
            provider: "controlled-test",
            prompts: {
              research: {
                id: "test",
                version: "1",
                sha256: "test",
                instructions: "Controlled test",
              },
              marketSelection: {
                id: "test",
                version: "1",
                sha256: "test",
                instructions: "Controlled test",
              },
            },
          }),
          select: async () => ({ marketId: "1", reason: "Controlled fixture", usage: {} }),
          research: async ({ tools, market: selected, evidence }) => {
            await tools.searchWeb!("supporting evidence", "supporting");
            await tools.searchWeb!("contradictory evidence", "contradicting");
            if (selected.id === "3") {
              throw new PilotError("PROVIDER_FAILURE", "Controlled provider failure");
            }
            const trade = selected.id === "2";
            const probability = { lower: 0.68, estimate: 0.7, upper: 0.72 };
            const assessment: ModelAssessment = {
              action: trade ? "TRADE" : "ABSTAIN",
              marketId: selected.id,
              outcomeId: trade ? "yes" : null,
              thesis: "Controlled integration result",
              counterEvidence: "Controlled contradictory evidence",
              uncertainty: "Controlled test uncertainty",
              sourceIds: [source.id],
              probability: trade ? probability : null,
              uncertaintyLevel: trade ? "LOW" : "MEDIUM",
              missingInformation: [],
              observedPrice: trade ? "0.5" : null,
              limitPrice: trade ? "0.55" : null,
              expiresAt: trade ? new Date(Date.now() + 600000).toISOString() : null,
              abstentionReason: trade ? null : "No demonstrated edge in controlled scenario",
              report: {
                protocol: "general-market-v1",
                forecast: { outcomeId: "yes", probability, inabilityReason: null },
                sections: GENERAL_SECTIONS.map((section) => {
                  const reference = evidence!().references?.find(
                    (r) =>
                      r.sections.includes(section) && (section !== "quotes" || r.kind === "quote"),
                  );
                  return {
                    section,
                    status: reference ? "supported" : "missing",
                    explanation: "Controlled scenario",
                    sourceIds: [reference?.id ?? source.id],
                  };
                }),
              },
            };
            return { decision: assessment, usage: {} };
          },
        },
      }),
    };
  },
});
