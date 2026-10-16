import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PerpsHourlyBreakoutConfig } from "@pickler/trading/evaluation";
import { PilotError } from "@pickler/core";
import {
  DatabaseClockSampleError,
  sampleDatabaseClock,
  type DatabaseClockProof,
  type OrderedClock,
} from "../src/hourly-breakout/clock.js";
import { cleanupDiagnosticOwnership } from "../src/hourly-breakout/host.js";
import { ArtifactBudget, digest } from "../src/hourly-breakout/files.js";
import { analyzeSource, type SourceManifest } from "../src/hourly-breakout/report.js";
import { freezeSourceWindow } from "../src/hourly-breakout/schedule.js";

function pairedClock(walls: readonly number[], monos: readonly number[]): OrderedClock {
  let wallIndex = 0;
  let monoIndex = 0;
  return {
    wall() {
      assert.ok(wallIndex < walls.length, "Unexpected extra wall-clock read");
      return walls[wallIndex++]!;
    },
    monotonic() {
      assert.ok(monoIndex < monos.length, "Unexpected extra monotonic read");
      return monos[monoIndex++]!;
    },
  };
}

const hasCode = (code: string) => (error: unknown) =>
  error instanceof PilotError && error.code === code;

test("the unchanged full-RTT rule accepts an interval containing zero and rejects tighter incompatible intervals", async () => {
  // Controlled values reproduce interval geometry, not the unretained rejected startup sample.
  const wide = await sampleDatabaseClock(
    async () => ({ databaseAt: 1000 }),
    pairedClock([1000, 1006], [10, 15.334458]),
  );
  assert.equal(wide.compatibility, "LOCAL_OS_INTERVAL_COMPATIBLE");
  assert.deepEqual(wide.databaseOffsetInterval, { lowerMs: -7, upperMs: 1 });
  assert.ok(Math.abs(wide.roundTripMs - 5.334458) < 1e-9);
  for (const walls of [
    [1003, 1004],
    [1004, 1004],
  ] as const) {
    await assert.rejects(
      sampleDatabaseClock(async () => ({ databaseAt: 1000 }), pairedClock(walls, [10, 10.5])),
      hasCode("CLOCK_INCOMPATIBLE"),
    );
  }
});

test("zero at either conservative interval endpoint is accepted without a new offset tolerance", async () => {
  for (const databaseAt of [999, 1002]) {
    const proof = await sampleDatabaseClock(
      async () => ({ databaseAt }),
      pairedClock([1000, 1001], [10, 11]),
    );
    assert.ok(proof.databaseOffsetInterval.lowerMs <= 0);
    assert.ok(proof.databaseOffsetInterval.upperMs >= 0);
  }
  for (const databaseAt of [998, 1003]) {
    await assert.rejects(
      sampleDatabaseClock(async () => ({ databaseAt }), pairedClock([1000, 1001], [10, 11])),
      hasCode("CLOCK_INCOMPATIBLE"),
    );
  }
});

test("invalid or regressed clock numbers never produce a compatible proof", async () => {
  for (const example of [
    { databaseAt: Number.NaN, walls: [1000, 1001], monos: [10, 11] },
    { databaseAt: 1000, walls: [Number.NaN, 1001], monos: [10, 11] },
    { databaseAt: 1000, walls: [1000, Number.POSITIVE_INFINITY], monos: [10, 11] },
    { databaseAt: 1000, walls: [1000, 1001], monos: [Number.NaN, 11] },
    { databaseAt: 1000, walls: [1000, 1001], monos: [10, Number.POSITIVE_INFINITY] },
    { databaseAt: 1000, walls: [1001, 1000], monos: [10, 11] },
    { databaseAt: 1000, walls: [1000, 1001], monos: [11, 10] },
  ]) {
    await assert.rejects(
      sampleDatabaseClock(
        async () => ({ databaseAt: example.databaseAt }),
        pairedClock(example.walls, example.monos),
      ),
      hasCode("CLOCK_PROOF_FAILURE"),
    );
  }
});

test("rejected clock proof preserves numeric RTT evidence before throwing without changing compatibility", async () => {
  const sequence: string[] = [];
  let received: DatabaseClockProof | undefined;
  let caught: unknown;
  try {
    await sampleDatabaseClock(
      async () => {
        sequence.push("sample");
        return { databaseAt: 1000 };
      },
      pairedClock([1003, 1004], [10, 10.5]),
      async (proof) => {
        sequence.push("rejected-proof");
        await Promise.resolve();
        received = structuredClone(proof);
      },
    );
  } catch (error) {
    caught = error;
    sequence.push("caught");
  }
  assert.deepEqual(sequence, ["sample", "rejected-proof", "caught"]);
  assert.ok(caught instanceof DatabaseClockSampleError);
  assert.equal(caught.code, "CLOCK_INCOMPATIBLE");
  assert.equal(received?.format, "hourly-breakout-database-clock-proof-v1");
  assert.equal(received?.compatibility, "CLOCK_INCOMPATIBLE");
  assert.equal(received?.databaseAt, 1000);
  assert.equal(received?.wallBefore, 1003);
  assert.equal(received?.wallAfter, 1004);
  assert.equal(received?.monotonicBefore, 10);
  assert.equal(received?.monotonicAfter, 10.5);
  assert.equal(received?.roundTripMs, 0.5);
  assert.equal(received?.quantizationMarginMs, 1);
  assert.deepEqual(received?.databaseOffsetInterval, { lowerMs: -5, upperMs: -2 });
  assert.deepEqual(caught.proof, received);
});

test("a rejected-proof writer failure cannot replace the clock cause or leak its message", async () => {
  const secretMessage = "postgresql://PRIVATE_USER:PRIVATE_PASSWORD@private.invalid/database";
  let caught: unknown;
  try {
    await sampleDatabaseClock(
      async () => ({ databaseAt: 1000 }),
      pairedClock([1003, 1004], [10, 10.5]),
      (proof) => {
        proof.databaseAt = 0;
        proof.compatibility = "LOCAL_OS_INTERVAL_COMPATIBLE";
        if (proof.databaseOffsetInterval) {
          proof.databaseOffsetInterval.lowerMs = -99999;
        }
        throw new PilotError("PERSISTENCE_QUERY_TIMEOUT", secretMessage);
      },
    );
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof DatabaseClockSampleError);
  assert.equal(caught.code, "CLOCK_INCOMPATIBLE");
  assert.equal(caught.proof.compatibility, "CLOCK_INCOMPATIBLE");
  assert.equal(caught.proof.databaseAt, 1000);
  assert.deepEqual(caught.proof.databaseOffsetInterval, { lowerMs: -5, upperMs: -2 });
  assert.equal(caught.proofPersistenceCode, "PERSISTENCE_QUERY_TIMEOUT");
  assert.equal(JSON.stringify(caught).includes(secretMessage), false);
  assert.equal(caught.message.includes(secretMessage), false);
});

test("invalid numeric proof is explicit and accepted probes never call the rejection observer", async () => {
  let rejected: DatabaseClockProof | undefined;
  await assert.rejects(
    sampleDatabaseClock(
      async () => ({ databaseAt: 1000 }),
      pairedClock([Number.NaN, 1004], [10, 10.5]),
      (proof) => {
        rejected = proof;
      },
    ),
    hasCode("CLOCK_PROOF_FAILURE"),
  );
  assert.equal(rejected?.compatibility, "CLOCK_PROOF_FAILURE");
  assert.equal(rejected?.wallBefore, null);
  assert.equal(rejected?.databaseOffsetInterval, null);
  assert.deepEqual(JSON.parse(JSON.stringify(rejected)), rejected);
  let rejectionCount = 0;
  const accepted = await sampleDatabaseClock(
    async () => ({ databaseAt: 1000 }),
    pairedClock([1000, 1001], [10, 11]),
    () => {
      rejectionCount++;
    },
  );
  assert.equal(accepted.compatibility, "LOCAL_OS_INTERVAL_COMPATIBLE");
  assert.equal(rejectionCount, 0);
});

test("ownership loss while persisting a rejected proof retains LEASE_LOST", async () => {
  const lost = new PilotError("LEASE_LOST", "Controlled ownership loss");
  await assert.rejects(
    sampleDatabaseClock(
      async () => ({ databaseAt: 1000 }),
      pairedClock([1003, 1004], [10, 10.5]),
      () => {
        throw lost;
      },
    ),
    (error: unknown) =>
      error instanceof DatabaseClockSampleError &&
      error.code === "LEASE_LOST" &&
      error.proofPersistenceCode === "LEASE_LOST" &&
      error.proof.compatibility === "CLOCK_INCOMPATIBLE",
  );
});

function cleanupFixture(
  options: {
    ownershipLost?: boolean;
    failure?: unknown;
    guardFailure?: unknown;
    sampleFailure?: unknown;
    verifyFailure?: unknown;
    releaseFailure?: unknown;
    eventFailure?: unknown;
  } = {},
) {
  const calls: string[] = [];
  const releasedCodes: (string | undefined)[] = [];
  return {
    calls,
    releasedCodes,
    run: () =>
      cleanupDiagnosticOwnership({
        ownershipLost: options.ownershipLost ?? false,
        ...(options.failure === undefined ? {} : { failure: options.failure }),
        async guard() {
          calls.push("guard");
          if (options.guardFailure) {
            throw options.guardFailure;
          }
        },
        async sampleClock() {
          calls.push("sample");
          if (options.sampleFailure) {
            throw options.sampleFailure;
          }
        },
        async verifyNoAccounts() {
          calls.push("verify-no-accounts");
          if (options.verifyFailure) {
            throw options.verifyFailure;
          }
        },
        async release(code) {
          calls.push("technical-lease-release");
          releasedCodes.push(code);
          if (options.releaseFailure) {
            throw options.releaseFailure;
          }
        },
        async event(value) {
          calls.push("local-release-ack");
          assert.equal(value.kind, "diagnostic-release-acknowledged");
          assert.ok(Number.isSafeInteger(value.at));
          if (options.eventFailure) {
            throw options.eventFailure;
          }
        },
      }),
  };
}

test("incompatible end-clock evidence does not prevent confirmed technical lease release", async () => {
  const primary = new PilotError("CLOCK_INCOMPATIBLE", "Controlled original clock failure");
  const secondary = new PilotError("CLOCK_INCOMPATIBLE", "Controlled rejected end clock");
  const fixture = cleanupFixture({ failure: primary, sampleFailure: secondary });
  const result = await fixture.run();
  assert.equal(result.failure, primary);
  assert.equal(result.leaseReleased, true);
  assert.equal(result.ownershipLost, false);
  assert.ok(result.failureCodes.includes("CLOCK_INCOMPATIBLE"));
  assert.deepEqual(
    fixture.calls.filter((call) => call !== "guard"),
    ["sample", "verify-no-accounts", "technical-lease-release", "local-release-ack"],
  );
  assert.deepEqual(fixture.releasedCodes, ["CLOCK_INCOMPATIBLE"]);
});

test("verification and local journal failures preserve the first failure while releasing only the diagnostic lease", async () => {
  const primary = new PilotError("CLOCK_INCOMPATIBLE", "Controlled first failure");
  for (const additional of [
    { verifyFailure: new PilotError("PERSISTENCE_QUERY_TIMEOUT", "Controlled view failure") },
    { eventFailure: new PilotError("BREAKOUT_ARTIFACT_LIMIT", "Controlled ACK journal failure") },
    {
      sampleFailure: new PilotError("BREAKOUT_ARTIFACT_LIMIT", "Controlled proof journal failure"),
    },
  ]) {
    const fixture = cleanupFixture({ failure: primary, ...additional });
    const result = await fixture.run();
    assert.equal(result.failure, primary);
    assert.equal(result.leaseReleased, true);
    assert.equal(result.ownershipLost, false);
    assert.equal(fixture.calls.filter((call) => call === "technical-lease-release").length, 1);
    const cleanupFailure = Object.values(additional)[0]!;
    assert.ok(result.failureCodes.includes(cleanupFailure.code));
  }
});

test("known ownership loss and fresh guard failure prohibit every subsequent database operation", async () => {
  const lost = new PilotError("LEASE_LOST", "Controlled already lost ownership");
  const known = cleanupFixture({ ownershipLost: true, failure: lost });
  const knownResult = await known.run();
  assert.deepEqual(known.calls, []);
  assert.equal(knownResult.leaseReleased, false);
  assert.equal(knownResult.ownershipLost, true);
  for (const failure of [lost, new PilotError("PERSISTENCE_QUERY_TIMEOUT", "Unproved guard")]) {
    const fixture = cleanupFixture({ guardFailure: failure });
    const result = await fixture.run();
    assert.deepEqual(fixture.calls, ["guard"]);
    assert.equal(result.leaseReleased, false);
    assert.equal(result.failure, failure);
  }
});

test("ownership lost at any later boundary prevents every following database call and no release is retried", async () => {
  const lost = new PilotError("LEASE_LOST", "Controlled boundary ownership loss");
  for (const example of [
    { options: { sampleFailure: lost }, last: "sample" },
    { options: { verifyFailure: lost }, last: "verify-no-accounts" },
    { options: { releaseFailure: lost }, last: "technical-lease-release" },
  ]) {
    const fixture = cleanupFixture(example.options);
    const result = await fixture.run();
    assert.equal(result.ownershipLost, true);
    assert.equal(result.leaseReleased, false);
    assert.equal(result.failure, lost);
    assert.equal(fixture.calls.at(-1), example.last);
    assert.equal(fixture.calls.includes("local-release-ack"), false);
    assert.ok(fixture.calls.filter((call) => call === "technical-lease-release").length <= 1);
  }
  const writeFailure = new PilotError("PERSISTENCE_QUERY_TIMEOUT", "Unconfirmed lease release");
  const fixture = cleanupFixture({ releaseFailure: writeFailure });
  const result = await fixture.run();
  assert.equal(result.leaseReleased, false);
  assert.equal(result.failure, writeFailure);
  assert.equal(fixture.calls.filter((call) => call === "technical-lease-release").length, 1);
  assert.equal(fixture.calls.includes("local-release-ack"), false);
});

test("an untyped rejected-proof writer error is recorded only by a bounded safe code", async () => {
  await assert.rejects(
    sampleDatabaseClock(
      async () => ({ databaseAt: 1000 }),
      pairedClock([1003, 1004], [10, 10.5]),
      () => {
        throw new Error("PRIVATE_DATABASE_DRIVER_MESSAGE_MUST_NOT_BE_PERSISTED");
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseClockSampleError);
      assert.equal(error.code, "CLOCK_INCOMPATIBLE");
      assert.equal(error.proofPersistenceCode, "BREAKOUT_CLOCK_PROOF_WRITE_FAILED");
      assert.equal(JSON.stringify(error).includes("PRIVATE_DATABASE_DRIVER_MESSAGE"), false);
      return true;
    },
  );
});

test("an interrupted empty source audit preserves fixed denominators and unknown J maxima", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-clock-empty-audit-"));
  try {
    const config = JSON.parse(
      await readFile(new URL("../hourly-breakout-disabled.example.json", import.meta.url), "utf8"),
    ) as PerpsHourlyBreakoutConfig;
    let clockFailure: DatabaseClockSampleError | undefined;
    try {
      await sampleDatabaseClock(
        async () => ({ databaseAt: 1000 }),
        pairedClock([1003, 1004], [10, 10.5]),
      );
    } catch (error) {
      assert.ok(error instanceof DatabaseClockSampleError);
      clockFailure = error;
    }
    assert.ok(clockFailure);
    const manifest: SourceManifest = {
      format: "hourly-breakout-source-capture-v1",
      protocol: config.protocol,
      version: 10,
      config,
      configHash: digest(config),
      captureCommit: "a".repeat(40),
      frozen: freezeSourceWindow(Date.UTC(2026, 9, 15, 12)),
      processState: "interrupted",
      failureCode: "BREAKOUT_ARTIFACT_LIMIT",
      clockFailure: { proof: clockFailure.proof, proofPersistenceCode: null },
      journals: {
        snapshots: [],
        clocks: [],
        prepared: [],
        versions: [],
        wire: [],
        http: [],
        control: [],
      },
      wire: { truncated: false, retainedBytes: 0, maximumBytes: 33554432, firstOmittedAt: null },
      coldStart: { firstAttemptAt: null, metadataAndWebSocketReadyAt: null, within20Seconds: null },
      artifactBudget: new ArtifactBudget().snapshot(),
      authority: {
        scope: "source-local",
        clockAuthority: "LOCAL_OS",
        externalUTC: "UNVERIFIED",
        financialAcceptance: false,
      },
      databaseCounts: {
        accounts: 0,
        positions: 0,
        attempts: 0,
        reservations: 0,
        funding: 0,
        financialV: 0,
      },
      modelCalls: 0,
      newReservations: 0,
      cleanup: { socketClosed: false, leaseReleased: false, poolClosed: true },
    };
    const frozen = JSON.parse(JSON.stringify(manifest)) as SourceManifest;
    const report = await analyzeSource(directory, frozen);
    assert.equal(report.result, "FAIL_NONFINANCIAL_SOURCE_ACCEPTANCE");
    assert.deepEqual(report.coverage.canonicalMinutes, {
      qualified: 0,
      planned: 1440,
      required: 1368,
    });
    assert.deepEqual(report.coverage.canonicalMarketMinutes, {
      qualified: 0,
      planned: 15840,
      required: 15048,
    });
    assert.deepEqual(report.coverage.originalPumps, { recorded: 0, planned: 4320 });
    assert.equal(report.rows.length, 15840);
    assert.equal(report.pumpRows.length, 47520);
    assert.ok(report.rows.every((row) => row.status === "NOT_RECORDED"));
    assert.equal(report.continuity.maximumUpperFinancialMs, null);
    assert.equal(report.continuity.maximumUpperMonotonicMs, null);
    assert.equal(report.continuity.qualifiedSourceReceipts, 0);
    assert.equal(report.continuity.pass, false);
    assert.equal(report.financialAcceptance, false);
    assert.equal(
      frozen.failureCode,
      "BREAKOUT_ARTIFACT_LIMIT",
      "A later clock rejection must not replace the primary failure",
    );
    assert.deepEqual(report.clockFailure, frozen.clockFailure);
    assert.equal(report.clockFailure?.proof.compatibility, "CLOCK_INCOMPATIBLE");
    const invalidRaw = structuredClone(frozen);
    invalidRaw.clockFailure!.proof.wallAfter = Number.NaN;
    await assert.rejects(analyzeSource(directory, invalidRaw), hasCode("BREAKOUT_SOURCE_INVALID"));
    const invalidInterval = structuredClone(frozen);
    invalidInterval.clockFailure!.proof.databaseOffsetInterval!.upperMs = Number.POSITIVE_INFINITY;
    await assert.rejects(
      analyzeSource(directory, invalidInterval),
      hasCode("BREAKOUT_SOURCE_INVALID"),
    );
    const invalidCode = structuredClone(frozen);
    invalidCode.clockFailure!.proofPersistenceCode =
      "postgresql://PRIVATE_USER:PRIVATE_PASSWORD@private.invalid";
    await assert.rejects(analyzeSource(directory, invalidCode), hasCode("BREAKOUT_SOURCE_INVALID"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
