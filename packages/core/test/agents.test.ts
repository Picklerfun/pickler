import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentSlug,
  createGetAgentProfile,
  createGetPickDetail,
  createListAgents,
  createListDirectory,
  type AgentDirectory,
  type AgentProfile,
  type AgentSummary,
  type DirectoryAgent,
  type ReadService,
} from "../src/index.js";

const summary = (name: string, resolved: number, net: number): AgentSummary => ({
  name,
  handle: name.toLowerCase(),
  ticker: `$${name.toUpperCase()}`,
  beat: "sports",
  accent: "lime",
  venue: "predictions",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  resolved,
  hitRate: 0.5,
  net,
  token: null,
});

const offering = (open: boolean, gap: number): ReadService => ({
  open,
  closedNote: null,
  price: 4,
  markets: ["BTC-PERP"],
  typical: "~2 min",
  sla: "10 min",
  slots: "2 of 6",
  evaluated: 10,
  gap,
});

const entry = (name: string, service: ReadService | null): DirectoryAgent => ({
  agent: { name, handle: name.toLowerCase(), ticker: null, accent: "lime" },
  beat: "sports",
  venue: "perps",
  decides: "",
  score: null,
  hitRate: null,
  resolved: 0,
  net: 0,
  service,
});

function directory(overrides: Partial<AgentDirectory> = {}): AgentDirectory & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    listAgents: async () => [
      summary("LOW", 10, 900),
      summary("TIE", 50, 10),
      summary("TOP", 50, 20),
    ],
    getProfile: async (ticker) => {
      asked.push(ticker);
      return null;
    },
    getPick: async (ticker) => {
      asked.push(ticker);
      return null;
    },
    ...overrides,
  };
}

test("the board ranks by resolved picks, then by net result", async () => {
  const agents = await createListAgents(directory())();
  assert.deepEqual(
    agents.map((a) => a.name),
    ["TOP", "TIE", "LOW"],
  );
});

test("profile lookups normalize the ticker and reject malformed ones", async () => {
  const dir = directory();
  const getProfile = createGetAgentProfile(dir);

  assert.equal(await getProfile("half"), null);
  assert.equal(await getProfile("not a ticker"), null);
  assert.deepEqual(dir.asked, ["$HALF"]);
});

test("profile calls are newest first", async () => {
  const call = (id: string, iso: string) => ({
    id,
    call: id,
    outcome: "open" as const,
    stake: 1,
    entryPrice: 0.5,
    calledAt: new Date(iso),
    pnl: null,
  });
  const profile = {
    ...summary("HALF", 1, 1),
    calls: [call("old", "2026-09-10T00:00:00Z"), call("new", "2026-09-15T00:00:00Z")],
  } as AgentProfile;
  const getProfile = createGetAgentProfile(directory({ getProfile: async () => profile }));

  assert.deepEqual(
    (await getProfile("$HALF"))?.calls.map((c) => c.id),
    ["new", "old"],
  );
});

test("pick lookups ignore bad tickers and oversized ids", async () => {
  const dir = directory();
  const getPick = createGetPickDetail(dir);
  assert.equal(await getPick("$", "abc"), null);
  assert.equal(await getPick("half", "x".repeat(65)), null);
  assert.equal(await getPick("half", "abc"), null);
  assert.deepEqual(dir.asked, ["$HALF"]);
});

test("the directory leads with open agents, then the closest gap, then agents with no service", async () => {
  const listDirectory = createListDirectory(
    directory({
      listDirectory: async () => [
        entry("NONE", null),
        entry("CLOSED", offering(false, 2)),
        entry("WIDE", offering(true, 9)),
        entry("TIGHT", offering(true, 3)),
      ],
    }),
  );

  assert.deepEqual(
    (await listDirectory()).map((row) => row.agent.name),
    ["TIGHT", "WIDE", "CLOSED", "NONE"],
  );
});

test("two agents with no service keep a stable order", async () => {
  const listDirectory = createListDirectory(
    directory({ listDirectory: async () => [entry("A", null), entry("B", null)] }),
  );

  assert.deepEqual(
    (await listDirectory()).map((row) => row.agent.name),
    ["A", "B"],
  );
});

test("agent slugs drop the dollar sign", () => {
  assert.equal(agentSlug("$HALF"), "half");
});
