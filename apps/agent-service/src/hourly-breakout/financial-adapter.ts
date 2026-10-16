import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { PilotError, requireTool, type PerpFundingHistory } from "@pickler/core";
import {
  BREAKOUT_HOUR_MS,
  assertBreakoutAcceptance,
  assertHourlyBreakoutConfig,
  breakoutDueWork,
  breakoutWindowTimes,
  canonicalBreakoutJson,
  createHourlyBreakoutCoordinator,
  type BreakoutClockCertificate,
  type BreakoutInitialSet,
  type BreakoutRunAcceptance,
  type BreakoutScreenStore,
  type BreakoutWindow,
  type BreakoutFinalSet,
  type PerpsHourlyBreakoutConfig,
  type PerpsStudyLease,
} from "@pickler/trading/evaluation";
import {
  COMPONENT_PAPER_POLICY,
  transientPerpsData,
  validatePaperFrameSet,
} from "@pickler/trading/perps";
import { analyzePts } from "@pickler/trading/pts";
import type {
  BreakoutPreparedData,
  createHourlyBreakoutPublicReader,
} from "@pickler/agent-runtime/plugins/perps-paper/public-study";
import type { HourlyBreakoutCommandInput } from "./index.js";
import { createReportQueue } from "../perps-study/report-queue.js";
import { localStudyDatabase } from "../perps-study/database-env.js";
import { startAwakeGuard } from "./awake.js";
import {
  createBoundaryClock,
  createFinancialReceiptHooks,
  DatabaseClockSampleError,
  sampleDatabaseClock,
} from "./clock.js";
import {
  ArtifactBudget,
  SegmentedJournal,
  atomicJson,
  boundedJson,
  budgetWriter,
  bytesHash,
  checkoutCommit,
  digest,
  newDirectory,
  requireCleanCheckout,
  requireFreeSpace,
} from "./files.js";
import {
  exportFinancialAudit,
  renderFinancialAudit,
  runFinancialReportWorker,
} from "./financial-report.js";

export const FINANCIAL_RESOURCE_ENVELOPE = {
  artifactLimitBytes: 64 * 1024 ** 3,
  minimumFreeBytes: 80 * 1024 ** 3,
  terminalHeadroomBytes: 256 * 1024 ** 2,
} as const;

export interface FinancialAuthorityBundle {
  format: "hourly-breakout-financial-authority-v1";
  configHash: string;
  implementationCommit: string;
  acceptance: BreakoutRunAcceptance;
  resources: typeof FINANCIAL_RESOURCE_ENVELOPE;
  technical: { file: string; sha256: string };
  source: { file: string; sha256: string; manifestFile: string; manifestSha256: string };
  authorization: { file: string; sha256: string };
  clock: {
    scope: "financial-valuation";
    authority: "LOCAL_OS";
    externalUTC: "UNVERIFIED";
    policyId: string;
    policySha256: string;
    epochId: string;
    certificateId: string;
    certificate: BreakoutClockCertificate;
    sourceAuthority: {
      scope: "source-local";
      accepted: true;
      authority: "LOCAL_OS";
      externalUTC: "UNVERIFIED";
    };
    maximumBracketMs: number;
    maximumPairingDeviationMs: number;
  };
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const code = (error: unknown) =>
  error instanceof PilotError && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : "BREAKOUT_FINANCIAL_HOST_FAILED";
const failAuthority = (message: string): never => {
  throw new PilotError("BREAKOUT_FINANCIAL_AUTHORITY_INVALID", message);
};

/** Explicit future bundle verification is entirely offline and precedes all environment access. */
export async function validateFinancialAuthority(input: {
  config: PerpsHourlyBreakoutConfig;
  path: string;
  now: number;
  commit: string;
}) {
  assertHourlyBreakoutConfig(input.config);
  const authority = (await boundedJson(input.path, 1024 * 1024)) as FinancialAuthorityBundle;
  if (
    authority.format !== "hourly-breakout-financial-authority-v1" ||
    authority.configHash !== digest(input.config) ||
    authority.implementationCommit !== input.commit ||
    canonicalBreakoutJson(authority.resources) !==
      canonicalBreakoutJson(FINANCIAL_RESOURCE_ENVELOPE)
  ) {
    failAuthority(
      "Future authority must pin this exact disabled specification and tested implementation",
    );
  }
  assertBreakoutAcceptance(authority.acceptance, input.now);
  if (authority.acceptance.protocolDigest !== input.config.researchProtocolSha256) {
    failAuthority(
      "Financial authority protocolDigest must identify the reviewed final research protocol",
    );
  }
  if (authority.acceptance.T0 <= input.now) {
    failAuthority("A new future UTC-midnight start is required; started screens cannot resume");
  }
  const checked = async (reference: { file: string; sha256: string }) => {
    if (
      !reference ||
      !/^[a-f0-9]{64}$/.test(reference.sha256) ||
      typeof reference.file !== "string"
    ) {
      return failAuthority("Explicit hashed authority evidence required");
    }
    const file = resolve(dirname(input.path), reference.file);
    const value = await boundedJson(file, 4 * 1024 * 1024);
    const bytes = await readFile(file);
    if (bytesHash(bytes) !== reference.sha256) {
      return failAuthority("Future authority evidence byte hash mismatch");
    }
    return object(value);
  };
  const technical = await checked(authority.technical);
  const source = await checked(authority.source);
  const authorization = await checked(authority.authorization);
  if (
    authority.technical.sha256 !== authority.acceptance.technicalAcceptanceSha256 ||
    technical.format !== "hourly-breakout-technical-acceptance-v1" ||
    technical.status !== "PASS" ||
    technical.implementationCommit !== input.commit ||
    technical.configHash !== authority.configHash ||
    technical.resourcesSha256 !== digest(authority.resources)
  ) {
    failAuthority("Independent complete technical acceptance is required");
  }
  if (
    authority.source.sha256 !== authority.acceptance.sourceQualificationSha256 ||
    source.result !== "PASS_NONFINANCIAL_SOURCE_ACCEPTANCE" ||
    source.financialAcceptance !== false ||
    object(source.authority).externalUTC !== "UNVERIFIED"
  ) {
    failAuthority(
      "Pinned passing source continuity evidence is required and never establishes financial V",
    );
  }
  if (
    authority.authorization.sha256 !== authority.acceptance.financialAuthorizationSha256 ||
    authorization.format !== "hourly-breakout-operator-financial-authorization-v1" ||
    authorization.authorized !== true ||
    authorization.configHash !== authority.configHash ||
    authorization.implementationCommit !== input.commit ||
    authorization.T0 !== authority.acceptance.T0 ||
    object(authorization.operator).identity !== authority.acceptance.operator.identity ||
    authorization.acknowledgementSha256 !== authority.acceptance.operator.acknowledgementSha256 ||
    authorization.technicalAcceptanceSha256 !== authority.technical.sha256 ||
    authorization.sourceQualificationSha256 !== authority.source.sha256 ||
    authorization.clockPolicySha256 !== authority.clock.policySha256 ||
    authorization.resourcesSha256 !== digest(authority.resources)
  ) {
    failAuthority(
      "Separate explicit operator financial authorization and liability owner are required",
    );
  }
  const sourceManifestPath = resolve(dirname(input.path), authority.source.manifestFile);
  const { readSourceManifest, analyzeSource } = await import("./report.js");
  const sourceManifest = await readSourceManifest(sourceManifestPath);
  if (
    bytesHash(await readFile(sourceManifestPath)) !== authority.source.manifestSha256 ||
    sourceManifest.captureCommit !== input.commit
  ) {
    failAuthority("Source capture manifest byte hash or frozen code differs");
  }
  const replayedSource = await analyzeSource(dirname(sourceManifestPath), sourceManifest);
  if (
    replayedSource.result !== "PASS_NONFINANCIAL_SOURCE_ACCEPTANCE" ||
    replayedSource.sourceManifestHash !== source.sourceManifestHash
  ) {
    failAuthority("Original complete source journals do not reproduce the accepted source result");
  }
  const policy = authority.clock;
  const clockPolicy = {
    scope: policy?.scope,
    authority: policy?.authority,
    externalUTC: policy?.externalUTC,
    policyId: policy?.policyId,
    certificate: policy?.certificate,
    sourceAuthority: policy?.sourceAuthority,
    maximumBracketMs: policy?.maximumBracketMs,
    maximumPairingDeviationMs: policy?.maximumPairingDeviationMs,
  };
  if (
    policy?.scope !== "financial-valuation" ||
    policy.sourceAuthority?.scope !== "source-local" ||
    policy.sourceAuthority.accepted !== true ||
    policy.sourceAuthority.authority !== "LOCAL_OS" ||
    policy.sourceAuthority.externalUTC !== "UNVERIFIED" ||
    policy.authority !== "LOCAL_OS" ||
    policy.externalUTC !== "UNVERIFIED" ||
    typeof policy.policyId !== "string" ||
    !policy.policyId ||
    policy.policySha256 !== digest(clockPolicy) ||
    typeof policy.epochId !== "string" ||
    !policy.epochId ||
    typeof policy.certificateId !== "string" ||
    !authority.acceptance.acceptedClockCertificateIds.includes(policy.certificateId) ||
    !policy.certificate ||
    policy.certificate.id !== policy.certificateId ||
    policy.certificate.epochId !== policy.epochId ||
    policy.certificate.scope !== "financial-valuation" ||
    policy.certificate.accepted !== true ||
    policy.certificate.validFromMs > input.now ||
    policy.certificate.validUntilMs < breakoutWindowTimes(authority.acceptance.T0).TF ||
    !policy.certificate.provenance.includes(policy.policyId) ||
    !Number.isFinite(policy.maximumBracketMs) ||
    policy.maximumBracketMs <= 0 ||
    policy.maximumBracketMs > 1000 ||
    !Number.isFinite(policy.maximumPairingDeviationMs) ||
    policy.maximumPairingDeviationMs <= 0 ||
    policy.maximumPairingDeviationMs > 1000
  ) {
    failAuthority("A separately accepted finite financial clock mapping policy is required");
  }
  return authority;
}

export type BreakoutPublicReader = ReturnType<typeof createHourlyBreakoutPublicReader>;
type Captured = Awaited<ReturnType<BreakoutPublicReader["capture"]>>;

/** Preserve complete original candles and the first native receipt; never infer bytes from a hash. */
export function financialWindows(
  config: PerpsHourlyBreakoutConfig,
  prepared: BreakoutPreparedData,
  D: number,
): BreakoutWindow[] {
  const H = Math.floor(D / BREAKOUT_HOUR_MS) * BREAKOUT_HOUR_MS;
  return config.markets.flatMap((market) => {
    const series = prepared.candles.find(
      (s) => s.market.marketId === market.marketId && s.resolution === 3600 && s.to === H,
    );
    if (!series) {
      return [];
    }
    const candles = series.candles.slice(-22);
    if (
      candles.length !== 22 ||
      candles.some((c, i) => c.openTime !== H - (22 - i) * BREAKOUT_HOUR_MS || !c.closed)
    ) {
      return [];
    }
    const bars = candles.flatMap((candle) => {
      const version = prepared.versions.find(
        (v) =>
          v.marketId === market.marketId &&
          v.resolution === 3600 &&
          v.candle.openTime === candle.openTime &&
          canonicalBreakoutJson(v.candle) === canonicalBreakoutJson(candle),
      );
      if (!version || version.source.providerTimestamp === null || version.source.block === null) {
        return [];
      }
      return [
        {
          candle: structuredClone(candle) as typeof candle & Record<string, unknown>,
          provenance: {
            firstReceiptAt: version.firstReceivedAt,
            sourceRecordId: version.sourceRecordId,
            revisionId: version.contentHash,
            requestId: version.requestId,
            responseSha256: version.responseSha256,
            seriesTimestamp: version.source.providerTimestamp,
            seriesBlock: version.source.block,
            from: version.from,
            to: version.to,
            resolution: 3600 as const,
          },
        },
      ];
    });
    return bars.length === 22 ? [{ market: structuredClone(series.market), H, D, bars }] : [];
  });
}

export function financialInitialSet(
  config: PerpsHourlyBreakoutConfig,
  capture: Captured,
  operationId: string,
  scheduledAt: number,
  deadlineAt: number,
  funding: readonly PerpFundingHistory[] = [],
  marksOnly = true,
): BreakoutInitialSet {
  const D = capture.at;
  const windows = financialWindows(config, capture.prepared, D);
  return {
    operationId,
    scheduledAt,
    D,
    financialAt: D,
    receiptAt: D,
    sourceDeadlineAt: deadlineAt,
    markets: config.markets.map((market) => {
      const frame =
        capture.frames.find((f) => f.snapshot.market.marketId === market.marketId) ?? null;
      const window = windows.find((w) => w.market.marketId === market.marketId) ?? null;
      const common = capture.prepared.commonSymbols.includes(market.symbol);
      return {
        marketId: market.marketId,
        symbol: market.symbol,
        window,
        frame,
        financialReady: !!frame && common,
        unavailableReasons: [
          ...(!frame ? ["INITIAL_PRICE_UNAVAILABLE"] : []),
          ...(!common ? ["INITIAL_COMMON_HISTORY_UNAVAILABLE"] : []),
          ...(!window ? ["INITIAL_BREAKOUT_HISTORY_UNAVAILABLE"] : []),
        ],
      };
    }),
    observation: {
      frames: structuredClone(capture.frames),
      funding: structuredClone([...funding]),
      marksOnly,
    },
    smaEvidence: {
      observedAt: D,
      frames: structuredClone(capture.frames),
      candles: structuredClone(capture.prepared.candles),
      sourceIds: capture.frames.map((f) => f.hash),
      excluded: capture.excluded,
    },
  };
}

interface DriverStore extends BreakoutScreenStore {
  fundingRequirements(
    scope: PerpsHourlyBreakoutConfig,
    lease: PerpsStudyLease,
    options?: { after?: string; limit?: number },
  ): Promise<{
    rows: { key: string; symbol: string; marketId: number; from: number; to: number }[];
    nextCursor: string | null;
  }>;
}
export interface FinancialDriverDependencies {
  config: PerpsHourlyBreakoutConfig;
  acceptance: BreakoutRunAcceptance;
  store: DriverStore;
  lease: PerpsStudyLease;
  reader: BreakoutPublicReader;
  clock(): number;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  signal: AbortSignal;
  guard(): Promise<void>;
  evidence(kind: string, value: unknown): Promise<void>;
  progress(value: unknown): Promise<void>;
  reports(): void;
}

/** Single serialized financial loop; preparation/funding fetches never perform financial writes. */
export async function runFinancialDriver(deps: FinancialDriverDependencies) {
  const { config, acceptance, store, lease, reader, signal } = deps;
  const times = breakoutWindowTimes(acceptance.T0);
  const progress = {
    lastMinute: null as number | null,
    lastDecisionSlot: null as number | null,
    lastFundingMinute: null as number | null,
    admissionsClosed: false,
  };
  let prepared: BreakoutPreparedData = {
    candles: [],
    commonSymbols: [],
    ptsHistory: [],
    excluded: [],
    versions: [],
  };
  let preparationWork: Promise<void> | null = null;
  let fundingWork: Promise<void> | null = null;
  let backgroundFailure: unknown;
  let lastPreparation = -1;
  let fundingCursor: string | undefined;
  let freshFunding: PerpFundingHistory[] = [];
  let lastFunding = -1;
  let stoppedTechnical: string[] = [];
  const event = async (kind: string, value: unknown, key: string) => {
    await deps.guard();
    await store.event(config, lease, key, kind, value);
  };
  const capture = async (operationId: string, dueAt: number) => {
    const startedAt = deps.clock();
    const deadlineAt = Math.min(dueAt + 20_000, startedAt + 20_000);
    const value = await reader.capture({ operationId, dueAt, deadlineAt, signal });
    await deps.evidence("price-copy", { operationId, dueAt, deadlineAt, value });
    return { value, deadlineAt };
  };
  const coordinator = createHourlyBreakoutCoordinator({
    config,
    acceptance,
    repository: store,
    lease,
    clock: deps.clock,
    receiptClock: deps.clock,
    digest: (canonical) => bytesHash(canonical),
    async finalEvidence(request) {
      const startedAt = deps.clock();
      const originalEnd = request.initial.scheduledAt + 300_000;
      if (startedAt >= originalEnd) {
        throw new PilotError("DATA_UNAVAILABLE", "Original final window expired");
      }
      // Refresh only when the original selection crosses a native candle boundary. No initial
      // omission can become an opening: coordinator retains every original candidate identity.
      const stale = prepared.candles.some(
        (s) => s.to !== Math.floor(startedAt / (s.resolution * 1000)) * s.resolution * 1000,
      );
      if (stale) {
        // A final candle boundary may only cancel. Begin preparation outside this priority
        // path; never pause risk/valuation for another 60-second REST preparation here.
        startBackground(startedAt);
      }
      const captured = await capture(request.operationId, deps.clock());
      validatePaperFrameSet(
        captured.value.frames,
        config.network,
        deps.clock(),
        COMPONENT_PAPER_POLICY,
        deps.clock(),
      );
      const available = new Set(captured.value.frames.map((f) => f.snapshot.market.marketId));
      const source = financialInitialSet(
        config,
        captured.value,
        request.operationId,
        request.initial.scheduledAt,
        captured.deadlineAt,
        freshFunding,
        freshFunding.length === 0,
      );
      const final: BreakoutFinalSet = {
        operationId: request.operationId,
        initialOperationId: request.initial.operationId,
        H: Math.floor(request.initial.D / BREAKOUT_HOUR_MS) * BREAKOUT_HOUR_MS,
        financialAt: source.financialAt,
        receiptAt: source.receiptAt,
        sourceDeadlineAt: captured.deadlineAt,
        frames: captured.value.frames,
        windows: financialWindows(config, captured.value.prepared, captured.value.at),
        observation: source.observation,
        smaEvidence: source.smaEvidence,
      };
      await event(
        "breakout-host-final",
        {
          operationId: final.operationId,
          initialOperationId: final.initialOperationId,
          validMarketIds: [...available],
          sourceIdentity: digest(captured.value),
          finalSet: final,
        },
        `${final.operationId}:host-final`,
      );
      return structuredClone(final);
    },
  });
  function startBackground(at: number) {
    if (signal.aborted || at >= times.TV) {
      return;
    }
    const bucket = Math.floor((at - times.T0) / 300_000);
    if (!preparationWork && bucket !== lastPreparation) {
      lastPreparation = bucket;
      preparationWork = (async () => {
        prepared = await reader.prepare({
          operationId: `prepared:${bucket}`,
          dueAt: at,
          deadlineAt: at + 60_000,
          signal,
        });
        await deps.evidence("prepared", { operationId: `prepared:${bucket}`, at, value: prepared });
      })()
        .catch((error) => {
          if (!signal.aborted && !(error instanceof PilotError && transientPerpsData(error))) {
            backgroundFailure = error;
          }
        })
        .finally(() => {
          preparationWork = null;
        });
    }
    if (
      preparationWork ||
      fundingWork ||
      at < times.T0 ||
      Math.floor(at / 60_000) === lastFunding
    ) {
      return;
    }
    lastFunding = Math.floor(at / 60_000);
    fundingWork = (async () => {
      const page = await store.fundingRequirements(config, lease, {
        ...(fundingCursor ? { after: fundingCursor } : {}),
        limit: 8,
      });
      fundingCursor = page.nextCursor ?? undefined;
      if (page.rows.length) {
        const now = deps.clock();
        const result = await reader.reconcileRanges(
          {
            operationId: `funding:${now}`,
            dueAt: now,
            deadlineAt: Math.min(now + 20_000, times.TF),
            signal,
          },
          page.rows,
        );
        freshFunding = result.funding;
        await deps.evidence("funding-copy", { at: now, ...result });
      }
    })()
      .catch((error) => {
        if (!signal.aborted && !(error instanceof PilotError && transientPerpsData(error))) {
          backgroundFailure = error;
        }
      })
      .finally(() => {
        fundingWork = null;
      });
  }

  async function serviceMinute(at: number, phase: string) {
    progress.lastMinute = at;
    try {
      const captured = await capture(`minute:${at}`, at);
      const initial = financialInitialSet(
        config,
        captured.value,
        `minute:${at}`,
        at,
        captured.deadlineAt,
        freshFunding,
        freshFunding.length === 0,
      );
      freshFunding = [];
      const result = await coordinator.maintenance(initial, signal);
      stoppedTechnical = [...new Set([...stoppedTechnical, ...result.technicalFailures])];
      if (result.unknown || result.technicalFailures.length) {
        progress.admissionsClosed = true;
      }
      const valid = new Set(captured.value.frames.map((f) => f.snapshot.market.marketId));
      if (at < times.TA) {
        await event(
          "breakout-host-cells",
          {
            cells: config.markets.map((m) => ({
              population: "MARKET_MINUTE",
              marketId: m.marketId,
              scheduledAt: at,
              valid: valid.has(m.marketId),
              status: valid.has(m.marketId) ? "QUALIFIED_SOURCE_COPY" : "DATA_UNAVAILABLE",
            })),
            clocks: [
              {
                population: "MINUTE",
                scheduledAt: at,
                valid: valid.size === config.markets.length,
                status: result.status,
              },
            ],
          },
          `minute-cells:${at}`,
        );
      } else {
        await recordGraceMinute(at, valid);
      }
    } catch (error) {
      if (!(error instanceof PilotError && transientPerpsData(error))) {
        throw error;
      }
      if (at < times.TA) {
        await event(
          "breakout-host-cells",
          {
            cells: config.markets.map((m) => ({
              population: "MARKET_MINUTE",
              marketId: m.marketId,
              scheduledAt: at,
              valid: false,
              status: code(error),
            })),
            clocks: [{ population: "MINUTE", scheduledAt: at, valid: false, status: code(error) }],
          },
          `minute-cells:${at}`,
        );
      } else {
        await recordGraceMinute(at, new Set());
      }
    }
    await deps.progress({
      phase: phase,
      at: deps.clock(),
      originalMinute: at,
      progress,
      stoppedTechnical,
    });
  }
  async function recordGraceMinute(at: number, valid: ReadonlySet<number>) {
    await event(
      "breakout-host-grace-cells",
      {
        rows: [
          {
            scheduledAt: at,
            marketId: null,
            status: valid.size === config.markets.length ? "QUALIFIED" : "UNAVAILABLE",
          },
          ...config.markets.map((market) => ({
            scheduledAt: at,
            marketId: market.marketId,
            status: valid.has(market.marketId) ? "QUALIFIED" : "UNAVAILABLE",
          })),
        ],
      },
      `grace-minute:${at}`,
    );
  }
  async function recordMissedMinute(scheduledAt: number) {
    if (scheduledAt >= times.TA) {
      await recordGraceMinute(scheduledAt, new Set());
    } else {
      await event(
        "breakout-host-cells",
        {
          cells: config.markets.map((market) => ({
            population: "MARKET_MINUTE",
            marketId: market.marketId,
            scheduledAt,
            valid: false,
            status: "MISSED_ORIGINAL_MINUTE",
          })),
          clocks: [
            {
              population: "MINUTE",
              scheduledAt,
              valid: false,
              status: "MISSED_ORIGINAL_MINUTE",
            },
          ],
        },
        `missed-minute:${scheduledAt}`,
      );
    }
    progress.lastMinute = scheduledAt;
  }
  async function waitForPreparation() {
    // Only this serialized owner services finance. The REST task may continue independently,
    // but each newly due original minute is valued before the claimed decision resumes.
    while (preparationWork) {
      const originalWork = preparationWork;
      await Promise.race([originalWork, deps.sleep(1000, signal)]);
      await deps.guard();
      if (backgroundFailure) {
        throw backgroundFailure;
      }
      const due = breakoutDueWork(acceptance.T0, deps.clock(), progress);
      for (const scheduledAt of due.missedMinutes) {
        await recordMissedMinute(scheduledAt);
      }
      if (due.minute) {
        await serviceMinute(due.minute.scheduledAt, due.phase);
      }
    }
  }
  try {
    while (!signal.aborted) {
      await deps.guard();
      if (backgroundFailure) {
        throw backgroundFailure;
      }
      const now = deps.clock();
      const due = breakoutDueWork(acceptance.T0, now, progress);
      if (due.phase === "TERMINAL") {
        break;
      }
      if (due.phase === "WAITING") {
        startBackground(now);
        await deps.sleep(Math.max(1, Math.min(1000, acceptance.T0 - now)), signal);
        continue;
      }
      if (due.closeAdmissionsDue) {
        const closed = await store.closeAdmissions(
          config,
          lease,
          `fixed-admission-close:${times.TA}`,
        );
        if (closed.status !== "confirmed") {
          throw new PilotError(
            "ADMISSION_CLOSE_UNCONFIRMED",
            "Fixed admission closure did not confirm",
          );
        }
        progress.admissionsClosed = true;
      }
      for (const scheduledAt of due.missedMinutes) {
        await recordMissedMinute(scheduledAt);
      }
      for (const slot of due.missedDecisionSlots) {
        const at = times.T0 + slot * 300_000;
        await event(
          "breakout-host-cells",
          {
            cells: config.markets.flatMap((m) => [
              {
                population: "S_SIGNAL",
                marketId: m.marketId,
                scheduledAt: at,
                valid: false,
                status: "MISSED_ORIGINAL_SLOT",
              },
              {
                population: "S_INITIAL",
                marketId: m.marketId,
                scheduledAt: at,
                valid: false,
                status: "MISSED_ORIGINAL_SLOT",
              },
              ...(slot % 12 === 0
                ? ["C_SIGNAL", "C_INITIAL", "L_INITIAL"].map((population) => ({
                    population,
                    marketId: m.marketId,
                    scheduledAt: at,
                    valid: false,
                    status: "MISSED_ORIGINAL_SLOT",
                  }))
                : []),
            ]),
            clocks: [
              {
                population: "S_CLAIM",
                scheduledAt: at,
                valid: false,
                status: "MISSED_ORIGINAL_SLOT",
              },
              ...(slot % 12 === 0
                ? [
                    {
                      population: "C_CLAIM",
                      scheduledAt: at,
                      valid: false,
                      status: "MISSED_ORIGINAL_SLOT",
                    },
                  ]
                : []),
            ],
          },
          `missed-slot:${slot}`,
        );
        progress.lastDecisionSlot = slot;
      }
      let decisionClaimed = false;
      if (due.decision) {
        decisionClaimed = await store.claimSlot(config, lease, due.decision.slot);
        progress.lastDecisionSlot = due.decision.slot;
      }
      if (due.minute) {
        await serviceMinute(due.minute.scheduledAt, due.phase);
      }
      // Candle work follows the priority minute valuation. The claim is already durable; its
      // original five-minute window is never moved by this preparation or final refresh.
      if (decisionClaimed && due.decision) {
        startBackground(deps.clock());
        await waitForPreparation();
        if (backgroundFailure) {
          throw backgroundFailure;
        }
        const scheduledAt = due.decision.scheduledAt;
        const operationId = `decision:${due.decision.slot}`;
        try {
          const captured = await capture(operationId, deps.clock());
          const initial = financialInitialSet(
            config,
            captured.value,
            operationId,
            scheduledAt,
            captured.deadlineAt,
            freshFunding,
            freshFunding.length === 0,
          );
          freshFunding = [];
          const result = await coordinator.cycle(initial, signal);
          stoppedTechnical = [...new Set([...stoppedTechnical, ...result.technicalFailures])];
          if (result.unknown || result.technicalFailures.length) {
            progress.admissionsClosed = true;
          }
          const cells = config.markets.flatMap((m) => {
            const own = initial.markets.find((v) => v.marketId === m.marketId)!;
            return [
              {
                population: "S_SIGNAL",
                marketId: m.marketId,
                scheduledAt,
                valid: captured.value.prepared.commonSymbols.includes(m.symbol),
                status: captured.value.prepared.commonSymbols.includes(m.symbol)
                  ? "VALID"
                  : "DATA_UNAVAILABLE",
              },
              {
                population: "S_INITIAL",
                marketId: m.marketId,
                scheduledAt,
                valid: own.financialReady,
                status: own.financialReady ? "VALID" : "DATA_UNAVAILABLE",
              },
              ...(due.decision!.candidateHourly
                ? [
                    {
                      population: "C_SIGNAL",
                      marketId: m.marketId,
                      scheduledAt,
                      valid: own.window !== null,
                      status: own.window ? "VALID" : "DATA_UNAVAILABLE",
                    },
                    ...["C_INITIAL", "L_INITIAL"].map((population) => ({
                      population,
                      marketId: m.marketId,
                      scheduledAt,
                      valid: own.financialReady,
                      status: own.financialReady ? "VALID" : "DATA_UNAVAILABLE",
                    })),
                  ]
                : []),
            ];
          });
          await event(
            "breakout-host-cells",
            {
              cells,
              clocks: [
                {
                  population: "S_CLAIM",
                  scheduledAt,
                  valid: true,
                  status: "CLAIMED_ORIGINAL_SLOT",
                },
                ...(due.decision.candidateHourly
                  ? [
                      {
                        population: "C_CLAIM",
                        scheduledAt,
                        valid: true,
                        status: "CLAIMED_ORIGINAL_SLOT",
                      },
                    ]
                  : []),
              ],
              result,
            },
            `${operationId}:host-cells`,
          );
          if (due.decision.candidateHourly) {
            const rows = config.markets.map((m) => {
              const history = captured.value.prepared.ptsHistory.find(
                (h) => h.market.marketId === m.marketId,
              );
              if (!history) {
                return {
                  symbol: m.symbol,
                  marketId: m.marketId,
                  status: "NOT_VERIFIABLE",
                  reason: "PTS_CONTEXT_HISTORY_UNAVAILABLE",
                };
              }
              try {
                return {
                  symbol: m.symbol,
                  marketId: m.marketId,
                  status: "OBSERVED_CONTEXT_ONLY",
                  value: analyzePts(history, captured.value.at, "0.2.0-fast.2"),
                  sourceHistory: history,
                };
              } catch (error) {
                return {
                  symbol: m.symbol,
                  marketId: m.marketId,
                  status: "NOT_VERIFIABLE",
                  reason: code(error),
                };
              }
            });
            await event(
              "breakout-host-context",
              { operationId, at: captured.value.at, rows, positions: 0, pnl: null },
              `${operationId}:pts-context`,
            );
          }
        } catch (error) {
          if (!(error instanceof PilotError && transientPerpsData(error))) {
            throw error;
          }
          await event(
            "breakout-host-slot-unavailable",
            { operationId, scheduledAt, code: code(error), noRetry: true },
            `${operationId}:unavailable`,
          );
        }
        deps.reports();
      } else if (due.phase === "FUNDING" && due.fundingMinute !== null) {
        progress.lastFundingMinute = due.fundingMinute;
        const page = await store.fundingRequirements(config, lease, {
          ...(fundingCursor ? { after: fundingCursor } : {}),
          limit: 8,
        });
        fundingCursor = page.nextCursor ?? undefined;
        const nowAt = deps.clock();
        const funding = await reader.reconcileRanges(
          {
            operationId: `terminal-funding:${due.fundingMinute}`,
            dueAt: nowAt,
            deadlineAt: nowAt + 20_000,
            signal,
          },
          page.rows,
        );
        await deps.evidence("funding-copy", { at: nowAt, ...funding });
        const empty: Captured = {
          operationId: `funding:${due.fundingMinute}`,
          dueAt: due.fundingMinute,
          at: deps.clock(),
          frames: [],
          excluded: [],
          raw: null,
          prepared,
        };
        const initial = financialInitialSet(
          config,
          empty,
          empty.operationId,
          due.fundingMinute,
          nowAt + 20_000,
          funding.funding,
          false,
        );
        await coordinator.reconcileFunding(initial, signal);
        deps.reports();
      }
      startBackground(deps.clock());
      const after = deps.clock();
      const next = breakoutDueWork(acceptance.T0, after, progress).nextWakeAt;
      if (next !== null) {
        await deps.sleep(Math.max(1, Math.min(1000, next - after)), signal);
      }
    }
    signal.throwIfAborted();
    return { status: "FIXED_WINDOW_FINISHED", cutoffs: times, stoppedTechnical, progress };
  } finally {
    await Promise.all([preparationWork, fundingWork]);
  }
}

type FinancialCommand = HourlyBreakoutCommandInput & {
  config: PerpsHourlyBreakoutConfig;
  configText: string;
};

/** The shipped disabled template has no bundle; only a separate future approval may call this. */
export async function runAcceptedHourlyBreakout(input: FinancialCommand) {
  if (!input.acceptancePath || !input.envFile || !input.output || !input.configPath) {
    throw new PilotError(
      "BREAKOUT_FUTURE_FINANCIAL_AUTHORIZATION_REQUIRED",
      "Future accepted bundle, dedicated database file and new output are required",
    );
  }
  const authority = await validateFinancialAuthority({
    config: input.config,
    path: resolve(input.acceptancePath),
    now: Date.now(),
    commit: checkoutCommit(),
  });
  requireCleanCheckout();
  const directory = await newDirectory(input.output);
  await requireFreeSpace(directory, authority.resources.minimumFreeBytes);
  const budget = new ArtifactBudget(0, authority.resources.artifactLimitBytes);
  budget.reserve(authority.resources.terminalHeadroomBytes)();
  const writer = budgetWriter(budget);
  const journals = {
    clock: new SegmentedJournal(directory, "financial-clocks", budget),
    evidence: new SegmentedJournal(directory, "financial-evidence", budget),
  };
  let lastPreparedHash: string | null = null;
  const persistPrepared = (prepared: BreakoutPreparedData) => {
    const sha256 = digest(prepared);
    if (sha256 !== lastPreparedHash) {
      journals.evidence.append(
        {
          kind: "prepared-exact-reference",
          format: "breakout-prepared-exact-reference-v1",
          sha256,
          value: { ...prepared, versions: prepared.versions.map((version) => digest(version)) },
        },
        false,
      );
      lastPreparedHash = sha256;
    }
    return sha256;
  };
  const persistEvidence = (kind: string, value: unknown) => {
    const envelope = object(value);
    if (kind === "prepared") {
      const hash = persistPrepared(envelope.value as BreakoutPreparedData);
      journals.evidence.append({
        kind: "prepared-receipt",
        ...envelope,
        value: undefined,
        preparedSha256: hash,
      });
    } else if (kind === "price-copy") {
      const captured = envelope.value as Captured;
      const { prepared, ...price } = captured;
      journals.evidence.append({
        kind,
        ...envelope,
        value: undefined,
        preparedSha256: persistPrepared(prepared),
        sourcePriceSha256: digest(price),
      });
    } else {
      journals.evidence.append({ kind, value });
    }
  };
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  let failure: unknown;
  let rejectedDatabaseClock: DatabaseClockSampleError | undefined;
  let ownerLost = false;
  let lease: PerpsStudyLease | undefined;
  const stop = (error: unknown) => {
    failure ??= error;
    if (error instanceof PilotError && error.code === "LEASE_LOST") {
      ownerLost = true;
    }
    controller.abort(error);
  };
  const boundary = createBoundaryClock({
    scope: "financial-valuation",
    epochId: authority.clock.epochId,
    certificate: authority.clock.certificate,
    acceptance: {
      accepted: true,
      provenance: [
        "SEPARATE_EXPLICIT_FUTURE_FINANCIAL_CLOCK_AUTHORIZATION",
        authority.clock.policyId,
        authority.clock.policySha256,
      ],
    },
    appendAndSync(record) {
      if (
        record.ordered.monotonicAfter - record.ordered.monotonicBefore >
          authority.clock.maximumBracketMs ||
        Math.abs(
          record.ordered.wallAfter -
            record.ordered.wallBefore -
            (record.ordered.monotonicAfter - record.ordered.monotonicBefore),
        ) > authority.clock.maximumPairingDeviationMs
      ) {
        throw new PilotError(
          "CLOCK_PROOF_FAILURE",
          "Explicit financial clock-policy bounds exceeded",
        );
      }
      journals.clock.append(record);
    },
  });
  const sourceBoundary = createBoundaryClock({
    scope: "source-local",
    acceptance: {
      accepted: authority.clock.sourceAuthority.accepted,
      provenance: [
        "SEPARATE_EXPLICIT_FUTURE_SOURCE_LOCAL_AUTHORIZATION",
        authority.clock.policyId,
        authority.clock.policySha256,
      ],
    },
    appendAndSync(record) {
      journals.clock.append(record);
    },
  });
  const { createLocalPerpsLabStore, warmLocalPerpsLabStore, PostgresPerpsHourlyBreakoutStore } =
    await import("@pickler/infrastructure/perps-lab");
  const research = createLocalPerpsLabStore(
    await localStudyDatabase(resolve(input.envFile)),
    "execution",
    { failed: (error) => stop(error) },
  );
  const receiptHooks = createFinancialReceiptHooks({
    clock: boundary,
    getSourceIdentity: (context) => context.sourceIdentity,
    guard() {
      signal.throwIfAborted();
      if (ownerLost) {
        throw new PilotError("LEASE_LOST", "Financial owner lost");
      }
      lease?.assertActive?.();
    },
  });
  const store = new PostgresPerpsHourlyBreakoutStore(research.pool, {
    clock: Date.now,
    receiptClock: Date.now,
    financialReceipts: receiptHooks,
  });
  const financialDatabaseClock = async (kind: string) => {
    try {
      return await sampleDatabaseClock(
        () => store.sampleDatabaseClock(),
        undefined,
        (proof) => {
          journals.evidence.append({ kind, rejected: true, value: proof });
        },
      );
    } catch (error) {
      if (error instanceof DatabaseClockSampleError) {
        rejectedDatabaseClock ??= error;
      }
      throw error;
    }
  };
  let reader: BreakoutPublicReader | undefined;
  let renewal: Promise<void> | undefined;
  let monitor: Promise<void> | undefined;
  let awake: Awaited<ReturnType<typeof startAwakeGuard>> | undefined;
  let reports: ReturnType<typeof createReportQueue> | undefined;
  let generation = 0;
  const publishClockManifest = async () => {
    const updated = await atomicJson(
      directory,
      "financial-clock-manifest.json",
      {
        format: "hourly-breakout-financial-clock-manifest-v1",
        configHash: digest(input.config),
        parts: journals.clock.snapshot(),
        evidenceParts: journals.evidence.snapshot(),
        ...(rejectedDatabaseClock
          ? {
              clockFailure: {
                proof: rejectedDatabaseClock.proof,
                proofPersistenceCode: rejectedDatabaseClock.proofPersistenceCode ?? null,
              },
            }
          : {}),
      },
      writer,
    );
    budget.release(updated.replacedBytes);
  };
  const guard = async () => {
    signal.throwIfAborted();
    if (!lease || ownerLost) {
      throw new PilotError("LEASE_LOST", "Financial owner unavailable");
    }
    if ((await readFile(resolve(input.configPath!), "utf8")) !== input.configText) {
      throw new PilotError("CONFIG_CHANGED", "Frozen financial configuration changed");
    }
    await store.guard(input.config, lease);
  };
  try {
    const agent = await research.agent({
      tenantId: input.config.tenantId,
      agentId: input.config.agentId,
    });
    if (
      agent.paused ||
      agent.config.perpl?.version !== 2 ||
      agent.config.perpl.network !== input.config.network ||
      input.config.markets.some(
        (m) => !(agent.config.perpl!.markets as readonly string[]).includes(m.symbol),
      )
    ) {
      throw new PilotError(
        "CONFIG_CHANGED",
        "Existing public permissions differ from accepted financial screen",
      );
    }
    for (const tool of [
      "getPerpSnapshot",
      "getPerpOrderBook",
      "getPerpCandles",
      "getPerpFundingHistory",
    ] as const) {
      requireTool(agent.config, tool);
    }
    await warmLocalPerpsLabStore(research, signal);
    awake = await startAwakeGuard(stop);
    await store.initialize(
      input.config,
      {
        directory,
        commit: checkoutCommit(),
        configHash: digest(input.config),
        authorityHash: digest(authority),
        acceptedClockPolicy: authority.clock,
        resources: authority.resources,
      },
      authority.acceptance,
    );
    lease = await store.claim(input.config);
    journals.evidence.append({
      kind: "database-clock-compatibility-start",
      value: await financialDatabaseClock("database-clock-compatibility-start"),
    });
    await writer.write(
      join(directory, "financial-authority.json"),
      Buffer.from(JSON.stringify(authority) + "\n"),
    );
    await writer.write(
      join(directory, "STARTED"),
      Buffer.from(
        JSON.stringify({
          version: 10,
          protocol: input.config.protocol,
          cutoffs: breakoutWindowTimes(authority.acceptance.T0),
          modelCalls: 0,
        }) + "\n",
      ),
    );
    renewal = (async () => {
      while (!signal.aborted) {
        await wait(20_000, undefined, { signal });
        await awake!.check();
        await guard();
        await store.renew(input.config, lease!);
        journals.evidence.append(
          {
            kind: "database-clock-compatibility-renewal",
            value: await financialDatabaseClock("database-clock-compatibility-renewal"),
          },
          false,
        );
      }
    })().catch((error) => {
      if (!signal.aborted) {
        stop(error);
      }
    });
    monitor = (async () => {
      while (!signal.aborted) {
        await wait(1000, undefined, { signal });
        boundary.sample(
          { kind: "K", operationId: `financial-monitor:${Date.now()}` },
          () => undefined,
        );
      }
    })().catch((error) => {
      if (!signal.aborted) {
        stop(error);
      }
    });
    const { createHourlyBreakoutPublicReader: createReader } =
      await import("@pickler/agent-runtime/plugins/perps-paper/public-study");
    const underlyingReader = createReader(
      research,
      { tenantId: input.config.tenantId, agentId: input.config.agentId },
      input.config.markets,
      {
        guard,
        onCandleVersion(value) {
          journals.evidence.append(
            { kind: "original-candle-version", sha256: digest(value), value },
            false,
          );
        },
        async onResponse(value) {
          journals.evidence.append(
            { kind: "original-public-http-response", ...value, bodySha256: bytesHash(value.body) },
            false,
          );
        },
      },
    );
    reader = {
      ...underlyingReader,
      async capture(operation) {
        const original = await underlyingReader.capture(operation);
        const copied = sourceBoundary.sample(
          { kind: "K", operationId: `financial-source-copy:${operation.operationId}` },
          () => structuredClone(original),
        );
        const receipt = copied.record.boundary;
        const sourceSetIdentity = bytesHash(canonicalBreakoutJson(copied.value.frames));
        const { prepared: sourcePrepared, ...sourcePrice } = copied.value;
        journals.evidence.append({
          kind: "source-copy-receipt",
          sourcePrice,
          sourcePriceSha256: digest(sourcePrice),
          preparedSha256: persistPrepared(sourcePrepared),
          operationId: operation.operationId,
          sourceSetIdentity,
          originalCopyAt: copied.value.at,
          receipt: copied.record,
        });
        if (
          receipt.financial.upperMs >= operation.deadlineAt ||
          receipt.financial.lowerMs < operation.dueAt
        ) {
          throw new PilotError(
            "DATA_UNAVAILABLE",
            "Original financial source receipt missed its fixed acquisition window",
          );
        }
        for (const at of [
          Math.floor(receipt.financial.lowerMs),
          Math.ceil(receipt.financial.upperMs),
        ]) {
          validatePaperFrameSet(
            copied.value.frames,
            input.config.network,
            at,
            COMPONENT_PAPER_POLICY,
            at,
          );
        }
        for (const frame of copied.value.frames) {
          sourceBoundary.shared(
            {
              kind: "J",
              operationId: operation.operationId,
              marketId: frame.snapshot.market.marketId,
              sourceIdentity: frame.hash,
              acceptedProof: true,
            },
            copied.record,
          );
        }
        if (copied.value.frames.length) {
          sourceBoundary.shared(
            {
              kind: "J",
              operationId: operation.operationId,
              sourceIdentity: sourceSetIdentity,
              marketIds: copied.value.frames.map((f) => f.snapshot.market.marketId),
              acceptedProof: true,
            },
            copied.record,
          );
        }
        return copied.value;
      },
    };
    reports = createReportQueue(async () => {
      await publishClockManifest();
      await runFinancialReportWorker(
        {
          directory,
          generation: `generation-${String(generation++).padStart(6, "0")}`,
          envFile: input.envFile!,
          config: input.config,
        },
        budget,
        signal,
      );
    }, stop);
    await runFinancialDriver({
      config: input.config,
      acceptance: authority.acceptance,
      store,
      lease,
      reader,
      clock: Date.now,
      sleep: (milliseconds, sleepSignal) => wait(milliseconds, undefined, { signal: sleepSignal }),
      signal,
      guard,
      async evidence(kind, value) {
        persistEvidence(kind, value);
      },
      async progress(value) {
        const result = await atomicJson(
          directory,
          "status.json",
          {
            format: "hourly-breakout-financial-status-v1",
            ...object(value),
            cutoffs: breakoutWindowTimes(authority.acceptance.T0),
            modelCalls: 0,
            apiCostUSD: "0",
          },
          writer,
        );
        budget.release(result.replacedBytes);
      },
      reports: () => reports!.request(),
    });
  } catch (error) {
    stop(error);
    if (lease && !ownerLost) {
      try {
        await store.guard(input.config, lease);
        await store.event(
          input.config,
          lease,
          `host-interruption:${Date.now()}`,
          "breakout-host-interruption",
          { code: code(error), observedAt: Date.now() },
        );
      } catch (guardError) {
        if (guardError instanceof PilotError && guardError.code === "LEASE_LOST") {
          ownerLost = true;
        }
      }
    }
  } finally {
    controller.abort(
      failure ?? new PilotError("FINANCIAL_SCREEN_FINISHED", "Fixed financial screen finished"),
    );
    await reader?.close().catch((error) => {
      failure ??= error;
    });
    await Promise.allSettled(
      [renewal, monitor].filter((task): task is Promise<void> => Boolean(task)),
    );
    awake?.stop();
    if (lease && !ownerLost) {
      try {
        await store.guard(input.config, lease);
        await store.release(input.config, lease, failure ? code(failure) : undefined);
      } catch (error) {
        failure ??= error;
      }
    }
    await research.pool.end().catch((error) => {
      failure ??= error;
    });
    journals.clock.seal();
    journals.evidence.seal();
    budget.release(authority.resources.terminalHeadroomBytes);
    await publishClockManifest();
    await reports?.flush().catch((error) => {
      failure ??= error;
    });
    if (lease) {
      await runFinancialReportWorker(
        {
          directory,
          generation: `generation-${String(generation++).padStart(6, "0")}`,
          envFile: input.envFile,
          config: input.config,
        },
        budget,
      ).catch((error) => {
        failure ??= error;
      });
    }
  }
  if (failure) {
    throw failure;
  }
  return {
    directory,
    status: "FIXED_FINANCIAL_WINDOW_FINISHED",
    cutoffs: breakoutWindowTimes(authority.acceptance.T0),
  };
}

export async function runFinancialReadCommand(input: FinancialCommand) {
  if (!input.envFile) {
    throw new PilotError(
      "INVALID_INPUT",
      "Financial status/report/export/control requires a dedicated loopback DATABASE_URL-only file",
    );
  }
  input.signal.throwIfAborted();
  const { createLocalPerpsLabStore, PostgresPerpsHourlyBreakoutStore } =
    await import("@pickler/infrastructure/perps-lab");
  if (input.command === "status" || input.command === "stop") {
    const research = createLocalPerpsLabStore(
      await localStudyDatabase(resolve(input.envFile)),
      input.command === "stop" ? "execution" : "report",
    );
    try {
      const store = new PostgresPerpsHourlyBreakoutStore(research.pool);
      if (input.command === "stop") {
        await store.stopAdmissionsExternal(input.config);
      }
      const view = await store.viewRecord(input.config);
      console.log(
        JSON.stringify({
          status: view.record.status,
          processLiveness: "UNVERIFIED_READ_ONLY_STATUS",
          admissionsClosed: view.record.admissionsClosed,
          stopRequestsAdmissionsOnly: input.command === "stop",
          cutoffs: breakoutWindowTimes(view.record.acceptance.T0),
          unknownBarriers: view.record.unknownBarriers,
          pendingCounts: view.pendingCounts,
          pendingInventoryValid: view.pendingInventoryValid,
          interruption: view.record.interruption,
          modelCalls: 0,
        }),
      );
      return;
    } finally {
      await research.pool.end();
    }
  }
  if (!["report", "audit-export"].includes(input.command)) {
    throw new PilotError("INVALID_INPUT", "Unsupported financial read command");
  }
  const directory = await newDirectory(input.output);
  const budget = new ArtifactBudget();
  const writer = budgetWriter(budget);
  const manifest = await exportFinancialAudit({
    config: input.config,
    envFile: input.envFile,
    directory,
    budget,
    writer,
    signal: input.signal,
  });
  if (input.command === "report") {
    await renderFinancialAudit({ directory, manifest, output: directory, writer });
  }
  console.log(
    JSON.stringify({
      status: "READ_ONLY_COMPLETE",
      directory,
      command: input.command,
      financialAcceptance: false,
      modelCalls: 0,
    }),
  );
}
