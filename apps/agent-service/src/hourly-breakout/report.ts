import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { PilotError } from "@pickler/core";
import type { PerpsPaperFrame } from "@pickler/trading/perps";
import {
  compareBreakoutBoundaries,
  assertHourlyBreakoutConfig,
  type PerpsHourlyBreakoutConfig,
} from "@pickler/trading/evaluation";
import type { BreakoutClockRecord, DatabaseClockProof } from "./clock.js";
import { qualifySourceFrames, type SourceQualificationFailure } from "./source-qualification.js";
import {
  SOURCE_DATABASE_CLOCK_POLICY,
  validateSourceDatabaseClockSample,
  type SourceDatabaseClockSample,
} from "./source-database-clock.js";
import {
  BREAKOUT_BYTES,
  boundedJson,
  bytesHash,
  digest,
  type ArtifactWriter,
  type JournalPart,
} from "./files.js";
import { CAPTURE_GRID, sourceWindowAt, type CaptureWindow, type PumpStatus } from "./schedule.js";

export interface PumpRecord {
  kind: "pump";
  window: CaptureWindow;
  status: PumpStatus;
  completedAt: number | null;
  qualifiedMarketIds: number[];
  qualificationFailures?: SourceQualificationFailure[];
  commonPreparedMarketIds: number[];
  preparedHash: string | null;
  sourceHash: string | null;
  code: string | null;
  original?: unknown;
  copyReceipt?: BreakoutClockRecord;
}

export interface SourceManifest {
  format: "hourly-breakout-source-capture-v1";
  protocol: "perps-hourly-breakout-fixed-screen-v1";
  version: 10;
  config: PerpsHourlyBreakoutConfig;
  configHash: string;
  captureCommit: string;
  frozen: {
    preflightCompletedAt: number;
    startsAt: number;
    endsAt: number;
    crossesUTCRollover: boolean;
  };
  processState: "running" | "completed" | "interrupted";
  failureCode: string | null;
  databaseClockPolicy?: typeof SOURCE_DATABASE_CLOCK_POLICY;
  databaseClockPolicyHash?: string;
  clockFailure?: { proof: DatabaseClockProof; proofPersistenceCode: string | null };
  journals: {
    snapshots: JournalPart[];
    clocks: JournalPart[];
    prepared: JournalPart[];
    versions: JournalPart[];
    wire: JournalPart[];
    http: JournalPart[];
    control: JournalPart[];
  };
  wire: {
    truncated: boolean;
    retainedBytes: number;
    maximumBytes: number;
    firstOmittedAt: number | null;
  };
  coldStart: {
    firstAttemptAt: number | null;
    metadataAndWebSocketReadyAt: number | null;
    within20Seconds: boolean | null;
  };
  artifactBudget: { usedBytes: number; reservedBytes: number; limitBytes: number };
  authority: {
    scope: "source-local";
    clockAuthority: "LOCAL_OS";
    externalUTC: "UNVERIFIED";
    financialAcceptance: false;
  };
  databaseCounts: {
    accounts: 0;
    positions: 0;
    attempts: 0;
    reservations: 0;
    funding: 0;
    financialV: 0;
  };
  modelCalls: 0;
  newReservations: 0;
  cleanup: { socketClosed: boolean; leaseReleased: boolean; poolClosed: boolean };
  stopMarkerReservedBytes?: 14;
}

export function validateSourceManifest(value: unknown): asserts value is SourceManifest {
  const manifest = value as SourceManifest;
  assertHourlyBreakoutConfig(manifest?.config);
  if (
    manifest?.format !== "hourly-breakout-source-capture-v1" ||
    manifest.protocol !== "perps-hourly-breakout-fixed-screen-v1" ||
    manifest.version !== 10 ||
    manifest.configHash !== digest(manifest.config) ||
    manifest.config?.financiallyExecutable !== false ||
    manifest.config?.enabled !== false ||
    manifest.config?.T0 !== null ||
    manifest.config?.operator !== null ||
    manifest.frozen?.endsAt - manifest.frozen?.startsAt !== CAPTURE_GRID.durationMs ||
    !Number.isSafeInteger(manifest.frozen?.startsAt) ||
    !Number.isSafeInteger(manifest.frozen?.endsAt) ||
    !Number.isSafeInteger(manifest.frozen?.preflightCompletedAt) ||
    manifest.frozen.startsAt < manifest.frozen.preflightCompletedAt + 120000 ||
    manifest.frozen.startsAt % 60000 !== 0 ||
    manifest.frozen.startsAt % 86400000 === 0 ||
    manifest.authority?.scope !== "source-local" ||
    manifest.authority.financialAcceptance !== false ||
    manifest.modelCalls !== 0 ||
    manifest.newReservations !== 0 ||
    !manifest.journals ||
    ["accounts", "positions", "attempts", "reservations", "funding", "financialV"].some(
      (key) => manifest.databaseCounts?.[key as keyof SourceManifest["databaseCounts"]] !== 0,
    )
  ) {
    throw new PilotError(
      "BREAKOUT_SOURCE_INVALID",
      "Nonfinancial source manifest identity is invalid",
    );
  }
  if (manifest.clockFailure) {
    const { proof, proofPersistenceCode } = manifest.clockFailure;
    if (
      proof?.format !== "hourly-breakout-database-clock-proof-v1" ||
      !["CLOCK_INCOMPATIBLE", "CLOCK_PROOF_FAILURE"].includes(proof.compatibility) ||
      proof.quantizationMarginMs !== 1 ||
      [
        proof.databaseAt,
        proof.wallBefore,
        proof.wallAfter,
        proof.monotonicBefore,
        proof.monotonicAfter,
        proof.roundTripMs,
      ].some((value) => value !== null && !Number.isFinite(value)) ||
      (proof.databaseOffsetInterval !== null &&
        (!Number.isFinite(proof.databaseOffsetInterval?.lowerMs) ||
          !Number.isFinite(proof.databaseOffsetInterval?.upperMs))) ||
      (proofPersistenceCode !== null && !/^[A-Z0-9_]{1,80}$/.test(proofPersistenceCode))
    ) {
      throw new PilotError("BREAKOUT_SOURCE_INVALID", "Rejected database clock proof is invalid");
    }
  }
  if (
    (manifest.databaseClockPolicy !== undefined ||
      manifest.databaseClockPolicyHash !== undefined) &&
    (!manifest.databaseClockPolicy ||
      manifest.databaseClockPolicyHash !== digest(SOURCE_DATABASE_CLOCK_POLICY) ||
      digest(manifest.databaseClockPolicy) !== manifest.databaseClockPolicyHash)
  ) {
    throw new PilotError("BREAKOUT_SOURCE_INVALID", "Source database clock policy is invalid");
  }
  let total = 0;
  const seen = new Set<string>();
  for (const [group, parts] of Object.entries(manifest.journals)) {
    if (
      !["snapshots", "clocks", "prepared", "versions", "wire", "http", "control"].includes(group) ||
      !Array.isArray(parts)
    ) {
      throw new PilotError("BREAKOUT_SOURCE_INVALID", "Source journal group is invalid");
    }
    for (const part of parts) {
      safePart(part);
      if (!part.file.startsWith(`${group}-`) || seen.has(part.file)) {
        throw new PilotError(
          "BREAKOUT_SOURCE_INVALID",
          "Source journal part group or identity differs",
        );
      }
      seen.add(part.file);
      total += part.bytes;
    }
  }
  if (total > BREAKOUT_BYTES.all) {
    throw new PilotError(
      "BREAKOUT_ARTIFACT_LIMIT",
      "Original source parts exceed all-artifact ceiling",
    );
  }
}

export async function readSourceManifest(path: string) {
  const manifest = await boundedJson(resolve(path), 4 * 1024 * 1024);
  validateSourceManifest(manifest);
  return manifest;
}

function safePart(part: JournalPart) {
  if (
    !/^(snapshots|clocks|prepared|versions|wire|http|control)-[0-9]{6}\.jsonl$/.test(part.file) ||
    !Number.isSafeInteger(part.bytes) ||
    part.bytes < 1 ||
    part.bytes > BREAKOUT_BYTES.part ||
    !Number.isSafeInteger(part.records) ||
    part.records < 1 ||
    !/^[0-9a-f]{64}$/.test(part.sha256)
  ) {
    throw new PilotError("BREAKOUT_UNSAFE_PATH", "Source part identity is not bounded");
  }
}

/** Hash only the frozen prefix; a concurrent immutable journal may append beyond that prefix. */
export async function* readJournal(root: string, parts: readonly JournalPart[]) {
  const seen = new Set<string>();
  for (const part of parts) {
    safePart(part);
    if (seen.has(part.file)) {
      throw new PilotError("BREAKOUT_SOURCE_INVALID", "Duplicate source part");
    }
    seen.add(part.file);
    const path = join(root, part.file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < part.bytes) {
      throw new PilotError("BREAKOUT_SOURCE_INVALID", "Original source prefix is unavailable");
    }
    const hash = createHash("sha256");
    const stream = createReadStream(path, { start: 0, end: part.bytes - 1 });
    stream.on("data", (chunk) => hash.update(chunk));
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let records = 0;
    try {
      for await (const line of lines) {
        if (!line || Buffer.byteLength(line) >= BREAKOUT_BYTES.part) {
          throw new PilotError("BREAKOUT_SOURCE_INVALID", "Original source record is not bounded");
        }
        records++;
        yield JSON.parse(line) as Record<string, unknown>;
      }
    } finally {
      lines.close();
      stream.destroy();
    }
    if (hash.digest("hex") !== part.sha256 || records !== part.records) {
      throw new PilotError(
        "BREAKOUT_HASH_MISMATCH",
        "Original source prefix bytes or count differ",
      );
    }
  }
}

export async function analyzeSource(root: string, manifest: SourceManifest) {
  validateSourceManifest(manifest);
  const marketIds = manifest.config.markets.map((market) => market.marketId);
  const pumps = new Map<number, PumpRecord>();
  const pumpsByOperation = new Map<string, PumpRecord>();
  const componentTiming = new Map<string, Record<string, number | null>>();
  const prepared = new Set<string>();
  for await (const record of readJournal(root, manifest.journals.prepared)) {
    if (
      record.kind !== "prepared" ||
      typeof record.hash !== "string" ||
      digest(record.value) !== record.hash
    ) {
      throw new PilotError("BREAKOUT_HASH_MISMATCH", "Original preparation bytes differ");
    }
    prepared.add(record.hash);
  }
  for await (const record of readJournal(root, manifest.journals.snapshots)) {
    const pump = record as unknown as PumpRecord;
    const expected = sourceWindowAt(manifest.frozen.startsAt, pump.window?.index);
    if (
      pump.kind !== "pump" ||
      pumps.has(expected.index) ||
      JSON.stringify(expected) !== JSON.stringify(pump.window) ||
      ![
        "CAPTURED",
        "UNAVAILABLE",
        "MISSED_BUSY",
        "MISSED_TIMER",
        "NOT_OBSERVED_AFTER_STOP",
      ].includes(pump.status) ||
      !Array.isArray(pump.qualifiedMarketIds) ||
      !Array.isArray(pump.commonPreparedMarketIds) ||
      new Set(pump.qualifiedMarketIds).size !== pump.qualifiedMarketIds.length ||
      pump.qualifiedMarketIds.some((id) => !marketIds.includes(id)) ||
      (pump.preparedHash !== null && !prepared.has(pump.preparedHash)) ||
      (pump.qualifiedMarketIds.length &&
        (pump.status !== "CAPTURED" ||
          pump.completedAt === null ||
          pump.completedAt < expected.dueAt ||
          pump.completedAt >= expected.deadlineAt))
    ) {
      throw new PilotError(
        "BREAKOUT_SOURCE_INVALID",
        "Original pump identity or qualification is invalid",
      );
    }
    if (pump.original !== undefined && pump.sourceHash !== digest(pump.original)) {
      throw new PilotError("BREAKOUT_HASH_MISMATCH", "Copied original snapshot hash differs");
    }
    const copied = pump.original as { frames?: PerpsPaperFrame[] } | undefined;
    for (const frame of copied?.frames ?? []) {
      componentTiming.set(`${expected.index}:${frame.snapshot.market.marketId}`, {
        tickerAt: frame.snapshot.ticker.provenance.providerTimestamp,
        tickerBlock: frame.snapshot.ticker.provenance.block,
        tickerReceivedAt: frame.snapshot.ticker.provenance.receivedAt,
        bookAt: frame.book.provenance.providerTimestamp,
        bookBlock: frame.book.provenance.block,
        bookReceivedAt: frame.book.provenance.receivedAt,
        copyLowerMs: pump.copyReceipt?.boundary.financial.lowerMs ?? null,
        copyUpperMs: pump.copyReceipt?.boundary.financial.upperMs ?? null,
      });
    }
    if (pump.qualifiedMarketIds.length) {
      const original = pump.original as
        { frames?: PerpsPaperFrame[]; operationId?: string; dueAt?: number } | undefined;
      const receipt = pump.copyReceipt;
      if (
        !receipt ||
        !original?.frames ||
        original.operationId !== expected.operationId ||
        original.dueAt !== expected.dueAt ||
        receipt.boundary.financial.upperMs >= expected.deadlineAt ||
        receipt.boundary.financial.lowerMs < expected.dueAt ||
        new Set(original.frames.map((frame) => frame.snapshot.market.marketId)).size !==
          original.frames.length
      ) {
        throw new PilotError(
          "BREAKOUT_SOURCE_INVALID",
          "Qualified original copy proof is unavailable",
        );
      }
      const qualification = qualifySourceFrames({
        frames: original.frames,
        network: manifest.config.network,
        markets: manifest.config.markets,
        receipt,
        window: expected,
        completedAt: pump.completedAt!,
      });
      const actual = qualification.qualifiedMarketIds;
      if (
        pump.qualificationFailures !== undefined &&
        JSON.stringify(pump.qualificationFailures) !== JSON.stringify(qualification.failures)
      ) {
        throw new PilotError(
          "BREAKOUT_SOURCE_INVALID",
          "Per-market original qualification diagnostics differ",
        );
      }
      if (JSON.stringify(actual) !== JSON.stringify(pump.qualifiedMarketIds)) {
        throw new PilotError(
          "BREAKOUT_SOURCE_INVALID",
          "Original qualified market mask differs from copied frames",
        );
      }
    }
    // Retain only the compact projection, never every native book/history in the report worker.
    const { original: _original, ...compact } = pump;
    void _original;
    pumps.set(expected.index, compact);
    pumpsByOperation.set(expected.operationId, compact);
  }
  let clockFailures = 0;
  let unprovedGaps = 0;
  let provedBreaches = 0;
  const last = new Map<number | "joint", BreakoutClockRecord>();
  const starts = new Map<number | "joint", BreakoutClockRecord>();
  let start: BreakoutClockRecord | undefined;
  let end: BreakoutClockRecord | undefined;
  let financialV = 0;
  let maximumUpperFinancialMs: number | null = null;
  let maximumUpperMonotonicMs: number | null = null;
  let qualifiedSourceReceipts = 0;
  const receipts = new Set<string>();
  const qualifiedOperations = new Set<string>();
  const compare = (previous: BreakoutClockRecord, next: BreakoutClockRecord) => {
    const result = compareBreakoutBoundaries(
      previous.boundary,
      next.boundary,
      [previous.certificate, next.certificate],
      "source-local",
    );
    if (result.status === "CLOCK_PROOF_FAILURE") {
      clockFailures++;
    } else if (result.status === "PROVED_GAP_BREACH") {
      provedBreaches++;
    } else if (result.status === "GAP_COMPLIANCE_UNPROVED") {
      unprovedGaps++;
    }
    if (result.financial !== null) {
      maximumUpperFinancialMs = Math.max(
        maximumUpperFinancialMs ?? Number.NEGATIVE_INFINITY,
        result.financial.upperMs,
      );
    }
    if (result.monotonic !== null) {
      maximumUpperMonotonicMs = Math.max(
        maximumUpperMonotonicMs ?? Number.NEGATIVE_INFINITY,
        result.monotonic.upperMs,
      );
    }
  };
  for await (const value of readJournal(root, manifest.journals.clocks)) {
    const record = value as unknown as BreakoutClockRecord;
    if (
      !record.boundary ||
      !record.certificate ||
      record.certificate.scope !== "source-local" ||
      record.authority !== "LOCAL_OS" ||
      record.externalUTC !== "UNVERIFIED" ||
      record.financialReadiness !== "NOT_ACCEPTED" ||
      record.process?.epochId !== record.certificate.epochId ||
      !Number.isSafeInteger(record.process?.pid) ||
      !Number.isFinite(record.process?.timeOriginMs)
    ) {
      throw new PilotError("BREAKOUT_SOURCE_INVALID", "Source clock authority is invalid");
    }
    const boundary = record.boundary;
    if (boundary.kind === "V" || boundary.kind === "V_CLOSE" || boundary.accountRole) {
      financialV++;
      continue;
    }
    if (boundary.operationId === "source-window-start") {
      start = record;
      for (const key of [...marketIds, "joint" as const]) {
        starts.set(key, record);
        last.set(key, record);
      }
    } else if (boundary.operationId === "source-window-end") {
      end = record;
    } else if (boundary.kind === "J" && boundary.acceptedProof === true) {
      const key = boundary.marketId ?? "joint";
      if (
        (key !== "joint" && !marketIds.includes(key)) ||
        receipts.has(boundary.id) ||
        !boundary.sourceIdentity ||
        !start
      ) {
        throw new PilotError(
          "BREAKOUT_SOURCE_INVALID",
          "Original per-market J identity is invalid",
        );
      }
      receipts.add(boundary.id);
      const pump = pumpsByOperation.get(boundary.operationId);
      if (
        !pump ||
        pump.sourceHash !== boundary.sourceIdentity ||
        !pump.copyReceipt ||
        pump.copyReceipt.boundary.certificateId !== boundary.certificateId ||
        JSON.stringify(pump.copyReceipt.boundary.financial) !==
          JSON.stringify(boundary.financial) ||
        JSON.stringify(pump.copyReceipt.boundary.monotonic) !==
          JSON.stringify(boundary.monotonic) ||
        (key === "joint"
          ? pump.qualifiedMarketIds.length !== marketIds.length
          : !pump.qualifiedMarketIds.includes(key))
      ) {
        throw new PilotError(
          "BREAKOUT_SOURCE_INVALID",
          "J receipt does not identify its exact original copied pump",
        );
      }
      qualifiedOperations.add(`${boundary.operationId}:${key}`);
      const previous = last.get(key) ?? starts.get(key);
      if (previous) {
        compare(previous, record);
      }
      last.set(key, record);
      qualifiedSourceReceipts++;
    } else if (
      boundary.kind === "K" &&
      start &&
      boundary.financial.lowerMs >= start.boundary.financial.lowerMs
    ) {
      for (const previous of last.values()) {
        compare(previous, record);
      }
    }
  }
  if (end) {
    for (const previous of last.values()) {
      compare(previous, end);
    }
  }
  if (financialV !== 0) {
    throw new PilotError(
      "BREAKOUT_SOURCE_INVALID",
      "Nonfinancial capture contains a financial population",
    );
  }
  for (const pump of pumps.values()) {
    if (
      pump.qualifiedMarketIds.some(
        (marketId) => !qualifiedOperations.has(`${pump.window.operationId}:${marketId}`),
      )
    ) {
      throw new PilotError(
        "BREAKOUT_SOURCE_INVALID",
        "Qualified pump has no original per-market source receipt",
      );
    }
  }
  // Verify all original native parts even though their full bodies are excluded from reports.
  for await (const response of readJournal(root, manifest.journals.http)) {
    if (
      response.kind !== "original-http-response" ||
      typeof response.body !== "string" ||
      bytesHash(response.body) !== response.bodySha256 ||
      Buffer.byteLength(response.body) !== response.bodyBytes
    ) {
      throw new PilotError("BREAKOUT_HASH_MISMATCH", "Original public HTTP body bytes differ");
    }
  }
  for (const parts of [manifest.journals.versions, manifest.journals.wire]) {
    for await (const _record of readJournal(root, parts)) {
      void _record;
      // Hash and record cardinality are checked by the iterator on exhaustion.
    }
  }
  const databaseClock = {
    policyId: SOURCE_DATABASE_CLOCK_POLICY.id,
    sourceAuthority: "LOCAL_OS",
    leaseAuthority: "POSTGRESQL",
    externalUTC: "UNVERIFIED",
    financialAcceptance: false,
    samples: 0,
    observedNonzeroOffsetSamples: 0,
    rejectedSamples: 0,
    offsetLowerMinimumMs: null as number | null,
    offsetUpperMaximumMs: null as number | null,
    preflightRecorded: false,
    startRecorded: false,
    endRecorded: false,
  };
  let previousDatabaseClock: SourceDatabaseClockSample | undefined;
  for await (const record of readJournal(root, manifest.journals.control)) {
    if (!manifest.databaseClockPolicy || !String(record.kind).startsWith("database-clock-")) {
      continue;
    }
    if (
      ![
        "database-clock-preflight",
        "database-clock-start",
        "database-clock-renewal",
        "database-clock-end",
      ].includes(String(record.kind)) ||
      databaseClock.endRecorded
    ) {
      throw new PilotError("CLOCK_PROOF_FAILURE", "Source database clock phase is invalid");
    }
    if (record.rejected === true) {
      databaseClock.rejectedSamples++;
      continue;
    }
    validateSourceDatabaseClockSample(record.sample, previousDatabaseClock);
    previousDatabaseClock = record.sample;
    if (record.kind === "database-clock-preflight") {
      if (databaseClock.samples !== 0) {
        throw new PilotError("CLOCK_PROOF_FAILURE", "Source preflight clock proof was repeated");
      }
      databaseClock.preflightRecorded = true;
    } else if (record.kind === "database-clock-start") {
      if (!databaseClock.preflightRecorded || databaseClock.startRecorded) {
        throw new PilotError("CLOCK_PROOF_FAILURE", "Source start clock proof is invalid");
      }
      databaseClock.startRecorded = true;
    } else if (
      !databaseClock.startRecorded &&
      !(
        record.kind === "database-clock-end" &&
        databaseClock.preflightRecorded &&
        manifest.processState === "interrupted"
      )
    ) {
      throw new PilotError("CLOCK_PROOF_FAILURE", "Source clock proof precedes start");
    }
    if (record.kind === "database-clock-end") {
      databaseClock.endRecorded = true;
    }
    databaseClock.samples++;
    if (record.sample.absoluteAlignment === "OBSERVED_NONZERO_OFFSET") {
      databaseClock.observedNonzeroOffsetSamples++;
    }
    databaseClock.offsetLowerMinimumMs = Math.min(
      databaseClock.offsetLowerMinimumMs ?? Number.POSITIVE_INFINITY,
      record.sample.databaseOffsetInterval.lowerMs,
    );
    databaseClock.offsetUpperMaximumMs = Math.max(
      databaseClock.offsetUpperMaximumMs ?? Number.NEGATIVE_INFINITY,
      record.sample.databaseOffsetInterval.upperMs,
    );
  }
  const perMarket = marketIds.map((marketId) => ({ marketId, qualified: 0, planned: 1440 }));
  let jointMinutes = 0;
  let qualifiedCells = 0;
  let commonPreparedJointMinutes = 0;
  let pumpQualifiedCells = 0;
  const rows: Record<string, string | number | null>[] = [];
  const pumpRows: Record<string, string | number | null>[] = [];
  for (let index = 0; index < CAPTURE_GRID.pumps; index++) {
    const window = sourceWindowAt(manifest.frozen.startsAt, index);
    const pump = pumps.get(index);
    pumpQualifiedCells += pump?.qualifiedMarketIds.length ?? 0;
    for (const marketId of marketIds) {
      pumpRows.push({
        index,
        operationId: window.operationId,
        dueAt: window.dueAt,
        deadlineAt: window.deadlineAt,
        offsetSeconds: window.offsetSeconds,
        canonicalMinute: window.canonicalMinute,
        marketId,
        completedAt: pump?.completedAt ?? null,
        elapsedFromDueMs:
          pump?.completedAt === null || pump?.completedAt === undefined
            ? null
            : pump.completedAt - window.dueAt,
        status: pump?.status ?? "NOT_RECORDED",
        qualified: pump?.qualifiedMarketIds.includes(marketId) ? 1 : 0,
        code: pump?.qualifiedMarketIds.includes(marketId)
          ? null
          : (pump?.qualificationFailures?.find((failure) => failure.marketId === marketId)?.code ??
            pump?.code ??
            null),
        ...componentTiming.get(`${index}:${marketId}`),
      });
    }
    if (window.canonicalMinute === null) {
      continue;
    }
    const qualified = pump?.qualifiedMarketIds ?? [];
    const common = pump?.commonPreparedMarketIds ?? [];
    if (qualified.length === marketIds.length) {
      jointMinutes++;
    }
    if (common.length === marketIds.length) {
      commonPreparedJointMinutes++;
    }
    for (const market of perMarket) {
      const valid = qualified.includes(market.marketId);
      if (valid) {
        market.qualified++;
        qualifiedCells++;
      }
      rows.push({
        minute: window.canonicalMinute,
        dueAt: window.dueAt,
        marketId: market.marketId,
        status: pump?.status ?? "NOT_RECORDED",
        qualified: valid ? 1 : 0,
        commonPreparation: common.includes(market.marketId) ? 1 : 0,
        code: valid
          ? null
          : (pump?.qualificationFailures?.find((failure) => failure.marketId === market.marketId)
              ?.code ??
            pump?.code ??
            null),
      });
    }
  }
  const complete =
    manifest.processState === "completed" &&
    pumps.size === CAPTURE_GRID.pumps &&
    Boolean(start && end) &&
    manifest.cleanup?.socketClosed === true &&
    manifest.cleanup.leaseReleased === true &&
    manifest.cleanup.poolClosed === true &&
    manifest.failureCode === null &&
    (!manifest.databaseClockPolicy ||
      (databaseClock.preflightRecorded &&
        databaseClock.startRecorded &&
        databaseClock.endRecorded &&
        databaseClock.rejectedSamples === 0));
  const coveragePass =
    jointMinutes >= CAPTURE_GRID.jointMinuteFloor &&
    qualifiedCells >= CAPTURE_GRID.marketMinuteFloor &&
    perMarket.every((market) => market.qualified >= CAPTURE_GRID.perMarketMinuteFloor);
  const endpointsCovered = Boolean(
    start &&
    end &&
    start.boundary.financial.lowerMs <= manifest.frozen.startsAt &&
    end.boundary.financial.upperMs >= manifest.frozen.endsAt,
  );
  const continuityPass =
    endpointsCovered &&
    clockFailures === 0 &&
    unprovedGaps === 0 &&
    provedBreaches === 0 &&
    qualifiedSourceReceipts > 0;
  return {
    format: "hourly-breakout-source-report-v1",
    replayMode: "SAVED_SNAPSHOT_QUALIFICATION",
    transportReconstruction: "NOT_PERFORMED",
    wireScope: "VALIDATED_PUBLIC_MESSAGE_EVENT_PREFIX",
    result:
      manifest.processState === "running"
        ? "IN_PROGRESS_NONFINANCIAL_SOURCE_CAPTURE"
        : complete && coveragePass && continuityPass
          ? "PASS_NONFINANCIAL_SOURCE_ACCEPTANCE"
          : "FAIL_NONFINANCIAL_SOURCE_ACCEPTANCE",
    sourceManifestHash: digest(manifest),
    captureCommit: manifest.captureCommit,
    processState: manifest.processState,
    processLiveness: "UNVERIFIED_READ_ONLY_REPORT",
    ...(manifest.databaseClockPolicy ? { databaseClock } : {}),
    clockFailure: manifest.clockFailure ?? null,
    complete,
    coverage: {
      canonicalMinutes: { qualified: jointMinutes, planned: 1440, required: 1368 },
      canonicalMarketMinutes: { qualified: qualifiedCells, planned: 15840, required: 15048 },
      perMarket,
      originalPumps: { recorded: pumps.size, planned: 4320 },
      originalPumpCells: { qualified: pumpQualifiedCells, planned: 47520 },
      commonPreparationJointMinutes: commonPreparedJointMinutes,
      offset20Or40RescuesCanonical: false,
      pass: coveragePass,
    },
    continuity: {
      population: "J_SOURCE_ONLY",
      pass: continuityPass,
      qualifiedSourceReceipts,
      clockFailures,
      unprovedGaps,
      provedBreaches,
      maximumUpperFinancialMs,
      maximumUpperMonotonicMs,
      includesStartEndAndTrailingK: true,
      endpointsCovered,
      maximumAllowedMs: 90000,
    },
    authority: manifest.authority,
    coldStart: manifest.coldStart,
    wire: manifest.wire,
    cleanup: manifest.cleanup,
    financialAcceptance: false,
    financialV: 0,
    accounts: 0,
    positions: 0,
    newReservations: 0,
    modelCalls: 0,
    interpretation:
      "Source capture only; no financial V acceptance, position, return or 28-day continuity claim",
    rows,
    pumpRows,
  };
}

function html(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function safeCsv(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\t\r\n ]*[=+@-]/.test(text)) {
    text = "'" + text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

const DERIVED_FILES = [
  "report.json",
  "acceptance.json",
  "minutes.csv",
  "pumps.csv",
  "report.html",
  "source-manifest.json",
] as const;

/** A previous generation is retained only after its original published byte hashes verify. */
async function verifyDerivedGeneration(root: string, generation: string) {
  const directory = join(root, generation);
  const verified = await boundedJson(join(directory, "verified.json"));
  const value = verified as {
    format: string;
    generation: string;
    sourceManifestHash: string;
    files: { file: string; bytes: number; sha256: string }[];
  };
  if (
    value?.format !== "hourly-breakout-report-generation-v1" ||
    value.generation !== generation ||
    !Array.isArray(value.files) ||
    value.files.length !== DERIVED_FILES.length ||
    new Set(value.files.map((file) => file.file)).size !== DERIVED_FILES.length ||
    value.files.some(
      (file) =>
        !(DERIVED_FILES as readonly string[]).includes(file.file) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        !/^[0-9a-f]{64}$/.test(file.sha256),
    )
  ) {
    throw new PilotError("BREAKOUT_REPORT_VERIFY_FAILED", "Derived manifest identity differs");
  }
  for (const file of value.files) {
    const path = join(directory, file.file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes) {
      throw new PilotError("BREAKOUT_REPORT_VERIFY_FAILED", "Published derived file is absent");
    }
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(path)) {
      hash.update(bytes);
    }
    if (hash.digest("hex") !== file.sha256) {
      throw new PilotError("BREAKOUT_REPORT_VERIFY_FAILED", "Published derived bytes differ");
    }
  }
  const source = await readSourceManifest(join(directory, "source-manifest.json"));
  if (digest(source) !== value.sourceManifestHash) {
    throw new PilotError("BREAKOUT_REPORT_VERIFY_FAILED", "Published source identity differs");
  }
  return value;
}

export async function publishReportGeneration(input: {
  sourceDirectory: string;
  outputDirectory: string;
  manifest: SourceManifest;
  generation: string;
  writer: ArtifactWriter;
  released(bytes: number): void;
}) {
  if (!/^generation-[a-zA-Z0-9-]{1,80}$/.test(input.generation)) {
    throw new PilotError("BREAKOUT_UNSAFE_PATH", "Derived generation identity is invalid");
  }
  const report = await analyzeSource(input.sourceDirectory, input.manifest);
  const { rows: _rows, pumpRows: _pumpRows, ...acceptance } = report;
  void _rows;
  void _pumpRows;
  const directory = join(input.outputDirectory, input.generation);
  await mkdir(directory, { mode: 0o700 });
  const json = Buffer.from(JSON.stringify(report) + "\n");
  const columns = [
    "minute",
    "dueAt",
    "marketId",
    "status",
    "qualified",
    "commonPreparation",
    "code",
  ];
  const csv = Buffer.from(
    columns.map(safeCsv).join(",") +
      "\n" +
      report.rows.map((row) => columns.map((column) => safeCsv(row[column])).join(",")).join("\n") +
      "\n",
  );
  const pumpColumns = [
    "index",
    "operationId",
    "dueAt",
    "deadlineAt",
    "offsetSeconds",
    "canonicalMinute",
    "marketId",
    "completedAt",
    "elapsedFromDueMs",
    "status",
    "qualified",
    "code",
    "tickerAt",
    "tickerBlock",
    "tickerReceivedAt",
    "bookAt",
    "bookBlock",
    "bookReceivedAt",
    "copyLowerMs",
    "copyUpperMs",
  ];
  const pumpsCsv = Buffer.from(
    pumpColumns.map(safeCsv).join(",") +
      "\n" +
      report.pumpRows
        .map((row) => pumpColumns.map((key) => safeCsv(row[key])).join(","))
        .join("\n") +
      "\n",
  );
  const errorWindows = new Map<string, Set<number>>();
  for (const row of report.pumpRows) {
    if (typeof row.code === "string" && typeof row.index === "number") {
      const windows = errorWindows.get(row.code) ?? new Set<number>();
      windows.add(row.index);
      errorWindows.set(row.code, windows);
    }
  }
  const pending = report.processState === "running";
  const page = Buffer.from(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Hourly breakout source continuity</title>
<style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:16px;color:#17202a;background:#f8fafc}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{padding:8px;border:1px solid #cbd5e1;text-align:left}code{overflow-wrap:anywhere}a{color:#174d9b}</style>
<h1>${html(report.result)}</h1><p>${html(report.interpretation)}</p>
<p>Fixed source window: <time>${html(new Date(input.manifest.frozen.startsAt).toISOString())}</time> to <time>${html(new Date(input.manifest.frozen.endsAt).toISOString())}</time>. State: ${html(report.processState)}; failure: ${html(input.manifest.failureCode ?? "none recorded")}.</p>
<p>${pending ? "Acceptance remains pending until the original 24-hour window and cleanup finish." : "The fixed population includes every missed and unavailable original opportunity."} Financial accounts, positions, V receipts, model calls and new monetary reserves: <strong>zero</strong>. No return was measured.</p>
<h2>Coverage</h2>
<table><thead><tr><th>Population</th><th>Qualified / planned</th><th>Required</th></tr></thead><tbody>
<tr><td>Joint canonical minutes</td><td>${report.coverage.canonicalMinutes.qualified} / 1440</td><td>1368</td></tr>
<tr><td>Market-minutes</td><td>${report.coverage.canonicalMarketMinutes.qualified} / 15840</td><td>15048 and 1368 per market</td></tr>
<tr><td>Recorded original windows</td><td>${report.coverage.originalPumps.recorded} / 4320</td><td>4320 recorded</td></tr>
<tr><td>Market-reads</td><td>${report.coverage.originalPumpCells.qualified} / 47520</td><td>Descriptive; seconds 20/40 cannot rescue canonical minutes</td></tr>
<tr><td>Common candle preparation</td><td>${report.coverage.commonPreparationJointMinutes} / 1440</td><td>Separate from price J acceptance</td></tr>
</tbody></table>
<table><thead><tr><th>Market</th><th>Qualified minutes</th><th>Planned / required</th></tr></thead><tbody>${report.coverage.perMarket.map((market) => `<tr><td>${html(input.manifest.config.markets.find((m) => m.marketId === market.marketId)?.symbol)} (${market.marketId})</td><td>${market.qualified}</td><td>1440 / 1368</td></tr>`).join("")}</tbody></table>
<h2>Clock and continuity evidence</h2>
<p>Authority: local OS clock. External UTC accuracy: <strong>UNVERIFIED</strong>. J acceptance: ${pending ? "pending" : html(report.continuity.pass)}. Endpoint coverage: ${html(report.continuity.endpointsCovered)}.</p>
${report.databaseClock ? `<p>Database clock policy: <code>${html(report.databaseClock.policyId)}</code>. The local OS clock owns source receipts and the calendar; PostgreSQL owns lease expiration. ${report.databaseClock.samples} full-RTT samples; ${report.databaseClock.observedNonzeroOffsetSamples} observed nonzero offsets; ${report.databaseClock.rejectedSamples} rejected proofs. Recorded PostgreSQL-minus-host offset envelope: [${html(report.databaseClock.offsetLowerMinimumMs ?? "NOT_VERIFIABLE")}, ${html(report.databaseClock.offsetUpperMaximumMs ?? "NOT_VERIFIABLE")}] ms. No timestamp was adjusted and no external UTC alignment or financial V acceptance is asserted.</p>` : ""}
<p>Maximum conservative J interval: UTC ${html(report.continuity.maximumUpperFinancialMs ?? "NOT_VERIFIABLE")} ms; monotonic ${html(report.continuity.maximumUpperMonotonicMs ?? "NOT_VERIFIABLE")} ms; limit 90000 ms. Demonstrated breaches: ${report.continuity.provedBreaches}; unproved intervals: ${report.continuity.unprovedGaps}; clock failures: ${report.continuity.clockFailures}.</p>
<p>Cleanup acknowledgements: socket ${html(report.cleanup?.socketClosed ?? "NOT_VERIFIABLE")}, lease ${html(report.cleanup?.leaseReleased ?? "NOT_VERIFIABLE")}, database pool ${html(report.cleanup?.poolClosed ?? "NOT_VERIFIABLE")}. Cleanup is pending during capture.</p>
<h2>Unavailable and omitted opportunities</h2>
<p>Counts below are distinct original windows per code and can overlap. Future unobserved rows remain in the fixed denominator.</p>
<table><thead><tr><th>Code</th><th>Windows</th></tr></thead><tbody>${[...errorWindows]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, windows]) => `<tr><td>${html(code)}</td><td>${windows.size}</td></tr>`)
    .join("")}</tbody></table>
<h2>Inspectable evidence</h2>
<p><a href="report.json">Complete report JSON</a> · <a href="minutes.csv">15,840 canonical cells CSV</a> · <a href="pumps.csv">47,520 original market-read cells CSV</a> · <a href="acceptance.json">Compact acceptance</a> · <a href="source-manifest.json">Exact source manifest</a></p>
<p>Code commit: <code>${html(report.captureCommit)}</code>. Source manifest SHA-256: <code>${html(report.sourceManifestHash)}</code>.</p>
<p>Retained validated WebSocket message prefix: ${report.wire.retainedBytes} bytes; truncated: ${html(report.wire.truncated)}. Offline replay requalifies saved snapshots; transport reconstruction is not performed. This check cannot establish financial V, 28-day reliability or profitability.</p>
</html>\n`);
  const files = [
    { file: "report.json", bytes: json },
    { file: "acceptance.json", bytes: Buffer.from(JSON.stringify(acceptance) + "\n") },
    { file: "minutes.csv", bytes: csv },
    { file: "pumps.csv", bytes: pumpsCsv },
    { file: "report.html", bytes: page },
    {
      file: "source-manifest.json",
      bytes: Buffer.from(JSON.stringify(input.manifest) + "\n"),
    },
  ];
  for (const file of files) {
    await input.writer.write(join(directory, file.file), file.bytes);
  }
  const hashes = files.map((file) => ({
    file: file.file,
    bytes: file.bytes.byteLength,
    sha256: bytesHash(file.bytes),
  }));
  for (const file of hashes) {
    const actual = await readFile(join(directory, file.file));
    if (actual.byteLength !== file.bytes || bytesHash(actual) !== file.sha256) {
      throw new PilotError(
        "BREAKOUT_REPORT_VERIFY_FAILED",
        "Derived publication verification failed",
      );
    }
  }
  const verified = {
    format: "hourly-breakout-report-generation-v1",
    generation: input.generation,
    sourceManifestHash: digest(input.manifest),
    files: hashes,
  };
  await input.writer.write(
    join(directory, "verified.json"),
    Buffer.from(JSON.stringify(verified) + "\n"),
  );
  let previous: string | null = null;
  const pointer = join(input.outputDirectory, "current-report.json");
  try {
    const saved = JSON.parse(await readFile(pointer, "utf8"));
    if (/^generation-[a-zA-Z0-9-]{1,80}$/.test(saved.generation)) {
      await verifyDerivedGeneration(input.outputDirectory, saved.generation);
      previous = saved.generation;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const temp = join(input.outputDirectory, `.current-report-${input.generation}.tmp`);
  await input.writer.write(temp, Buffer.from(JSON.stringify({ ...verified, previous }) + "\n"));
  let oldPointerBytes = 0;
  try {
    oldPointerBytes = (await lstat(pointer)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await rename(temp, pointer);
  input.released(oldPointerBytes);
  // Only verified derived generations can be pruned. Immutable source parts are never visited.
  for (const entry of await readdir(input.outputDirectory, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !/^generation-[a-zA-Z0-9-]{1,80}$/.test(entry.name) ||
      [input.generation, previous].includes(entry.name)
    ) {
      continue;
    }
    const old = join(input.outputDirectory, entry.name);
    try {
      await readFile(join(old, "verified.json"));
    } catch {
      continue;
    }
    await verifyDerivedGeneration(input.outputDirectory, entry.name);
    let removed = 0;
    for (const file of await readdir(old)) {
      removed += (await lstat(join(old, file))).size;
    }
    await rm(old, { recursive: true });
    input.released(removed);
  }
  return { generation: input.generation, result: report.result };
}

export async function exportSourcePacket(
  manifestPath: string,
  output: string,
  writer: ArtifactWriter,
) {
  const source = await readSourceManifest(manifestPath);
  // Exhaust every part through the deterministic analysis before copying native evidence.
  await analyzeSource(dirname(resolve(manifestPath)), source);
  for (const parts of Object.values(source.journals)) {
    for (const part of parts) {
      safePart(part);
      const handle = await open(join(dirname(resolve(manifestPath)), part.file), "r");
      const bytes = Buffer.alloc(part.bytes);
      try {
        let offset = 0;
        while (offset < bytes.byteLength) {
          const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
          if (!read.bytesRead) {
            throw new PilotError("BREAKOUT_HASH_MISMATCH", "Original source prefix ended early");
          }
          offset += read.bytesRead;
        }
      } finally {
        await handle.close();
      }
      if (bytesHash(bytes) !== part.sha256) {
        throw new PilotError("BREAKOUT_HASH_MISMATCH", "Original source changed during export");
      }
      await writer.write(join(output, part.file), bytes);
    }
  }
  await writer.write(
    join(output, "source-manifest.json"),
    Buffer.from(JSON.stringify(source) + "\n"),
  );
  return source;
}
