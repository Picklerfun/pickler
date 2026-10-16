import test from "node:test";
import assert from "node:assert/strict";
import { PilotError } from "@pickler/core";
import {
  DatabaseClockSampleError,
  sampleDatabaseClock,
  type DatabaseClockProof,
  type OrderedClock,
} from "../src/hourly-breakout/clock.js";
import {
  createSourceDatabaseClock,
  SOURCE_DATABASE_CLOCK_POLICY,
  validateSourceDatabaseClockSample,
} from "../src/hourly-breakout/source-database-clock.js";

function controlledClock() {
  let walls: number[] = [];
  let monos: number[] = [];
  const clock: OrderedClock = {
    wall() {
      assert.ok(walls.length, "Unexpected wall read");
      return walls.shift()!;
    },
    monotonic() {
      assert.ok(monos.length, "Unexpected monotonic read");
      return monos.shift()!;
    },
  };
  return {
    clock,
    set(before = 1003, after = 1004, monoBefore = 10, monoAfter = 10.5) {
      assert.equal(walls.length + monos.length, 0);
      walls = [before, after];
      monos = [monoBefore, monoAfter];
    },
  };
}

const code = (expected: string) => (error: unknown) =>
  error instanceof PilotError && error.code === expected;

test("source captures record a measured nonzero database offset while legacy financial alignment stays strict", async () => {
  const input = controlledClock();
  input.set();
  await assert.rejects(
    sampleDatabaseClock(async () => ({ databaseAt: 1000 }), input.clock),
    code("CLOCK_INCOMPATIBLE"),
  );

  input.set();
  let rejected = 0;
  const sample = await createSourceDatabaseClock({ clock: input.clock }).sample(
    async () => ({ databaseAt: 1000 }),
    () => {
      rejected++;
    },
  );
  assert.deepEqual(sample.databaseOffsetInterval, { lowerMs: -5, upperMs: -2 });
  assert.equal(sample.absoluteAlignment, "OBSERVED_NONZERO_OFFSET");
  assert.equal(sample.databaseAt, 1000);
  assert.equal(sample.wallBefore, 1003);
  assert.equal(sample.wallAfter, 1004);
  assert.equal(sample.roundTripMs, 0.5);
  assert.equal(sample.sourceAuthority, "LOCAL_OS");
  assert.equal(sample.leaseAuthority, "POSTGRESQL");
  assert.equal(sample.financialAcceptance, false);
  assert.equal(sample.externalUTC, "UNVERIFIED");
  assert.equal(sample.process.pid, process.pid);
  assert.ok(Number.isFinite(sample.process.timeOriginMs));
  assert.ok(sample.process.epochId);
  assert.equal(rejected, 0);
});

test("offset sign and magnitude do not change timestamps, ownership clocks or the declared uncertainty", async () => {
  for (const offset of [-3_600_000, -5, -1, 0, 1, 5, 3_600_000]) {
    const input = controlledClock();
    input.set(4_000_000, 4_000_001, 10, 11);
    const sample = await createSourceDatabaseClock({ clock: input.clock }).sample(async () => ({
      databaseAt: 4_000_000 + offset,
    }));
    assert.deepEqual(sample.databaseOffsetInterval, { lowerMs: offset - 2, upperMs: offset + 1 });
    assert.equal(sample.quantizationMarginMs, 1);
    assert.equal(sample.databaseAt, 4_000_000 + offset);
    assert.equal(sample.wallBefore, 4_000_000);
    assert.equal(sample.wallAfter, 4_000_001);
    assert.equal(SOURCE_DATABASE_CLOCK_POLICY.timestampAdjustment, "NONE");
    validateSourceDatabaseClockSample(JSON.parse(JSON.stringify(sample)));
  }
});

test("the complete 24-hour diagnostic clock sequence remains bounded without anchoring later offsets to zero", async () => {
  const input = controlledClock();
  const sampler = createSourceDatabaseClock({ clock: input.clock });
  let last;
  for (let index = 0; index < 4322; index++) {
    const before = 1_800_000_000_000 + index * 20000;
    input.set(before, before + 1, index * 20000, index * 20000 + 0.5);
    const offset = index % 2 === 0 ? -3 : 4;
    const sample = await sampler.sample(async () => ({ databaseAt: before + offset }));
    validateSourceDatabaseClockSample(sample, last);
    last = sample;
  }
  assert.equal(last?.absoluteAlignment, "OBSERVED_NONZERO_OFFSET");
  assert.equal(last?.financialAcceptance, false);
});

test("database and both host clock regressions reject with retained numeric proof", async () => {
  for (const boundary of ["database", "wall", "monotonic"]) {
    const input = controlledClock();
    const sampler = createSourceDatabaseClock({ clock: input.clock });
    input.set(1000, 1001, 10, 11);
    const previous = await sampler.sample(async () => ({ databaseAt: 997 }));
    input.set(boundary === "wall" ? 1000 : 1020, 1021, boundary === "monotonic" ? 10 : 30, 31);
    let saved: DatabaseClockProof | undefined;
    await assert.rejects(
      sampler.sample(
        async () => ({ databaseAt: boundary === "database" ? 996 : 1017 }),
        (proof) => {
          saved = proof;
        },
      ),
      code("CLOCK_PROOF_FAILURE"),
    );
    assert.equal(saved?.compatibility, "CLOCK_PROOF_FAILURE");
    assert.equal(previous.databaseAt, 997);
  }
});

test("nonfinite or within-RTT regressed numbers cannot qualify source clocks", async () => {
  for (const example of [
    { db: Number.NaN, before: 1000, after: 1001, monoBefore: 10, monoAfter: 11 },
    { db: 997, before: Number.NaN, after: 1001, monoBefore: 10, monoAfter: 11 },
    { db: 997, before: 1000, after: Number.POSITIVE_INFINITY, monoBefore: 10, monoAfter: 11 },
    { db: 997, before: 1000, after: 1001, monoBefore: 10, monoAfter: Number.NaN },
    { db: 997, before: 1001, after: 1000, monoBefore: 10, monoAfter: 11 },
    { db: 997, before: 1000, after: 1001, monoBefore: 11, monoAfter: 10 },
  ]) {
    const input = controlledClock();
    input.set(example.before, example.after, example.monoBefore, example.monoAfter);
    await assert.rejects(
      createSourceDatabaseClock({ clock: input.clock }).sample(async () => ({
        databaseAt: example.db,
      })),
      code("CLOCK_PROOF_FAILURE"),
    );
  }
});

test("unavailable SQL is a persistence failure, without an invented clock rejection or retry", async () => {
  const input = controlledClock();
  input.set();
  let reads = 0;
  const failure = new PilotError("PERSISTENCE_QUERY_TIMEOUT", "Controlled read failure");
  await assert.rejects(
    createSourceDatabaseClock({ clock: input.clock }).sample(async () => {
      reads++;
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(reads, 1);
});

test("an accepted returned object cannot change the retained preceding sample", async () => {
  const input = controlledClock();
  input.set(1000, 1001, 10, 11);
  const sampler = createSourceDatabaseClock({ clock: input.clock });
  const first = await sampler.sample(async () => ({ databaseAt: 997 }));
  first.databaseAt = 99_999_999;
  first.wallAfter = 99_999_999;
  input.set(1020, 1021, 30, 31);
  const next = await sampler.sample(async () => ({ databaseAt: 1017 }));
  assert.equal(next.databaseAt, 1017);
});

test("a preflight sample bridges into the same source process and concurrent probes cannot overlap", async () => {
  const input = controlledClock();
  input.set(1000, 1001, 10, 11);
  const first = await createSourceDatabaseClock({ clock: input.clock }).sample(async () => ({
    databaseAt: 997,
  }));
  const sampler = createSourceDatabaseClock({ clock: input.clock, previous: first });
  input.set(1020, 1021, 30, 31);
  let release!: () => void;
  const pending = sampler.sample(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { databaseAt: 1017 };
  });
  await assert.rejects(
    sampler.sample(async () => assert.fail("Unexpected second query")),
    code("CLOCK_PROOF_FAILURE"),
  );
  release();
  assert.equal((await pending).databaseAt, 1017);
});

test("rejected-proof persistence cannot conceal ownership loss or leak driver messages", async () => {
  for (const failure of [
    new PilotError("LEASE_LOST", "private"),
    new Error("private-driver-message"),
  ]) {
    const input = controlledClock();
    input.set(1001, 1000, 10, 11);
    await assert.rejects(
      createSourceDatabaseClock({ clock: input.clock }).sample(
        async () => ({ databaseAt: 997 }),
        () => {
          throw failure;
        },
      ),
      (error) => {
        assert.ok(error instanceof DatabaseClockSampleError);
        assert.equal(error.proof.compatibility, "CLOCK_PROOF_FAILURE");
        assert.equal(
          error.code,
          failure instanceof PilotError ? "LEASE_LOST" : "CLOCK_PROOF_FAILURE",
        );
        assert.equal(JSON.stringify(error).includes("private"), false);
        return true;
      },
    );
  }
});

test("offline source-clock validation rejects altered intervals and authority claims", async () => {
  const input = controlledClock();
  input.set();
  const sample = await createSourceDatabaseClock({ clock: input.clock }).sample(async () => ({
    databaseAt: 1000,
  }));
  for (const changed of [
    { ...sample, financialAcceptance: true },
    { ...sample, externalUTC: "VERIFIED" },
    { ...sample, databaseOffsetInterval: { lowerMs: -100, upperMs: 100 } },
    { ...sample, absoluteAlignment: "ZERO_WITHIN_RTT_INTERVAL" },
    { ...sample, policyId: "old-zero-offset-rule" },
    { ...sample, roundTripMs: 0 },
    { ...sample, process: { ...sample.process, pid: 0 } },
  ]) {
    assert.throws(() => validateSourceDatabaseClockSample(changed), code("CLOCK_PROOF_FAILURE"));
  }
  assert.throws(
    () =>
      createSourceDatabaseClock({
        previous: { ...sample, process: { ...sample.process, epochId: "different-process" } },
      }),
    code("CLOCK_PROOF_FAILURE"),
  );
  assert.throws(
    () =>
      validateSourceDatabaseClockSample(
        { ...sample, process: { ...sample.process, epochId: "different-process" } },
        sample,
      ),
    code("CLOCK_PROOF_FAILURE"),
  );
});
