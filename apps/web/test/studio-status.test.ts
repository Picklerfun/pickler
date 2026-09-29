import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaperOrder, Run, RunEvent } from "../src/features/studio/api";
import {
  depositFailure,
  homeStatus,
  intervalLabel,
  nextUp,
  pickCard,
  scheduleView,
  stripLog,
  type StatusAgent,
} from "../src/features/studio/home/status";
import { stageFromSearch, STAGES } from "../src/features/studio/home/stage";
import { homeFixture } from "../src/features/studio/home/fixture";

/* The home's words, one state per test: the pill, the mood, the "say" line, the strip, the picks
   card, the schedule note, the next-up list and the deposit failures. No React, no transport. */

const T0 = Date.UTC(2026, 8, 25, 18, 0, 0);
const HOUR = 3_600_000;

const agent = (patch: Partial<StatusAgent> = {}): StatusAgent => ({
  scheduleEnabled: false,
  nextDueAt: null,
  config: { intervalHours: 6 },
  wallet: { balanceAusd: 0 },
  canSchedule: { ok: false, reason: "unfunded" },
  ...patch,
});

const run = (patch: Partial<Run> = {}): Run =>
  ({
    id: "11111111-0000-4000-8000-000000000000",
    tenantId: "t",
    agentId: "a",
    trigger: "manual",
    marketId: null,
    status: "running",
    createdAt: T0,
    startedAt: T0,
    finishedAt: null,
    configVersion: 1,
    config: {},
    decision: null,
    error: null,
    ...patch,
  }) as Run;

let id = 0;
const event = (type: string, seconds: number, data: unknown = {}): RunEvent => ({
  id: ++id,
  type,
  data,
  createdAt: T0 + seconds * 1000,
});

const candidates = event("eligible_candidates", 2, [
  {
    id: "m1",
    question: "Chiefs vs. Bills",
    outcomes: [
      { id: "o-chiefs", label: "Chiefs" },
      { id: "o-bills", label: "Bills" },
    ],
  },
]);
const selection = event("selection", 9, { marketId: "m1", reason: "Line moved" });
const search = event("search_query", 24, { query: "Chiefs injury report", intent: "supporting" });
const assessment = event("model_assessment", 88, {
  probability: { lower: 0.58, estimate: 0.62, upper: 0.66 },
});
const policy = event("policy_evaluation", 112, { finalAction: "TRADE" });

const trade = {
  schemaVersion: 3,
  action: "TRADE",
  marketId: "m1",
  outcomeId: "o-chiefs",
  thesis: "Line moved",
  counterEvidence: "Short week",
  uncertainty: "Preliminary report",
  sourceIds: ["s1", "s2", "s3", "s4", "s5", "s6"],
  observedPrice: "0.54",
  limitPrice: "0.60",
  expiresAt: null,
  abstentionReason: null,
  modelAssessment: { action: "TRADE", probability: { lower: 0.58, estimate: 0.62, upper: 0.66 } },
  policyEvaluation: { finalAction: "TRADE", reasonCodes: [], config: {} },
} as unknown as NonNullable<Run["decision"]>;

const pass = {
  ...trade,
  action: "ABSTAIN",
  outcomeId: null,
  abstentionReason: "The range is wider than twenty points.",
  modelAssessment: { action: "ABSTAIN", probability: { lower: 0.4, estimate: 0.55, upper: 0.7 } },
  policyEvaluation: { finalAction: "ABSTAIN", reasonCodes: [], config: {} },
} as unknown as NonNullable<Run["decision"]>;

const decided = (decision = trade) =>
  run({
    status: "completed",
    marketId: "m1",
    finishedAt: T0 + 131_000,
    decision,
  });

const traced = [candidates, selection, search, assessment, policy];

// ─── Pill and mood ──────────────────────────────────────────────────────────────────────────────

test("a run that has not chosen a market is WORKING and THINKING", () => {
  const status = homeStatus({
    run: run(),
    events: [candidates],
    agent: agent({ canSchedule: { ok: false, reason: "first_run" } }),
    now: T0,
    runCount: 1,
  });

  assert.equal(status.pill, "WORKING");
  assert.equal(status.working, true);
  assert.equal(status.mood, "THINKING");
  assert.equal(status.moodTint, "violet");
  assert.equal(status.moodSub, "Found 1 markets it may call");
  assert.equal(status.say, "Scanning the markets I may call for one worth a look.");
  assert.equal(status.picks, "empty");
});

test("a queued run with no events is getting ready for its first run", () => {
  const status = homeStatus({
    run: run({ status: "queued", startedAt: null }),
    events: [],
    agent: agent(),
    now: T0,
    runCount: 1,
  });

  assert.equal(status.mood, "THINKING");
  assert.equal(status.moodSub, "Getting ready");
  assert.equal(status.say, "Getting ready for my first run.");
  assert.equal(status.strip?.line, "Getting ready…");
  assert.equal(status.strip?.count, "0 STEPS");
});

test("after the selection event it is RESEARCHING the market it chose", () => {
  const status = homeStatus({
    run: run(),
    events: [candidates, selection],
    agent: agent(),
    now: T0,
    runCount: 1,
  });

  assert.equal(status.mood, "RESEARCHING");
  assert.equal(status.moodSub, "Chiefs vs. Bills");
  assert.equal(status.say, "Chiefs vs. Bills looks interesting.");
  assert.equal(status.picks, "looking");
  assert.equal(status.hasRange, false);
  assert.equal(status.lookingNote, "Reading the market rules");
  assert.deepEqual(status.market, { question: "Chiefs vs. Bills", outcome: null });
});

test("a run started on a named market researches without a selection event", () => {
  const status = homeStatus({
    run: run({ marketId: "m9" }),
    events: [event("market_classification", 3)],
    agent: agent(),
    now: T0,
    runCount: 1,
  });

  assert.equal(status.mood, "RESEARCHING");
  assert.equal(status.moodSub, "The market it chose");
  assert.equal(status.say, "I picked a market to look at.");
});

test("each research event gives the say line its own words", () => {
  const say = (events: RunEvent[]) =>
    homeStatus({ run: run(), events, agent: agent(), now: T0, runCount: 1 }).say;

  assert.equal(say([candidates, selection, search]), "Looking up “Chiefs injury report”.");
  assert.equal(
    say([candidates, selection, event("source", 30)]),
    "Reading what I found on Chiefs vs. Bills.",
  );
  assert.equal(
    say([candidates, selection, search, assessment]),
    "My range is 0.58 to 0.66. Checking it against the market.",
  );
  assert.equal(
    say([candidates, selection, event("model_assessment", 40, {})]),
    "Forming my range.",
  );
  assert.equal(say(traced), "Checking your rules before I commit.");
});

test("the range appears in the looking card once the model has assessed", () => {
  const status = homeStatus({
    run: run(),
    events: [candidates, selection, search, assessment],
    agent: agent(),
    now: T0,
    runCount: 1,
  });

  assert.equal(status.hasRange, true);
  assert.deepEqual(status.range, { lower: 0.58, upper: 0.66 });
  assert.equal(status.lookingNote, "Range forming · checking your rules");
});

test("searches count in the looking note before the range forms", () => {
  const status = homeStatus({
    run: run(),
    events: [candidates, selection, search, event("search_query", 30, { query: "Bills" })],
    agent: agent(),
    now: T0,
    runCount: 1,
  });

  assert.equal(status.lookingNote, "Searched 2 times so far");
});

test("a completed TRADE is FIRST CALL IN and PICKED, and asks for funding while unfunded", () => {
  const status = homeStatus({
    run: decided(),
    events: traced,
    agent: agent(),
    now: T0 + 140_000,
    runCount: 1,
  });

  assert.equal(status.pill, "FIRST CALL IN");
  assert.equal(status.working, false);
  assert.equal(status.mood, "PICKED");
  assert.equal(status.moodTint, "lime");
  assert.equal(status.moodSub, "Chiefs to win · first call");
  assert.equal(
    status.say,
    "That was my first call, on paper. Fund my wallet and I can keep going on my own.",
  );
  assert.equal(status.picks, "done");
});

test("a later call says latest, not first", () => {
  const status = homeStatus({
    run: decided(),
    events: traced,
    agent: agent(),
    now: T0 + 140_000,
    runCount: 3,
  });

  assert.equal(status.moodSub, "Chiefs to win · latest call");
  assert.equal(
    status.say,
    "That was my latest call, on paper. Fund my wallet and I can keep going on my own.",
  );
  assert.equal(status.strip?.line, "Last run finished in 2m 11s · 5 steps, 6 sources");
});

test("a completed ABSTAIN is PASSED", () => {
  const status = homeStatus({
    run: decided(pass),
    events: traced,
    agent: agent(),
    now: T0 + 140_000,
    runCount: 1,
  });

  assert.equal(status.pill, "FIRST CALL IN");
  assert.equal(status.mood, "PASSED");
  assert.equal(status.moodTint, "grey");
  assert.equal(status.moodSub, "Chiefs vs. Bills · first call");
});

test("funded with the schedule off, it asks for the schedule", () => {
  const status = homeStatus({
    run: decided(),
    events: traced,
    agent: agent({ wallet: { balanceAusd: 25 }, canSchedule: { ok: true, reason: null } }),
    now: T0 + 140_000,
    runCount: 1,
  });

  assert.equal(status.say, "Funded. Turn on the schedule and I will keep going on my own.");
});

test("funded but locked behind a new configuration, it asks for a run by hand", () => {
  const status = homeStatus({
    run: decided(),
    events: traced,
    agent: agent({
      wallet: { balanceAusd: 25 },
      canSchedule: { ok: false, reason: "first_run" },
    }),
    now: T0 + 140_000,
    runCount: 1,
  });

  assert.equal(
    status.say,
    "Funded. Run me once by hand with these settings and I can keep going on my own.",
  );
});

test("with the schedule on it is LIVE and WAITING, and names the interval", () => {
  const on = (hours: number) =>
    homeStatus({
      run: decided(),
      events: traced,
      agent: agent({
        scheduleEnabled: true,
        nextDueAt: T0 + 140_000 + 6 * HOUR,
        config: { intervalHours: hours },
        wallet: { balanceAusd: 25 },
        canSchedule: { ok: true, reason: null },
      }),
      now: T0 + 140_000,
      runCount: 1,
    });

  assert.equal(on(6).pill, "LIVE");
  assert.equal(on(6).mood, "WAITING");
  assert.equal(on(6).moodTint, "grey");
  assert.equal(on(6).moodSub, "Next run in 6h");
  assert.equal(
    on(6).say,
    "On it. I will run every 6 hours and only bother you when I make a call.",
  );
  assert.equal(on(24).say, "On it. I will run once a day and only bother you when I make a call.");
});

test("a scheduled run in progress is still WORKING", () => {
  const status = homeStatus({
    run: run({ trigger: "schedule" }),
    events: [candidates],
    agent: agent({ scheduleEnabled: true, nextDueAt: T0 + HOUR }),
    now: T0,
    runCount: 2,
  });

  assert.equal(status.pill, "WORKING");
  assert.equal(status.mood, "THINKING");
  assert.equal(status.say, "Scanning the markets I may call for one worth a look.");
});

test("a failed run is STOPPED and says why, in the strip too", () => {
  const status = homeStatus({
    run: run({ status: "failed", finishedAt: T0 + 62_000, error: "NO_ELIGIBLE_MARKETS" }),
    events: [candidates],
    agent: agent({ canSchedule: { ok: false, reason: "first_run" } }),
    now: T0 + 70_000,
    runCount: 1,
  });

  assert.equal(status.pill, "NO CALL YET");
  assert.equal(status.mood, "STOPPED");
  assert.equal(status.moodTint, "magenta");
  assert.equal(status.moodSub, "NO_ELIGIBLE_MARKETS");
  assert.equal(status.say, "My first run stopped before a call: NO_ELIGIBLE_MARKETS.");
  assert.equal(status.strip?.line, "First run failed after 1m 02s · NO_ELIGIBLE_MARKETS");
  assert.equal(status.strip?.tint, "magenta");
  assert.equal(status.picks, "empty");
});

test("a cancelled run and a completed run without a decision are STOPPED too", () => {
  const cancelled = homeStatus({
    run: run({ status: "cancelled", finishedAt: T0 + 5_000 }),
    events: [],
    agent: agent(),
    now: T0 + 6_000,
    runCount: 1,
  });
  const empty = homeStatus({
    run: run({ status: "completed", finishedAt: T0 + 5_000 }),
    events: [],
    agent: agent(),
    now: T0 + 6_000,
    runCount: 2,
  });

  assert.equal(cancelled.mood, "STOPPED");
  assert.equal(cancelled.say, "My first run stopped before a call: it was cancelled.");
  assert.equal(empty.mood, "STOPPED");
  assert.equal(empty.moodSub, "Finished without a call");
  assert.equal(empty.say, "My latest run finished without a call.");
});

test("no run at all is waiting with nothing to say yet, and no strip", () => {
  const status = homeStatus({ run: null, events: [], agent: agent(), now: T0, runCount: 0 });

  assert.equal(status.pill, "NO CALL YET");
  assert.equal(status.mood, "WAITING");
  assert.equal(status.moodSub, "No run yet");
  assert.equal(status.say, "I have not made a call yet.");
  assert.equal(status.strip, null);
  assert.equal(status.picks, "empty");
});

// ─── The strip ──────────────────────────────────────────────────────────────────────────────────

test("a live strip names the latest step and counts them", () => {
  const status = homeStatus({
    run: run(),
    events: [candidates, selection, search],
    agent: agent(),
    now: T0,
    runCount: 1,
  });

  assert.equal(status.strip?.line, "Searched “Chiefs injury report”…");
  assert.equal(status.strip?.count, "3 STEPS");
  assert.equal(status.strip?.tint, "violet");
});

test("a finished strip reads the run's clock, its steps and its cited sources", () => {
  const status = homeStatus({
    run: decided(),
    events: traced,
    agent: agent(),
    now: T0 + 140_000,
    runCount: 1,
  });

  assert.equal(status.strip?.line, "First run finished in 2m 11s · 5 steps, 6 sources");
  assert.equal(status.strip?.count, "");
  assert.equal(status.strip?.tint, "lime");
});

test("the strip's log is newest first, stamped from the run's start", () => {
  const log = stripLog(traced, decided());

  assert.equal(log.length, 5);
  assert.deepEqual(log[0], { id: policy.id, at: "1:52", text: "Its rules let the call through" });
  assert.deepEqual(log[4], { id: candidates.id, at: "0:02", text: "Found 1 markets it may call" });
});

// ─── The picks card ─────────────────────────────────────────────────────────────────────────────

const filled = {
  status: "filled",
  reason: null,
  fill: {
    quantity: "10",
    averagePrice: "0.54",
    market: { question: "Chiefs vs. Bills", outcomes: [{ id: "o-chiefs", label: "Chiefs" }] },
  },
} as unknown as PaperOrder;

test("a TRADE card carries the range, the market, the reason and the paper line", () => {
  const card = pickCard({
    run: decided(),
    events: traced,
    order: { state: "loaded", order: filled },
    now: T0 + 140_000,
  })!;

  assert.equal(card.action, "TRADE");
  assert.equal(card.title, "Chiefs to win");
  assert.equal(card.sub, "Chiefs vs. Bills · just now");
  assert.deepEqual(card.range, { lower: 0.58, estimate: 0.62, upper: 0.66 });
  assert.equal(card.market, 0.54);
  assert.equal(card.rangeText, "0.58 – 0.66");
  assert.equal(card.marketText, "0.54");
  assert.equal(
    card.reason,
    "The price sits under its whole range, and none of your rules stopped it.",
  );
  assert.equal(card.paper, "TRACKED ON PAPER · 10 AT 0.54");
});

test("a TRADE priced inside its range says only that no rule stopped it", () => {
  const inside = {
    ...trade,
    observedPrice: "0.60",
  } as unknown as NonNullable<Run["decision"]>;
  const card = pickCard({
    run: decided(inside),
    events: traced,
    order: { state: "loaded", order: filled },
    now: T0 + 3 * HOUR,
  })!;

  assert.equal(card.reason, "None of your rules stopped it.");
  assert.equal(card.sub, "Chiefs vs. Bills · 3h ago");
});

test("the paper line says what happened to the order, never a fill that did not happen", () => {
  const line = (order: Parameters<typeof pickCard>[0]["order"]) =>
    pickCard({ run: decided(), events: traced, order, now: T0 + 140_000 })!.paper;

  assert.equal(line({ state: "loading" }), "PLACING IT ON PAPER…");
  assert.equal(line({ state: "missing" }), "NOT TRACKED ON PAPER");
  assert.equal(
    line({ state: "loaded", order: { ...filled, status: "pending" } }),
    "PLACING IT ON PAPER…",
  );
  assert.equal(
    line({
      state: "loaded",
      order: { ...filled, status: "not_filled", fill: null, reason: "No depth" },
    }),
    "NOT FILLED ON PAPER · No depth",
  );
});

test("a pass is titled by its market and says why it passed, with no paper line", () => {
  const card = pickCard({
    run: decided(pass),
    events: traced,
    order: { state: "none" },
    now: T0 + 26 * HOUR,
  })!;

  assert.equal(card.action, "PASS");
  assert.equal(card.title, "Chiefs vs. Bills");
  assert.equal(card.sub, "Passed · 1d ago");
  assert.equal(card.reason, "The range is wider than twenty points.");
  assert.equal(card.paper, null);
});

test("a yes/no outcome is titled by the question, and a market with no name by its id", () => {
  const yes = event("eligible_candidates", 2, [
    { id: "m1", question: "Will it rain?", outcomes: [{ id: "o-chiefs", label: "Yes" }] },
  ]);
  const named = pickCard({
    run: decided(),
    events: [yes, selection],
    order: { state: "none" },
    now: T0 + 140_000,
  })!;
  const bare = pickCard({ run: decided(), events: [], order: { state: "none" }, now: T0 })!;

  assert.equal(named.title, "Yes · Will it rain?");
  assert.equal(bare.title, "Market m1");
  assert.equal(bare.sub, "just now");
});

test("there is no card before a decision", () => {
  assert.equal(pickCard({ run: run(), events: traced, order: { state: "none" }, now: T0 }), null);
});

// ─── Run on its own ─────────────────────────────────────────────────────────────────────────────

test("the schedule is locked behind the first run, then behind funding", () => {
  const first = scheduleView(agent({ canSchedule: { ok: false, reason: "first_run" } }), T0);
  const unfunded = scheduleView(agent(), T0);

  assert.equal(first.locked, true);
  assert.equal(first.note, "Unlocks after its first run.");
  assert.equal(first.title, "Locked until the first run finishes");
  assert.equal(unfunded.locked, true);
  assert.equal(unfunded.note, "Fund its wallet to let it run on its own · min. 10 AUSD.");
  assert.equal(unfunded.title, "Fund its wallet first");
});

test("an open lock is ready and off, and an on schedule counts down to its next run", () => {
  const ready = scheduleView(agent({ canSchedule: { ok: true, reason: null } }), T0);
  const on = scheduleView(
    agent({
      scheduleEnabled: true,
      nextDueAt: T0 + 25 * 60_000,
      canSchedule: { ok: true, reason: null },
    }),
    T0,
  );
  const due = scheduleView(agent({ scheduleEnabled: true, nextDueAt: T0 - 1 }), T0);

  assert.equal(ready.locked, false);
  assert.equal(ready.note, "Ready. Off for now.");
  assert.equal(ready.title, "Turn the schedule on or off");
  assert.equal(on.note, "On. Next run in 25m.");
  assert.equal(on.locked, false);
  // A schedule that is on can always be turned off, whatever the lock says now.
  assert.equal(due.locked, false);
  assert.equal(due.note, "On. Next run any moment.");
});

test("the interval reads as the canvas writes it", () => {
  assert.equal(intervalLabel(3), "every 3h");
  assert.equal(intervalLabel(24), "daily");
});

// ─── Next up ────────────────────────────────────────────────────────────────────────────────────

test("next up is empty until a call is in, then asks for funding until 10 AUSD", () => {
  const before = nextUp({ callIn: false, balanceAusd: 0 });
  const unfunded = nextUp({ callIn: true, balanceAusd: 9.99 });
  const funded = nextUp({ callIn: true, balanceAusd: 10 });

  assert.deepEqual(before, { items: [], count: "" });
  assert.equal(unfunded.count, "1 LEFT");
  assert.deepEqual(unfunded.items, [
    {
      key: "fund",
      title: "Fund its wallet",
      note: "At least 10 AUSD to run on its own.",
      cta: "Deposit",
      done: false,
    },
  ]);
  assert.equal(funded.count, "ALL DONE");
  assert.equal(funded.items[0]?.done, true);
  assert.equal(funded.items[0]?.note, "Done");
});

// ─── Deposit failures ───────────────────────────────────────────────────────────────────────────

test("deposit failures are said in the person's terms, and a repeat counts as done", () => {
  assert.deepEqual(depositFailure("DEPOSIT_NOT_SENDABLE", "x"), {
    done: false,
    message: "Your master wallet can't cover this. Add AUSD to it first.",
  });
  assert.deepEqual(depositFailure("DEPOSIT_FEE_TOO_HIGH", "x"), {
    done: false,
    message: "Network fees jumped. Try again.",
  });
  assert.deepEqual(depositFailure("DEPOSIT_NONCE_MISMATCH", "x"), {
    done: false,
    message: "Your master wallet sent another transaction. Try again.",
  });
  assert.deepEqual(depositFailure("DEPOSIT_ALREADY_RECORDED", "x"), { done: true, message: "" });
  assert.deepEqual(depositFailure("SIGNING_UNAVAILABLE", "Request failed: SIGNING_UNAVAILABLE"), {
    done: false,
    message: "Request failed: SIGNING_UNAVAILABLE",
  });
});

// ─── ?stage= ────────────────────────────────────────────────────────────────────────────────────

test("?stage= opens a staged home outside production only, and only for a known stage", () => {
  assert.equal(stageFromSearch("development", "decided"), "decided");
  assert.equal(stageFromSearch("development", ["researching", "live"]), "researching");
  assert.equal(stageFromSearch("development", "nonsense"), undefined);
  assert.equal(stageFromSearch("development", undefined), undefined);
  assert.equal(stageFromSearch("production", "decided"), undefined);
});

test("every staged agent carries an accent from the palette", () => {
  for (const stage of STAGES) {
    assert.equal(homeFixture(stage).agent.accent, "lime");
  }
});

test("a draft's call does not ask for funding: its wallet comes with Go Public", () => {
  const status = homeStatus({
    run: decided(),
    events: traced,
    agent: agent({ draft: true, wallet: null }),
    now: T0 + 140_000,
    runCount: 1,
  });

  assert.equal(
    status.say,
    "That was my first call, on paper. I stay private and on paper until I go public.",
  );
});

test("a draft refused at the limit is told so, not shown a raw request failure", async () => {
  const { messageFor } = await import("../src/features/studio/lib/messages");
  assert.equal(
    messageFor("DRAFT_LIMIT", "At most 3 drafts at a time"),
    "At most 3 drafts at a time.",
  );
  assert.equal(
    messageFor("SOMETHING_NEW", "the server's words"),
    "Request failed: the server's words",
  );
  assert.equal(messageFor("500", undefined), "Request failed: 500");
});
