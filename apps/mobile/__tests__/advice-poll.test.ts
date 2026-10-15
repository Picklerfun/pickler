import recommendationJson from "./fixtures/advice/recommendation.json";
import { parseRecommendation } from "../src/advice/parse";
import { POLL_DEADLINE_MS, POLL_INTERVAL_MS, nextPoll, startPoll } from "../src/advice/poll";
import type { PollResponse } from "../src/advice/types";

const T0 = 1_760_000_000_000;
const completed = parseRecommendation(recommendationJson);
const job = (status: "queued" | "running" | "completed" | "failed", over: Record<string, unknown> = {}): PollResponse => ({
  ok: true,
  recommendation: parseRecommendation({ ...recommendationJson, status, result: status === "completed" ? recommendationJson.result : null, ...over }),
});
const fetchFailed: PollResponse = { ok: false };

test("polls every 3 s for at most 4 min", () => {
  expect(POLL_INTERVAL_MS).toBe(3_000);
  expect(POLL_DEADLINE_MS).toBe(240_000);
});

test("queued, then running, then completed gives done with the recommendation", () => {
  let state = startPoll(T0);
  expect(state).toEqual({ kind: "waiting", since: T0 });

  state = nextPoll(state, job("queued"), T0 + 3_000);
  expect(state).toEqual({ kind: "waiting", since: T0 });

  state = nextPoll(state, job("running"), T0 + 6_000);
  expect(state).toEqual({ kind: "waiting", since: T0 });

  state = nextPoll(state, job("completed"), T0 + 9_000);
  expect(state).toEqual({ kind: "done", recommendation: completed });
});

test("failed gives failed with the job's error", () => {
  const state = nextPoll(startPoll(T0), job("failed", { error: "ANALYSIS_EXPIRED" }), T0 + 3_000);
  expect(state).toEqual({ kind: "failed", error: "ANALYSIS_EXPIRED" });
});

test("a completed job without a result counts as failed, never as done", () => {
  const state = nextPoll(startPoll(T0), job("completed", { result: null }), T0 + 3_000);
  expect(state).toEqual({ kind: "failed", error: "ANALYSIS_FAILED" });
});

test("4 min without an answer gives timeout", () => {
  const before = nextPoll(startPoll(T0), job("running"), T0 + POLL_DEADLINE_MS - 1);
  expect(before).toEqual({ kind: "waiting", since: T0 });

  expect(nextPoll(before, job("running"), T0 + POLL_DEADLINE_MS)).toEqual({ kind: "timeout" });
});

test("a fetch error stays waiting until the deadline, then times out", () => {
  let state = nextPoll(startPoll(T0), fetchFailed, T0 + 3_000);
  expect(state).toEqual({ kind: "waiting", since: T0 });

  state = nextPoll(state, fetchFailed, T0 + 120_000);
  expect(state).toEqual({ kind: "waiting", since: T0 });

  expect(nextPoll(state, fetchFailed, T0 + POLL_DEADLINE_MS + 1)).toEqual({ kind: "timeout" });
});

test("a completed answer that arrives at the deadline is still shown", () => {
  expect(nextPoll(startPoll(T0), job("completed"), T0 + POLL_DEADLINE_MS + 500)).toEqual({ kind: "done", recommendation: completed });
});

test("a final state does not move", () => {
  const done = { kind: "done" as const, recommendation: completed };
  expect(nextPoll(done, job("failed"), T0)).toBe(done);
  const timeout = { kind: "timeout" as const };
  expect(nextPoll(timeout, job("completed"), T0)).toBe(timeout);
});
