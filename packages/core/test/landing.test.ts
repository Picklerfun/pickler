import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGetLanding,
  LANDING_LIMITS,
  type AgentRef,
  type LandingSnapshot,
} from "../src/index.js";

const agent = (name: string): AgentRef => ({
  name,
  ticker: `$${name.slice(0, 4).toUpperCase()}`,
  beat: "sports",
  accent: "lime",
  markSize: 3,
});

function snapshot(overrides: Partial<LandingSnapshot> = {}): LandingSnapshot {
  return {
    generatedAt: new Date("2026-09-16T12:00:00Z"),
    source: "sample",
    graduationTarget: 8000,
    stats: {
      totalVolume: 0,
      totalMarketCap: 0,
      agentsFunded: 0,
      agentsCreated: 0,
      agentsCreatedToday: 0,
      picksToday: 0,
      waitlistCount: 0,
    },
    tape: [],
    spawns: [],
    backing: { fundedTotal: 0, recent: [] },
    launches: [],
    leaderboard: [],
    picks: [],
    announcements: [],
    ...overrides,
  };
}

test("landing ranks agents by net betting result and caps the board", async () => {
  const leaderboard = [-310, 1204, 468, 842, 190, 12].map((net, i) => ({
    agent: agent(`Agent${i}`),
    resolved: 10,
    hitRate: 0.5,
    net,
  }));
  const getLanding = createGetLanding({ getSnapshot: async () => snapshot({ leaderboard }) });

  const result = await getLanding();

  assert.deepEqual(
    result.leaderboard.map((s) => s.net),
    [1204, 842, 468, 190, 12],
  );
  assert.equal(result.leaderboard.length, LANDING_LIMITS.leaderboard);
});

test("landing lists graduated tokens first, then by capital raised", async () => {
  const launches = [
    {
      agent: agent("Small"),
      summary: "",
      stage: "pre-graduation" as const,
      marketCap: 1,
      raised: 960,
    },
    { agent: agent("Grad"), summary: "", stage: "graduated" as const, marketCap: 1, raised: 8000 },
    {
      agent: agent("Big"),
      summary: "",
      stage: "pre-graduation" as const,
      marketCap: 1,
      raised: 4160,
    },
  ];
  const getLanding = createGetLanding({ getSnapshot: async () => snapshot({ launches }) });

  const result = await getLanding();

  assert.deepEqual(
    result.launches.map((l) => l.agent.name),
    ["Grad", "Big", "Small"],
  );
});

test("landing shows the most recently updated picks first", async () => {
  const pick = (name: string, iso: string) => ({
    agent: agent(name),
    outcome: "open" as const,
    updatedAt: new Date(iso),
    steps: [],
  });
  const picks = [
    pick("Old", "2026-09-16T08:00:00Z"),
    pick("New", "2026-09-16T11:00:00Z"),
    pick("Mid", "2026-09-16T10:00:00Z"),
    pick("Oldest", "2026-09-15T08:00:00Z"),
  ];
  const getLanding = createGetLanding({ getSnapshot: async () => snapshot({ picks }) });

  const result = await getLanding();

  assert.deepEqual(
    result.picks.map((p) => p.agent.name),
    ["New", "Mid", "Old"],
  );
});
