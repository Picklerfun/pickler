import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceCurve,
  advanceRecord,
  CURVE_GOAL,
  CURVE_SEED,
  curveView,
  DROPS,
  LOCK_GRID,
  RECORD_CAPACITY,
  RECORD_SEED,
  stepLabel,
  STEPS,
  WAYS,
} from "../src/features/landing/lib/demo";

describe("the four steps", () => {
  it("label the phone panel with the step's number and screen", () => {
    assert.equal(stepLabel(0), "STEP 01 · SIGN IN");
    assert.equal(stepLabel(3), "STEP 04 · MARKET");
    assert.equal(STEPS.length, 4);
  });
});

describe("the three ways in", () => {
  it("link only to a page that exists; the launchpad says soon", () => {
    assert.deepEqual(
      WAYS.map((way) => way.href),
      ["/agents", null, "/markets"],
    );
  });
});

describe("the candle game", () => {
  it("lands one call per tick from the seed", () => {
    const next = advanceRecord(RECORD_SEED);
    assert.equal(next.stack.length, 3);
    assert.equal(next.stack[2], DROPS[2]);
    assert.equal(next.cursor, 3);
    assert.equal(next.clearing, false);
  });

  it("settles and clears a full board, then starts landing again", () => {
    let state = RECORD_SEED;
    while (state.stack.length < RECORD_CAPACITY) {
      state = advanceRecord(state);
    }
    const cleared = advanceRecord(state);
    assert.deepEqual(cleared.stack, []);
    assert.equal(cleared.clearing, true);
    const again = advanceRecord(cleared);
    assert.equal(again.stack.length, 1);
    assert.equal(again.clearing, false);
  });

  it("wraps around the eight calls", () => {
    let state = RECORD_SEED;
    for (let i = 0; i < 20; i++) {
      state = advanceRecord(state);
    }
    for (const drop of state.stack) {
      assert.ok(DROPS.includes(drop));
    }
  });
});

describe("the token curve", () => {
  it("fills by a buy each tick and never passes the goal", () => {
    const low = advanceCurve(CURVE_SEED, () => 0);
    assert.equal(low.backed, CURVE_SEED.backed + 260);
    assert.equal(low.graduated, false);
    let state = CURVE_SEED;
    for (let i = 0; i < 40 && !state.graduated; i++) {
      state = advanceCurve(state, () => 0.999);
    }
    assert.equal(state.backed, CURVE_GOAL);
    assert.equal(state.graduated, true);
  });

  it("holds in the pool for three ticks, then a fresh curve starts", () => {
    let state = { backed: CURVE_GOAL, graduated: true, hold: 0 };
    for (let i = 0; i < 3; i++) {
      state = advanceCurve(state, () => 0);
      assert.equal(state.graduated, true);
    }
    assert.deepEqual(
      advanceCurve(state, () => 0),
      CURVE_SEED,
    );
  });

  it("is described in money and in bars", () => {
    const pre = curveView({ backed: 1250, graduated: false, hold: 0 });
    assert.equal(pre.backed, "$1,250");
    assert.equal(pre.badge, "PRE-GRAD");
    assert.equal(pre.goal, "$3,750 TO GO");
    assert.equal(pre.bars.length, 12);
    assert.equal(pre.bars.filter((bar) => bar.lit).length, 3);
    const grad = curveView({ backed: CURVE_GOAL, graduated: true, hold: 1 });
    assert.equal(grad.badge, "GRADUATED");
    assert.equal(grad.goal, "POOL OPEN");
    assert.equal(
      grad.bars.every((bar) => bar.lit),
      true,
    );
  });
});

describe("the padlock", () => {
  it("is nine by nine with a lime shackle", () => {
    assert.equal(LOCK_GRID.length, 81);
    assert.equal(LOCK_GRID.filter((cell) => cell === "lime").length, 7);
  });
});
