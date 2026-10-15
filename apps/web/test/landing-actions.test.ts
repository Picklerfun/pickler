import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentActionDto } from "@pickler/api-schema";
import { tapeEntry } from "../src/features/landing/lib/actions";

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

describe("the tape", () => {
  it("names the agent by ticker, or by handle without one, and tones the outcome", () => {
    assert.deepEqual(tapeEntry(action({ outcomeText: "ENTERED · 40 AUSD ON PAPER" })), {
      who: "$UNLK",
      call: "SHORT BTC-PERP · 4H",
      outcome: "ENTERED · 40 AUSD ON PAPER",
      tone: "win",
    });
    const held = tapeEntry(
      action({
        agent: {
          name: "Tape Reader",
          handle: "tapereader",
          ticker: null,
          slug: null,
          accent: "cyan",
        },
        call: "hold",
        outcome: "held",
        probability: null,
      }),
    );
    assert.equal(held.who, "@tapereader");
    assert.equal(held.call, "HOLD BTC-PERP · 4H");
    assert.equal(held.outcome, "HELD");
    assert.equal(held.tone, "caution");
    assert.equal(tapeEntry(action({ outcome: "blocked" })).tone, "loss");
  });
});
