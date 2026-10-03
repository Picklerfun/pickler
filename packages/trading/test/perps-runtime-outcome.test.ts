import test from "node:test";
import assert from "node:assert/strict";
import {
  decideOutcome,
  exitsMet,
  feeReserveFor,
  type DecideOutcomeInput,
  type PerpsCheckDecision,
  type PerpsCheckResult,
} from "@pickler/trading/perps";

function decision(overrides: Partial<PerpsCheckDecision> = {}): PerpsCheckDecision {
  return {
    instrument: "BTC",
    action: "open-long",
    probability: 0.7,
    horizonHours: 24,
    entries: [
      { index: 1, met: true, why: "" },
      { index: 2, met: true, why: "" },
    ],
    exits: [],
    never: [
      { index: 1, broken: false },
      { index: 2, broken: false },
    ],
    rationale: "",
    sources: [],
    ...overrides,
  };
}

function input(overrides: Partial<DecideOutcomeInput> = {}): DecideOutcomeInput {
  return {
    decision: decision(),
    brief: { entries: 2, exits: 1, never: 2 },
    paused: false,
    markets: ["BTC", "ETH"],
    takerFee: 0.0002,
    position: null,
    openCount: 0,
    risk: { maxOpenPositions: 3, dayLossStopAusd: 20 },
    spend: { perCallAusd: 10, perDayAusd: 50 },
    maxLeverage: 3,
    entry: { mode: "auto", meanwhile: "wait", smallAusd: 4 },
    newMarginToday: 0,
    realizedToday: 0,
    freeEquity: 100,
    ...overrides,
  };
}

const long = { id: "pos-1", side: "long" as const, margin: 10 };
const short = { id: "pos-1", side: "short" as const, margin: 10 };

const cases: Array<[string, Partial<DecideOutcomeInput>, Partial<PerpsCheckResult>]> = [
  // R6 (1): never broken
  [
    "never broken holds",
    {
      decision: decision({
        never: [
          { index: 1, broken: false },
          { index: 2, broken: true },
        ],
      }),
    },
    { outcome: "held", code: "NEVER_BROKEN", text: "NEVER 2" },
  ],
  [
    "several never lines broken are all named",
    {
      decision: decision({
        never: [
          { index: 1, broken: true },
          { index: 2, broken: true },
        ],
      }),
    },
    { outcome: "held", code: "NEVER_BROKEN", text: "NEVER 1, 2" },
  ],
  [
    "never comes before entries",
    {
      decision: decision({
        never: [{ index: 1, broken: true }],
        entries: [{ index: 1, met: false, why: "" }],
      }),
    },
    { outcome: "held", code: "NEVER_BROKEN", text: "NEVER 1" },
  ],
  // R6 (2): entries
  [
    "an unmet entry holds",
    {
      decision: decision({
        entries: [
          { index: 1, met: true, why: "" },
          { index: 2, met: false, why: "" },
        ],
      }),
    },
    { outcome: "held", code: "ENTRY_HELD", text: "ENTRY 2 HELD" },
  ],
  [
    "an entry line the model skipped counts as held",
    { decision: decision({ entries: [{ index: 1, met: true, why: "" }] }) },
    { outcome: "held", code: "ENTRY_HELD", text: "ENTRY 2 HELD" },
  ],
  [
    "entries come before conviction",
    { decision: decision({ probability: 0.5, entries: [{ index: 1, met: false, why: "" }] }) },
    { outcome: "held", code: "ENTRY_HELD", text: "ENTRY 1, 2 HELD" },
  ],
  // R6 (3): conviction
  [
    "probability under 0.55 holds",
    { decision: decision({ probability: 0.54 }) },
    { outcome: "held", code: "LOW_CONVICTION", text: "LOW CONVICTION" },
  ],
  [
    "conviction comes before caps",
    { decision: decision({ probability: 0.5 }), openCount: 3 },
    { outcome: "held", code: "LOW_CONVICTION" },
  ],
  // R6 (4): caps
  [
    "open positions at the cap block",
    { openCount: 3 },
    { outcome: "blocked", code: "CAP_OPEN", text: "BLOCKED BY CAP · 3 OPEN" },
  ],
  [
    "the day's spend blocks when this margin would cross it",
    { newMarginToday: 41 },
    { outcome: "blocked", code: "CAP_DAY", text: "BLOCKED BY CAP · PER DAY" },
  ],
  [
    "the day's spend exactly reached is allowed",
    { newMarginToday: 40 },
    { outcome: "entered", margin: 10 },
  ],
  [
    "the day-loss stop blocks",
    { realizedToday: -20 },
    { outcome: "blocked", code: "DAY_LOSS", text: "DAY-LOSS STOP" },
  ],
  ["a loss short of the stop does not block", { realizedToday: -19.99 }, { outcome: "entered" }],
  [
    "caps come before free equity",
    { openCount: 3, freeEquity: 0 },
    { outcome: "blocked", code: "CAP_OPEN" },
  ],
  // R6 (5): free equity
  [
    "too little free equity blocks",
    { freeEquity: 9.99 },
    { outcome: "blocked", code: "NO_FREE_AUSD", text: "NO FREE AUSD" },
  ],
  [
    "free equity must cover the margin plus the fee reserve",
    { freeEquity: 10 },
    { outcome: "blocked", code: "NO_FREE_AUSD" },
  ],
  ["margin plus the fee reserve free enters", { freeEquity: 10.009 }, { outcome: "entered" }],
  [
    "with no taker fee the margin alone is enough",
    { freeEquity: 10, takerFee: 0 },
    { outcome: "entered" },
  ],
  // Its markets
  [
    "an open outside the agent's markets holds",
    { markets: ["ETH"] },
    { outcome: "held", code: "NOT_ITS_MARKET", text: "NOT ITS MARKET" },
  ],
  [
    "a close outside the agent's markets still closes the held position",
    { markets: ["ETH"], position: long, decision: decision({ action: "close" }) },
    { outcome: "exited", code: "CLOSE_CALLED", close: { positionId: "pos-1", reason: "brief" } },
  ],
  // Lines past the brief's counts
  [
    "a never index past the brief is ignored",
    { decision: decision({ never: [{ index: 3, broken: true }] }) },
    { outcome: "entered" },
  ],
  [
    "an entry line with no answer is not met",
    { decision: decision({ entries: [{ index: 1, met: true, why: "" }] }) },
    { outcome: "held", code: "ENTRY_HELD", text: "ENTRY 2 HELD" },
  ],
  [
    "entry indexes past the brief do not stand in for missing ones",
    {
      decision: decision({
        entries: [
          { index: 1, met: true, why: "" },
          { index: 3, met: true, why: "" },
        ],
      }),
    },
    { outcome: "held", code: "ENTRY_HELD", text: "ENTRY 2 HELD" },
  ],
  [
    "a probability under 0.5 holds as low conviction",
    { decision: decision({ probability: 0.3 }) },
    { outcome: "held", code: "LOW_CONVICTION" },
  ],
  [
    "an exit line for another instrument does not close this one",
    {
      position: long,
      openCount: 1,
      decision: decision({
        action: "hold",
        exits: [{ index: 1, met: true, why: "", instrument: "ETH" }],
      }),
    },
    { outcome: "held", code: "HOLD" },
  ],
  // R6 (6): entry modes
  [
    "auto enters at full size above 0.65",
    {},
    {
      outcome: "entered",
      code: "ENTERED",
      text: "ENTERED LONG BTC",
      side: "long",
      margin: 10,
      leverage: 3,
      notional: 30,
    },
  ],
  [
    "auto enters at half size between 0.55 and 0.65",
    { decision: decision({ probability: 0.6, action: "open-short" }) },
    { outcome: "entered", side: "short", margin: 5, notional: 15, text: "ENTERED SHORT BTC" },
  ],
  [
    "approve + wait proposes the entry",
    { entry: { mode: "approve", meanwhile: "wait", smallAusd: 4 } },
    {
      outcome: "proposed",
      code: "PROPOSED",
      text: "PROPOSED LONG BTC",
      margin: undefined,
      proposals: [
        { kind: "enter", instrument: "BTC", side: "long", margin: 10, leverage: 3, notional: 30 },
      ],
    },
  ],
  [
    "approve + small enters small and proposes the size-up",
    { entry: { mode: "approve", meanwhile: "small", smallAusd: 4 } },
    {
      outcome: "entered",
      code: "ENTERED_SMALL",
      text: "ENTERED LONG BTC SMALL · SIZE-UP PROPOSED",
      margin: 4,
      leverage: 3,
      notional: 12,
      proposals: [
        { kind: "size_up", instrument: "BTC", side: "long", margin: 6, leverage: 3, notional: 18 },
      ],
    },
  ],
  [
    "approve + small with a small amount at or over the margin just enters",
    {
      decision: decision({ probability: 0.6 }),
      entry: { mode: "approve", meanwhile: "small", smallAusd: 8 },
    },
    { outcome: "entered", code: "ENTERED", margin: 5, proposals: undefined },
  ],
  // Paused
  [
    "paused holds an open call",
    { paused: true },
    { outcome: "held", code: "PAUSED", text: "PAUSED" },
  ],
  [
    "paused still lets a close through",
    { paused: true, position: long, openCount: 1, decision: decision({ action: "close" }) },
    { outcome: "exited", code: "CLOSE_CALLED", close: { positionId: "pos-1", reason: "brief" } },
  ],
  // close / hold / positions
  [
    "close on an open position exits",
    {
      position: short,
      openCount: 1,
      decision: decision({ action: "close", probability: undefined }),
    },
    { outcome: "exited", code: "CLOSE_CALLED", text: "CLOSED SHORT BTC" },
  ],
  [
    "close with nothing open holds",
    { decision: decision({ action: "close", probability: undefined }) },
    { outcome: "held", code: "NOTHING_TO_CLOSE", text: "NOTHING TO CLOSE" },
  ],
  [
    "hold holds",
    { decision: decision({ action: "hold", probability: undefined }) },
    { outcome: "held", code: "HOLD", text: "HOLD" },
  ],
  [
    "an exit line met on the open position exits, whatever the action",
    {
      position: long,
      openCount: 1,
      decision: decision({ action: "hold", exits: [{ index: 1, met: true, why: "" }] }),
    },
    {
      outcome: "exited",
      code: "EXIT_MET",
      text: "EXIT 1 MET",
      close: { positionId: "pos-1", reason: "brief" },
    },
  ],
  [
    "exit lines without a position are ignored",
    { decision: decision({ exits: [{ index: 1, met: true, why: "" }] }) },
    { outcome: "entered" },
  ],
  [
    "a same-side open on a held instrument holds",
    { position: long, openCount: 1 },
    { outcome: "held", code: "ALREADY_OPEN", text: "ALREADY LONG BTC" },
  ],
  [
    "an opposite open closes first, then enters with the freed slot and margin",
    {
      position: short,
      openCount: 3,
      freeEquity: 5,
    },
    {
      outcome: "entered",
      side: "long",
      margin: 10,
      close: { positionId: "pos-1", reason: "brief" },
    },
  ],
  [
    "an opposite open that fails the brief does not close",
    { position: short, openCount: 1, decision: decision({ probability: 0.52 }) },
    { outcome: "held", code: "LOW_CONVICTION", close: undefined },
  ],
  [
    "an opposite open still closes when caps then block",
    { position: short, openCount: 1, realizedToday: -50 },
    { outcome: "blocked", code: "DAY_LOSS", close: { positionId: "pos-1", reason: "brief" } },
  ],
];

for (const [name, overrides, expected] of cases) {
  test(`decideOutcome: ${name}`, () => {
    const result = decideOutcome(input(overrides));

    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(result[key as keyof PerpsCheckResult], value, `${name}: ${key}`);
    }
  });
}

test("decideOutcome: leverage falls back to 1 and is clamped to the core bounds", () => {
  assert.equal(decideOutcome(input({ maxLeverage: 0 })).leverage, 1);
  assert.equal(decideOutcome(input({ maxLeverage: 40 })).leverage, 10);
});

test("exitsMet reads exit lines per held instrument and ignores indexes past the brief", () => {
  const d = decision({
    exits: [
      { index: 2, met: true, why: "" },
      { index: 1, met: true, why: "" },
      { index: 1, met: true, why: "", instrument: "ETH" },
      { index: 2, met: false, why: "", instrument: "ETH" },
      { index: 4, met: true, why: "", instrument: "ETH" },
    ],
  });

  assert.deepEqual(exitsMet(d, 2, "BTC"), [1, 2]);
  assert.deepEqual(exitsMet(d, 2, "ETH"), [1]);
  assert.deepEqual(exitsMet(d, 1, "BTC"), [1]);
});

test("feeReserveFor is notional × taker fee × 1.5, rounded up to micro-AUSD", () => {
  assert.equal(feeReserveFor(1000, 0.0002), 0.3);
  assert.equal(feeReserveFor(10_000, 0.0002), 3);
  assert.equal(feeReserveFor(33.333333, 0.0002), 0.01);
  assert.equal(feeReserveFor(3.333331, 0.0002), 0.001);
  assert.equal(feeReserveFor(100, 0), 0);
});
