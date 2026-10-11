import test from "node:test";
import assert from "node:assert/strict";
import { PilotError } from "@pickler/core";
import {
  createProfileStudyRunner,
  startLeaseHeartbeat,
  type PerpsStudyView,
  type PerpsStudyRepository,
} from "../src/evaluation.js";
import { PTS_CATALOG, replayPtsFinance, assertPtsConfig, type PerpsPtsConfig } from "../src/pts.js";
import { canonicalAudit } from "../src/evaluation.js";
import type { PerpsPaperRepository } from "../src/perps.js";
import { ptsTime, ptsFixture, ptsEvidence } from "./pts-fixture.js";
const digest = (v: unknown) => canonicalAudit(v);
const config: PerpsPtsConfig = {
  version: 8,
  protocol: "perps-pts-sma-v1",
  tenantId: "fixture",
  sessionId: "pts-clock",
  network: "mainnet",
  hours: 336,
  budgetUsd: "5",
  markets: PTS_CATALOG.map((m) => ({ ...m })),
  acquisitionPolicy: "stream-universe-component-paper-20s-v1",
  candidate: "pts-trend-reversal@0.2.0",
  history: { file: "history.json", sha256: "a".repeat(64) },
  preparedFor: "local-paper-only",
};
test("actual coordinator financial replay opens both independent arms and closes PTS targets without a provider", async () => {
  for (const short of [false, true]) {
    const start = ptsTime + 60000,
      captures = ["0.40", "0.61", "0.78", "1"].map((ratio, i) => {
        const e = ptsEvidence(start + i * 60000, short, ratio, () => "a".repeat(64));
        return {
          at: e.observedAt,
          frames: e.frames,
          funding: e.frames.map((f) => ({
            market: f.snapshot.market,
            from: ptsTime - 60000,
            to: e.observedAt,
            complete: true,
            pages: [f.book.provenance],
            events: [],
          })),
        };
      });
    // Component frames carry an actual digest in the recorded replay.
    const { createHash } = await import("node:crypto");
    for (const c of captures) {
      for (const f of c.frames) {
        f.hash = createHash("sha256")
          .update(
            JSON.stringify({
              snapshot: f.snapshot,
              book: f.book,
              streamEvidence: f.streamEvidence,
            }),
          )
          .digest("hex");
      }
    }
    const histories = PTS_CATALOG.map((m) => ptsFixture(m.symbol, short));
    for (const h of histories) {
      h.market.provenance.network = "mainnet";
      h.market.provenance.chainId = 143;
    }
    const input = {
      format: "perps-pts-history-v1" as const,
      capturedAt: start + 600000,
      from: start,
      to: start + 600000,
      commit: "controlled",
      markets: histories,
      financial: captures,
    };
    const result = await replayPtsFinance(input, digest);
    assert.equal(result.status, "REPLAYED");
    const pts = result.accounts!["pts-basic"]!;
    assert.ok(pts.account.positions.length > 0);
    assert.ok(
      pts.account.positions.every(
        (p) => p.closedAt !== null && p.pts!.consumedTargets.length === 3,
      ),
    );
    assert.ok(result.accounts!["sma-reference"]!.account.positions.length > 0);
    assert.equal(result.modelCalls, 0);
  }
});
test("fourteen-day calendar records 4032 slots and fixed closure, renews ownership, releases without recovering missed windows", async () => {
  assertPtsConfig(config);
  let now = ptsTime,
    renewals = 0,
    releases = 0,
    claimed = 0,
    missing = 0,
    observations = 0,
    closed = 0;
  const start = Math.floor(now / 300000) * 300000 + 60000,
    ends = start + 336 * 3600000;
  const view: PerpsStudyView = {
    record: {
      config,
      metadata: { controlled: true },
      agentIds: { "sma-reference": "sma", "pts-basic": "pts" },
      agentVersions: { "sma-reference": 1, "pts-basic": 1 },
      createdAt: now,
      startedAt: start,
      endsAt: ends,
      graceUntil: ends + 900000,
      status: "running",
      decisionStopReason: null,
      stopRequested: false,
      lastObservationAt: null,
      lastRoundSlot: -1,
    },
    rounds: [],
    events: [],
  };
  const lease = { owner: "controlled", expiresAt: now + 90000 };
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected financial/model port");
  };
  const study: PerpsStudyRepository = {
    initialize: async () => view,
    view: async () => view,
    cycleView: async () => view,
    claim: async () => lease,
    renew: async () => {
      renewals++;
      lease.expiresAt = now + 90000;
    },
    guard: async () => {
      if (now >= lease.expiresAt) {
        throw new PilotError("LEASE_LOST", "controlled expiry");
      }
    },
    release: async () => {
      releases++;
    },
    claimSlot: async (_s, _l, slot) => {
      if (
        slot < 0 ||
        slot >= 4032 ||
        slot <= (view.record.lastAttemptedSlot ?? -1) ||
        now >= ends ||
        now - start - slot * 300000 > 30000
      ) {
        return false;
      }
      claimed++;
      view.record.lastAttemptedSlot = slot;
      return true;
    },
    event: async (_s, _l, key, kind, data) => {
      if (kind === "slot-missed") {
        missing++;
        view.record.lastAttemptedSlot = (data as { slot: number }).slot;
      }
      if (kind === "observation-failed") {
        observations++;
        view.events = [{ key, kind, at: now, data }];
      }
    },
    complete: async () => {
      view.record.status = "completed";
    },
    stop: unexpected,
    stopDecisions: async (_s, _l, reason) => {
      view.record.status = "closing";
      view.record.decisionStopReason = reason;
    },
    reserve: unexpected,
    finishRound: unexpected,
    finishExecution: unexpected,
    startCall: unexpected,
    usage: unexpected,
    finishCall: unexpected,
  };
  const paper = {
    closeAdmissions: async () => {
      closed++;
    },
  } as unknown as PerpsPaperRepository;
  const runner = createProfileStudyRunner({
    study,
    paper,
    now: () => now,
    data: {
      observe: async () => {
        throw new PilotError("DATA_UNAVAILABLE", "controlled unavailable");
      },
      evidence: unexpected,
      execution: unexpected,
      finalEvidence: unexpected,
    },
  });
  const heartbeat = startLeaseHeartbeat({
    lease,
    now: () => now,
    renew: () => study.renew(config, lease),
  });
  try {
    // Reuse the real cycle under one controlled ownership lifetime. Skip one admission window.
    for (now = start; now <= ends + 900000; now += 60000) {
      await study.renew(config, lease);
      heartbeat.tick();
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (now === start + 300000) {
        continue;
      }
      const keep = await runner.cycle(
        config,
        { ...lease, assertActive: heartbeat.assertActive },
        new AbortController().signal,
      );
      if (!keep) {
        break;
      }
    }
  } finally {
    await heartbeat.stop();
    await study.release(config, lease);
  }
  assert.equal(claimed + missing, 4032);
  assert.equal(missing, 1);
  assert.equal(claimed, 4031);
  assert.equal(view.record.status, "completed");
  assert.equal(now, ends + 900000);
  assert.ok(renewals > 20160);
  assert.equal(releases, 1);
  assert.ok(observations >= 20160);
  assert.ok(closed > 0);
  assert.equal(view.record.lastAttemptedSlot, 4031);
});
