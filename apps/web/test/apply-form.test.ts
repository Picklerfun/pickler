import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARENA_START,
  ARENA_STATE_START,
  arenaRows,
  arenaTick,
  clock,
  CURVE_GOAL,
  CURVE_START,
  curvePrice,
  curveStep,
  formatDelta,
  moveLiquidity,
  poolTotal,
} from "../src/features/apply/lib/demo-model";
import {
  answersOf,
  blocksOf,
  canSubmit,
  emailLooksOk,
  filledCount,
  progressLabel,
  sendHint,
  tickerHint,
  WAITLIST_REFUSAL,
  waitlistRefusal,
  withinLimits,
  type BlockSwatches,
  type Fields,
  type SendState,
} from "../src/features/apply/lib/form-model";

/* The rules of the public application form (docs/specs/landing-trade-v1.md §4), with no React and
   no built package behind them. */

/** Core's limits, as APPLICATION_LIMITS_DTO holds them. The canvas's 280 for whyYou is a drift. */
const LIMITS = { agentName: 40, edge: 140, whyYou: 200 };

const full: Fields = {
  agentName: "Halftime",
  ticker: "$HALF",
  xHandle: "@halftimebot",
  category: "Sports",
  personality: "Analyst",
  edge: "It reads injury reports before the books move.",
  whyYou: "Six years of NBA props.",
};

const swatches: BlockSwatches = {
  email: "blue",
  name: "lime",
  handle: "ink",
  edge: "amber",
  whyYou: "magenta",
  category: (name) => (name === "Sports" ? "lime" : "violet"),
  personality: (name) => (name === "Analyst" ? "indigo" : "orange"),
};

const ready: SendState = {
  filled: 6,
  withinLimits: true,
  emailOk: true,
  tickerStatus: "available",
  submitting: false,
};

test("the name counts only once it has a ticker beside it", () => {
  assert.equal(answersOf({ ...full, ticker: "" }).name, false);
  assert.equal(answersOf({ ...full, agentName: "  " }).name, false);
  assert.equal(answersOf(full).name, true);
  assert.equal(filledCount(answersOf(full)), 6);
  assert.equal(filledCount(answersOf({ ...full, category: "", edge: " " })), 4);
});

test("the three free-text answers are held to core's limits", () => {
  assert.equal(withinLimits(full, LIMITS), true);
  assert.equal(withinLimits({ ...full, whyYou: "x".repeat(200) }, LIMITS), true);
  assert.equal(withinLimits({ ...full, whyYou: "x".repeat(201) }, LIMITS), false);
  assert.equal(withinLimits({ ...full, edge: "x".repeat(141) }, LIMITS), false);
  assert.equal(withinLimits({ ...full, agentName: "x".repeat(41) }, LIMITS), false);
  // Trailing spaces on the name do not count against it; the server trims them too.
  assert.equal(withinLimits({ ...full, agentName: `${"x".repeat(40)}   ` }, LIMITS), true);
});

test("the email needs something before an @", () => {
  assert.equal(emailLooksOk("you@email.com"), true);
  assert.equal(emailLooksOk("@email.com"), false);
  assert.equal(emailLooksOk("you"), false);
  assert.equal(emailLooksOk(""), false);
});

test("send lights only with all six in, within limits, an email and a ticker that is not refused", () => {
  assert.equal(canSubmit(ready), true);
  assert.equal(canSubmit({ ...ready, tickerStatus: "idle" }), true);
  assert.equal(canSubmit({ ...ready, tickerStatus: "unknown" }), true);
  // A check still in flight does not hold it; the server confirms on send.
  assert.equal(canSubmit({ ...ready, tickerStatus: "checking" }), true);
  assert.equal(canSubmit({ ...ready, tickerStatus: "taken" }), false);
  assert.equal(canSubmit({ ...ready, tickerStatus: "invalid" }), false);
  assert.equal(canSubmit({ ...ready, filled: 5 }), false);
  assert.equal(canSubmit({ ...ready, withinLimits: false }), false);
  assert.equal(canSubmit({ ...ready, emailOk: false }), false);
  assert.equal(canSubmit({ ...ready, submitting: true }), false);
});

test("the label over the section counts what is left", () => {
  assert.equal(progressLabel({ sent: false, filled: 0, withinLimits: true }), "6 TO GO");
  assert.equal(progressLabel({ sent: false, filled: 4, withinLimits: true }), "2 TO GO");
  assert.equal(progressLabel({ sent: false, filled: 6, withinLimits: true }), "ALL SIX IN");
  assert.equal(
    progressLabel({ sent: false, filled: 6, withinLimits: false }),
    "TRIM THE LONG ANSWERS",
  );
  // An answer over its limit is still in; the label says trim, not count.
  assert.equal(progressLabel({ sent: false, filled: 5, withinLimits: false }), "1 TO GO");
  assert.equal(progressLabel({ sent: true, filled: 6, withinLimits: true }), "SENT");
});

test("the hint beside Send says why it is off", () => {
  assert.equal(sendHint(ready), "All six in. Send it.");
  assert.equal(sendHint({ ...ready, filled: 3 }), "3 to go");
  assert.equal(sendHint({ ...ready, filled: 3, emailOk: false }), "3 to go");
  assert.equal(sendHint({ ...ready, emailOk: false }), "Add the email the invite should go to.");
  assert.equal(sendHint({ ...ready, withinLimits: false }), "Trim the long answers.");
  assert.equal(
    sendHint({ ...ready, tickerStatus: "taken" }),
    "That ticker is taken. Pick another.",
  );
  assert.equal(sendHint({ ...ready, tickerStatus: "invalid" }), "Fix the ticker.");
  assert.equal(sendHint({ ...ready, submitting: true }), "Sending…");
});

test("the ticker hint, in order of what matters most", () => {
  assert.deepEqual(tickerHint("$HALF", "available", "Ticker is reserved."), {
    text: "Ticker is reserved.",
    tone: "bad",
  });
  assert.deepEqual(tickerHint("", "idle", undefined), {
    text: "Type a name and we suggest a ticker. You can change it.",
    tone: "quiet",
  });
  assert.equal(tickerHint("$1AB", "invalid", undefined).tone, "bad");
  assert.deepEqual(tickerHint("$HALF", "taken", undefined), {
    text: "$HALF is taken. Try another.",
    tone: "bad",
  });
  assert.deepEqual(tickerHint("$HALF", "available", undefined), {
    text: "$HALF is free. Edit it if you want something else.",
    tone: "good",
  });
  assert.deepEqual(tickerHint("$HALF", "checking", undefined), {
    text: "Checking $HALF…",
    tone: "quiet",
  });
  assert.deepEqual(tickerHint("$HALF", "unknown", undefined), {
    text: "$HALF looks good. We confirm it when you send.",
    tone: "good",
  });
});

test("the blocks: the email first, then one per answer that is in, in the form's order", () => {
  const blocks = blocksOf(full, " you@email.com ", "$HALF", swatches);
  assert.deepEqual(
    blocks.map((block) => [block.id, block.swatch, block.value, block.label]),
    [
      ["email", "blue", "you@email.com", "INVITE GOES HERE"],
      ["name", "lime", "Halftime", "$HALF · NAME HELD"],
      ["handle", "ink", "@halftimebot", "POSTS FROM"],
      ["category", "lime", "Sports", "CATEGORY"],
      ["personality", "indigo", "Analyst", "PERSONALITY"],
      ["edge", "amber", "It reads injury reports before the books move.", "ITS EDGE"],
      ["whyYou", "magenta", "Six years of NBA props.", "WHY YOU"],
    ],
  );
});

test("an empty form still shows the email block, with the placeholder", () => {
  const empty: Fields = {
    agentName: "",
    ticker: "",
    xHandle: "",
    category: "",
    personality: "",
    edge: "",
    whyYou: "",
  };
  const blocks = blocksOf(empty, "", "", swatches);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.value, "you@email.com");
  // A name without a ticker is not a block yet.
  assert.equal(blocksOf({ ...empty, agentName: "Halftime" }, "", "", swatches).length, 1);
});

test("a seat the browser does not hold is refused in the form's words", () => {
  assert.equal(waitlistRefusal({ canApply: true }), null);
  assert.equal(waitlistRefusal({ canApply: false }), WAITLIST_REFUSAL);
  assert.equal(
    WAITLIST_REFUSAL,
    "This email is already in line. Finish from the browser you signed up with.",
  );
});

/* The two animated cards are pure arithmetic over injected randomness. */

test("the arena moves AUSD from one agent to another and keeps the pool whole", () => {
  const before = poolTotal(ARENA_START);
  const picks = [0.1, 0.9, 0.5];
  const moved = moveLiquidity(ARENA_START, () => picks.shift() ?? 0.5);
  assert.equal(poolTotal(moved.rows), before);
  assert.ok(moved.flow);
  assert.equal(moved.flow.amount, 120 + Math.floor(0.5 * 480));
  const givers = moved.rows.filter((row) => row.delta < 0);
  const takers = moved.rows.filter((row) => row.delta > 0);
  assert.equal(givers.length, 1);
  assert.equal(takers.length, 1);
  assert.equal(givers[0]?.delta, -takers[0]!.delta);
  assert.equal(moved.flow.from, givers[0]?.swatch);
  assert.equal(moved.flow.to, takers[0]?.swatch);
});

test("the arena never drains an agent below its floor", () => {
  const thin = ARENA_START.map((row, at) => (at === 4 ? { ...row, liq: 200 } : row));
  // The leaver is the last row (0.9 of 5 → index 4); it has nothing above the floor to give.
  const moved = moveLiquidity(thin, () => 0.9);
  assert.equal(moved.flow, null);
  assert.equal(poolTotal(moved.rows), poolTotal(thin));
  assert.ok(moved.rows.every((row) => row.delta === 0));
});

test("the arena is ranked by liquidity, bars relative to the leader", () => {
  const rows = arenaRows(ARENA_START);
  assert.deepEqual(
    rows.map((row) => row.rank),
    ["01", "02", "03", "04", "05"],
  );
  assert.equal(rows[0]?.leader, true);
  assert.equal(rows[0]?.pct, 100);
  assert.equal(rows[1]?.leader, false);
  assert.ok(rows.every((row, at) => at === 0 || row.liq <= rows[at - 1]!.liq));
  assert.equal(formatDelta(0), "");
  assert.equal(formatDelta(1240), "+1,240");
  assert.equal(formatDelta(-380), "−380");
});

test("an arena tick keeps the last three flows under stable keys and moves the clock a minute", () => {
  let state = ARENA_STATE_START;
  for (let at = 0; at < 5; at += 1) {
    state = arenaTick(state, () => 0.5);
  }
  assert.equal(state.flows.length, 3);
  assert.deepEqual(
    state.flows.map((flow) => flow.id),
    [2, 3, 4],
  );
  assert.equal(state.secs, 300);
  assert.equal(clock(0), "6D 14H 22M LEFT");
  assert.equal(clock(300), "6D 14H 17M LEFT");
  assert.equal(clock(10 ** 9), "0D 00H 00M LEFT");
});

test("the curve fills to its goal, graduates, holds three ticks and starts over", () => {
  let state = CURVE_START;
  let ticks = 0;
  while (!state.graduated) {
    state = curveStep(state, () => 0);
    ticks += 1;
    assert.ok(ticks < 100, "the curve graduates");
  }
  assert.equal(state.backed, CURVE_GOAL);
  assert.equal(curvePrice(state.backed), "0.480");
  state = curveStep(state, () => 0);
  state = curveStep(state, () => 0);
  state = curveStep(state, () => 0);
  assert.equal(state.graduated, true);
  assert.equal(state.hold, 3);
  assert.deepEqual(
    curveStep(state, () => 0),
    CURVE_START,
  );
  assert.equal(curvePrice(0), "0.120");
});
