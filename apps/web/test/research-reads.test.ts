import { test } from "node:test";
import assert from "node:assert/strict";
import { researchReads } from "../src/features/studio/lib/research-reads";

test("research polling transfers full result once, drains event pages and deduplicates event IDs", async () => {
  const paths: string[] = [];
  let at = 0;
  let state = "running";
  let eventPages = 0;
  const summary = {
    id: "run",
    tenantId: "tenant",
    agentId: "agent",
    trigger: "manual",
    marketId: null,
    status: "running",
    createdAt: 1,
    startedAt: 2,
    finishedAt: null,
    configVersion: 1,
    error: null,
    resultAvailable: false,
    lastEventId: "1",
  };
  const request = async <T>(path: string): Promise<T> => {
    paths.push(path);
    if (path.includes("/agents/")) {
      return { items: [summary], nextCursor: null } as T;
    }
    if (path.endsWith("/status")) {
      return { ...summary, status: state, resultAvailable: state === "completed" } as T;
    }
    if (path.includes("/events")) {
      eventPages++;
      return {
        items: [{ id: String(eventPages), type: "source", data: {}, createdAt: 3 }],
        nextCursor: String(eventPages),
        hasMore: eventPages === 1,
      } as T;
    }
    return { ...summary, status: "completed", decision: { action: "ABSTAIN" } } as T;
  };
  const reader = researchReads(request, () => at);
  const signal = new AbortController().signal;
  await reader.list("agent", signal);
  await reader.selected("run", signal);
  await reader.events("run", signal);
  state = "completed";
  at = 3000;
  await reader.list("agent", signal);
  await reader.selected("run", signal);
  await reader.events("run", signal);
  await reader.selected("run", signal);
  assert.equal(paths.filter((path) => path === "/runs/run").length, 1);
  assert.equal(paths.filter((path) => path.includes("/agents/")).length, 1);
  assert.ok(paths.some((path) => path.endsWith("after=1")));
});

test("explicit older pages preserve history progress and bridge a newly arriving head without auto traversal", async () => {
  let now = 0;
  let newest = 60;
  let calls = 0;
  const reader = researchReads(
    async <T>(path: string): Promise<T> => {
      calls++;
      const match = /cursor=(\d+)/.exec(path);
      const top = match ? Number(match[1]) - 1 : newest;
      const ids = Array.from({ length: Math.min(20, top) }, (_, i) => top - i);
      return {
        items: ids.map((n) => ({
          id: String(n).padStart(3, "0"),
          agentId: "agent",
          createdAt: n,
          status: "completed",
          decision: null,
          resultAvailable: false,
        })),
        nextCursor: top > 20 ? String(top - 19) : null,
      } as T;
    },
    () => now,
  );
  const signal = new AbortController().signal;
  await reader.list("agent", signal);
  await reader.older("agent", signal);
  assert.equal(calls, 2);
  now = 20000;
  newest = 100;
  const refreshed = await reader.list("agent", signal);
  assert.equal(calls, 3, "head refresh does not drain missing pages");
  assert.equal(refreshed.runs.length, 60);
  await reader.older("agent", signal);
  await reader.older("agent", signal);
  const all = await reader.older("agent", signal);
  assert.equal(all.nextCursor, null);
  assert.equal(all.runs.length, 100);
  assert.equal(new Set(all.runs.map((run) => run.id)).size, 100);
  assert.deepEqual(
    all.runs.map((run) => run.createdAt),
    Array.from({ length: 100 }, (_, i) => 100 - i),
  );
});
