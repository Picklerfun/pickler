// apps/web/test/studio-live-runtime.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PerpsActionDto,
  PerpsCheckDetailDto,
  PerpsCheckSummaryDto,
  PerpsPositionsResponseDto,
  PerpsProposalDto,
  PerpsRecordDto,
} from "@pickler/api-schema";
import { clock } from "../src/features/studio/shell/clock";
import { liveStudioFixture } from "../src/features/studio/live/fixture";
import {
  entryView,
  healthRows,
  liveCaps,
  liveCapsStepper,
  liveTiles,
} from "../src/features/studio/live/model";
import {
  actionErrorText,
  closedRow,
  costLine,
  countdown,
  decisionRow,
  durationLabel,
  filterChecks,
  flatLine,
  manualCheckView,
  openPnlLabel,
  ownerActionView,
  positionMeter,
  positionTime,
  positionView,
  proposalView,
  recordView,
  runtimeCapsView,
  runtimeCounts,
  runtimeEntryView,
  runtimeErrorText,
  runtimeFilters,
  runtimeHealthRows,
  runtimeMeters,
  runtimeOn,
  runtimeStatus,
  runtimeStopRows,
  runtimeStrip,
  runtimeTiles,
  spanLabel,
  stepRows,
  stopConfirm,
} from "../src/features/studio/live/runtime-model";

const NOW = Date.UTC(2026, 9, 2, 14, 30, 0);
const MINUTE = 60_000;
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MINUTE).toISOString();

const today = (fields: Partial<PerpsRecordDto["today"]> = {}): PerpsRecordDto["today"] => ({
  newMarginAusd: 50,
  realizedAusd: -3.2,
  openCount: 1,
  leverageInUse: 3,
  checks: 14,
  manualChecks: 2,
  manualLimit: 6,
  costMicros: "58300",
  ...fields,
});

const record = (fields: Partial<PerpsRecordDto> = {}): PerpsRecordDto => ({
  runtimeEnabled: true,
  network: "testnet",
  account: true,
  realizedAusd: 1.4,
  openPnlAusd: 0.4,
  feesAndFundingAusd: -0.9,
  cashAusd: 77.2,
  equityAusd: 77.6,
  closedCount: 3,
  wins: 2,
  hitRate: 2 / 3,
  maxDrawdownAusd: 3.2,
  maxDrawdownPct: 0.041,
  checks: 31,
  entries: 4,
  series: [
    { at: at(120), equity: 75.8 },
    { at: at(60), equity: 74.1 },
    { at: at(0), equity: 77.6 },
  ],
  today: today(),
  ...fields,
});

const check = (fields: Partial<PerpsCheckSummaryDto> = {}): PerpsCheckSummaryDto => ({
  id: "c0ffee00-0000-4000-8000-000000000001",
  at: at(2),
  trigger: "hourly",
  status: "finished",
  outcome: "held",
  outcomeText: "ENTRY 2 HELD",
  instrument: "ETH",
  action: "hold",
  probability: null,
  horizonHours: null,
  entries: [
    { index: 1, met: true, why: "Two sources" },
    { index: 2, met: false, why: "Already moved" },
  ],
  exits: [],
  never: [{ index: 1, broken: false }],
  rationale: "The move already happened.",
  inputs: { instruments: ["BTC", "ETH"], web: true },
  configVersion: 4,
  costMicros: "3900",
  error: null,
  ...fields,
});

const open = (
  fields: Partial<PerpsPositionsResponseDto["open"][number]> = {},
): PerpsPositionsResponseDto["open"][number] => ({
  id: "pos-1",
  instrument: "BTC",
  side: "long",
  quantity: "0.000774",
  entryPrice: "96900",
  notional: "75",
  margin: "25",
  leverage: 3,
  openedAt: at(94),
  mark: "97420",
  unrealizedPnl: "0.402",
  stopPrice: "95931",
  takeProfitPrice: "98838",
  exitDueAt: new Date(NOW + 146 * MINUTE).toISOString(),
  liquidationEstimate: "64600",
  checkId: "c0ffee00-0000-4000-8000-000000000005",
  configVersion: 4,
  ...fields,
});

const proposal = (fields: Partial<PerpsProposalDto> = {}): PerpsProposalDto => ({
  id: "9b0b0000-0000-4000-8000-000000000001",
  checkId: "c0ffee00-0000-4000-8000-000000000001",
  kind: "enter",
  instrument: "ETH",
  side: "short",
  margin: "25",
  leverage: 3,
  notional: "75",
  createdAt: at(2),
  expiresAt: new Date(NOW + 13 * MINUTE).toISOString(),
  positionId: null,
  ...fields,
});

// ─── Is it on ──────────────────────────────────────────────────────────────────────────────────

test("the runtime is on only once the record says so; unread, failed and off keep 'runs soon'", () => {
  assert.equal(runtimeOn(null), false);
  assert.equal(runtimeOn("failed"), false);
  assert.equal(runtimeOn(record({ runtimeEnabled: false })), false);
  assert.equal(runtimeOn(record()), true);
});

// ─── Status, tiles, meters, health ─────────────────────────────────────────────────────────────

test("the chip says it runs on paper once on, and paused stays EXITS ONLY", () => {
  assert.equal(runtimeStatus(false).label, "LIVE · ON PAPER");
  assert.equal(runtimeStatus(false).action, "Pause entries");
  assert.equal(runtimeStatus(true).label, "PAUSED · EXITS ONLY");
  assert.equal(runtimeStatus(true).tone, "caution");
});

test("TODAY, OPEN and PUT IN TODAY are real; EQUITY is still its wallet's AUSD", () => {
  const read = { ausdMicro: 75_800_000n, monWei: null };
  const tiles = runtimeTiles(read, 100, record());

  assert.deepEqual(tiles[0], liveTiles(read, 100)[0]);
  assert.deepEqual(
    tiles.slice(1).map((tile) => [tile.label, tile.value, tile.soon]),
    [
      ["TODAY · AUSD", "−3.20", false],
      ["OPEN · 1 POSITION", "+0.40", false],
      ["PUT IN TODAY · OF 100 CAP", "50 AUSD", false],
    ],
  );
});

test("OPEN reads 0 with nothing open, and a dash while a mark is unknown", () => {
  const read = { ausdMicro: 1n, monWei: null };
  assert.equal(runtimeTiles(read, 100, record({ today: today({ openCount: 0 }) }))[2]!.value, "0");
  assert.equal(runtimeTiles(read, 100, record({ openPnlAusd: null }))[2]!.value, "—");
  assert.equal(
    runtimeTiles(read, 100, record({ today: today({ openCount: 2 }) }))[2]!.label,
    "OPEN · 2 POSITIONS",
  );
});

test("the meters are today's figures against the caps", () => {
  const { caps } = liveCaps(liveStudioFixture("perpl-live-active").agent);
  const rows = runtimeMeters(caps, today());

  assert.deepEqual(
    rows.map((row) => [row.key, row.value, Number(row.fill.toFixed(3))]),
    [
      ["putIn", "50 / 100 AUSD", 0.5],
      ["open", "1 / 3", 0.333],
      ["dayLoss", "−3.20 / −20 AUSD", 0.16],
      ["leverage", "3× / 3× max", 1],
    ],
  );
  assert.equal(runtimeMeters(caps, today({ realizedAusd: 4 }))[2]!.value, "0 / −20 AUSD");
});

test("HEALTH adds the runtime and the model's cost today once on; off, only the state", () => {
  const base = healthRows({ market: "connected", sourcesOn: 2, monWei: null, version: 4 });

  assert.deepEqual(runtimeHealthRows(base, null), base);
  assert.deepEqual(runtimeHealthRows(base, "failed"), base);
  assert.deepEqual(
    runtimeHealthRows(base, record({ runtimeEnabled: false }))
      .slice(base.length)
      .map((row) => [row.label, row.value]),
    [["Runtime", "NOT OPEN YET"]],
  );
  assert.deepEqual(
    runtimeHealthRows(base, record())
      .slice(base.length)
      .map((row) => [row.label, row.value]),
    [
      ["Runtime", "ON · PAPER · HOURLY"],
      ["Model cost today", "≈ $0.06"],
    ],
  );
});

test("the model's cost reads in dollars, under a cent said so, unknown a dash", () => {
  assert.equal(costLine("58300"), "≈ $0.06");
  assert.equal(costLine("3900"), "< $0.01");
  assert.equal(costLine("0"), "≈ $0.00");
  assert.equal(costLine(null), "—");
});

// ─── Words for what runs ───────────────────────────────────────────────────────────────────────

test("once on, HOW IT RUNS says it checks hourly on paper and drops ONCE IT RUNS", () => {
  const view = runtimeEntryView(
    entryView({ mode: "approve", meanwhile: "wait", smallAusd: 10 }, 25),
  );

  assert.equal(
    view.statusNote,
    "It is public on Pickler and checks Perpl and its sources every hour, on paper; it asks you before entering.",
  );
  assert.equal(view.modeNote, "ON PAPER · EVERY ENTRY WAITS FOR YOUR TAP · EXITS NEVER WAIT");
  assert.doesNotMatch(view.statusNote, /when the Perpl runtime opens/);
});

test("STOPS once on: Stop · close all is paper, Auto-pause is on for the day-loss stop", () => {
  const rows = runtimeStopRows(false);

  assert.deepEqual(
    rows.map((row) => [row.key, row.action.label]),
    [
      ["pause", "Pause"],
      ["stop", "PAPER"],
      ["auto", "ON · DAY-LOSS"],
    ],
  );
  assert.match(rows[1]!.note, /No passkey: it is paper/);
  assert.match(rows[2]!.note, /^It pauses itself when today's realized loss \(UTC\) reaches/);
  assert.match(rows[2]!.note, /gas, credits or losing Perpl comes with live trading/);
  assert.doesNotMatch(rows[2]!.note, /WITH THE RUNTIME|will pause/i);
  assert.equal(runtimeStopRows(true)[0]!.action.label, "Resume");
});

test("Stop · close all asks once, saying what closes", () => {
  assert.equal(
    stopConfirm(2).note,
    "2 paper positions close at the market; it pauses until you resume. No passkey: it is paper.",
  );
  assert.match(stopConfirm(1).note, /^1 paper position closes/);
  assert.match(stopConfirm(0).note, /^Nothing is open/);
});

test("the flat line once on says when it enters, and paused says entries are paused", () => {
  assert.match(flatLine(false), /every line of the brief is true/);
  assert.match(flatLine(true), /Entries are paused/);
});

test("the runtime's refusals are said in the owner's words, others keep theirs", () => {
  assert.match(runtimeErrorText("MANUAL_LIMIT", "x"), /6 manual checks/);
  assert.match(runtimeErrorText("PROPOSAL_EXPIRED", "x"), /15 minutes/);
  assert.match(runtimeErrorText("POSITION_CLOSED", "x"), /already closed/);
  assert.match(runtimeErrorText("AGENT_KILLED", "x"), /stopped this agent/);
  assert.equal(runtimeErrorText("SOMETHING_ELSE", "Their words."), "Their words.");
});

test("once on, Limits' day-loss line and note say what runs now, the other caps unchanged", () => {
  const { caps } = liveCaps(liveStudioFixture("perpl-live-active").agent);
  const off = liveCapsStepper(caps, caps);
  const on = runtimeCapsView(off);

  assert.match(off.rows.find((row) => row.key === "dayLossStopAusd")!.sub, /ONCE IT RUNS/);
  assert.equal(
    on.rows.find((row) => row.key === "dayLossStopAusd")!.sub,
    "LOST IN A DAY (UTC) · IT PAUSES ITSELF THERE, EXITS KEEP RUNNING",
  );
  assert.equal(
    on.note,
    "Pickler holds every paper trade to these. On-chain caps come with live trading.",
  );
  assert.deepEqual(
    on.rows.filter((row) => row.key !== "dayLossStopAusd"),
    off.rows.filter((row) => row.key !== "dayLossStopAusd"),
  );
  assert.equal(on.tag, off.tag);
});

// ─── The owner's actions ───────────────────────────────────────────────────────────────────────

const actionDto = (fields: Partial<PerpsActionDto>): PerpsActionDto => ({
  id: "ac710000-0000-4000-8000-000000000009",
  kind: "close",
  status: "pending",
  positionId: "pos-1",
  proposalId: null,
  attempts: 0,
  lastError: null,
  checkId: null,
  createdAt: "2026-10-02T14:29:00.000Z",
  updatedAt: "2026-10-02T14:29:00.000Z",
  ...fields,
});

const ownerCheck = (fields: Partial<PerpsCheckDetailDto>): PerpsCheckDetailDto => ({
  ...liveStudioFixture("perpl-live-active").runtime.details[
    liveStudioFixture("perpl-live-active").runtime.checks[0]!.id
  ]!,
  id: "c0ffee00-0000-4000-8000-0000000000aa",
  trigger: "owner",
  ...fields,
});

test("an owner action reads sending, then waiting, then being carried out", () => {
  assert.deepEqual(ownerActionView({ kind: "close", action: null, outcome: null }), {
    state: "sending",
    text: "Sending…",
    tone: "quiet",
    settled: false,
  });

  const queued = ownerActionView({ kind: "close", action: actionDto({}), outcome: null });
  assert.equal(queued.state, "pending");
  assert.match(queued.text, /research worker picks it up/);
  assert.equal(queued.settled, false);

  const held = ownerActionView({
    kind: "approve",
    action: actionDto({ kind: "approve", lastError: "CHECK_RUNNING", attempts: 1 }),
    outcome: null,
  });
  assert.equal(held.text, "Waiting for the current check…");
  assert.equal(held.settled, false);

  const retrying = ownerActionView({
    kind: "close",
    action: actionDto({ lastError: "CLOSE_FAILED", attempts: 2 }),
    outcome: null,
  });
  assert.equal(retrying.text, "Trying again. A paper close didn't go through.");

  assert.equal(
    ownerActionView({ kind: "stop", action: actionDto({ status: "running" }), outcome: null }).text,
    "Closing everything on paper…",
  );
});

test("a done action waits for its check, then says what really happened", () => {
  const checkId = "c0ffee00-0000-4000-8000-0000000000aa";
  const done = actionDto({ kind: "approve", status: "done", checkId });

  const unread = ownerActionView({ kind: "approve", action: done, outcome: null });
  assert.equal(unread.settled, false);
  assert.equal(unread.text, "Entering on paper…");

  const cases: [Partial<PerpsCheckDetailDto>, string, string][] = [
    [
      { outcome: "entered", outcomeText: "ENTERED SHORT ETH" },
      "Entered on paper · ENTERED SHORT ETH",
      "good",
    ],
    [
      { outcome: "blocked", outcomeText: "BLOCKED BY CAP · PER DAY" },
      "Not entered · BLOCKED BY CAP · PER DAY",
      "caution",
    ],
    [
      { outcome: "exited", outcomeText: "CLOSED BY YOU · LONG BTC" },
      "Done · CLOSED BY YOU · LONG BTC",
      "good",
    ],
    [
      { outcome: "skipped", outcomeText: "ALREADY CLOSED" },
      "Nothing changed · ALREADY CLOSED",
      "quiet",
    ],
    [
      { outcome: "failed", outcomeText: "Failed", error: "CHECK_INTERRUPTED" },
      "Couldn't enter. It lost its turn before acting, so nothing changed. Try again.",
      "bad",
    ],
  ];
  for (const [fields, text, tone] of cases) {
    const view = ownerActionView({ kind: "approve", action: done, outcome: ownerCheck(fields) });

    assert.equal(view.text, text);
    assert.equal(view.tone, tone);
    assert.equal(view.settled, true);
    assert.equal(view.state, "done");
  }

  /* Another check's detail is not this action's outcome. */
  assert.equal(
    ownerActionView({
      kind: "approve",
      action: done,
      outcome: ownerCheck({ id: "c0ffee00-0000-4000-8000-0000000000bb" }),
    }).settled,
    false,
  );
  /* No check, or one that could not be read: done, and said plainly. */
  assert.equal(
    ownerActionView({ kind: "stop", action: actionDto({ status: "done" }), outcome: null }).text,
    "Done.",
  );
  assert.equal(ownerActionView({ kind: "approve", action: done, outcome: "failed" }).text, "Done.");
});

test("a failed action says why in words", () => {
  const view = ownerActionView({
    kind: "close",
    action: actionDto({ status: "failed", lastError: "POSITION_CLOSED" }),
    outcome: null,
  });
  assert.equal(view.text, "Couldn't close it. That position is already closed.");
  assert.equal(view.tone, "bad");
  assert.equal(view.settled, true);

  assert.equal(actionErrorText(null), "It could not be carried out.");
  assert.equal(actionErrorText("AGENT_KILLED"), runtimeErrorText("AGENT_KILLED", ""));
  assert.equal(actionErrorText("WEIRD_CODE"), "It could not be carried out (WEIRD_CODE).");
});

// ─── The manual check ──────────────────────────────────────────────────────────────────────────

test("Run a check now counts the day's manual checks and shuts at the limit or while one runs", () => {
  assert.deepEqual(manualCheckView(today(), false), {
    label: "Run a check now",
    note: "2 OF 6 MANUAL TODAY",
    shut: null,
  });
  assert.equal(
    manualCheckView(today({ manualChecks: 6 }), false).shut,
    "All 6 manual checks are used today (UTC).",
  );
  assert.equal(manualCheckView(today(), true).label, "Checking…");
  assert.equal(manualCheckView(today(), true).shut, "A check is running.");
});

// ─── Decisions ─────────────────────────────────────────────────────────────────────────────────

test("the filters count what was read; Posted stays at zero", () => {
  const checks = [
    check(),
    check({ id: "b", outcome: "entered" }),
    check({ id: "c", outcome: "held" }),
    check({ id: "d", outcome: "proposed" }),
  ];
  const filters = runtimeFilters(checks, "held");

  assert.deepEqual(
    filters.map((filter) => [filter.key, filter.count, filter.on]),
    [
      ["all", 4, false],
      ["entered", 1, false],
      ["held", 2, true],
      ["exited", 0, false],
      ["blocked", 0, false],
      ["posted", 0, false],
    ],
  );
  assert.equal(filterChecks(checks, "held").length, 2);
  assert.equal(filterChecks(checks, "all").length, 4);
});

test("a feed row: outcome text, the call and its conviction, the inputs, the lines and the cost", () => {
  const row = decisionRow(
    check({
      outcome: "proposed",
      outcomeText: "PROPOSED SHORT ETH",
      action: "open-short",
      probability: 0.68,
      horizonHours: 4,
    }),
    NOW,
  );

  assert.equal(row.text, "PROPOSED SHORT ETH · SHORT ETH · 68% OVER 4H");
  assert.equal(row.tag, "ASKED YOU");
  assert.equal(row.kind, "proposed");
  assert.equal(row.inputsLine, "HOURLY · BTC, ETH · WEB");
  assert.equal(row.at, clock(new Date(at(2))));
  assert.equal(row.cost, "< $0.01");
  assert.deepEqual(
    row.lines.map((line) => [line.label, line.tag, line.good]),
    [
      ["ENTRY 1", "MET", true],
      ["ENTRY 2", "HELD", false],
      ["NEVER 1", "KEPT", true],
    ],
  );
});

test("a running check says so; a manual one says who ran it; an exit has no inputs", () => {
  assert.equal(
    decisionRow(check({ status: "running", outcome: null }), NOW).text,
    "Checking… · HOLD ETH",
  );
  assert.equal(decisionRow(check({ status: "running", outcome: null }), NOW).kind, "running");
  assert.equal(
    decisionRow(check({ trigger: "manual" }), NOW).inputsLine,
    "RUN BY YOU · BTC, ETH · WEB",
  );
  assert.equal(decisionRow(check({ trigger: "exits", inputs: null }), NOW).inputsLine, "EXITS");
});

test("a check's steps read newest first, each at its offset from the start", () => {
  const detail: PerpsCheckDetailDto = {
    ...check(),
    startedAt: at(2),
    finishedAt: new Date(NOW - 2 * MINUTE + 8_600).toISOString(),
    steps: [
      { at: new Date(NOW - 2 * MINUTE + 300).toISOString(), text: "Woke up", ms: null },
      {
        at: new Date(NOW - 2 * MINUTE + 7_100).toISOString(),
        text: "Checking the brief",
        ms: null,
      },
      { at: new Date(NOW - 2 * MINUTE + 68_000).toISOString(), text: "HOLD", ms: null },
    ],
  };

  assert.deepEqual(
    stepRows(detail).map((step) => [step.at, step.text]),
    [
      ["1:08", "HOLD"],
      ["0:07", "Checking the brief"],
      ["0:00", "Woke up"],
    ],
  );
});

// ─── The strip ─────────────────────────────────────────────────────────────────────────────────

test("the strip with no check yet says it checks hourly, or that paused runs none", () => {
  const none = runtimeStrip({ newest: null, detail: null, total: 0, paused: false, now: NOW });

  assert.equal(none.line, "No checks yet · it checks Perpl every hour, on paper");
  assert.equal(none.count, "0 CHECKS");
  assert.deepEqual(none.log, []);
  assert.match(
    runtimeStrip({ newest: null, detail: null, total: 0, paused: true, now: NOW }).line,
    /paused/,
  );
});

test("the strip reads the newest check: its time, what it did, how long, its steps", () => {
  const newest = check();
  const detail: PerpsCheckDetailDto = {
    ...newest,
    startedAt: at(2),
    finishedAt: new Date(NOW - 2 * MINUTE + 900).toISOString(),
    steps: [
      { at: at(2), text: "Woke up", ms: null },
      { at: new Date(NOW - 2 * MINUTE + 900).toISOString(), text: "ENTRY 2 HELD", ms: null },
    ],
  };
  const view = runtimeStrip({ newest, detail, total: 31, paused: false, now: NOW });

  assert.equal(view.line, `Last check ${clock(new Date(at(2)))} · ENTRY 2 HELD · 0.9s · 2 steps`);
  assert.equal(view.count, "31 CHECKS");
  assert.deepEqual(
    view.log.map((step) => step.text),
    ["ENTRY 2 HELD", "Woke up"],
  );
  assert.equal(view.more, "EVERY DECISION →");
});

test("a running newest check is 'Checking now'; another check's steps are not its log", () => {
  const view = runtimeStrip({
    newest: check({ status: "running", outcome: null }),
    detail: { ...check({ id: "other" }), startedAt: null, finishedAt: null, steps: [] },
    total: 1,
    paused: false,
    now: NOW,
  });

  assert.match(view.line, /^Checking now · started /);
  assert.equal(view.count, "1 CHECK");
  assert.deepEqual(view.log, []);
});

test("durations and spans read as the canvas writes them", () => {
  assert.equal(durationLabel(900), "0.9s");
  assert.equal(durationLabel(12_400), "12s");
  assert.equal(durationLabel(72_000), "1m 12s");
  assert.equal(spanLabel(52 * MINUTE), "52 MIN");
  assert.equal(spanLabel(190 * MINUTE), "3H 10M");
  assert.equal(spanLabel(240 * MINUTE), "4H");
});

// ─── Positions ─────────────────────────────────────────────────────────────────────────────────

test("the stop–target meter places the mark between them, for a long and a short", () => {
  const long = positionMeter(true, 96900, 97420, 95931, 98838)!;

  assert.equal(long.fill.toFixed(3), "0.512");
  assert.equal(long.stop, "STOP 95,931.0");
  assert.equal(long.target, "TARGET 98,838.0");
  assert.equal(long.text, "+0.54% · 1.46% TO TARGET · 1.53% TO STOP");

  const short = positionMeter(false, 3600, 3564, 3636, 3528)!;
  assert.equal(short.fill.toFixed(3), "0.667");
  assert.match(short.text, /^\+1\.00%/);

  assert.equal(positionMeter(true, 1, 1, null, 2), null);
  assert.equal(positionMeter(true, 1, null, 0.9, 2), null);
});

test("the meter clamps past either level", () => {
  assert.equal(positionMeter(true, 100, 90, 95, 110)!.fill, 0);
  assert.equal(positionMeter(true, 100, 120, 95, 110)!.fill, 1);
});

test("the time stop says what is left of it and when it closes", () => {
  const time = positionTime(at(94), new Date(NOW + 146 * MINUTE).toISOString(), NOW)!;

  assert.equal(time.text, "2H 26M LEFT OF 4H");
  assert.equal(time.fill.toFixed(3), "0.392");
  assert.equal(time.closesAt, clock(new Date(NOW + 146 * MINUTE)));
  assert.match(positionTime(at(300), at(60), NOW)!.text, /^TIME STOP DUE/);
  assert.equal(positionTime(at(94), null, NOW), null);
});

test("a position card: P&L and its share of the margin, figures, liquidation, the line", () => {
  const view = positionView(open(), NOW);

  assert.equal(view.side, "LONG");
  assert.equal(view.market, "BTC-PERP");
  assert.equal(view.pnl, "+0.40");
  assert.equal(view.pnlPct, "+1.6%");
  assert.equal(view.tone, "up");
  assert.equal(view.size, "25");
  assert.equal(view.notional, "75");
  assert.equal(view.worth, "25.40");
  assert.equal(view.liq, "64,600.0 · 33.7% AWAY");
  assert.equal(view.decision, "#C0FFEE");
  assert.equal(view.line, "Put in 25 AUSD · 75 of BTC at 3× · worth 25.40 · 2H 26M LEFT OF 4H");
});

test("a position without a mark has no P&L, worth or meter, and says so with dashes", () => {
  const view = positionView(open({ mark: null, unrealizedPnl: null }), NOW);

  assert.equal(view.pnl, "—");
  assert.equal(view.pnlPct, null);
  assert.equal(view.worth, "—");
  assert.equal(view.meter, null);
  assert.equal(view.mark, "—");
});

test("the positions head sums the open P&L, or counts them while a mark is unknown", () => {
  assert.equal(openPnlLabel([]), "0 OPEN");
  assert.equal(openPnlLabel([open(), open({ id: "b", unrealizedPnl: "-1.1" })]), "OPEN −0.70 AUSD");
  assert.equal(openPnlLabel([open({ unrealizedPnl: null })]), "1 OPEN");
});

// ─── Waiting on you ────────────────────────────────────────────────────────────────────────────

test("a live countdown to expiresAt, then EXPIRED", () => {
  const expiresAt = new Date(NOW + 4 * MINUTE + 12_000).toISOString();

  assert.deepEqual(countdown(expiresAt, NOW), { text: "VALID 4:12", expired: false });
  assert.deepEqual(countdown(expiresAt, NOW + 4 * MINUTE + 11_500), {
    text: "VALID 0:01",
    expired: false,
  });
  assert.deepEqual(countdown(expiresAt, NOW + 5 * MINUTE), { text: "EXPIRED", expired: true });
});

test("a proposal card: the canvas's head, title, figures, its check's lines and Enter / Skip", () => {
  const view = proposalView(proposal(), NOW, check());

  assert.equal(view.head, "IT WANTS TO ENTER");
  assert.equal(view.title, "SHORT ETH-PERP · 25 AUSD · 3×");
  assert.equal(view.ttl, "VALID 13:00");
  assert.equal(view.cta, "Enter");
  assert.equal(view.skip, "Skip");
  assert.deepEqual(
    view.why.map((line) => [line.text, line.tag]),
    [
      ["Two sources", "MET"],
      ["Already moved", "HELD"],
      ["You asked to approve entries · waiting", "ASK"],
    ],
  );
});

test("a size-up proposal reads Size up / Keep it small; an unread check leaves only the ask", () => {
  const view = proposalView(proposal({ kind: "size_up", margin: "15" }), NOW, null);

  assert.equal(view.head, "IN SMALL · SIZE UP?");
  assert.equal(view.cta, "Size up +15");
  assert.equal(view.skip, "Keep it small");
  assert.deepEqual(
    view.why.map((line) => line.tag),
    ["ASK"],
  );
});

// ─── Record ────────────────────────────────────────────────────────────────────────────────────

test("Record's head, equity line and five figures come from the record", () => {
  const view = recordView(record());

  assert.equal(view.meta, "SINCE PUBLIC · 3 CLOSED");
  assert.equal(view.equityHead, "STARTED 75.80 · NOW 77.60");
  assert.deepEqual(view.trail, [75.8, 74.1, 77.6]);
  assert.equal(view.up, true);
  assert.deepEqual(
    view.stats.map((stat) => [stat.label, stat.value]),
    [
      ["REALIZED · AUSD", "+1.40"],
      ["WON · OF 3 CLOSED", "2"],
      ["WORST DIP", "−4.1%"],
      ["FEES + FUNDING · AUSD", "−0.90"],
      ["CHECKS · 4 ENTERED", "31"],
    ],
  );
});

test("Record with nothing yet: no series, no dip", () => {
  const view = recordView(
    record({ series: [], maxDrawdownAusd: 0, maxDrawdownPct: null, equityAusd: null, cashAusd: 0 }),
  );

  assert.equal(view.equityHead, "NOW 0.00");
  assert.equal(view.up, null);
  assert.equal(view.stats[2]!.value, "0");
  assert.equal(view.trailText, "No equity read yet.");
});

test("a closed row says how it closed and for how long it was held", () => {
  const row = closedRow(
    {
      id: "x",
      instrument: "ETH",
      side: "long",
      entryPrice: "3650",
      exitPrice: "3613.5",
      margin: "25",
      leverage: 3,
      openedAt: at(223),
      closedAt: at(171),
      closeReason: "stop",
      realizedPnl: "-3.2",
    },
    NOW,
  );

  assert.equal(row.title, "LONG ETH-PERP · 25 AUSD · 3×");
  assert.equal(row.sub, "STOP · HELD 52 MIN");
  assert.equal(row.pnl, "−3.20");
  assert.equal(row.tone, "down");
});

// ─── The rail and the stages ───────────────────────────────────────────────────────────────────

test("the rail counts open positions and proposals waiting; unread is zero", () => {
  assert.deepEqual(
    runtimeCounts({ network: "testnet", account: true, open: [open()], closed: [] }, [
      proposal(),
      proposal({ id: "b" }),
    ]),
    { positions: 1, decisions: 2 },
  );
  assert.deepEqual(runtimeCounts(null, "failed"), { positions: 0, decisions: 0 });
});

test("the existing stages keep the runtime off; the -active stages have it on, populated", () => {
  assert.equal(runtimeOn(liveStudioFixture("perpl-live").runtime.record), false);
  assert.equal(runtimeOn(liveStudioFixture("perpl-decisions").runtime.record), false);

  for (const stage of [
    "perpl-live-active",
    "perpl-decisions-active",
    "perpl-record-active",
  ] as const) {
    const staged = liveStudioFixture(stage);

    assert.equal(runtimeOn(staged.runtime.record), true, stage);
    assert.ok(staged.runtime.checks.length > 0, stage);
    assert.ok(staged.runtime.positions.open.length > 0, stage);
    assert.ok(staged.runtime.proposals.length > 0, stage);
    assert.ok(staged.runtime.details[staged.runtime.checks[0]!.id], stage);
    assert.deepEqual(staged.runtime.actions, [], stage);
  }
  assert.equal(liveStudioFixture("perpl-live-active").section, "overview");
  assert.equal(liveStudioFixture("perpl-decisions-active").section, "decisions");
  assert.equal(liveStudioFixture("perpl-record-active").section, "record");
  assert.deepEqual(liveStudioFixture("perpl-live").runtime.actions, []);
});

test("the staged proposal is still valid on the fixture's clock", () => {
  const staged = liveStudioFixture("perpl-live-active");

  assert.equal(countdown(staged.runtime.proposals[0]!.expiresAt, staged.now).expired, false);
});
