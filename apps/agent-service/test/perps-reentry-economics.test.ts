import test from "node:test";
import assert from "node:assert/strict";
import {
  reentryEconomics,
  hourlyEntryKey,
  type PerpsStudyView,
  type PerpsStudyMap,
} from "@pickler/trading/evaluation";
import {
  applyPaperFill,
  type PerpsPaperAttempt,
  type PerpsPaperView,
} from "@pickler/trading/perps";
import { renderProfileReport } from "../src/perps-study/profiles-report.js";
import { perpsStudyReport } from "../src/perps-study/report.js";
import { config, at, account, evidence } from "./perps-reentry-fixtures.js";

function fixture(exit = "101") {
  const input = evidence();
  const bar = input.candles
    .find((s) => s.market.symbol === "BTC" && s.resolution === 3600)!
    .candles.at(-1)!.openTime;
  const opening: PerpsPaperAttempt = {
    key: "round-000:BTC:sma-reference",
    intent: {
      kind: "open",
      symbol: "BTC",
      side: "long",
      notional: "100",
      feeReserve: "1",
      entryEvidence: { roundKey: "round-000", resolution: 3600, candleOpenTime: bar },
    },
    status: "pending",
    reserved: "101",
    createdAt: at,
    finishedAt: null,
    reason: null,
    evidence: {},
  };
  const opened = applyPaperFill(
    account(true),
    opening,
    {
      quantity: "1",
      price: "100",
      notional: "100",
      fee: "0.1",
      block: 1,
      timestamp: at,
      evidence: {},
    },
    at,
  );
  const closing: PerpsPaperAttempt = {
    ...opening,
    key: "observe-1:BTC:sma-reference",
    intent: { kind: "close", symbol: "BTC", side: "long", notional: "0", feeReserve: "1" },
    createdAt: at + 60000,
  };
  const closed = applyPaperFill(
    opened.account,
    closing,
    {
      quantity: "1",
      price: exit,
      notional: exit,
      fee: "0.1",
      block: 2,
      timestamp: at + 60000,
      evidence: {},
    },
    at + 60000,
  );
  const reference: PerpsPaperView = {
    account: closed.account,
    attempts: [
      { ...opening, status: "filled", finishedAt: at },
      { ...closing, status: "filled", finishedAt: at + 60000 },
    ],
    movements: [...opened.movements, ...closed.movements],
  };
  reference.account.entryPolicy = "unrestricted-hourly-v1";
  const accounts: PerpsStudyMap<PerpsPaperView> = {
    "sma-reference": reference,
    "sma-once-bar": { account: account(true), attempts: [], movements: [] },
  };
  const study: PerpsStudyView = {
    record: {
      config,
      metadata: {},
      agentIds: { "sma-reference": "reference", "sma-once-bar": "once" },
      agentVersions: { "sma-reference": 1, "sma-once-bar": 1 },
      createdAt: at,
      startedAt: at,
      endsAt: at + 21600000,
      graceUntil: at + 22500000,
      status: "completed",
      decisionStopReason: null,
      stopRequested: false,
      lastObservationAt: at + 60000,
      lastRoundSlot: 0,
    },
    rounds: [
      {
        key: "round-000",
        slot: 0,
        status: "completed",
        executionStatus: "complete",
        createdAt: at,
        finishedAt: at,
        evidence: input,
        accounts: {},
        proposals: {},
        calls: {},
      },
    ],
    events: [
      { key: "round-000:final-evidence", kind: "final-evidence", at, data: { evidence: input } },
      {
        key: "round-000:sma-once-bar:final-gate",
        kind: "final-gate",
        at,
        data: {
          final: [
            {
              symbol: "BTC",
              action: "hold",
              reason: "HOURLY_ENTRY_ALREADY_CONSUMED",
              entryKey: hourlyEntryKey(input, "BTC", "long"),
            },
          ],
        },
      },
    ],
  };
  return { study, accounts, reference };
}

test("blocked reference winners and losers use confirmed postings, including fees and funding", () => {
  const winner = fixture();
  winner.reference.movements.push({
    key: "funding:controlled",
    kind: "funding",
    delta: "-0.05",
    at: at + 30000,
    evidence: { positionId: winner.reference.account.positions[0]!.id },
  });
  const measured = reentryEconomics(winner.study, winner.accounts);
  assert.equal(measured.referenceWinningPositions, 1);
  assert.equal(measured.rows[0]!.grossRealizedAUSD, "1");
  assert.equal(measured.rows[0]!.feeCostAUSD, "0.2");
  assert.equal(measured.rows[0]!.fundingAUSD, "-0.05");
  assert.equal(measured.rows[0]!.netRealizedAUSD, "0.75");
  assert.equal(winner.accounts["sma-once-bar"]!.movements.length, 0);

  const loser = fixture("99");
  const losing = reentryEconomics(loser.study, loser.accounts);
  assert.equal(losing.referenceLosingPositions, 1);
  assert.equal(losing.rows[0]!.netRealizedAUSD, "-1.2");
  const flat = fixture("100.2");
  assert.equal(reentryEconomics(flat.study, flat.accounts).referenceFlatPositions, 1);
});

test("unknown funding, missing or duplicate postings cannot establish a net result", () => {
  for (const change of ["funding", "missing", "duplicate"] as const) {
    const saved = fixture();
    if (change === "funding") {
      saved.reference.account.fundingPending = true;
    } else if (change === "missing") {
      saved.reference.movements.pop();
    } else {
      saved.reference.movements.push(saved.reference.movements[0]!);
    }
    const measured = reentryEconomics(saved.study, saved.accounts);
    assert.equal(measured.unverifiable, 1);
    assert.equal(measured.rows[0]!.netRealizedAUSD, null);
  }
});

test("a reference opening must match the same round, direction and final hourly key", () => {
  for (const change of ["round", "direction", "bar", "rejected"] as const) {
    const saved = fixture();
    const opening = saved.reference.attempts[0]!;
    if (change === "round") {
      opening.intent.entryEvidence!.roundKey = "round-001";
    } else if (change === "direction") {
      opening.intent.side = "short";
    } else if (change === "bar") {
      opening.intent.entryEvidence!.candleOpenTime += 3600000;
    } else {
      opening.status = "rejected";
    }
    const measured = reentryEconomics(saved.study, saved.accounts);
    assert.equal(measured.rows[0]!.outcome, "NO_MATCHING_REFERENCE_OPEN");
    assert.equal(measured.rows[0]!.netRealizedAUSD, null);
  }
});

test("open positions remain pending and incomplete or excluded slots are not comparable", () => {
  const saved = fixture();
  saved.reference.account.positions[0]!.closedAt = null;
  assert.equal(reentryEconomics(saved.study, saved.accounts).pendingPositions, 1);
  saved.study.rounds[0]!.executionStatus = "skipped_data_unavailable";
  assert.equal(reentryEconomics(saved.study, saved.accounts).comparableBlockedKeys, 0);
  saved.study.rounds[0]!.executionStatus = "complete";
  saved.study.rounds[0]!.evidence.excluded = [
    { symbol: "BTC", code: "DATA_UNAVAILABLE", phase: "final" },
  ];
  assert.equal(reentryEconomics(saved.study, saved.accounts).comparableBlockedKeys, 0);
});

test("economic report is deterministic, preserves evidence and exposes the ledger references", () => {
  const saved = fixture();
  const before = JSON.stringify(saved);
  const render = () =>
    renderProfileReport(saved, perpsStudyReport(saved.study, saved.accounts), "finished");
  const first = render();
  assert.equal(first.economicsCsv, render().economicsCsv);
  assert.equal(first.economics!.rows[0]!.referenceClosingKey, "observe-1:BTC:sma-reference");
  assert.match(first.html, /Confirmed reference positions matching blocked reentries/);
  assert.match(first.html, /No P&amp;L is assigned to the unexecuted/);
  assert.equal(JSON.stringify(saved), before);

  const unsafe = structuredClone(saved);
  const gate = unsafe.study.events[1]!.data as { final: { entryKey: string }[] };
  gate.final[0]!.entryKey = '=HYPERLINK("x")<script>alert(1)</script>';
  const guarded = renderProfileReport(
    unsafe,
    perpsStudyReport(unsafe.study, unsafe.accounts),
    "finished",
  );
  assert.match(guarded.economicsCsv, /'=HYPERLINK/);
  assert.doesNotMatch(guarded.html, /<script>alert\(1\)<\/script>/);
  assert.match(guarded.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
