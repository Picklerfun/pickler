import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { PilotError } from "@pickler/core";
import {
  BREAKOUT_FINANCIAL_ROLES,
  BREAKOUT_FIXED_POPULATIONS,
  assertHourlyBreakoutConfig,
  breakoutAvailability,
  breakoutGraceAvailability,
  breakoutActionObligationKey,
  breakoutRequiredFinals,
  breakoutWindowTimes,
  canonicalBreakoutJson,
  compareBreakoutBoundaries,
  hourlyBreakoutScreenReport,
  hourlyBreakoutSignal,
  type BreakoutActionObligation,
  type BreakoutArmFinancialEvidence,
  type BreakoutAvailabilityCell,
  type BreakoutClockBoundary,
  type BreakoutClockCell,
  type BreakoutClockCertificate,
  type BreakoutFinancialPosition,
  type BreakoutFinancialRole,
  type PerpsHourlyBreakoutConfig,
} from "@pickler/trading/evaluation";
import {
  COMPONENT_PAPER_POLICY,
  validatePaperFrameSet,
  paperUnits,
  paperDecimal,
  type PerpsPaperFrame,
  type PerpsPaperAccount,
  type PerpsPaperMovement,
  type PerpsPaperPosition,
} from "@pickler/trading/perps";
import type {
  PerpsBreakoutAuditPart,
  PerpsBreakoutStudyRecord,
} from "@pickler/infrastructure/perps-lab";
import {
  ArtifactBudget,
  BREAKOUT_BYTES,
  SegmentedJournal,
  boundedJson,
  budgetWriter,
  bytesHash,
  checkoutCommit,
  newDirectory,
  type ArtifactWriter,
  type JournalPart,
} from "./files.js";
import type { BreakoutClockRecord } from "./clock.js";

export interface FinancialAuditManifest {
  format: "hourly-breakout-financial-audit-v1";
  protocol: "perps-hourly-breakout-fixed-screen-v1";
  version: 10;
  config: PerpsHourlyBreakoutConfig;
  configHash: string;
  exporterCommit: string;
  studyCommit: string | null;
  capturedAt: number;
  source: { sha256: string; rows: number; protocol: string; version: number };
  parts: JournalPart[];
  clocks: JournalPart[];
  evidence: JournalPart[];
  journalDirectory: string | null;
  clockSource: string | null;
  financialExecutionAuthorizedByThisExport: false;
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const integer = (value: unknown): number | null =>
  Number.isSafeInteger(value) ? (value as number) : null;
const roleOf = (value: unknown): BreakoutFinancialRole | null =>
  BREAKOUT_FINANCIAL_ROLES.includes(value as BreakoutFinancialRole)
    ? (value as BreakoutFinancialRole)
    : null;
const safeCode = (error: unknown) =>
  error instanceof PilotError && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : "BREAKOUT_REPORT_FAILED";
function invalid(message: string): never {
  throw new PilotError("BREAKOUT_AUDIT_INVALID", message);
}

/** Verify the immutable prefix before yielding any row; reject path escapes and truncated bytes. */
export async function* verifiedJournal(directory: string, parts: readonly JournalPart[]) {
  for (const part of parts) {
    if (
      basename(part.file) !== part.file ||
      !/^[a-z][a-z0-9-]*\.jsonl$/.test(part.file) ||
      !Number.isSafeInteger(part.bytes) ||
      part.bytes < 0 ||
      part.bytes > BREAKOUT_BYTES.part ||
      !/^[a-f0-9]{64}$/.test(part.sha256)
    ) {
      invalid("Invalid bounded journal descriptor");
    }
    const path = join(directory, part.file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < part.bytes) {
      invalid("Original journal part is missing or truncated");
    }
    const hash = createHash("sha256");
    if (part.bytes) {
      for await (const chunk of createReadStream(path, { start: 0, end: part.bytes - 1 })) {
        hash.update(chunk);
      }
    }
    if (hash.digest("hex") !== part.sha256) {
      invalid("Original journal hash mismatch");
    }
    let rows = 0;
    if (part.bytes) {
      const lines = createInterface({
        input: createReadStream(path, { start: 0, end: part.bytes - 1 }),
        crlfDelay: Infinity,
      });
      try {
        for await (const line of lines) {
          if (!line.length || Buffer.byteLength(line) > BREAKOUT_BYTES.part) {
            invalid("Invalid original journal record");
          }
          rows++;
          yield JSON.parse(line) as unknown;
        }
      } finally {
        lines.close();
      }
    }
    if (rows !== part.records) {
      invalid("Original journal row inventory mismatch");
    }
  }
}

export async function readFinancialAuditManifest(path: string): Promise<FinancialAuditManifest> {
  const value = (await boundedJson(path, 4 * 1024 * 1024)) as FinancialAuditManifest;
  if (
    value.format !== "hourly-breakout-financial-audit-v1" ||
    value.version !== 10 ||
    value.protocol !== "perps-hourly-breakout-fixed-screen-v1" ||
    value.financialExecutionAuthorizedByThisExport !== false ||
    !Array.isArray(value.parts) ||
    !Array.isArray(value.clocks) ||
    !Array.isArray(value.evidence) ||
    value.parts.length > 4096 ||
    value.clocks.length > 4096 ||
    value.evidence.length > 4096
  ) {
    invalid("Versioned financial audit manifest required");
  }
  assertHourlyBreakoutConfig(value.config);
  if (bytesHash(JSON.stringify(value.config)) !== value.configHash) {
    invalid("Frozen financial configuration hash mismatch");
  }
  return value;
}

/** Read-only database export into bounded original parts. No executable composition is imported. */
export async function exportFinancialAudit(input: {
  envFile: string;
  config: PerpsHourlyBreakoutConfig;
  directory: string;
  writer: ArtifactWriter;
  budget: ArtifactBudget;
  signal?: AbortSignal;
  referenceOriginalJournals?: boolean;
}) {
  const { localStudyDatabase } = await import("../perps-study/database-env.js");
  const { createLocalPerpsLabStore, exportPerpsBreakoutAuditParts } =
    await import("@pickler/infrastructure/perps-lab");
  const database = createLocalPerpsLabStore(
    await localStudyDatabase(resolve(input.envFile)),
    "report",
  );
  const journal = new SegmentedJournal(input.directory, "financial-source", input.budget);
  let record: PerpsBreakoutStudyRecord | undefined;
  try {
    const source = await exportPerpsBreakoutAuditParts(
      database.pool,
      input.config,
      async (part) => {
        input.signal?.throwIfAborted();
        if (part.kind === "record") {
          record = part.value;
          if (canonicalBreakoutJson(record.config) !== canonicalBreakoutJson(input.config)) {
            invalid("Selected configuration differs from authoritative study");
          }
        }
        journal.append(part, false);
      },
      { pageSize: 32 },
    );
    journal.seal();
    if (!record) {
      invalid("Authoritative financial record was not exported");
    }
    const metadata = object(record.metadata);
    const originalDirectory = text(metadata.directory);
    let clocks: JournalPart[] = [];
    let evidence: JournalPart[] = [];
    let journalDirectory: string | null = null;
    let clockSource: string | null = null;
    // The manifest is a bounded read-only prefix, not a substitute or reconstruction of lost V.
    if (originalDirectory) {
      try {
        const clockManifest = object(
          await boundedJson(
            join(originalDirectory, "financial-clock-manifest.json"),
            4 * 1024 * 1024,
          ),
        );
        if (
          clockManifest.format !== "hourly-breakout-financial-clock-manifest-v1" ||
          clockManifest.configHash !== bytesHash(JSON.stringify(input.config)) ||
          !Array.isArray(clockManifest.parts)
        ) {
          invalid("Original financial clock manifest identity differs");
        }
        clocks = clockManifest.parts as JournalPart[];
        evidence = Array.isArray(clockManifest.evidenceParts)
          ? (clockManifest.evidenceParts as JournalPart[])
          : [];
        if (clocks.length > 4096 || evidence.length > 4096) {
          invalid("Financial journal inventory exceeds bounded capacity");
        }
        if (input.referenceOriginalJournals) {
          journalDirectory = originalDirectory;
        }
        for (const part of input.referenceOriginalJournals ? [] : [...clocks, ...evidence]) {
          const destination = join(input.directory, part.file);
          if (basename(part.file) !== part.file || part.bytes > BREAKOUT_BYTES.part) {
            invalid("Unsafe financial clock part");
          }
          const handle = await open(join(originalDirectory, part.file), "r");
          try {
            const bytes = Buffer.alloc(part.bytes);
            let received = 0;
            while (received < bytes.length) {
              const read = await handle.read(bytes, received, bytes.length - received, received);
              if (!read.bytesRead) {
                invalid("Financial journal original prefix is truncated");
              }
              received += read.bytesRead;
            }
            if (bytesHash(bytes) !== part.sha256) {
              invalid("Financial journal original prefix hash differs");
            }
            await input.writer.write(destination, bytes);
          } finally {
            await handle.close();
          }
        }
        clockSource = originalDirectory;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
    const manifest: FinancialAuditManifest = {
      format: "hourly-breakout-financial-audit-v1",
      protocol: input.config.protocol,
      version: 10,
      config: input.config,
      configHash: bytesHash(JSON.stringify(input.config)),
      exporterCommit: checkoutCommit(),
      studyCommit: text(metadata.commit),
      capturedAt: Date.now(),
      source,
      parts: journal.snapshot(),
      clocks,
      evidence,
      journalDirectory,
      clockSource,
      financialExecutionAuthorizedByThisExport: false,
    };
    await input.writer.write(
      join(input.directory, "financial-audit-manifest.json"),
      Buffer.from(JSON.stringify(manifest) + "\n"),
    );
    return manifest;
  } finally {
    journal.seal();
    await database.pool.end();
  }
}

interface PositionEvidence {
  role: BreakoutFinancialRole;
  native: PerpsPaperPosition;
  planned: BreakoutFinancialPosition;
  fundingComplete: boolean;
}
interface FinancialEffect {
  role: BreakoutFinancialRole;
  positionId: string;
  action: "OPEN" | "FULL_CLOSE";
  obligationId: string;
  recordId: string;
  attemptId: string;
  originalOperationId: string | null;
  sourceOperationId: string | null;
}

/** Histories are streamed; only fixed population cells, compact ledger postings and links survive. */
export async function analyzeFinancialAudit(directory: string, manifest: FinancialAuditManifest) {
  const canonical = createHash("sha256");
  let canonicalRows = 0;
  let record: PerpsBreakoutStudyRecord | undefined;
  const accounts = new Map<BreakoutFinancialRole, PerpsPaperAccount>();
  const positions = new Map<string, PositionEvidence>();
  const movements = new Map<BreakoutFinancialRole, PerpsPaperMovement[]>(
    BREAKOUT_FINANCIAL_ROLES.map((r) => [r, []]),
  );
  const effects = new Map<string, FinancialEffect>();
  const q = new Map<string, Record<string, unknown>>();
  const finalSources = new Map<string, Set<number>>();
  const cells: BreakoutAvailabilityCell[] = [];
  const clocks: BreakoutClockCell[] = [];
  const technical = new Set<string>();
  const pending = { C: 0, S: 0, L: 0 };
  const reservationTotals = { C: 0n, S: 0n, L: 0n };
  const historicalEmergencies = new Set<BreakoutFinancialRole>();
  const provedNoEffectOperations = new Set<string>();
  const graceRows: Parameters<typeof breakoutGraceAvailability>[1][number][] = [];
  const context = { observed: 0, available: 0, unavailable: 0, financialPositions: 0, pnl: null };
  const maximumCompactRows = 1_500_000;
  let compactRows = 0;
  for await (const raw of verifiedJournal(directory, manifest.parts)) {
    canonical.update(canonicalBreakoutJson(raw) + "\n");
    canonicalRows++;
    const part = raw as PerpsBreakoutAuditPart;
    if (part.kind === "record") {
      record = part.value;
    } else if (part.kind === "account") {
      accounts.set(part.role, part.value);
    } else if (part.kind === "position") {
      const p = part.value;
      const funding = object(object(p).breakoutFunding);
      const market = manifest.config.markets.find((m) => m.symbol === p.symbol);
      if (!market || positions.size >= 150_000) {
        invalid("Position exceeds frozen market/population capacity");
      }
      positions.set(`${part.role}:${p.id}`, {
        role: part.role,
        native: p,
        planned: {
          id: p.id,
          episodeKey: "NOT_VERIFIABLE",
          marketId: market.marketId,
          side: p.side,
          openedAt: p.openedAt,
          closedAt: p.closedAt,
          movementKeys: [],
        },
        fundingComplete: funding.pending === false && typeof funding.completeSourceKey === "string",
      });
    } else if (part.kind === "movement") {
      movements.get(part.role)!.push({
        key: part.value.key,
        kind: part.value.kind,
        delta: part.value.delta,
        at: part.value.at,
        evidence:
          part.value.kind === "funding"
            ? { positionId: object(part.value.evidence).positionId }
            : null,
      });
      compactRows++;
    } else if (part.kind === "attempt") {
      if (part.value.status === "pending" || part.value.reserved !== "0") {
        pending[part.role]++;
        reservationTotals[part.role] += paperUnits(part.value.reserved);
      }
    } else if (part.kind === "event") {
      const e = part.value;
      const data = object(e.data);
      if (e.kind === "breakout-close-latch" && Array.isArray(e.data)) {
        for (const value of e.data) {
          const obligation = object(value);
          const role = roleOf(obligation.role);
          if (
            role &&
            Array.isArray(obligation.reasons) &&
            obligation.reasons.some((r) =>
              ["DAILY_LOSS", "PEAK_DRAWDOWN", "INSOLVENT"].includes(String(r)),
            )
          ) {
            historicalEmergencies.add(role);
          }
        }
      }
      if (e.kind === "breakout-terminal-rejection") {
        const acknowledgement = object(data.noEffectAcknowledgement);
        if (
          text(acknowledgement.authoritativeRecordId)?.startsWith("rollback:") &&
          text(acknowledgement.operationId)
        ) {
          provedNoEffectOperations.add(acknowledgement.operationId as string);
        }
      }
      if (e.kind === "breakout-host-grace-cells" && Array.isArray(data.rows)) {
        graceRows.push(...(data.rows as (typeof graceRows)[number][]));
        compactRows += data.rows.length;
      } else if (e.kind === "breakout-host-cells") {
        if (Array.isArray(data.cells)) {
          cells.push(...(data.cells as BreakoutAvailabilityCell[]));
          compactRows += data.cells.length;
        }
        if (Array.isArray(data.clocks)) {
          clocks.push(...(data.clocks as BreakoutClockCell[]));
          compactRows += data.clocks.length;
        }
      } else if (e.kind === "breakout-action-obligation") {
        const role = roleOf(data.role);
        const id = text(data.actionObligationId);
        if (role && id && (data.action === "OPEN" || data.action === "FULL_CLOSE")) {
          const key = breakoutActionObligationKey(data as unknown as BreakoutActionObligation);
          const old = q.get(key);
          if (old && canonicalBreakoutJson(old) !== canonicalBreakoutJson(data)) {
            technical.add("ORIGINAL_ACTION_OBLIGATION_REASSIGNED");
          } else {
            q.set(key, old ?? data);
          }
          compactRows++;
        }
      } else if (e.kind === "breakout-host-final") {
        const operationId = text(data.operationId);
        if (operationId && Array.isArray(data.validMarketIds)) {
          const final = object(data.finalSet);
          if (
            !Array.isArray(final.frames) ||
            integer(final.financialAt) === null ||
            integer(final.receiptAt) === null
          ) {
            technical.add("ORIGINAL_FINAL_SOURCE_BYTES_NOT_VERIFIABLE");
            continue;
          }
          const frames = final.frames as PerpsPaperFrame[];
          try {
            validatePaperFrameSet(
              frames,
              manifest.config.network,
              final.financialAt as number,
              COMPONENT_PAPER_POLICY,
              final.receiptAt as number,
            );
            const ids = frames.map((f) => f.snapshot.market.marketId);
            if (
              canonicalBreakoutJson([...ids].sort((a, b) => a - b)) !==
              canonicalBreakoutJson([...(data.validMarketIds as number[])].sort((a, b) => a - b))
            ) {
              invalid("Declared final source mask differs from original validated frames");
            }
            finalSources.set(operationId, new Set(ids));
          } catch (error) {
            technical.add(`FINAL_SOURCE_REPLAY_${safeCode(error)}`);
          }
        }
      } else if (e.kind === "breakout-financial") {
        const discovery = object(data.discovery);
        const obligation = object(data.obligation);
        const role = roleOf(discovery.role ?? obligation.role);
        const action = data.action;
        const attemptId = text(data.attemptId);
        const positionId = action === "OPEN" ? attemptId : text(obligation.positionId);
        const obligationId = action === "OPEN" ? text(discovery.allocationId) : text(obligation.id);
        if (
          role &&
          positionId &&
          attemptId &&
          obligationId &&
          (action === "OPEN" || action === "FULL_CLOSE")
        ) {
          effects.set(e.key, {
            role,
            positionId,
            action,
            obligationId,
            attemptId,
            recordId: e.key,
            originalOperationId: text(
              discovery.initialOperationId ??
                obligation.originalOperationId ??
                data.originalOperationId,
            ),
            sourceOperationId: text(data.sourceOperationId),
          });
          if (
            action === "FULL_CLOSE" &&
            Array.isArray(obligation.reasons) &&
            obligation.reasons.some((r) =>
              ["DAILY_LOSS", "PEAK_DRAWDOWN", "INSOLVENT"].includes(String(r)),
            )
          ) {
            historicalEmergencies.add(role);
          }
          const position = positions.get(`${role}:${positionId}`);
          if (position) {
            if (action === "OPEN") {
              position.planned.episodeKey = text(discovery.episodeKey) ?? "NOT_VERIFIABLE";
              position.planned.openingActionObligationId = obligationId;
            } else {
              position.planned.closingActionObligationId = obligationId;
            }
          }
        } else {
          technical.add("FINANCIAL_EFFECT_LINK_NOT_VERIFIABLE");
        }
      } else if (e.kind === "breakout-host-context") {
        context.observed++;
        const rows = Array.isArray(data.rows) ? data.rows : [];
        context.available += rows.filter((r) => object(r).status !== "NOT_VERIFIABLE").length;
        context.unavailable += rows.filter((r) => object(r).status === "NOT_VERIFIABLE").length;
      } else if (["breakout-unknown-barrier", "breakout-host-interruption"].includes(e.kind)) {
        technical.add(text(data.code) ?? "UNKNOWN_OUTCOME");
      }
    }
    if (compactRows > maximumCompactRows) {
      invalid("Fixed 28-day compact analysis population exceeded");
    }
  }
  if (
    !record ||
    canonicalRows !== manifest.source.rows ||
    canonical.digest("hex") !== manifest.source.sha256
  ) {
    invalid("Canonical financial snapshot inventory/hash mismatch");
  }
  if (
    canonicalBreakoutJson(record.config) !== canonicalBreakoutJson(manifest.config) ||
    accounts.size !== 3
  ) {
    invalid("Authoritative financial account/configuration inventory differs");
  }
  const T0 = record.acceptance.T0;
  const { TV, TF } = breakoutWindowTimes(T0);
  const effectByAttempt = new Map<string, FinancialEffect>();
  for (const effect of effects.values()) {
    effectByAttempt.set(`${effect.role}:${effect.attemptId}`, effect);
  }
  for (const [role, rows] of movements) {
    for (const movement of rows) {
      if (movement.kind === "initial") {
        continue;
      }
      const positionId =
        movement.kind === "funding"
          ? text(object(movement.evidence).positionId)
          : (effectByAttempt.get(`${role}:${movement.key.replace(/:(?:fee|pnl)$/, "")}`)
              ?.positionId ?? null);
      const position = positionId ? positions.get(`${role}:${positionId}`) : undefined;
      if (!position) {
        technical.add("NATIVE_MOVEMENT_POSITION_LINK_NOT_VERIFIABLE");
      } else {
        position.planned.movementKeys = [...position.planned.movementKeys, movement.key];
      }
    }
  }
  const confirmedObligations = new Set(
    [...effects.values()].map(
      (e) =>
        `${e.role}:${e.action}:${e.obligationId}:${e.originalOperationId}:${e.sourceOperationId}`,
    ),
  );
  const finals: BreakoutActionObligation[] = [...q.values()].map((value) => {
    const role = roleOf(value.role)!;
    const action = value.action as "OPEN" | "FULL_CLOSE";
    const id = text(value.actionObligationId)!;
    const executed = confirmedObligations.has(
      `${role}:${action}:${id}:${text(value.originalOperationId)}:${text(value.finalOperationId)}`,
    );
    const valid =
      value.originalSourceAssignedBeforeAcquisition === true &&
      finalSources.get(text(value.finalOperationId) ?? "")?.has(integer(value.marketId) ?? -1) ===
        true;
    return {
      protocolDigest: text(value.protocolDigest) ?? "",
      role,
      action,
      marketId: integer(value.marketId) ?? -1,
      actionObligationId: id,
      originalOperationId: text(value.originalOperationId) ?? "",
      scheduledAt: integer(value.scheduledAt) ?? -1,
      evidenceStatus: valid ? "VALID" : "UNPERFORMED",
      financialStatus: executed ? "CONFIRMED" : "UNATTEMPTED",
    };
  });
  const originalJournalDirectory = manifest.journalDirectory ?? directory;
  const originalEvidence = await verifyFinancialEvidence(
    originalJournalDirectory,
    manifest.evidence,
  );
  if (positions.size && originalEvidence.status !== "VERIFIED_EXACT_ORIGINAL_REFERENCES") {
    technical.add("ORIGINAL_FINANCIAL_EVIDENCE_NOT_VERIFIABLE");
  }
  const supervision = await analyzeFinancialClocks(
    originalJournalDirectory,
    manifest.clocks,
    effects,
    record.acceptance.acceptedClockCertificateIds,
    object(record.metadata).acceptedClockPolicy,
    provedNoEffectOperations,
  );
  if (!supervision.complete) {
    technical.add("EXPOSED_SUPERVISION_NOT_VERIFIABLE_OR_INCOMPLETE");
  }
  if (record.interruption) {
    technical.add(record.interruption);
  }
  if (!record.startedAt || record.status !== "completed" || manifest.capturedAt < TF) {
    technical.add("FIXED_FINANCIAL_WINDOW_NOT_COMPLETE");
  }
  for (const barrier of record.unknownBarriers) {
    technical.add(barrier.code);
  }
  const availability = breakoutAvailability(T0, cells, clocks);
  const financial: BreakoutArmFinancialEvidence[] = BREAKOUT_FINANCIAL_ROLES.map((role) => {
    const account = accounts.get(role)!;
    const own = [...positions.values()].filter((p) => p.role === role);
    const nativeCash = account.cash;
    const noUnknown =
      !pending[role] && !record!.unknownBarriers.some((b) => b.affectedRoles.includes(role));
    const provenance =
      (own.length === 0 || originalEvidence.status === "VERIFIED_EXACT_ORIGINAL_REFERENCES") &&
      own.every(
        (p) =>
          p.planned.episodeKey !== "NOT_VERIFIABLE" &&
          !!p.planned.openingActionObligationId &&
          !!p.planned.closingActionObligationId,
      );
    const emergency = account.blocked || account.dailyBlocked || historicalEmergencies.has(role);
    return {
      role,
      positions: own.map((p) => p.planned),
      movements: movements.get(role)!,
      nativeCashAtTF: nativeCash,
      unknownEffects: !noUnknown,
      authoritativelyFlatByTV:
        noUnknown &&
        account.positions.every((p) => p.closedAt !== null) &&
        own.every((p) => p.native.closedAt !== null && p.native.closedAt <= TV),
      heldFundingCompleteAtTF:
        !account.fundingPending && !account.fundingDisputed && own.every((p) => p.fundingComplete),
      provenanceComplete: provenance,
      ledgerReconciled: noUnknown,
      riskStatus: emergency
        ? "EMERGENCY_VERIFIED"
        : record!.status === "completed" && availability.passes95 && technical.size === 0
          ? "NO_EMERGENCY_VERIFIED"
          : "UNVERIFIABLE",
    };
  });
  const report = hourlyBreakoutScreenReport({
    T0,
    financial,
    availability,
    requiredFinals: breakoutRequiredFinals(T0, finals),
    technicalFailures: [...technical],
    exposedSupervisionComplete: supervision.complete,
    admittedProvenanceComplete: financial.every((a) => a.provenanceComplete),
    requiredExitsComplete:
      record.closeObligations.every((o) => o.state === "CONFIRMED") &&
      financial.every((a) => a.authoritativelyFlatByTV),
    P_context: context,
  });
  return {
    format: "hourly-breakout-financial-report-v1",
    analyzerCommit: checkoutCommit(),
    source: manifest.source,
    studyCommit: manifest.studyCommit,
    configHash: manifest.configHash,
    capturedAt: manifest.capturedAt,
    modelCalls: 0,
    tokens: 0,
    apiCostUSD: "0",
    newMonetaryReservationsUSD: "0",
    pending,
    pendingReservationAUSD: Object.fromEntries(
      BREAKOUT_FINANCIAL_ROLES.map((role) => [role, paperDecimal(reservationTotals[role])]),
    ),
    technicalFailures: [...technical].sort(),
    supervision,
    originalEvidence,
    graceAvailability: breakoutGraceAvailability(T0, graceRows),
    report,
    limitations: [
      "Local OS clock authority; external UTC accuracy unverified",
      "Offline export creates no authorization, receipt or recovered valuation",
      "No reconstruction of hypothetical portfolios or PTS financial performance",
    ],
  };
}

/** Reconstruct only from already encountered exact records. Later observations cannot fill a gap. */
export async function verifyFinancialEvidence(directory: string, parts: readonly JournalPart[]) {
  const versions = new Map<string, unknown>();
  const prepared = new Set<string>();
  const responses = new Set<string>();
  let versionRows = 0;
  let preparedRows = 0;
  let sourceCopies = 0;
  let missing = 0;
  for await (const raw of verifiedJournal(directory, parts)) {
    const record = object(raw);
    if (record.kind === "original-public-http-response") {
      if (typeof record.body !== "string" || bytesHash(record.body) !== record.bodySha256) {
        invalid("Original public HTTP bytes/hash differ");
      }
      responses.add(record.bodySha256 as string);
    } else if (record.kind === "original-candle-version") {
      const value = object(record.value);
      const hash = bytesHash(JSON.stringify(value));
      if (record.sha256 !== hash || !responses.has(text(value.responseSha256) ?? "")) {
        invalid("Original first/revised candle lacks its exact earlier HTTP body");
      }
      versions.set(hash, record.value);
      versionRows++;
      if (versions.size > 32768) {
        versions.delete(versions.keys().next().value!);
      }
    } else if (record.kind === "prepared-exact-reference") {
      const value = object(record.value);
      if (
        record.format !== "breakout-prepared-exact-reference-v1" ||
        !Array.isArray(value.versions) ||
        value.versions.length > 32768
      ) {
        invalid("Unknown or unbounded prepared reference packet");
      }
      const expanded = value.versions.map((key) => versions.get(String(key)));
      if (expanded.some((version) => version === undefined)) {
        missing++;
      } else if (bytesHash(JSON.stringify({ ...value, versions: expanded })) !== record.sha256) {
        invalid("Reconstructed exact prepared packet differs from its original bytes");
      } else {
        prepared.add(record.sha256 as string);
      }
      preparedRows++;
    } else if (record.kind === "source-copy-receipt") {
      if (!prepared.has(text(record.preparedSha256) ?? "")) {
        missing++;
      }
      const source = object(record.sourcePrice);
      if (
        bytesHash(JSON.stringify(source)) !== record.sourcePriceSha256 ||
        bytesHash(canonicalBreakoutJson(source.frames)) !== record.sourceSetIdentity
      ) {
        invalid("Original source copy differs from J/V source identities");
      }
      sourceCopies++;
    }
  }
  return {
    status:
      parts.length > 0 && missing === 0 ? "VERIFIED_EXACT_ORIGINAL_REFERENCES" : "NOT_VERIFIABLE",
    versionRows,
    preparedRows,
    sourceCopies,
    missingReferences: missing,
    interpretation:
      "First/revised native candles and raw HTTP bytes are retained; exact prepared packets expand only from earlier immutable records. Working version cache is bounded; missing references are never reconstructed from later data.",
  };
}

async function analyzeFinancialClocks(
  directory: string,
  parts: readonly JournalPart[],
  effects: Map<string, FinancialEffect>,
  acceptedCertificateIds: readonly string[],
  acceptedClockPolicy: unknown,
  provedNoEffectOperations: ReadonlySet<string>,
) {
  const active = new Map<
    string,
    {
      previous: BreakoutClockBoundary;
      marketId: number;
      certificate: BreakoutClockCertificate;
      intervals: number;
      failed: boolean;
    }
  >();
  const completed = new Map<
    string,
    { role: BreakoutFinancialRole; positionId: string; intervals: number; accepted: boolean }
  >();
  const seen = new Set<string>();
  let failureCount = 0;
  let boundaryCount = 0;
  for await (const raw of verifiedJournal(directory, parts)) {
    const record = raw as BreakoutClockRecord;
    const boundary = record.boundary;
    if (!boundary || !record.certificate || boundary.certificateId !== record.certificate.id) {
      invalid("Original paired clock certificate unavailable");
    }
    boundaryCount++;
    if (record.certificate.scope !== "financial-valuation") {
      continue;
    }
    const accepted = object(acceptedClockPolicy).certificate;
    if (
      !acceptedCertificateIds.includes(record.certificate.id) ||
      !accepted ||
      canonicalBreakoutJson(accepted) !== canonicalBreakoutJson(record.certificate)
    ) {
      invalid("Financial clock original certificate differs from separate immutable acceptance");
    }
    const effect = boundary.authoritativeRecordId
      ? effects.get(boundary.authoritativeRecordId)
      : undefined;
    const key = effect ? `${effect.role}:${effect.positionId}` : null;
    if (
      boundary.kind === "A_BEFORE_EFFECT" &&
      (effect?.action === "OPEN" ||
        (!effect && !provedNoEffectOperations.has(boundary.operationId)))
    ) {
      const openingKey = key ?? `${boundary.accountRole}:possible-effect:${boundary.operationId}`;
      if (seen.has(openingKey) || active.size >= 64 || !roleOf(boundary.accountRole)) {
        invalid("Duplicate opening or unbounded active exposure population");
      }
      seen.add(openingKey);
      active.set(openingKey, {
        previous: boundary,
        marketId: boundary.marketId ?? boundary.marketIds?.[0] ?? -1,
        certificate: record.certificate,
        intervals: 0,
        failed: false,
      });
    }
    for (const [id, exposure] of active) {
      const [role] = id.split(":");
      const marketId = exposure.marketId;
      const matches =
        boundary.kind === "K" ||
        (boundary.accountRole === role &&
          (boundary.marketId === marketId || boundary.marketIds?.includes(marketId ?? -1)));
      const closed = boundary.kind === "V_CLOSE" && key === id;
      if (
        ((boundary.kind === "V" && matches) || closed || boundary.kind === "K") &&
        boundary.id !== exposure.previous.id
      ) {
        const proof = compareBreakoutBoundaries(
          exposure.previous,
          boundary,
          [exposure.certificate, record.certificate],
          "financial-valuation",
        );
        if (proof.status !== "COMPLIANT") {
          exposure.failed = true;
          failureCount++;
        }
        // K checks the trailing gap but never advances the last exact financial valuation.
        if (boundary.kind !== "K") {
          exposure.previous = boundary;
          exposure.certificate = record.certificate;
          exposure.intervals++;
        }
      }
      if (closed) {
        completed.set(id, {
          role: effect!.role,
          positionId: effect!.positionId,
          intervals: exposure.intervals,
          accepted: !exposure.failed && exposure.intervals > 0,
        });
        active.delete(id);
      }
    }
  }
  const expected = [...effects.values()].filter((e) => e.action === "OPEN");
  return {
    boundaryCount,
    closedExposures: completed.size,
    pendingExposures: active.size,
    possibleUnresolvedOpeningAnchors: [...active.keys()].filter((key) =>
      key.includes(":possible-effect:"),
    ).length,
    failedIntervals: failureCount,
    missingOriginalOpeningProof: expected.filter((e) => !seen.has(`${e.role}:${e.positionId}`))
      .length,
    complete:
      parts.length > 0 &&
      active.size === 0 &&
      expected.every((e) => completed.get(`${e.role}:${e.positionId}`)?.accepted === true),
    exposures: [...completed.values()],
  };
}

const html = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[s]!,
  );
const csv = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
};

export async function renderFinancialAudit(input: {
  directory: string;
  manifest: FinancialAuditManifest;
  output: string;
  writer: ArtifactWriter;
}) {
  const result = await analyzeFinancialAudit(input.directory, input.manifest);
  await input.writer.write(
    join(input.output, "report.json"),
    Buffer.from(JSON.stringify(result) + "\n"),
  );
  const decisionParts: { file: string; rows: number; sha256: string; bytes: number }[] = [];
  let decisionLines = [
    "scheduled_at,original_operation,role,market_id,symbol,signal,proposal,discovery_state,blocking_reasons,allocation_id,attempt_id",
  ];
  let decisionBytes = Buffer.byteLength(decisionLines[0]! + "\n");
  let decisionRows = 0;
  const flushDecisions = async () => {
    if (decisionLines.length === 1) {
      return;
    }
    const bytes = Buffer.from(decisionLines.join("\n") + "\n");
    const file = `decisions-${String(decisionParts.length).padStart(6, "0")}.csv`;
    await input.writer.write(join(input.output, file), bytes);
    decisionParts.push({
      file,
      rows: decisionLines.length - 1,
      bytes: bytes.length,
      sha256: bytesHash(bytes),
    });
    decisionLines = [decisionLines[0]!];
    decisionBytes = Buffer.byteLength(decisionLines[0]! + "\n");
  };
  for await (const raw of verifiedJournal(input.directory, input.manifest.parts)) {
    const part = raw as PerpsBreakoutAuditPart;
    if (part.kind !== "event" || part.value.kind !== "breakout-discovery") {
      continue;
    }
    const data = object(part.value.data);
    const initial = object(data.initialEvidence);
    const original = object(initial.initial ?? initial);
    const markets = Array.isArray(original.markets) ? original.markets : [];
    const discoveries = Array.isArray(data.discoveries) ? data.discoveries : [];
    const sma = Array.isArray(initial.originalSmaProposals) ? initial.originalSmaProposals : [];
    const scheduledAt = integer(original.scheduledAt);
    if (scheduledAt === null) {
      continue;
    }
    for (const marketValue of markets) {
      const market = object(marketValue);
      for (const role of BREAKOUT_FINANCIAL_ROLES) {
        if (role !== "S" && scheduledAt % 3600000 !== 0) {
          continue;
        }
        const discovery = discoveries
          .map(object)
          .find((d) => d.role === role && d.marketId === market.marketId);
        const window = market.window as Parameters<typeof hourlyBreakoutSignal>[0] | null;
        const signal =
          role === "C" && window
            ? hourlyBreakoutSignal(window, (canonical) => bytesHash(canonical))
            : null;
        const smaProposal =
          role === "S" ? sma.map(object).find((p) => p.symbol === market.symbol) : undefined;
        const line = [
          scheduledAt,
          original.operationId,
          role,
          market.marketId,
          market.symbol,
          signal
            ? signal.status === "VALID"
              ? signal.raw
              : signal.reason
            : role === "L"
              ? "HOURLY_LONG_REFERENCE"
              : (smaProposal?.action ?? "NOT_VERIFIABLE"),
          discovery?.side ?? smaProposal?.action ?? "NO_RECORDED_ENTITLEMENT",
          discovery?.state ?? "NO_RECORDED_DISCOVERY",
          JSON.stringify(discovery?.initialBlockReasons ?? []),
          discovery?.allocationId ?? null,
          discovery?.attemptId ?? null,
        ]
          .map(csv)
          .join(",");
        if (decisionBytes + Buffer.byteLength(line) + 1 > 1024 * 1024) {
          await flushDecisions();
        }
        decisionLines.push(line);
        decisionBytes += Buffer.byteLength(line) + 1;
        decisionRows++;
      }
    }
  }
  await flushDecisions();
  await input.writer.write(
    join(input.output, "decision-detail-manifest.json"),
    Buffer.from(
      JSON.stringify({
        format: "hourly-breakout-decision-details-v1",
        rows: decisionRows,
        parts: decisionParts,
        interpretation:
          "Native saved initial proposals and consumed discoveries. Missing fields remain NOT_VERIFIABLE; no hypothetical fill or P&L.",
      }) + "\n",
    ),
  );
  const rows = result.report.arms.map((arm) => [
    arm.role,
    arm.status,
    arm.grossRealizedAUSD,
    arm.signedFeeAUSD,
    arm.recordedFundingAUSD,
    arm.netAUSD,
    arm.cashAUSD,
    arm.riskStatus,
  ]);
  const table = [
    "role",
    "status",
    "gross_realized_AUSD",
    "signed_fees_AUSD",
    "recorded_funding_AUSD",
    "final_net_AUSD",
    "cash_AUSD",
    "risk_status",
  ];
  await input.writer.write(
    join(input.output, "report.csv"),
    Buffer.from([table, ...rows].map((r) => r.map(csv).join(",")).join("\n") + "\n"),
  );
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Hourly breakout financial screen</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 20px;background:#10151d;color:#e2e8f0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #506078;padding:8px;text-align:left}a{color:#83c1ff}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Hourly breakout financial screen</h1><p>${html(result.report.economics)}</p><p>Captured native postings and independent C/S/L portfolios. N stays at 1,000 AUSD. P_context has no account or P&amp;L. API USD remains separate and is zero.</p><table><thead><tr>${table.map((h) => `<th>${html(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${html(v ?? "NOT_VERIFIABLE")}</td>`).join("")}</tr>`).join("")}</tbody></table><p><a href="report.json">Complete JSON evidence and metrics</a> · <a href="report.csv">Comparison CSV</a> · <a href="decision-detail-manifest.json">Per-market decision CSV parts</a></p><h2>Acceptance and evidence limits</h2><pre>${html(JSON.stringify({ flags: result.report.flags, technicalFailures: result.technicalFailures, fixedPopulations: BREAKOUT_FIXED_POPULATIONS, supervision: { ...result.supervision, exposures: undefined }, limitations: result.limitations }, null, 2))}</pre></html>`;
  await input.writer.write(join(input.output, "report.html"), Buffer.from(body));
  return result;
}

export async function runFinancialOfflineCommand(input: {
  command: string;
  state?: string | undefined;
  output?: string | undefined;
  signal: AbortSignal;
  envFile?: string | undefined;
  configPath?: string | undefined;
  acceptancePath?: string | undefined;
}) {
  if (!input.state || input.envFile || input.configPath || input.acceptancePath) {
    throw new PilotError(
      "INVALID_INPUT",
      "Offline financial audit rejects credentials, environment and configuration composition",
    );
  }
  if (!["audit", "replay", "report"].includes(input.command)) {
    throw new PilotError(
      "INVALID_INPUT",
      "Saved financial packets support offline audit/replay/report only; financial control uses explicit --config",
    );
  }
  input.signal.throwIfAborted();
  const manifestPath = resolve(input.state);
  const manifest = await readFinancialAuditManifest(manifestPath);
  const output = await newDirectory(input.output);
  const writer = budgetWriter(new ArtifactBudget());
  await renderFinancialAudit({ directory: dirname(manifestPath), manifest, output, writer });
  return { status: "OFFLINE_COMPLETE", output, modelCalls: 0, financialAcceptance: false };
}

const financialGenerationName = (value: unknown): value is string =>
  typeof value === "string" && /^generation-[a-z0-9-]{1,80}$/.test(value);
const financialGenerationFile = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(value);
const financialHash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

async function hashFinancialGenerationFile(path: string) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 64 * 1024 ** 3) {
    invalid("Derived financial output must be a bounded regular file");
  }
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) {
    hash.update(bytes);
  }
  const after = await lstat(path);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== before.size ||
    after.ino !== before.ino ||
    after.dev !== before.dev ||
    after.mtimeMs !== before.mtimeMs
  ) {
    invalid("Derived financial output changed during verification");
  }
  return { bytes: before.size, sha256: hash.digest("hex") };
}

async function verifyFinancialGeneration(root: string, generation: string, pinned?: string) {
  if (!financialGenerationName(generation)) {
    invalid("Allowlisted report generation required");
  }
  const directory = join(root, generation);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    invalid("Derived generation must be an original directory");
  }
  const manifestPath = join(directory, "verified-generation.json");
  const manifestInfo = await lstat(manifestPath);
  if (
    !manifestInfo.isFile() ||
    manifestInfo.isSymbolicLink() ||
    manifestInfo.size > 2 * 1024 ** 2
  ) {
    invalid("Derived financial manifest must be a bounded regular file");
  }
  const original = await readFile(manifestPath);
  const sha256 = bytesHash(original);
  if (pinned !== undefined && sha256 !== pinned) {
    invalid("Retained financial generation manifest differs from its published hash");
  }
  let value: Record<string, unknown>;
  try {
    value = object(JSON.parse(original.toString("utf8")));
  } catch {
    invalid("Derived financial manifest JSON is invalid");
  }
  const files = value.files;
  if (
    value.format !== "hourly-breakout-financial-generation-v1" ||
    value.generation !== generation ||
    !Array.isArray(files) ||
    files.length < 4 ||
    files.length > 4096
  ) {
    invalid("Derived financial manifest identity or inventory differs");
  }
  const names = new Set<string>();
  let bytes = original.length;
  for (const raw of files) {
    const file = object(raw);
    if (
      !financialGenerationFile(file.file) ||
      file.file === "verified-generation.json" ||
      names.has(file.file) ||
      !Number.isSafeInteger(file.bytes) ||
      Number(file.bytes) < 0 ||
      !financialHash(file.sha256)
    ) {
      invalid("Derived financial file inventory is unsafe or duplicated");
    }
    names.add(file.file);
    const measured = await hashFinancialGenerationFile(join(directory, file.file));
    if (measured.bytes !== file.bytes || measured.sha256 !== file.sha256) {
      invalid("Published financial output differs from its original byte hash");
    }
    bytes += measured.bytes;
    if (bytes > 64 * 1024 ** 3) {
      invalid("Derived financial generation exceeds its bounded byte envelope");
    }
  }
  for (const required of [
    "report.html",
    "report.json",
    "report.csv",
    "financial-audit-manifest.json",
  ]) {
    if (!names.has(required)) {
      invalid("Required financial output is absent");
    }
  }
  const actual = await readdir(directory, { withFileTypes: true });
  if (
    actual.length !== names.size + 1 ||
    actual.some(
      (file) =>
        !file.isFile() || (!names.has(file.name) && file.name !== "verified-generation.json"),
    )
  ) {
    invalid("Financial generation contains unmanifested files or unsafe paths");
  }
  return { sha256, bytes };
}

/** Publish only already-rendered local files; this boundary performs no database or provider work. */
export async function publishPreparedFinancialGeneration(input: {
  directory: string;
  generation: string;
  writer: ArtifactWriter;
  released(bytes: number): void;
}) {
  if (!financialGenerationName(input.generation)) {
    invalid("Allowlisted report generation required");
  }
  const path = join(input.directory, input.generation);
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    invalid("Financial generation must be an original directory");
  }
  const files = await readdir(path, { withFileTypes: true });
  if (files.length < 4 || files.length > 4096) {
    invalid("Bounded financial generation inventory required");
  }
  const hashes = [];
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      !file.isFile() ||
      !financialGenerationFile(file.name) ||
      file.name === "verified-generation.json"
    ) {
      invalid("Financial generation contains unsafe or unexpected files");
    }
    hashes.push({ file: file.name, ...(await hashFinancialGenerationFile(join(path, file.name))) });
  }
  await input.writer.write(
    join(path, "verified-generation.json"),
    Buffer.from(
      JSON.stringify({
        format: "hourly-breakout-financial-generation-v1",
        generation: input.generation,
        files: hashes,
      }) + "\n",
    ),
  );
  const current = await verifyFinancialGeneration(input.directory, input.generation);
  let previous: string | null = null;
  let previousHash: string | null = null;
  let older: string | null = null;
  let olderHash: string | null = null;
  let olderBytes = 0;
  let replaced = 0;
  const pointerPath = join(input.directory, "financial-report-current.json");
  try {
    const pointerInfo = await lstat(pointerPath);
    if (!pointerInfo.isFile() || pointerInfo.isSymbolicLink() || pointerInfo.size > 16384) {
      invalid("Financial report pointer must be a bounded regular file");
    }
    const pointer = object(await boundedJson(pointerPath));
    if (
      pointer.format !== "hourly-breakout-financial-pointer-v1" ||
      !financialGenerationName(pointer.current) ||
      pointer.current === input.generation ||
      !financialHash(pointer.manifestSha256) ||
      pointer.manifest !== `${pointer.current}/verified-generation.json` ||
      pointer.report !== `${pointer.current}/report.html` ||
      (pointer.previous !== null &&
        (!financialGenerationName(pointer.previous) || pointer.previous === pointer.current)) ||
      (pointer.previous === null
        ? pointer.previousManifestSha256 !== null
        : !financialHash(pointer.previousManifestSha256))
    ) {
      invalid("Published financial pointer identity differs");
    }
    previous = pointer.current;
    previousHash = pointer.manifestSha256;
    await verifyFinancialGeneration(input.directory, previous, previousHash);
    if (typeof pointer.previous === "string") {
      older = pointer.previous;
      olderHash = pointer.previousManifestSha256 as string;
      olderBytes = (await verifyFinancialGeneration(input.directory, older, olderHash)).bytes;
    }
    replaced = pointerInfo.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || replaced !== 0 || previous !== null) {
      throw error;
    }
    // Only an absent pointer is a first publication. Missing retained outputs must fail closed.
    try {
      await lstat(pointerPath);
      throw error;
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== "ENOENT") {
        throw missing;
      }
    }
  }
  const temporary = join(input.directory, `.financial-report-current-${randomUUID()}.tmp`);
  await input.writer.write(
    temporary,
    Buffer.from(
      JSON.stringify({
        format: "hourly-breakout-financial-pointer-v1",
        current: input.generation,
        previous,
        manifest: `${input.generation}/verified-generation.json`,
        manifestSha256: current.sha256,
        previousManifestSha256: previousHash,
        report: `${input.generation}/report.html`,
      }) + "\n",
    ),
  );
  // Recheck immediately before the atomic pointer switch. Failed generations stay unpublished.
  await verifyFinancialGeneration(input.directory, input.generation, current.sha256);
  if (previous && previousHash) {
    await verifyFinancialGeneration(input.directory, previous, previousHash);
  }
  await rename(temporary, pointerPath);
  input.released(replaced);
  if (older && olderHash) {
    await verifyFinancialGeneration(input.directory, older, olderHash);
    await rm(join(input.directory, older), { recursive: true });
    input.released(olderBytes);
  }
  return { generation: input.generation };
}

/** All generated files are one verified generation; pointer publication occurs last. */
export async function publishFinancialGeneration(input: {
  directory: string;
  generation: string;
  envFile: string;
  config: PerpsHourlyBreakoutConfig;
  writer: ArtifactWriter;
  budget: ArtifactBudget;
  released(bytes: number): void;
}) {
  if (!financialGenerationName(input.generation)) {
    invalid("Allowlisted report generation required");
  }
  const path = join(input.directory, input.generation);
  await mkdir(path, { mode: 0o700 });
  const manifest = await exportFinancialAudit({
    ...input,
    directory: path,
    referenceOriginalJournals: true,
  });
  await renderFinancialAudit({ directory: path, manifest, output: path, writer: input.writer });
  return publishPreparedFinancialGeneration(input);
}

/** Separate worker performs every historical read/export/analysis; execution never clones histories. */
export function runFinancialReportWorker(
  input: {
    directory: string;
    generation: string;
    envFile: string;
    config: PerpsHourlyBreakoutConfig;
  },
  budget: ArtifactBudget,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  return new Promise<void>((resolveWorker, rejectWorker) => {
    const workerModule = new URL("./financial-report-worker.ts", import.meta.url).href;
    const entry = `const { workerData } = require("node:worker_threads"); import("tsx/esm/api").then(({ tsImport }) => tsImport(workerData.module, ${JSON.stringify(import.meta.url)}));`;
    const worker = new Worker(entry, {
      eval: true,
      env: {},
      workerData: { ...input, module: workerModule },
      resourceLimits: { maxOldGenerationSizeMb: 768 },
    });
    let published = false;
    let failure: unknown;
    const abort = () => {
      failure ??= signal?.reason;
      void worker.terminate();
    };
    worker.on(
      "message",
      (message: {
        kind: string;
        id?: number;
        bytes?: number;
        code?: string;
        shared?: SharedArrayBuffer;
      }) => {
        try {
          if (message.kind === "reserve-sync") {
            if (!(message.shared instanceof SharedArrayBuffer)) {
              throw new PilotError(
                "BREAKOUT_REPORT_FAILED",
                "Missing synchronous byte-authority acknowledgement",
              );
            }
            const shared = new Int32Array(message.shared);
            try {
              budget.reserve(message.bytes ?? -1)();
              Atomics.store(shared, 0, 1);
            } catch (error) {
              failure ??= error;
              Atomics.store(shared, 0, 2);
            } finally {
              Atomics.notify(shared, 0);
            }
          } else if (message.kind === "reserve") {
            budget.reserve(message.bytes ?? -1)();
            worker.postMessage({ id: message.id, ok: true });
          } else if (message.kind === "released") {
            budget.release(message.bytes ?? -1);
          } else if (message.kind === "published") {
            published = true;
          } else {
            failure ??= new PilotError(
              message.code ?? "BREAKOUT_REPORT_FAILED",
              "Financial read-only report worker failed",
            );
          }
        } catch (error) {
          failure ??= error;
          worker.postMessage({ id: message.id, ok: false });
        }
      },
    );
    worker.once("error", () => {
      failure ??= new PilotError("BREAKOUT_REPORT_FAILED", "Financial report worker terminated");
    });
    worker.once("exit", (code) => {
      signal?.removeEventListener("abort", abort);
      if (failure || code !== 0 || !published) {
        rejectWorker(
          failure ??
            new PilotError("BREAKOUT_REPORT_FAILED", "Financial generation was not published"),
        );
      } else {
        resolveWorker();
      }
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}

export const financialReportSafeCode = safeCode;
