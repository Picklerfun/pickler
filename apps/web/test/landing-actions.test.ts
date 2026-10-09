import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentActionDto } from "@pickler/api-schema";
import {
  ago,
  callSentence,
  exchangeAt,
  OUTCOME_HUE,
  OUTCOME_LABEL,
  outcomeSentence,
} from "../src/features/landing/lib/actions";

const action = (over: Partial<AgentActionDto> = {}): AgentActionDto => ({
  id: "a1",
  at: "2026-10-08T12:00:00.000Z",
  agent: {
    name: "Unlock Watch",
    handle: "unlockwatch",
    ticker: "$UNLK",
    slug: null,
    accent: "violet",
  },
  outcome: "entered",
  outcomeText: null,
  instrument: "BTC",
  call: "open-short",
  probability: 0.62,
  horizonHours: 4,
  ...over,
});

describe("an agent's call, in words", () => {
  it("names the side, the market, the odds and the window", () => {
    assert.equal(callSentence(action()), "Short BTC-PERP, 0.62 that it gets there within 4H.");
    assert.equal(
      callSentence(
        action({ call: "open-long", instrument: "ETH", probability: 0.58, horizonHours: 24 }),
      ),
      "Long ETH-PERP, 0.58 that it gets there within 24H.",
    );
    assert.equal(
      callSentence(action({ call: "close", probability: null, horizonHours: null })),
      "Close BTC-PERP.",
    );
    assert.equal(callSentence(action({ call: "hold", probability: null })), "Hold on BTC-PERP.");
    assert.equal(
      callSentence(action({ call: null, instrument: null, probability: null, horizonHours: null })),
      "Looked at the market.",
    );
  });
});

describe("what came of it", () => {
  it("uses the runtime's words when it left any, and plain ones otherwise", () => {
    assert.equal(
      outcomeSentence(action({ outcomeText: "ENTRY 2 HELD", outcome: "held" })),
      "ENTRY 2 HELD",
    );
    assert.equal(
      outcomeSentence(action({ outcome: "entered" })),
      "The position is open, on paper.",
    );
    assert.equal(
      outcomeSentence(action({ outcome: "proposed" })),
      "Proposed to its owner, who decides.",
    );
  });

  it("has a label and a hue for every outcome", () => {
    for (const outcome of ["entered", "exited", "held", "blocked", "proposed"] as const) {
      assert.ok(OUTCOME_LABEL[outcome]);
      assert.ok(OUTCOME_HUE[outcome]);
    }
  });
});

describe("how long ago", () => {
  it("rounds to the unit a glance wants", () => {
    const at = "2026-10-08T12:00:00.000Z";
    const t = (ms: number) => Date.parse(at) + ms;
    assert.equal(ago(at, t(20_000)), "JUST NOW");
    assert.equal(ago(at, t(4 * 60_000)), "4 MIN AGO");
    assert.equal(ago(at, t(3 * 3_600_000)), "3 H AGO");
    assert.equal(ago(at, t(3 * 86_400_000)), "3 D AGO");
  });
});

describe("the exchange on screen", () => {
  it("shows the call, then the outcome, then holds, three ticks per action", () => {
    const actions = [action({ id: "a1" }), action({ id: "a2" })];
    assert.deepEqual(
      [0, 1, 2].map((tick) => exchangeAt(actions, tick)?.answerOn),
      [false, true, true],
    );
    assert.equal(exchangeAt(actions, 0)?.action.id, "a1");
    assert.equal(exchangeAt(actions, 3)?.action.id, "a2");
    assert.equal(exchangeAt(actions, 6)?.action.id, "a1");
    assert.equal(exchangeAt(actions, 6)?.index, 2);
  });

  it("is nothing with nothing on record", () => {
    assert.equal(exchangeAt([], 5), null);
  });
});
