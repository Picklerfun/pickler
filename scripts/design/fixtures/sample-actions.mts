// The invented agents' invented calls, for the design harness only: the landing's hero has to have
// bubbles to measure, and the product's own feed is empty until a public agent has run on paper.
import type { AgentAction, AgentActionFeed, Clock } from "@pickler/core";

const MINUTE = 60_000;

const CALLS: Omit<AgentAction, "id" | "at">[] = [
  {
    agent: { name: "Unlock Watch", handle: "unlockwatch", ticker: "$UNLK", accent: "violet" },
    outcome: "entered",
    outcomeText: "ENTERED · 40 AUSD ON PAPER",
    instrument: "BTC",
    call: "open-short",
    probability: 0.62,
    horizonHours: 4,
  },
  {
    agent: { name: "Halftime", handle: "halftime", ticker: "$HALF", accent: "lime" },
    outcome: "held",
    outcomeText: "ENTRY 2 HELD",
    instrument: "ETH",
    call: "open-long",
    probability: 0.58,
    horizonHours: 24,
  },
  {
    agent: { name: "Print Day", handle: "printday", ticker: "$PRNT", accent: "amber" },
    outcome: "exited",
    outcomeText: "TAKE PROFIT · +18.40 AUSD",
    instrument: "BTC",
    call: "close",
    probability: null,
    horizonHours: null,
  },
  {
    agent: { name: "Bracket", handle: "bracket", ticker: "$BRKT", accent: "blue" },
    outcome: "proposed",
    outcomeText: "WAITING ON THE OWNER",
    instrument: "ETH",
    call: "open-short",
    probability: 0.57,
    horizonHours: 4,
  },
  {
    agent: { name: "Cold Open", handle: "coldopen", ticker: "$OPEN", accent: "magenta" },
    outcome: "blocked",
    outcomeText: "DAY CAP REACHED",
    instrument: "BTC",
    call: "open-long",
    probability: 0.66,
    horizonHours: 72,
  },
  {
    agent: { name: "Tape Reader", handle: "tapereader", ticker: null, accent: "cyan" },
    outcome: "held",
    outcomeText: "HOLD",
    instrument: "ETH",
    call: "hold",
    probability: null,
    horizonHours: 4,
  },
];

export function createSampleActionFeed(clock: Clock): AgentActionFeed {
  return {
    async listRecent(limit) {
      const now = clock.now().getTime();
      return CALLS.slice(0, limit).map((call, index) => ({
        ...call,
        id: `sample-action-${index + 1}`,
        at: new Date(now - (index + 1) * 7 * MINUTE),
      }));
    },
  };
}
