import test from "node:test";
import assert from "node:assert/strict";
import { PilotError } from "@pickler/core";
import { createTestStore } from "@pickler/infrastructure/testing";
import { PostgresPerpsStudyStore, PostgresPerpsPaperStore } from "@pickler/infrastructure";
import {
  perpsSlotClock,
  type PerpsSmaReviewConfig,
  createPerpsStudyRunner,
} from "@pickler/trading/evaluation";
import { studyEvidence } from "./perps-study-fixtures.js";
const config: PerpsSmaReviewConfig = {
  version: 4,
  protocol: "perps-sma-jev-exa-v1",
  hours: 2,
  tenantId: "alpha",
  sessionId: "sma-review",
  network: "mainnet",
  budgetUsd: "5",
  providerBudgetUSD: "0.50",
  authorization: { jevApproved: true, exaApproved: true, operatorRecordHash: "a".repeat(64) },
  historicalAccountedOrReservedUSD: null,
  historicalUnknownReservations: [{ requestHash: "b".repeat(64), reservationUsd: "0.024576" }],
  jev: { model: "jev-1.13.0", inputPerMillion: "0.042", outputPerMillion: "0" },
  exa: { reservationPerSearchUSD: "0.05", lookbackHours: 24, results: 5 },
  pricingVerifiedAt: "2026-10-06T00:00:00Z",
  pricingSources: ["https://docs.typesafe.ai/models", "https://exa.ai/pricing"],
};

const authorization = {
  hash: "f".repeat(64),
  reason: "Operator requests repair and completion of untouched slots",
  commit: "a".repeat(40),
};
test("operator continuation retains portfolios, omissions and reservations, uses fresh time, and fences stale writers", async (t) => {
  let now = 1800000000000;
  const research = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(research.pool, () => now);
  const paper = new PostgresPerpsPaperStore(research.pool, () => now);
  const initial = await study.initialize(config, {});
  const first = await study.claim(config);
  now += 4 * 900000;
  assert.equal(await study.claimSlot(config, first, 4).catch(() => false), false);
  // Renewed controlled owner can record a data omission without creating paid calls.
  first.expiresAt = now + 90000;
  await research.pool.query("UPDATE pickler.perps_studies SET expires_at=$1 WHERE session_id=$2", [
    first.expiresAt,
    config.sessionId,
  ]);
  assert.equal(await study.claimSlot(config, first, 4), true);
  await study.event(config, first, "slot-4:data-unavailable", "data-unavailable", {
    slot: 4,
    phase: "before-model",
    code: "DATA_UNAVAILABLE",
  });
  const accountsBefore = await Promise.all(
    Object.values(initial.record.agentIds).map((agentId) => paper.view({ ...config, agentId })),
  );
  const previousEnd = (await study.view(config)).record.endsAt;
  await study.release(config, first, "PROCESS_INTERRUPTED");
  assert.equal((await study.view(config)).record.status, "interrupted");
  now += 86400000;
  const segment = await study.authorizeContinuation(config, authorization);
  assert.equal(segment.fromSlot, 5);
  assert.equal(segment.previousEndsAt, previousEnd);
  assert.equal((await study.view(config)).record.endsAt, now + 3 * 900000);
  assert.deepEqual(perpsSlotClock((await study.view(config)).record, now), {
    slot: 5,
    withinSlotMs: 0,
  });
  const resumed = await study.claim(config);
  assert.equal(await study.claimSlot(config, resumed, 4), false);
  assert.equal(await study.claimSlot(config, resumed, 5), true);
  assert.equal(await study.claimSlot(config, resumed, 5), false);
  await study.release(config, first, "PROCESS_INTERRUPTED");
  await study.guard(config, resumed);
  const after = await study.view(config);
  assert.equal(after.record.status, "running");
  assert.equal(after.events.filter((e) => e.kind === "data-unavailable").length, 1);
  assert.equal(after.rounds.length, 0);
  assert.deepEqual(
    await Promise.all(
      Object.values(initial.record.agentIds).map((agentId) => paper.view({ ...config, agentId })),
    ),
    accountsBefore,
  );
  await study.release(config, resumed, "PROCESS_INTERRUPTED");
  await assert.rejects(
    () => study.authorizeContinuation(config, authorization),
    (e: unknown) => e instanceof PilotError && e.code === "CONTINUATION_NOT_ALLOWED",
  );
});
test("unknown started call blocks continuation and remains fully reserved", async (t) => {
  const now = 1800000000000;
  const research = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(research.pool, () => now);
  const paper = new PostgresPerpsPaperStore(research.pool, () => now);
  const initial = await study.initialize(config, {});
  const lease = await study.claim(config);
  const accounts = Object.fromEntries(
    await Promise.all(
      Object.entries(initial.record.agentIds).map(async ([s, agentId]) => [
        s,
        (await paper.view({ ...config, agentId })).account,
      ]),
    ),
  );
  const round = await study.reserve(config, lease, 0, studyEvidence(now), accounts, []);
  await study.startCall(config, lease, round!.key, "sma-review", {
    sha256: "b".repeat(64),
    bytes: 1,
  });
  await study.release(config, lease, "PROCESS_INTERRUPTED");
  await assert.rejects(
    () => study.authorizeContinuation(config, authorization),
    (e: unknown) => e instanceof PilotError && e.code === "RECONCILIATION_REQUIRED",
  );
  const saved = (await study.view(config)).rounds[0]!.calls["sma-review"]!;
  assert.equal(saved.costUsd, null);
  assert.equal(saved.reservationUsd, "0.002752512");
  assert.equal(saved.status, "started");
});
test("fatal runner interruption is persisted instead of leaving a running study", async (t) => {
  const now = 1800000000000;
  const research = await createTestStore(t, () => now);
  const study = new PostgresPerpsStudyStore(research.pool, () => now);
  const paper = new PostgresPerpsPaperStore(research.pool, () => now);
  await study.initialize(config, {});
  const fail = async () => {
    throw new PilotError("PERMISSION_DENIED", "controlled failure");
  };
  const runner = createPerpsStudyRunner({
    study,
    paper,
    now: () => now,
    data: { observe: fail, evidence: fail, execution: fail },
  });
  await assert.rejects(() => runner.run(config, new AbortController().signal));
  const saved = await study.view(config);
  assert.equal(saved.record.status, "interrupted");
  assert.equal(saved.record.decisionStopReason, "PERMISSION_DENIED");
  await assert.rejects(() => study.authorizeContinuation(config, authorization));
});
