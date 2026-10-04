import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_HORIZONS,
  CHECK_RATIONALE_LIMIT,
  STOP_LOSS_BPS,
  TAKE_PROFIT_BPS,
  parseCheckDecision,
  entryTrace,
  type PerpsCheckDecision,
} from "@pickler/trading/perps";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instrument: "BTC",
    action: "open-long",
    probability: 0.7,
    horizonHours: 24,
    stopLossBps: 300,
    takeProfitBps: 600,
    entries: [{ index: 1, met: true, why: "Funding is negative" }],
    exits: [],
    never: [{ index: 1, broken: false }],
    rationale: "Shorts are paying.",
    sources: ["perpl-ticker"],
    ...overrides,
  };
}

function ok(input: unknown): PerpsCheckDecision {
  const result = parseCheckDecision(input);

  assert.equal(result.ok, true, JSON.stringify(input));
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.decision;
}

function invalid(input: unknown) {
  const result = parseCheckDecision(input);

  assert.deepEqual(result, { ok: false, code: "MODEL_INVALID" }, JSON.stringify(input));
}

test("constants follow the spec", () => {
  assert.deepEqual([...CHECK_HORIZONS], [4, 24, 72]);
  assert.deepEqual(STOP_LOSS_BPS, { min: 100, max: 1500, default: 300 });
  assert.deepEqual(TAKE_PROFIT_BPS, { min: 100, max: 5000, default: 600 });
  assert.equal(CHECK_RATIONALE_LIMIT, 600);
});

test("a well-formed decision parses, from an object or a JSON string", () => {
  const decision = ok(raw());

  assert.deepEqual(decision, {
    instrument: "BTC",
    action: "open-long",
    probability: 0.7,
    horizonHours: 24,
    stopLossBps: 300,
    takeProfitBps: 600,
    entries: [{ index: 1, met: true, why: "Funding is negative" }],
    exits: [],
    never: [{ index: 1, broken: false }],
    rationale: "Shorts are paying.",
    sources: ["perpl-ticker"],
  });
  assert.deepEqual(ok(JSON.stringify(raw())), decision);
});

test("unknown keys are dropped, optional bps may be absent", () => {
  const decision = ok(
    raw({ size: 1000, leverage: 50, stopLossBps: undefined, takeProfitBps: undefined }),
  );

  assert.equal("size" in decision, false);
  assert.equal("leverage" in decision, false);
  assert.equal(decision.stopLossBps, undefined);
  assert.equal(decision.takeProfitBps, undefined);
});

const clamps: Array<[string, Record<string, unknown>, Partial<PerpsCheckDecision>]> = [
  ["stop below 100", { stopLossBps: 10 }, { stopLossBps: 100 }],
  ["stop above 1500", { stopLossBps: 9000 }, { stopLossBps: 1500 }],
  ["target below 100", { takeProfitBps: 0 }, { takeProfitBps: 100 }],
  ["target above 5000", { takeProfitBps: 12000 }, { takeProfitBps: 5000 }],
  ["horizon 1 snaps to 4", { horizonHours: 1 }, { horizonHours: 4 }],
  ["horizon 12 snaps to 4", { horizonHours: 12 }, { horizonHours: 4 }],
  ["horizon 30 snaps to 24", { horizonHours: 30 }, { horizonHours: 24 }],
  ["horizon 500 snaps to 72", { horizonHours: 500 }, { horizonHours: 72 }],
  ["fractional bps round", { stopLossBps: 250.6 }, { stopLossBps: 251 }],
];
for (const [name, input, expected] of clamps) {
  test(`clamps ${name}`, () => {
    const decision = ok(raw(input));

    for (const [key, value] of Object.entries(expected)) {
      assert.equal(decision[key as keyof PerpsCheckDecision], value);
    }
  });
}

test("a long rationale and long reasons are cut, not refused", () => {
  const decision = ok(
    raw({
      rationale: "x".repeat(900),
      entries: [{ index: 1, met: true, why: "y".repeat(900) }],
    }),
  );

  assert.equal(decision.rationale.length, CHECK_RATIONALE_LIMIT);
  assert.ok(decision.entries[0]!.why.length <= 300);
});

test("hold drops the probability; close may omit it", () => {
  assert.equal(ok(raw({ action: "hold", probability: 0.9 })).probability, undefined);
  assert.equal(ok(raw({ action: "hold", probability: undefined })).probability, undefined);
  assert.equal(ok(raw({ action: "close", probability: undefined })).probability, undefined);
  assert.equal(ok(raw({ action: "close", probability: 0.8 })).probability, 0.8);
});

test("a probability inside [0, 1] is kept as given, not clamped up to 0.5", () => {
  assert.equal(ok(raw({ probability: 0.2 })).probability, 0.2);
  assert.equal(ok(raw({ probability: 0 })).probability, 0);
  assert.equal(ok(raw({ probability: 1 })).probability, 1);
});

test("null optional fields mean absent; missing exits and never mean none", () => {
  const decision = ok(
    raw({ stopLossBps: null, takeProfitBps: null, exits: undefined, never: undefined }),
  );

  assert.equal(decision.stopLossBps, undefined);
  assert.equal(decision.takeProfitBps, undefined);
  assert.deepEqual(decision.exits, []);
  assert.deepEqual(decision.never, []);
  assert.deepEqual(ok(raw({ exits: null, never: null })).exits, []);
  assert.equal(ok(raw({ action: "close", probability: null })).probability, undefined);
  assert.equal(ok(raw({ action: "hold", probability: null })).probability, undefined);
});

test("a hold may omit its horizon (24); an open may not", () => {
  assert.equal(ok(raw({ action: "hold", horizonHours: undefined })).horizonHours, 24);
  assert.equal(ok(raw({ action: "hold", horizonHours: null })).horizonHours, 24);
  invalid(raw({ horizonHours: null }));
});

test("exit lines may name the held instrument they were judged for", () => {
  const decision = ok(
    raw({
      exits: [
        { index: 1, met: true, why: "", instrument: "ETH" },
        { index: 1, met: false, why: "", instrument: "BTC" },
        { index: 2, met: false, why: "", instrument: null },
      ],
    }),
  );

  assert.deepEqual(decision.exits, [
    { index: 1, met: true, why: "", instrument: "ETH" },
    { index: 1, met: false, why: "" },
    { index: 2, met: false, why: "" },
  ]);
});

test("exits are kept with their reasons", () => {
  const decision = ok(raw({ exits: [{ index: 2, met: true, why: "Funding flipped" }] }));

  assert.deepEqual(decision.exits, [{ index: 2, met: true, why: "Funding flipped" }]);
});

const malformed: Array<[string, unknown]> = [
  ["not JSON", "{ nope"],
  ["null", null],
  ["an array", []],
  ["a number", 3],
  ["unknown instrument", raw({ instrument: "SOL" })],
  ["unknown action", raw({ action: "buy" })],
  ["open without probability", raw({ probability: undefined })],
  ["probability not a number", raw({ probability: "0.7" })],
  ["probability NaN", raw({ probability: Number.NaN })],
  ["probability in percent", raw({ probability: 70 })],
  ["probability 55 (percent)", raw({ probability: 55 })],
  ["probability above 1", raw({ probability: 1.4 })],
  ["probability below 0", raw({ probability: -0.1 })],
  ["open with null probability", raw({ probability: null })],
  [
    "a repeated entry index",
    raw({
      entries: [
        { index: 1, met: false, why: "" },
        { index: 1, met: true, why: "" },
      ],
    }),
  ],
  [
    "a repeated never index",
    raw({
      never: [
        { index: 1, broken: true },
        { index: 1, broken: false },
      ],
    }),
  ],
  [
    "a repeated exit index for one instrument",
    raw({
      exits: [
        { index: 1, met: false, why: "" },
        { index: 1, met: true, why: "", instrument: "BTC" },
      ],
    }),
  ],
  [
    "an exit line for an unknown instrument",
    raw({ exits: [{ index: 1, met: true, why: "", instrument: "SOL" }] }),
  ],
  ["stop infinite", raw({ stopLossBps: Number.POSITIVE_INFINITY })],
  ["horizon missing", raw({ horizonHours: undefined })],
  ["horizon a string", raw({ horizonHours: "24" })],
  ["entries missing", raw({ entries: undefined })],
  ["entries not an array", raw({ entries: {} })],
  ["entry index zero", raw({ entries: [{ index: 0, met: true, why: "" }] })],
  ["entry index fractional", raw({ entries: [{ index: 1.5, met: true, why: "" }] })],
  ["entry met not boolean", raw({ entries: [{ index: 1, met: "yes", why: "" }] })],
  ["entry why not a string", raw({ entries: [{ index: 1, met: true, why: 1 }] })],
  [
    "too many entries",
    raw({ entries: Array.from({ length: 9 }, (_, i) => ({ index: i + 1, met: true, why: "" })) }),
  ],
  ["exits not an array", raw({ exits: {} })],
  ["never broken missing", raw({ never: [{ index: 1 }] })],
  ["rationale missing", raw({ rationale: undefined })],
  ["sources not strings", raw({ sources: [1] })],
  ["too many sources", raw({ sources: Array.from({ length: 33 }, (_, i) => `s${i}`) })],
];
for (const [name, input] of malformed) {
  test(`refuses ${name} as MODEL_INVALID`, () => {
    invalid(input);
  });
}

test("entryTrace names which entry lines were met and which held", () => {
  const decision = ok(
    raw({
      entries: [
        { index: 1, met: true, why: "" },
        { index: 2, met: true, why: "" },
        { index: 3, met: false, why: "" },
      ],
    }),
  );

  assert.equal(entryTrace(decision, 3), "Entry 1 and 2 met · 3 held");
  assert.equal(entryTrace(decision, 4), "Entry 1 and 2 met · 3 and 4 held");
  assert.equal(entryTrace(ok(raw()), 1), "Entry 1 met");
  assert.equal(
    entryTrace(ok(raw({ entries: [{ index: 1, met: false, why: "" }] })), 1),
    "Entry 1 held",
  );
  assert.equal(entryTrace(ok(raw({ entries: [] })), 0), "No entry lines");
  assert.equal(
    entryTrace(
      ok(
        raw({
          entries: [1, 2, 3].map((index) => ({ index, met: true, why: "" })),
        }),
      ),
      3,
    ),
    "Entry 1, 2 and 3 met",
  );
});
