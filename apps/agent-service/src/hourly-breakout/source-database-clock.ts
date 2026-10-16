import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PilotError } from "@pickler/core";
import {
  DatabaseClockSampleError,
  systemClock,
  type DatabaseClockProof,
  type OrderedClock,
} from "./clock.js";

const processClock = Object.freeze({
  pid: process.pid,
  timeOriginMs: performance.timeOrigin,
  epochId: randomUUID(),
});

/** Source J never compares a PostgreSQL lease timestamp with a host timestamp. */
export const SOURCE_DATABASE_CLOCK_POLICY = Object.freeze({
  id: "source-independent-database-clock-v1",
  sourceAuthority: "LOCAL_OS",
  leaseAuthority: "POSTGRESQL",
  offsetMeaning: "POSTGRESQL_MINUS_LOCAL_OS_FULL_RTT_INTERVAL",
  quantizationMarginMs: 1,
  requireZeroOffset: false,
  timestampAdjustment: "NONE",
  externalUTC: "UNVERIFIED",
  financialAcceptance: false,
} as const);

export interface SourceDatabaseClockSample {
  format: "hourly-breakout-source-database-clock-v2";
  policyId: typeof SOURCE_DATABASE_CLOCK_POLICY.id;
  databaseAt: number;
  wallBefore: number;
  wallAfter: number;
  monotonicBefore: number;
  monotonicAfter: number;
  roundTripMs: number;
  databaseOffsetInterval: { lowerMs: number; upperMs: number };
  quantizationMarginMs: 1;
  compatibility: "INDEPENDENT_CLOCK_DOMAINS_RECORDED";
  absoluteAlignment: "ZERO_WITHIN_RTT_INTERVAL" | "OBSERVED_NONZERO_OFFSET";
  sourceAuthority: "LOCAL_OS";
  leaseAuthority: "POSTGRESQL";
  externalUTC: "UNVERIFIED";
  financialAcceptance: false;
  process: { pid: number; timeOriginMs: number; epochId: string };
}

/** The same pure checks qualify live samples and their immutable offline journal. */
export function validateSourceDatabaseClockSample(
  value: unknown,
  previous?: SourceDatabaseClockSample,
): asserts value is SourceDatabaseClockSample {
  const sample = value as SourceDatabaseClockSample;
  if (
    sample?.format !== "hourly-breakout-source-database-clock-v2" ||
    sample.policyId !== SOURCE_DATABASE_CLOCK_POLICY.id ||
    sample.compatibility !== "INDEPENDENT_CLOCK_DOMAINS_RECORDED" ||
    sample.sourceAuthority !== "LOCAL_OS" ||
    sample.leaseAuthority !== "POSTGRESQL" ||
    sample.externalUTC !== "UNVERIFIED" ||
    sample.financialAcceptance !== false ||
    !Number.isSafeInteger(sample.process?.pid) ||
    sample.process.pid <= 0 ||
    !Number.isFinite(sample.process.timeOriginMs) ||
    typeof sample.process.epochId !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(sample.process.epochId) ||
    sample.quantizationMarginMs !== 1 ||
    ![
      sample.databaseAt,
      sample.wallBefore,
      sample.wallAfter,
      sample.monotonicBefore,
      sample.monotonicAfter,
      sample.roundTripMs,
      sample.databaseOffsetInterval?.lowerMs,
      sample.databaseOffsetInterval?.upperMs,
    ].every(Number.isFinite) ||
    sample.wallAfter < sample.wallBefore ||
    sample.monotonicAfter < sample.monotonicBefore ||
    sample.roundTripMs !== sample.monotonicAfter - sample.monotonicBefore ||
    sample.databaseOffsetInterval.lowerMs !== sample.databaseAt - sample.wallAfter - 1 ||
    sample.databaseOffsetInterval.upperMs !== sample.databaseAt - sample.wallBefore + 1 ||
    sample.absoluteAlignment !==
      (sample.databaseOffsetInterval.lowerMs <= 0 && sample.databaseOffsetInterval.upperMs >= 0
        ? "ZERO_WITHIN_RTT_INTERVAL"
        : "OBSERVED_NONZERO_OFFSET") ||
    (previous &&
      (sample.databaseAt < previous.databaseAt ||
        sample.wallBefore < previous.wallAfter ||
        sample.monotonicBefore < previous.monotonicAfter ||
        sample.process.pid !== previous.process.pid ||
        sample.process.timeOriginMs !== previous.process.timeOriginMs ||
        sample.process.epochId !== previous.process.epochId))
  ) {
    throw new PilotError("CLOCK_PROOF_FAILURE", "Independent source clock evidence is invalid");
  }
}

export function createSourceDatabaseClock(
  options: {
    clock?: OrderedClock;
    previous?: SourceDatabaseClockSample;
  } = {},
) {
  const clock = options.clock ?? systemClock;
  let previous = options.previous ? structuredClone(options.previous) : undefined;
  if (previous) {
    validateSourceDatabaseClockSample(previous);
    if (
      previous.process.pid !== processClock.pid ||
      previous.process.timeOriginMs !== processClock.timeOriginMs ||
      previous.process.epochId !== processClock.epochId
    ) {
      throw new PilotError("CLOCK_PROOF_FAILURE", "Source preflight belongs to another process");
    }
  }
  let active = false;
  return {
    async sample(
      read: () => Promise<{ databaseAt: number }>,
      onRejected?: (proof: DatabaseClockProof) => void | Promise<void>,
    ): Promise<SourceDatabaseClockSample> {
      if (active) {
        throw new PilotError("CLOCK_PROOF_FAILURE", "Concurrent source clock sampling is invalid");
      }
      active = true;
      try {
        const monotonicBefore = clock.monotonic();
        const wallBefore = clock.wall();
        const { databaseAt } = await read();
        const wallAfter = clock.wall();
        const monotonicAfter = clock.monotonic();
        const databaseOffsetInterval = {
          lowerMs: databaseAt - wallAfter - 1,
          upperMs: databaseAt - wallBefore + 1,
        };
        const sample: SourceDatabaseClockSample = {
          format: "hourly-breakout-source-database-clock-v2",
          policyId: SOURCE_DATABASE_CLOCK_POLICY.id,
          databaseAt,
          wallBefore,
          wallAfter,
          monotonicBefore,
          monotonicAfter,
          roundTripMs: monotonicAfter - monotonicBefore,
          databaseOffsetInterval,
          quantizationMarginMs: 1,
          compatibility: "INDEPENDENT_CLOCK_DOMAINS_RECORDED",
          absoluteAlignment:
            databaseOffsetInterval.lowerMs <= 0 && databaseOffsetInterval.upperMs >= 0
              ? "ZERO_WITHIN_RTT_INTERVAL"
              : "OBSERVED_NONZERO_OFFSET",
          sourceAuthority: "LOCAL_OS",
          leaseAuthority: "POSTGRESQL",
          externalUTC: "UNVERIFIED",
          financialAcceptance: false,
          process: { ...processClock },
        };
        try {
          validateSourceDatabaseClockSample(sample, previous);
        } catch {
          const finite = (value: number) => (Number.isFinite(value) ? value : null);
          const proof: DatabaseClockProof = {
            format: "hourly-breakout-database-clock-proof-v1",
            databaseAt: finite(databaseAt),
            wallBefore: finite(wallBefore),
            wallAfter: finite(wallAfter),
            monotonicBefore: finite(monotonicBefore),
            monotonicAfter: finite(monotonicAfter),
            roundTripMs: finite(sample.roundTripMs),
            databaseOffsetInterval:
              Number.isFinite(databaseOffsetInterval.lowerMs) &&
              Number.isFinite(databaseOffsetInterval.upperMs)
                ? { ...databaseOffsetInterval }
                : null,
            quantizationMarginMs: 1,
            compatibility: "CLOCK_PROOF_FAILURE",
          };
          let proofPersistenceCode: string | undefined;
          try {
            await onRejected?.(structuredClone(proof));
          } catch (error) {
            proofPersistenceCode =
              error instanceof PilotError && /^[A-Z0-9_]{1,80}$/.test(error.code)
                ? error.code
                : "BREAKOUT_CLOCK_PROOF_WRITE_FAILED";
          }
          throw new DatabaseClockSampleError(proof, proofPersistenceCode);
        }
        previous = structuredClone(sample);
        return sample;
      } finally {
        active = false;
      }
    },
  };
}
