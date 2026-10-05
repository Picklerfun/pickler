// apps/web/test/studio-draft-runtime.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PerpsCheckDetailDto, PerpsRecordDto } from "@pickler/api-schema";
import {
  CHECK_POLL_MS,
  amount,
  checkRefusal,
  checkRunning,
  didMeta,
  outcomeCard,
  pnl,
  runButtonView,
  runState,
  runtimeOpen,
  scheduleCopy,
  stepLines,
  tradeCount,
  tradeRows,
  tradesNote,
} from "../src/features/studio/draft/runtime-model";
import { draftStudioFixture } from "../src/features/studio/draft/fixture";
import { clock } from "../src/features/studio/shell/clock";
import { DRAFT_STAGES } from "../src/features/studio/home/stage";

/* The draft Console on the Perpl paper runtime (perpl-paper-runtime-v1 R2, R17): the run button,
   What it did, the outcome card and Trades, from the staged run's fixture. */

const ran = draftStudioFixture("draft-console-ran");
const record = ran.perps.record!;
const check = ran.perps.check!;
const positions = ran.perps.positions!;
const brief = ran.agent.config.brief!;

const withToday = (manualChecks: number): PerpsRecordDto => ({
  ...record,
  today: { ...record.today, manualChecks },
});

test("only a record that says so opens the Console; every other stage keeps the Soon state", () => {
  assert.equal(runtimeOpen(null), false);
  assert.equal(runtimeOpen({ ...record, runtimeEnabled: false }), false);
  assert.equal(runtimeOpen(record), true);

  for (const stage of DRAFT_STAGES) {
    const { perps } = draftStudioFixture(stage);
    const staged = stage === "draft-console-ran" || stage === "draft-trades-active";
    assert.equal(runtimeOpen(perps.record), staged, stage);
  }
  assert.equal(draftStudioFixture("draft-trades-active").section, "picks");
  assert.equal(ran.section, "console");
});

test("Trades says checks are paused while a paper account exists with the runtime off", () => {
  assert.equal(
    tradesNote(record),
    "Every paper position its runs opened, with what it made or lost.",
  );
  assert.equal(
    tradesNote({ ...record, runtimeEnabled: false }),
    "Every paper position its runs opened, with what it made or lost. Checks are paused by the operator; exits still run.",
  );
  assert.equal(
    tradesNote({ ...record, runtimeEnabled: false, account: false }),
    "Every call it would have made, once paper runs open.",
  );
  assert.equal(tradesNote(null), "Every call it would have made, once paper runs open.");
});

test("a check is polled every 1.5 s until it has finished", () => {
  assert.equal(CHECK_POLL_MS, 1500);
  assert.equal(checkRunning(null), false);
  assert.equal(checkRunning({ status: "queued" }), true);
  assert.equal(checkRunning({ status: "running" }), true);
  assert.equal(checkRunning({ status: "finished" }), false);
});

test("the run button: Run it on paper, Running, Run it again, with today's count", () => {
  const base = { record: withToday(0), running: false, ran: false, canManage: true };

  assert.deepEqual(runButtonView(base), {
    label: "Run it on paper",
    shut: false,
    note: "0 OF 6 TODAY",
  });
  assert.deepEqual(runButtonView({ ...base, record: withToday(2), ran: true }), {
    label: "Run it again",
    shut: false,
    note: "2 OF 6 TODAY",
  });
  assert.deepEqual(runButtonView({ ...base, record: withToday(2), running: true, ran: true }), {
    label: "Running",
    shut: true,
    note: "A CHECK IS RUNNING · 2 OF 6 TODAY",
  });
});

test("the run button is shut with the reason at the manual limit and for a view-only member", () => {
  const base = { running: false, ran: true, canManage: true };

  assert.deepEqual(runButtonView({ ...base, record: withToday(6) }), {
    label: "Run it again",
    shut: true,
    note: "6 OF 6 TODAY · IT CAN RUN AGAIN TOMORROW (UTC)",
  });
  /* A count past the limit (a race at midnight) never reads 7 OF 6. */
  assert.equal(runButtonView({ ...base, record: withToday(7) }).note.startsWith("6 OF 6"), true);
  assert.deepEqual(runButtonView({ ...base, record: withToday(1), canManage: false }), {
    label: "Run it again",
    shut: true,
    note: "VIEW ONLY · THE OWNER RUNS IT · 1 OF 6 TODAY",
  });
});

test("the card's state and What it did's meta", () => {
  assert.equal(runState(true, null), "RUNNING");
  assert.equal(runState(false, null), "IDLE");
  assert.equal(runState(false, check), "DONE");
  assert.equal(runState(false, { ...check, status: "running" }), "IDLE");

  assert.equal(didMeta(null), "NO RUNS YET");
  assert.equal(didMeta(check), `RUN AT ${clock(new Date(check.at))}`);
});

test("a refused run is worded by its code", () => {
  assert.equal(
    checkRefusal("MANUAL_LIMIT", 6, "x"),
    "That's 6 paper runs today. It can run again tomorrow (UTC).",
  );
  assert.equal(
    checkRefusal("CHECK_RUNNING", 6, "x"),
    "A check is already running. It shows here as it goes.",
  );
  assert.equal(checkRefusal("RUNTIME_DISABLED", 6, "x"), "Paper runs are closed right now.");
  assert.match(checkRefusal("NOT_A_PERPL_AGENT", 6, "x"), /does not trade on Perpl/);
  assert.equal(checkRefusal("INTERNAL", 6, "Something broke."), "Something broke.");
});

test("What it did lists each step timed from the check's start, the last in the outcome's tone", () => {
  const lines = stepLines(check);

  assert.equal(lines.length, check.steps.length);
  assert.deepEqual(
    lines.map((line) => [line.meta, line.kind]),
    [
      ["0.6s", "brief"],
      ["0.9s", "act"],
      ["2.3s", "read"],
      ["3.2s", "read"],
      ["5.3s", "model"],
      ["5.4s", "rules"],
      ["5.6s", "trade"],
    ],
  );
  assert.equal(lines[0]!.text, "Read the brief · 3 entries, 3 exits, 3 never");
  assert.equal(lines[0]!.iso, check.steps[0]!.at);
});

test("a running check's steps keep their own dots; with no start it times from the first step", () => {
  const running: PerpsCheckDetailDto = {
    ...check,
    status: "running",
    outcome: null,
    startedAt: null,
    steps: check.steps.slice(0, 3),
  };
  const lines = stepLines(running);

  assert.deepEqual(
    lines.map((line) => [line.meta, line.kind]),
    [
      ["0.0s", "brief"],
      ["0.3s", "act"],
      ["1.7s", "read"],
    ],
  );
  assert.deepEqual(stepLines({ ...running, steps: [] }), []);
});

test("the outcome card: the call, its paper size, the entries met, and the rationale", () => {
  const card = outcomeCard(check, brief, positions);

  assert.equal(card.tone, "trade");
  assert.equal(card.eyebrow, "ITS TRADE");
  assert.equal(card.tag, "ENTERED LONG BTC");
  assert.equal(card.title, "LONG BTC · 5 AUSD · 1×");
  assert.equal(card.meta, "68% · 4H HORIZON");
  assert.deepEqual(
    card.lines.map((line) => [line.text, line.tag, line.kind]),
    brief.entersWhen.map((text) => [text, "MET", "met"]),
  );
  assert.equal(card.lines[1]!.why, "BTC is up 0.12% since the first headline");
  assert.equal(card.rationale, check.rationale);
});

test("a held check stands down, naming the entry that held, any exit met and any never broken", () => {
  const held: PerpsCheckDetailDto = {
    ...check,
    outcome: "held",
    outcomeText: "ENTRY 2 HELD",
    action: "hold",
    probability: null,
    entries: [
      { index: 1, met: true, why: "two sources" },
      { index: 2, met: false, why: "moved 0.6%" },
      { index: 9, met: false, why: "a line the brief no longer has" },
    ],
    exits: [
      { index: 1, met: true, why: "target" },
      { index: 2, met: false, why: "" },
    ],
    never: [
      { index: 1, broken: false },
      { index: 3, broken: true },
    ],
  };
  const card = outcomeCard(held, brief, positions);

  assert.equal(card.tone, "stood");
  assert.equal(card.eyebrow, "STOOD DOWN");
  assert.equal(card.tag, "ENTRY 2 HELD");
  assert.equal(card.title, "HOLD BTC");
  assert.equal(card.meta, "4H HORIZON");
  assert.deepEqual(
    card.lines.map((line) => [line.text, line.tag, line.kind]),
    [
      [brief.entersWhen[0], "MET", "met"],
      [brief.entersWhen[1], "HELD", "held"],
      ["Entry 9", "HELD", "held"],
      [brief.exitsWhen[0], "EXIT", "exit"],
      [brief.never[2], "BROKEN", "broken"],
    ],
  );
});

test("a failed check says so with its code; no call is NO DECISION; no brief falls back to numbers", () => {
  const failed: PerpsCheckDetailDto = {
    ...check,
    outcome: "failed",
    outcomeText: null,
    instrument: null,
    action: null,
    probability: null,
    horizonHours: null,
    entries: [{ index: 1, met: false, why: "" }],
    never: [],
    rationale: null,
    error: "MODEL_INVALID",
  };
  const card = outcomeCard(failed, undefined, null);

  assert.equal(card.tone, "failed");
  assert.equal(card.eyebrow, "IT FAILED");
  assert.equal(card.tag, "FAILED");
  assert.equal(card.title, "NO DECISION");
  assert.equal(card.meta, "");
  assert.deepEqual(
    card.lines.map((line) => line.text),
    ["Entry 1"],
  );
  assert.equal(card.rationale, "MODEL_INVALID");

  /* A trade whose position is not (yet) listed names no size. */
  assert.equal(outcomeCard(check, brief, null).title, "LONG BTC");
  assert.equal(
    outcomeCard({ ...check, outcome: "proposed" }, brief, null).eyebrow,
    "IT WOULD ASK YOU",
  );
});

test("amounts and P&L", () => {
  assert.equal(amount("64210.5"), "64,210.5");
  assert.equal(amount("5"), "5");
  assert.equal(amount("0.123456"), "0.12");

  assert.deepEqual(pnl(null), { text: "—", tone: "flat" });
  assert.deepEqual(pnl("0.064"), { text: "+0.06 AUSD", tone: "up" });
  assert.deepEqual(pnl("-0.4"), { text: "−0.40 AUSD", tone: "down" });
  assert.deepEqual(pnl("0.001"), { text: "0.00 AUSD", tone: "flat" });
});

test("Trades lists the open paper positions first, then the closed ones, with P&L", () => {
  const rows = tradeRows(positions);

  assert.deepEqual(
    rows.map((row) => [row.state, row.title, row.meta, row.pnl.text, row.pnl.tone]),
    [
      ["OPEN", "LONG BTC · 5 AUSD · 1×", "OPEN · ENTRY 64,210.5 · MARK 64,480", "+0.02 AUSD", "up"],
      [
        "CLOSED",
        "SHORT ETH · 5 AUSD · 1×",
        "CLOSED · TARGET · 2,412.8 → 2,380.4",
        "+0.06 AUSD",
        "up",
      ],
    ],
  );
  assert.equal(rows[0]!.iso, positions.open[0]!.openedAt);
  assert.equal(rows[0]!.at, clock(new Date(positions.open[0]!.openedAt)));
  assert.equal(rows[1]!.iso, positions.closed[0]!.closedAt);

  assert.equal(tradeCount(positions), "1 OPEN · 1 CLOSED");
  assert.equal(tradeCount(null), "0");
  assert.deepEqual(tradeRows(null), []);
});

test("an open position not yet marked, and a closed one with no reason or exit price", () => {
  const rows = tradeRows({
    ...positions,
    open: [
      { ...positions.open[0]!, id: "older", openedAt: "2026-10-01T10:00:00.000Z" },
      { ...positions.open[0]!, id: "newer", mark: null, unrealizedPnl: null },
    ],
    closed: [{ ...positions.closed[0]!, closeReason: null, exitPrice: null, realizedPnl: "-1.5" }],
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    ["newer", "older", "pos-eth-1"],
  );
  assert.equal(rows[0]!.meta, "OPEN · ENTRY 64,210.5 · MARK —");
  assert.deepEqual(rows[0]!.pnl, { text: "—", tone: "flat" });
  assert.equal(rows[2]!.meta, "CLOSED · 2,412.8 → —");
  assert.deepEqual(rows[2]!.pnl, { text: "−1.50 AUSD", tone: "down" });
});

test("the schedule says it unlocks with the runtime; once open, a draft runs only when you run it", () => {
  const off = scheduleCopy(false, 4);

  assert.equal(off.tag, "STARTS WITH THE PERPL RUNTIME");
  assert.equal(off.title, "Run on its own · every 4h");
  assert.equal(off.rowNote, "Unlocks with the Perpl runtime.");
  assert.equal(off.intervals, true);

  const on = scheduleCopy(true, 4);

  assert.equal(on.tag, "PREPARE THEN ENABLE");
  assert.match(
    on.note,
    /Publish it, complete a successful check.*then enable hourly paper checks in Controls/,
  );
  assert.equal(on.title, "Run on its own · explicit hourly scheduling");
  assert.equal(on.rowNote, "A draft runs only when you run it on paper.");
  assert.doesNotMatch(
    `${on.tag} ${on.note} ${on.title} ${on.rowNote}`,
    /STARTS WITH|Unlocks|every 4h/,
  );
  assert.equal(on.intervals, false);
});

test("a killed agent's refused run says so", () => {
  assert.match(checkRefusal("AGENT_KILLED", 6, "x"), /stopped this agent/);
});
