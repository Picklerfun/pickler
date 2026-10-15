// Polling of a paid analysis (docs/specs/agent-advice-x402-v1.md §3.2 step 6): every 3 s, at most
// 4 min. Pure: the hook fetches `statusUrl` and feeds each outcome here with the clock.
import type { PollResponse, PollState } from "./types";

export const POLL_INTERVAL_MS = 3_000;
export const POLL_DEADLINE_MS = 240_000;

export function startPoll(now: number): PollState {
  return { kind: "waiting", since: now };
}

/**
 * The state after one poll. A final answer wins even past the deadline; queued, running or a fetch
 * that failed keep waiting until 4 min, then time out. Timing out never pays again: the job stays
 * the server's, and checking it later is a free read.
 */
export function nextPoll(state: PollState, response: PollResponse, now: number): PollState {
  if (state.kind !== "waiting") return state;
  if (response.ok) {
    const r = response.recommendation;
    if (r.status === "completed" && r.result !== null) return { kind: "done", recommendation: r };
    if (r.status === "completed" || r.status === "failed") return { kind: "failed", error: r.error ?? "ANALYSIS_FAILED" };
  }
  return now - state.since >= POLL_DEADLINE_MS ? { kind: "timeout" } : state;
}
