import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentSummaryDto, LeaderboardDto } from "@pickler/api-schema";
import { launchedTokens, noAgents, nothingRanked } from "../src/features/agents/lib/empty";

/* The launch-day decisions. No test here renders a component — none in this suite does — so what
   is tested is the predicate each board asks before choosing its empty screen over its filters.
   One behaviour per test: an assert after a failing assert never runs. */

const summary = (handle: string, token: AgentSummaryDto["token"]): AgentSummaryDto => ({
  slug: token ? handle : null,
  name: handle,
  handle,
  ticker: token ? `$${handle.toUpperCase()}` : null,
  beat: "sports",
  accent: "lime",
  venue: "predictions",
  createdAt: "2026-09-01T00:00:00.000Z",
  resolved: 0,
  hitRate: null,
  net: 0,
  token,
});

const curve: NonNullable<AgentSummaryDto["token"]> = {
  stage: "pre-graduation",
  marketCap: 0,
  raised: 0,
  graduationTarget: 1000,
  volume24h: 0,
  price: 0,
  change24h: 0,
  address: null,
  chain: "monad-testnet",
};

const board = (entries: LeaderboardDto["entries"]): LeaderboardDto => ({
  entries,
  weights: [{ label: "Calibration", weight: 0.4, note: "Said versus did." }],
  calibration: [],
});

test("a directory with no agents is the launch-day screen", () => {
  assert.equal(noAgents([]), true);
});

test("a directory with one agent is the populated directory, filters and all", () => {
  assert.equal(noAgents([summary("halftime", null)]), false);
});

test("the token board keeps only the agents that have launched a token", () => {
  const rows = launchedTokens([summary("halftime", curve), summary("tapereader", null)]);

  assert.deepEqual(
    rows.map((agent) => agent.handle),
    ["halftime"],
  );
});

test("agents with no token among them leave the token board with nothing, which is its empty screen", () => {
  const rows = launchedTokens([summary("halftime", null), summary("tapereader", null)]);

  assert.equal(noAgents(rows), true);
});

test("a board with no entries has nothing to rank, whatever its weights say", () => {
  assert.equal(nothingRanked(board([])), true);
});

test("one settled entry is a ranking", () => {
  const entry: LeaderboardDto["entries"][number] = {
    agent: { name: "Halftime", handle: "halftime", ticker: null, slug: null, accent: "lime" },
    beat: "sports",
    venue: "predictions",
    score: 61,
    calibrationGap: 4.2,
    resolved: 1,
    net: 12,
  };

  assert.equal(nothingRanked(board([entry])), false);
});
