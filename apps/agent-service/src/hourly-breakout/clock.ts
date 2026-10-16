import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PilotError } from "@pickler/core";
import type {
  BreakoutBoundaryKind,
  BreakoutClockBoundary,
  BreakoutClockCertificate,
  BreakoutFinancialRole,
  BreakoutFinancialReceiptContext,
  BreakoutFinancialReceiptHooks,
  BreakoutAcknowledgement,
} from "@pickler/trading/evaluation";

export interface OrderedClock {
  wall(): number;
  monotonic(): number;
}

export interface BreakoutClockRecord {
  boundary: BreakoutClockBoundary;
  certificate: BreakoutClockCertificate;
  ordered: {
    monotonicBefore: number;
    wallBefore: number;
    wallAfter: number;
    monotonicAfter: number;
  };
  authority: "LOCAL_OS";
  externalUTC: "UNVERIFIED";
  financialReadiness: "NOT_ACCEPTED";
  observedBounds: BreakoutClockCertificate["measuredBounds"];
  process: { pid: number; timeOriginMs: number; epochId: string; nodeVersion: string };
}

export interface ClockAcceptance {
  accepted: boolean;
  provenance: readonly string[];
}

export const systemClock: OrderedClock = {
  wall: Date.now,
  monotonic: () => performance.now(),
};

/** Bounded conservative seen index. False positives reject; no seen original can advance V. */
class OriginalReceiptIndex {
  private readonly bits = new Uint8Array(8 * 1024 * 1024);
  private positions(key: string) {
    const hash = createHash("sha256").update(key).digest();
    return Array.from({ length: 8 }, (_, i) => hash.readUInt32LE(i * 4) % (this.bits.length * 8));
  }
  seen(key: string) {
    return this.positions(key).every(
      (position) => (this.bits[position >>> 3]! & (1 << (position & 7))) !== 0,
    );
  }
  add(key: string) {
    for (const position of this.positions(key)) {
      this.bits[position >>> 3] = this.bits[position >>> 3]! | (1 << (position & 7));
    }
  }
}

class ReceiptMemory<T> {
  private readonly recent = new Map<string, T>();
  constructor(
    private readonly index: OriginalReceiptIndex,
    private readonly prefix: string,
    private readonly capacity = 512,
  ) {}
  get(key: string): T | undefined {
    if (this.recent.has(key)) {
      return this.recent.get(key);
    }
    if (this.index.seen(`${this.prefix}:${key}`)) {
      throw new PilotError(
        "ORIGINAL_RECEIPT_UNAVAILABLE",
        "Original evicted receipt cannot be resampled or advanced",
      );
    }
    return undefined;
  }
  set(key: string, value: T) {
    this.index.add(`${this.prefix}:${key}`);
    this.recent.set(key, value);
    if (this.recent.size > this.capacity) {
      this.recent.delete(this.recent.keys().next().value!);
    }
  }
}

/** Measurements are empirical local resolution evidence, never an external UTC claim. */
export function measureLocalClock(clock: OrderedClock = systemClock, count = 256) {
  let wallStep = Number.POSITIVE_INFINITY;
  let monotonicStep = Number.POSITIVE_INFINITY;
  let beforeWall = clock.wall();
  let beforeMono = clock.monotonic();
  for (let i = 0; i < count; i++) {
    const mono = clock.monotonic();
    const wall = clock.wall();
    if (wall < beforeWall || mono < beforeMono) {
      throw new PilotError("CLOCK_PROOF_FAILURE", "Clock regressed during local measurement");
    }
    if (wall > beforeWall) {
      wallStep = Math.min(wallStep, wall - beforeWall);
    }
    if (mono > beforeMono) {
      monotonicStep = Math.min(monotonicStep, mono - beforeMono);
    }
    beforeWall = wall;
    beforeMono = mono;
  }
  // Date.now has integer milliseconds. No observed tick means its documented quantization is
  // retained explicitly, rather than asserting measured zero uncertainty.
  return {
    samples: count,
    wallQuantumMs: Number.isFinite(wallStep) ? Math.max(1, wallStep) : 1,
    wallTickObserved: Number.isFinite(wallStep),
    monotonicQuantumMs: Number.isFinite(monotonicStep) ? monotonicStep : 0.001,
    monotonicTickObserved: Number.isFinite(monotonicStep),
    source: "NODE_DATE_NOW_INTEGER_MS_AND_PERFORMANCE_NOW_EMPIRICAL" as const,
  };
}

export type BoundaryInput = {
  kind: BreakoutBoundaryKind;
  operationId: string;
  accountRole?: BreakoutFinancialRole;
  marketId?: number;
  marketIds?: readonly number[];
  acceptedRecords?: readonly { marketId: number; recordId: string; sourceIdentity: string }[];
  sourceIdentity?: string;
  authoritativeRecordId?: string;
  acceptedProof?: boolean;
};

export function createBoundaryClock(options: {
  clock?: OrderedClock;
  appendAndSync(record: BreakoutClockRecord): void;
  acceptance?: ClockAcceptance;
  epochId?: string;
  scope?: "source-local" | "financial-valuation";
  /** A future operator-approved immutable financial certificate, never a source certificate. */
  certificate?: BreakoutClockCertificate;
}) {
  const clock = options.clock ?? systemClock;
  const measurement = measureLocalClock(clock);
  const epochId = options.epochId ?? randomUUID();
  const compatibilityId = `local-os-paired:${epochId}`;
  const acceptedCertificate = options.certificate
    ? structuredClone(options.certificate)
    : undefined;
  if (
    acceptedCertificate &&
    (options.scope !== "financial-valuation" ||
      acceptedCertificate.scope !== "financial-valuation" ||
      !acceptedCertificate.accepted ||
      !options.acceptance?.accepted ||
      acceptedCertificate.epochId !== epochId ||
      !acceptedCertificate.id ||
      !acceptedCertificate.compatibilityId ||
      !acceptedCertificate.provenance.length ||
      !Number.isFinite(acceptedCertificate.validFromMs) ||
      !Number.isFinite(acceptedCertificate.validUntilMs) ||
      acceptedCertificate.validUntilMs <= acceptedCertificate.validFromMs ||
      !Object.values(acceptedCertificate.measuredBounds).every(
        (n) => Number.isFinite(n) && n >= 0,
      ) ||
      acceptedCertificate.measuredBounds.quantizationMs <= 0 ||
      acceptedCertificate.measuredBounds.resolutionMs <= 0)
  ) {
    throw new PilotError(
      "CLOCK_PROOF_FAILURE",
      "An immutable preaccepted financial clock certificate is required",
    );
  }
  let sequence = 0;
  let last: BreakoutClockRecord | undefined;

  function sample<T>(
    input: BoundaryInput,
    boundary: () => T,
  ): {
    value: T;
    record: BreakoutClockRecord;
  } {
    // This ordering must stay synchronous. No await, callback scheduling, database operation,
    // serialization or journal write belongs inside the five reads surrounding the boundary.
    const monotonicBefore = clock.monotonic();
    const wallBefore = clock.wall();
    const value = boundary();
    const wallAfter = clock.wall();
    const monotonicAfter = clock.monotonic();
    if (
      wallAfter < wallBefore ||
      monotonicAfter < monotonicBefore ||
      (last &&
        (wallBefore < last.ordered.wallAfter || monotonicBefore < last.ordered.monotonicAfter))
    ) {
      throw new PilotError("CLOCK_PROOF_FAILURE", "Ordered paired clock regressed");
    }
    const wallQuantum = Math.max(
      measurement.wallQuantumMs,
      acceptedCertificate?.measuredBounds.quantizationMs ?? 0,
    );
    const monoQuantum = Math.max(
      Number.EPSILON,
      measurement.monotonicQuantumMs,
      acceptedCertificate?.measuredBounds.resolutionMs ?? 0,
    );
    const bracketMs = monotonicAfter - monotonicBefore;
    const mappingUncertaintyMs = Math.max(monoQuantum, bracketMs + wallQuantum);
    const offsetBefore = wallBefore - monotonicBefore;
    const offsetAfter = wallAfter - monotonicAfter;
    const driftBoundMs = Math.max(
      monoQuantum,
      Math.abs(offsetAfter - offsetBefore),
      last ? Math.abs(offsetBefore - (last.ordered.wallAfter - last.ordered.monotonicAfter)) : 0,
    );
    const observedBounds: BreakoutClockCertificate["measuredBounds"] = {
      quantizationMs: measurement.wallQuantumMs,
      resolutionMs: measurement.monotonicQuantumMs,
      mappingUncertaintyMs,
      offsetBoundMs: Math.max(monoQuantum, Math.abs(offsetAfter - offsetBefore) + wallQuantum),
      driftBoundMs,
    };
    if (
      acceptedCertificate &&
      (wallBefore - wallQuantum < acceptedCertificate.validFromMs ||
        wallAfter + wallQuantum > acceptedCertificate.validUntilMs ||
        Object.entries(observedBounds).some(
          ([key, measured]) =>
            measured > acceptedCertificate.measuredBounds[key as keyof typeof observedBounds],
        ))
    ) {
      throw new PilotError(
        "CLOCK_PROOF_FAILURE",
        "Actual paired-clock bounds exceed the preaccepted financial certificate",
      );
    }
    if (
      bracketMs > 1000 ||
      Math.abs(wallAfter - wallBefore - bracketMs) > 1000 ||
      (last &&
        Math.abs(
          wallBefore - last.ordered.wallAfter - (monotonicBefore - last.ordered.monotonicAfter),
        ) > 1000)
    ) {
      throw new PilotError("CLOCK_PROOF_FAILURE", "One-second paired clock guard failed");
    }
    const id = `${epochId}:${sequence++}`;
    const certificate: BreakoutClockCertificate = acceptedCertificate
      ? structuredClone(acceptedCertificate)
      : {
          id: `certificate:${id}`,
          scope: options.scope ?? "source-local",
          epochId,
          compatibilityId,
          validFromMs: wallBefore - wallQuantum,
          validUntilMs: wallAfter + wallQuantum,
          accepted: options.acceptance?.accepted ?? false,
          measuredBounds: observedBounds,
          provenance: [
            measurement.source,
            `EMPIRICAL_SAMPLES:${measurement.samples}`,
            "ORDER:MONO_BEFORE,WALL_BEFORE,BOUNDARY,WALL_AFTER,MONO_AFTER",
            "AUTHORITY:LOCAL_OS",
            "EXTERNAL_UTC:UNVERIFIED",
            "FINANCIAL_READINESS:NOT_ACCEPTED",
            ...(options.acceptance?.provenance ?? []),
          ],
        };
    const record: BreakoutClockRecord = {
      boundary: {
        id,
        ...input,
        certificateId: certificate.id,
        epochId,
        financial: {
          lowerMs: wallBefore - wallQuantum,
          upperMs: wallAfter + wallQuantum,
        },
        monotonic: {
          lowerMs: monotonicBefore - monoQuantum,
          upperMs: monotonicAfter + monoQuantum,
        },
      },
      certificate,
      ordered: { monotonicBefore, wallBefore, wallAfter, monotonicAfter },
      authority: "LOCAL_OS",
      externalUTC: "UNVERIFIED",
      financialReadiness: "NOT_ACCEPTED",
      observedBounds,
      process: {
        pid: process.pid,
        timeOriginMs: performance.timeOrigin,
        epochId,
        nodeVersion: process.version,
      },
    };
    options.appendAndSync(record);
    last = record;
    return { value, record };
  }

  function shared(input: BoundaryInput, original: BreakoutClockRecord) {
    const record: BreakoutClockRecord = {
      ...original,
      boundary: {
        ...original.boundary,
        ...input,
        id: `${original.boundary.id}:role:${input.accountRole ?? "source"}:market:${input.marketId ?? "joint"}`,
      },
    };
    options.appendAndSync(record);
    return record;
  }

  return { sample, shared, measurement, epochId };
}

/** Exact infrastructure hook port: synchronous journal fsync precedes the adapter's callback. */
export function createFinancialReceiptHooks(options: {
  clock: ReturnType<typeof createBoundaryClock>;
  getSourceIdentity(context: BreakoutFinancialReceiptContext): string;
  guard(): void;
}): BreakoutFinancialReceiptHooks {
  const index = new OriginalReceiptIndex();
  const anchors = new ReceiptMemory<BreakoutClockBoundary>(index, "anchors");
  const receipts = new ReceiptMemory<BreakoutClockBoundary>(index, "receipts");
  const receiptContexts = new ReceiptMemory<string>(index, "receipt-contexts");
  const outerCommits = new ReceiptMemory<BreakoutClockRecord>(index, "outer-commits");
  const acknowledgements = new ReceiptMemory<BreakoutAcknowledgement>(index, "acknowledgements");
  function input(
    context: BreakoutFinancialReceiptContext,
    kind: BreakoutBoundaryKind,
  ): BoundaryInput {
    options.guard();
    const sourceIdentity = options.getSourceIdentity(context);
    if (
      !sourceIdentity ||
      !context.marketIds.length ||
      new Set(context.marketIds).size !== context.marketIds.length ||
      context.marketIds.some((id) => !Number.isSafeInteger(id) || id < 0)
    ) {
      throw new PilotError(
        "RECEIPT_PROOF_UNAVAILABLE",
        "Exact original source and market proof required",
      );
    }
    return {
      kind,
      operationId: context.operationId,
      accountRole: context.role,
      marketIds: context.marketIds,
      acceptedRecords: context.marketIds.map((marketId) => ({
        marketId,
        recordId: context.authoritativeRecordId,
        sourceIdentity,
      })),
      sourceIdentity,
      authoritativeRecordId: context.authoritativeRecordId,
      acceptedProof: true,
    };
  }
  return {
    beforeEffect(context) {
      const boundaryInput = input(context, "A_BEFORE_EFFECT");
      const key = `${context.operationId}:${context.role}:${context.action}`;
      if (anchors.get(key)) {
        throw new PilotError(
          "BREAKOUT_DUPLICATE_EFFECT",
          "Original financial phase cannot be retried",
        );
      }
      const { record } = options.clock.sample(boundaryInput, () => undefined);
      anchors.set(key, record.boundary);
      return record.boundary;
    },
    afterCommit(context) {
      const boundaryInput = input(context, context.action === "FULL_CLOSE" ? "V_CLOSE" : "V");
      const key = `${context.operationId}:${context.role}:${context.action}`;
      const identity = JSON.stringify([context, boundaryInput.sourceIdentity]);
      const previous = receipts.get(key);
      if (previous) {
        if (receiptContexts.get(key) !== identity) {
          throw new PilotError(
            "BREAKOUT_DUPLICATE_RECEIPT",
            "First original financial receipt changed",
          );
        }
        return previous;
      }
      const outerKey = `${context.operationId}:${context.authoritativeRecordId}`;
      const common = outerCommits.get(outerKey);
      const record = common
        ? options.clock.shared(boundaryInput, common)
        : options.clock.sample(boundaryInput, () => undefined).record;
      outerCommits.set(outerKey, common ?? record);
      receipts.set(key, record.boundary);
      receiptContexts.set(key, identity);
      const acknowledgement = acknowledgements.get(context.operationId);
      const valuationReceipts = [...(acknowledgement?.valuationReceipts ?? []), record.boundary];
      acknowledgements.set(context.operationId, {
        operationId: context.operationId,
        authoritativeRecordId: context.authoritativeRecordId,
        receivedAt: common?.ordered.wallAfter ?? record.ordered.wallAfter,
        receiptStatus: "QUALIFIED",
        receipt: acknowledgement?.receipt ?? record.boundary,
        valuationReceipts,
      });
      return record.boundary;
    },
    getAcknowledgement(operationId) {
      try {
        return acknowledgements.get(operationId) ?? null;
      } catch (error) {
        if (error instanceof PilotError && error.code === "ORIGINAL_RECEIPT_UNAVAILABLE") {
          return null;
        }
        throw error;
      }
    },
  };
}

export interface DefinitiveFinancialReceipt {
  operationId: string;
  role: BreakoutFinancialRole;
  authoritativeRecordId: string;
  sourceIdentity: string;
  acceptedMarkets: readonly number[];
  outcome: "COMMIT_ACK" | "FULL_CLOSE_ACK" | "WHOLE_ROLLBACK_ACK";
  ownershipValid: true;
  valuationRiskProofValid: true;
}

/** A source callback is deliberately insufficient to create a V record. */
export function createFinancialReceiptRecorder(clock: ReturnType<typeof createBoundaryClock>) {
  const index = new OriginalReceiptIndex();
  const first = new ReceiptMemory<BreakoutClockBoundary>(index, "first");
  const anchors = new ReceiptMemory<BreakoutClockBoundary>(index, "anchors");
  let ownerLost = false;
  function active() {
    if (ownerLost) {
      throw new PilotError("LEASE_LOST", "Lost financial owner cannot record or retry effects");
    }
  }
  return {
    loseOwner() {
      ownerLost = true;
    },
    beforeOpening(input: {
      operationId: string;
      role: BreakoutFinancialRole;
      marketId: number;
      sourceIdentity: string;
    }): BreakoutClockBoundary {
      active();
      const key = `${input.role}:${input.marketId}:${input.operationId}`;
      if (anchors.get(key)) {
        throw new PilotError("BREAKOUT_DUPLICATE_EFFECT", "An original opening cannot be retried");
      }
      const { record } = clock.sample(
        {
          kind: "A_BEFORE_EFFECT",
          operationId: input.operationId,
          accountRole: input.role,
          marketId: input.marketId,
          sourceIdentity: input.sourceIdentity,
          acceptedProof: true,
        },
        () => undefined,
      );
      anchors.set(key, record.boundary);
      return record.boundary;
    },
    definitive(receipt: DefinitiveFinancialReceipt, callback?: () => void) {
      active();
      if (
        !receipt.operationId ||
        !receipt.authoritativeRecordId ||
        !receipt.sourceIdentity ||
        !receipt.ownershipValid ||
        !receipt.valuationRiskProofValid ||
        !receipt.acceptedMarkets.length ||
        new Set(receipt.acceptedMarkets).size !== receipt.acceptedMarkets.length
      ) {
        throw new PilotError(
          "GAP_COMPLIANCE_UNPROVED",
          "Exact authoritative per-market proof required",
        );
      }
      if (receipt.outcome === "WHOLE_ROLLBACK_ACK") {
        throw new PilotError("BREAKOUT_ROLLBACK_NOT_VALUATION", "Rollback cannot be recorded as V");
      }
      const boundaries: BreakoutClockBoundary[] = [];
      let common: BreakoutClockRecord | undefined;
      for (const marketId of receipt.acceptedMarkets) {
        const key = `${receipt.role}:${marketId}:${receipt.operationId}`;
        const previous = first.get(key);
        if (previous) {
          if (previous.authoritativeRecordId !== receipt.authoritativeRecordId) {
            throw new PilotError("BREAKOUT_DUPLICATE_RECEIPT", "Original receipt identity changed");
          }
          boundaries.push(previous);
          continue;
        }
        const input: BoundaryInput = {
          kind: receipt.outcome === "FULL_CLOSE_ACK" ? "V_CLOSE" : "V",
          operationId: receipt.operationId,
          accountRole: receipt.role,
          marketId,
          sourceIdentity: receipt.sourceIdentity,
          authoritativeRecordId: receipt.authoritativeRecordId,
          acceptedProof: true,
        };
        const record: BreakoutClockRecord = common
          ? clock.shared(input, common)
          : clock.sample(input, () => undefined).record;
        common ??= record;
        first.set(key, record.boundary);
        boundaries.push(record.boundary);
      }
      callback?.();
      return boundaries;
    },
  };
}

export interface DatabaseClockProof {
  format: "hourly-breakout-database-clock-proof-v1";
  databaseAt: number | null;
  wallBefore: number | null;
  wallAfter: number | null;
  monotonicBefore: number | null;
  monotonicAfter: number | null;
  roundTripMs: number | null;
  databaseOffsetInterval: { lowerMs: number; upperMs: number } | null;
  quantizationMarginMs: 1;
  compatibility: "LOCAL_OS_INTERVAL_COMPATIBLE" | "CLOCK_INCOMPATIBLE" | "CLOCK_PROOF_FAILURE";
}

/** Keep the rejected numbers inspectable even if writing their journal also fails. */
export class DatabaseClockSampleError extends PilotError {
  constructor(
    readonly proof: DatabaseClockProof,
    readonly proofPersistenceCode?: string,
  ) {
    super(
      proofPersistenceCode === "LEASE_LOST" ? "LEASE_LOST" : proof.compatibility,
      proof.compatibility === "CLOCK_INCOMPATIBLE"
        ? "Database time lies outside the complete local RTT interval"
        : "Database clock RTT proof is invalid",
    );
  }
}

/** Preserve the complete host send/receive RTT, including query/queue delays. */
export async function sampleDatabaseClock(
  sample: () => Promise<{ databaseAt: number }>,
  clock: OrderedClock = systemClock,
  onRejected?: (proof: DatabaseClockProof) => void | Promise<void>,
) {
  const monotonicBefore = clock.monotonic();
  const wallBefore = clock.wall();
  const { databaseAt } = await sample();
  const wallAfter = clock.wall();
  const monotonicAfter = clock.monotonic();
  const databaseOffsetInterval = {
    lowerMs: databaseAt - wallAfter - 1,
    upperMs: databaseAt - wallBefore + 1,
  };
  const roundTripMs = monotonicAfter - monotonicBefore;
  const validNumbers = [
    databaseAt,
    wallBefore,
    wallAfter,
    monotonicBefore,
    monotonicAfter,
    roundTripMs,
    databaseOffsetInterval.lowerMs,
    databaseOffsetInterval.upperMs,
  ].every(Number.isFinite);
  const invalidProof = !validNumbers || wallAfter < wallBefore || monotonicAfter < monotonicBefore;
  const incompatible = databaseOffsetInterval.lowerMs > 0 || databaseOffsetInterval.upperMs < 0;
  if (invalidProof || incompatible) {
    const finite = (value: number) => (Number.isFinite(value) ? value : null);
    const proof: DatabaseClockProof = {
      format: "hourly-breakout-database-clock-proof-v1",
      databaseAt: finite(databaseAt),
      wallBefore: finite(wallBefore),
      wallAfter: finite(wallAfter),
      monotonicBefore: finite(monotonicBefore),
      monotonicAfter: finite(monotonicAfter),
      roundTripMs: finite(roundTripMs),
      databaseOffsetInterval:
        Number.isFinite(databaseOffsetInterval.lowerMs) &&
        Number.isFinite(databaseOffsetInterval.upperMs)
          ? { ...databaseOffsetInterval }
          : null,
      quantizationMarginMs: 1,
      compatibility: invalidProof ? "CLOCK_PROOF_FAILURE" : "CLOCK_INCOMPATIBLE",
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
  return {
    databaseAt,
    wallBefore,
    wallAfter,
    monotonicBefore,
    monotonicAfter,
    roundTripMs,
    databaseOffsetInterval,
    compatibility: "LOCAL_OS_INTERVAL_COMPATIBLE" as const,
  };
}
