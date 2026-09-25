import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeBrief,
  DEFAULT_CONFIG,
  type AgentConfig,
  type Market,
  type ResearchModel,
  type RunRecord,
  type Source,
  type SportsData,
} from "@pickler/core";
import { ExaResearch } from "@pickler/infrastructure";
import { scopeRun } from "../src/composition/run-scope.js";

const signal = () => AbortSignal.timeout(1000);
const limits = DEFAULT_CONFIG.limits;
const market = { id: "1", question: "Chiefs vs Bills" } as Market;

function runWith(patch: Partial<AgentConfig>): RunRecord {
  const config = { ...structuredClone(DEFAULT_CONFIG), ...patch };
  return {
    id: "run-1",
    tenantId: "tenant",
    agentId: "agent",
    trigger: "manual",
    marketId: null,
    status: "running",
    createdAt: 0,
    startedAt: 0,
    finishedAt: null,
    configVersion: 1,
    config,
    decision: null,
    error: null,
  };
}

/** Records the profile each model call receives, which is what the prompt builders serialize. */
function recordingModel() {
  const profiles: string[] = [];
  const tools: unknown[] = [];
  const model: ResearchModel = {
    async select(_markets, profile) {
      profiles.push(profile);
      return { marketId: "1", reason: "only one", usage: null };
    },
    async research(input) {
      profiles.push(input.profile);
      tools.push(input.tools);
      return { decision: {} as never, usage: null };
    },
    metadata: () => ({ model: "fake", provider: "fake", prompts: {} as never }),
  };
  return { model, profiles, tools };
}

function bookSource(key: string, lastUpdate: string): Source {
  return {
    id: `the-odds-api:g1:${key}:now`,
    externalId: `g1:${key}`,
    provider: "the-odds-api",
    url: "https://the-odds-api.com/",
    title: "Structured NFL data (the-odds-api)",
    content: JSON.stringify({ bookmaker: { key } }),
    truncated: false,
    retrievedAt: lastUpdate,
    publishedAt: lastUpdate,
  };
}

function fakeOdds(sources: Source[]): SportsData {
  return {
    async context() {
      return { status: "available", sources, usage: { remaining: 1 } };
    },
  };
}

const base = (model: ResearchModel, odds?: SportsData) => ({
  repository: { event: async () => {} },
  model,
  exa: new ExaResearch("test-only", async () => Response.json({ results: [] })),
  ...(odds ? { odds } : {}),
});

test("the model reads the brief with the rules the person wrote", async () => {
  const skill = { name: "Fade the public", prompt: "Lean against lopsided public money." };
  const withSkill = recordingModel();
  const withoutSkill = recordingModel();
  const run = runWith({ profile: "Reads injury reports.", skills: [skill] });

  const scoped = scopeRun(base(withSkill.model), run);
  await scoped.model.select([market], run.config.profile, signal(), limits, "now");
  await scoped.model.research({
    market,
    profile: run.config.profile,
    tools: {},
    signal: signal(),
    limits,
    onUsage: async () => {},
  });
  const plain = scopeRun(base(withoutSkill.model), runWith({ profile: "Reads injury reports." }));
  await plain.model.select([market], "Reads injury reports.", signal(), limits, "now");

  const brief = composeBrief("Reads injury reports.", [skill]);
  assert.deepEqual(withSkill.profiles, [brief, brief]);
  assert.match(withSkill.profiles[0]!, /Rules it follows:/);
  assert.doesNotMatch(withoutSkill.profiles[0]!, /Rules it follows:/);
  assert.equal(withoutSkill.profiles[0], "Reads injury reports.");
});

test("the model's page reader keeps to an only list", async () => {
  const recorder = recordingModel();
  const run = runWith({ sources: { web: { mode: "only", sites: ["espn.com"] }, books: [] } });
  const scoped = scopeRun(base(recorder.model), run);

  await scoped.model.research({
    market,
    profile: "p",
    tools: { readPage: async () => ({}) as Source },
    signal: signal(),
    limits,
    onUsage: async () => {},
  });

  const tools = recorder.tools[0] as { readPage(url: string): Promise<Source> };
  await assert.rejects(tools.readPage("https://reddit.com/r/nfl"), { code: "INVALID_INPUT" });
});

test("a prefer fallback is recorded as a run event", async () => {
  const events: { type: string; data: unknown }[] = [];
  const run = runWith({ sources: { web: { mode: "prefer", sites: ["espn.com"] }, books: [] } });
  const scoped = scopeRun(
    {
      ...base(recordingModel().model),
      repository: {
        event: async (_run, type, data) => {
          events.push({ type, data });
        },
      },
    },
    run,
  );

  await scoped.search.search("q", signal());

  assert.deepEqual(
    events.map((e) => e.type),
    ["sources.fallback"],
  );
});

test("the odds plugin quotes only the books the person chose, and every book when none", async () => {
  const fresh = new Date().toISOString();
  const all = [
    bookSource("draftkings", fresh),
    bookSource("fanduel", fresh),
    bookSource("williamhill_us", fresh),
  ];
  const odds = fakeOdds(all);
  const guard = async () => {};
  const anywhere = { mode: "anywhere" as const, sites: [] };

  const chosen = scopeRun(
    base(recordingModel().model, odds),
    runWith({ sources: { web: anywhere, books: ["draftkings", "williamhill_us"] } }),
  );
  const every = scopeRun(base(recordingModel().model, odds), runWith({}));
  const labelNotKey = scopeRun(
    base(recordingModel().model, odds),
    runWith({ sources: { web: anywhere, books: ["DraftKings" as never] } }),
  );
  const absent = scopeRun(
    base(recordingModel().model, odds),
    runWith({ sources: { web: anywhere, books: ["pinnacle"] } }),
  );

  const picked = await chosen.odds!.context(market, signal(), guard);
  assert.deepEqual(
    picked.sources.map((s) => s.externalId),
    ["g1:draftkings", "g1:williamhill_us"],
  );
  assert.equal(picked.status, "available");
  assert.equal(every.odds, odds, "an empty list leaves the plugin untouched");
  const byLabel = await labelNotKey.odds!.context(market, signal(), guard);
  assert.equal(byLabel.status, "no_coverage", "keys are compared exactly, never labels");
  assert.equal((await absent.odds!.context(market, signal(), guard)).status, "no_coverage");
});
