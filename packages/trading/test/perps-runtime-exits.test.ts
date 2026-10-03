import test from "node:test";
import assert from "node:assert/strict";
import {
  PROPOSAL_TTL_MS,
  dayLossReached,
  exitDue,
  exitLevels,
  liquidationPrice,
  maxStopLossBps,
  proposalExpired,
  proposalExpiresAt,
  utcDayStart,
} from "@pickler/trading/perps";

const openedAt = Date.UTC(2026, 9, 3, 10, 0, 0);
const hour = 3_600_000;

const levels: Array<[string, Parameters<typeof exitLevels>[0], ReturnType<typeof exitLevels>]> = [
  [
    "long with explicit bps",
    {
      side: "long",
      entryPrice: "100000",
      stopLossBps: 200,
      takeProfitBps: 500,
      horizonHours: 4,
      openedAt,
    },
    { stopPrice: "98000", takeProfitPrice: "105000", exitDueAt: openedAt + 4 * hour },
  ],
  [
    "short with explicit bps",
    {
      side: "short",
      entryPrice: "100000",
      stopLossBps: 200,
      takeProfitBps: 500,
      horizonHours: 72,
      openedAt,
    },
    { stopPrice: "102000", takeProfitPrice: "95000", exitDueAt: openedAt + 72 * hour },
  ],
  [
    "long defaults to 300 / 600",
    { side: "long", entryPrice: "2500.5", horizonHours: 24, openedAt },
    { stopPrice: "2425.485", takeProfitPrice: "2650.53", exitDueAt: openedAt + 24 * hour },
  ],
  [
    "short defaults to 300 / 600",
    { side: "short", entryPrice: "2500", horizonHours: 24, openedAt },
    { stopPrice: "2575", takeProfitPrice: "2350", exitDueAt: openedAt + 24 * hour },
  ],
  [
    "out-of-range bps are clamped",
    {
      side: "long",
      entryPrice: "100",
      stopLossBps: 5,
      takeProfitBps: 99999,
      horizonHours: 4,
      openedAt,
    },
    { stopPrice: "99", takeProfitPrice: "150", exitDueAt: openedAt + 4 * hour },
  ],
  [
    "a huge stop is clamped to 1500 bps",
    { side: "short", entryPrice: "100", stopLossBps: 4000, horizonHours: 4, openedAt },
    { stopPrice: "115", takeProfitPrice: "94", exitDueAt: openedAt + 4 * hour },
  ],
  [
    "at 10x the stop is clamped to 900 bps (90% of margin)",
    {
      side: "long",
      entryPrice: "100",
      stopLossBps: 1500,
      horizonHours: 4,
      openedAt,
      leverage: 10,
    },
    { stopPrice: "91", takeProfitPrice: "106", exitDueAt: openedAt + 4 * hour },
  ],
  [
    "at 7x a short's stop is clamped to 1285 bps",
    { side: "short", entryPrice: "100", stopLossBps: 1500, horizonHours: 4, openedAt, leverage: 7 },
    { stopPrice: "112.85", takeProfitPrice: "94", exitDueAt: openedAt + 4 * hour },
  ],
  [
    "a stop inside the leverage clamp is kept",
    { side: "long", entryPrice: "100", stopLossBps: 300, horizonHours: 4, openedAt, leverage: 10 },
    { stopPrice: "97", takeProfitPrice: "106", exitDueAt: openedAt + 4 * hour },
  ],
];
for (const [name, args, expected] of levels) {
  test(`exitLevels: ${name}`, () => {
    assert.deepEqual(exitLevels(args), expected);
  });
}

test("exitLevels refuses a bad price", () => {
  assert.throws(() => exitLevels({ side: "long", entryPrice: "abc", horizonHours: 4, openedAt }));
  assert.throws(() => exitLevels({ side: "long", entryPrice: "0", horizonHours: 4, openedAt }));
});

const longPosition = {
  side: "long" as const,
  stopPrice: "98000",
  takeProfitPrice: "105000",
  exitDueAt: openedAt + 4 * hour,
};
const shortPosition = {
  side: "short" as const,
  stopPrice: "102000",
  takeProfitPrice: "95000",
  exitDueAt: openedAt + 4 * hour,
};
const early = openedAt + hour;
const late = openedAt + 4 * hour;

const dues: Array<[string, Parameters<typeof exitDue>[0], string | null, number, string | null]> = [
  ["long inside the band", longPosition, "100000", early, null],
  ["long at the stop", longPosition, "98000", early, "stop"],
  ["long through the stop", longPosition, "97000.5", early, "stop"],
  ["long at the target", longPosition, "105000", early, "take_profit"],
  ["long through the target", longPosition, "110000", early, "take_profit"],
  ["long at the time stop", longPosition, "100000", late, "time"],
  ["long stop wins over time", longPosition, "90000", late, "stop"],
  ["long without a mark, early", longPosition, null, early, null],
  ["long without a mark, late", longPosition, null, late, "time"],
  ["short inside the band", shortPosition, "100000", early, null],
  ["short at the stop", shortPosition, "102000", early, "stop"],
  ["short at the target", shortPosition, "95000", early, "take_profit"],
  ["short through the target", shortPosition, "90000", early, "take_profit"],
  ["short at the time stop", shortPosition, "99000", late + 1, "time"],
];
for (const [name, position, mark, now, expected] of dues) {
  test(`exitDue: ${name}`, () => {
    assert.equal(exitDue(position, mark, now), expected);
  });
}

test("exitDue with missing levels only uses what is there", () => {
  const bare = { side: "long" as const, stopPrice: null, takeProfitPrice: null, exitDueAt: null };

  assert.equal(exitDue(bare, "1", late), null);
  assert.equal(exitDue({ ...bare, stopPrice: "2" }, "1", early), "stop");
});

test("maxStopLossBps keeps a stop's loss within 90% of margin", () => {
  assert.equal(maxStopLossBps(1), 9000);
  assert.equal(maxStopLossBps(3), 3000);
  assert.equal(maxStopLossBps(10), 900);
  assert.equal(maxStopLossBps(undefined), 9000);
});

test("liquidationPrice is where the loss equals the margin", () => {
  assert.equal(liquidationPrice("long", "100000", 10), "90000");
  assert.equal(liquidationPrice("short", "100000", 10), "110000");
  assert.equal(liquidationPrice("long", "100", 1), "0");
  assert.throws(() => liquidationPrice("long", "100", 0));
});

test("exitDue: a mark beyond the liquidation estimate is an immediate stop", () => {
  const wide = {
    side: "long" as const,
    stopPrice: "80000",
    takeProfitPrice: null,
    exitDueAt: null,
    entryPrice: "100000",
    leverage: 10,
  };

  assert.equal(exitDue(wide, "90001", early), null);
  assert.equal(exitDue(wide, "90000", early), "stop");
  assert.equal(exitDue({ ...wide, stopPrice: null }, "85000", early), "stop");
  assert.equal(exitDue({ ...wide, side: "short", stopPrice: null }, "110000", early), "stop");
  assert.equal(exitDue({ ...wide, side: "short", stopPrice: null }, "109999", early), null);
  assert.equal(exitDue({ ...wide, leverage: null }, "85000", early), null);
});

const dayLoss: Array<[number, number, boolean]> = [
  [0, 10, false],
  [5, 10, false],
  [-9.99, 10, false],
  [-10, 10, true],
  [-10.01, 10, true],
  [-200, 200, true],
];
for (const [realized, stop, expected] of dayLoss) {
  test(`dayLossReached(${realized}, stop ${stop}) = ${expected}`, () => {
    assert.equal(
      dayLossReached(realized, { maxOpenPositions: 1, dayLossStopAusd: stop }),
      expected,
    );
  });
}

test("utcDayStart is the UTC midnight before", () => {
  assert.equal(utcDayStart(Date.UTC(2026, 9, 3, 23, 59)), Date.UTC(2026, 9, 3));
  assert.equal(utcDayStart(Date.UTC(2026, 9, 3)), Date.UTC(2026, 9, 3));
});

test("proposals expire after 15 minutes", () => {
  const created = openedAt;

  assert.equal(PROPOSAL_TTL_MS, 15 * 60_000);
  assert.equal(proposalExpiresAt(created), created + 15 * 60_000);
  assert.equal(
    proposalExpired({ expiresAt: proposalExpiresAt(created) }, created + 14 * 60_000),
    false,
  );
  assert.equal(
    proposalExpired({ expiresAt: proposalExpiresAt(created) }, created + 15 * 60_000),
    true,
  );
});
