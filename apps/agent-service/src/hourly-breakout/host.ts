import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { PilotError, requireTool, type AgentRecord } from "@pickler/core";
import type { PerpsHourlyBreakoutConfig, PerpsStudyLease } from "@pickler/trading/evaluation";
import type {
  BreakoutPreparedData,
  createHourlyBreakoutPublicReader,
} from "@pickler/agent-runtime/plugins/perps-paper/public-study";
import { localStudyDatabase } from "../perps-study/database-env.js";
import { createReportQueue } from "../perps-study/report-queue.js";
import { startAwakeGuard } from "./awake.js";
import { createBoundaryClock, DatabaseClockSampleError } from "./clock.js";
import {
  createSourceDatabaseClock,
  SOURCE_DATABASE_CLOCK_POLICY,
} from "./source-database-clock.js";
import {
  ArtifactBudget,
  BREAKOUT_BYTES,
  SegmentedJournal,
  atomicJson,
  budgetWriter,
  bytesHash,
  checkoutCommit,
  digest,
  newDirectory,
  requireCleanCheckout,
  requireFreeSpace,
  type ArtifactWriter,
} from "./files.js";
import {
  CAPTURE_GRID,
  freezeSourceWindow,
  runBackgroundPreparation,
  runSourceWindows,
} from "./schedule.js";
import { runSourceReportWorker } from "./report-worker-client.js";
import type { PumpRecord, SourceManifest } from "./report.js";
import { qualifySourceFrames } from "./source-qualification.js";

function safeCode(error: unknown): string {
  return error instanceof PilotError && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : "BREAKOUT_CAPTURE_FAILED";
}

/** Technical diagnostic cleanup stays ownership-fenced even when clock qualification fails. */
export async function cleanupDiagnosticOwnership(input: {
  ownershipLost: boolean;
  failure?: unknown;
  guard(): Promise<void>;
  sampleClock(): Promise<void>;
  verifyNoAccounts(): Promise<void>;
  release(failureCode?: string): Promise<void>;
  event(value: { kind: "diagnostic-release-acknowledged"; at: number }): void | Promise<void>;
}) {
  let ownershipLost = input.ownershipLost;
  let failure = input.failure;
  let leaseReleased = false;
  const failureCodes: string[] = [];
  const retain = (error: unknown) => {
    failure ??= error;
    const code = safeCode(error);
    failureCodes.push(code);
    ownershipLost ||= code === "LEASE_LOST";
  };
  const result = () => ({ leaseReleased, ownershipLost, failure, failureCodes });
  if (ownershipLost) {
    return result();
  }
  try {
    await input.guard();
  } catch (error) {
    retain(error);
    return result();
  }
  for (const check of [input.sampleClock, input.verifyNoAccounts]) {
    try {
      await check();
    } catch (error) {
      retain(error);
    }
    if (ownershipLost) {
      return result();
    }
  }
  // This releases only the diagnostic lease. The adapter checks current ownership under lock;
  // it neither accepts financial work nor repairs any interrupted historical record.
  try {
    await input.release(failure ? safeCode(failure) : undefined);
    leaseReleased = true;
    await input.event({ kind: "diagnostic-release-acknowledged", at: Date.now() });
  } catch (error) {
    retain(error);
  }
  return result();
}

async function verifyAgent(agent: AgentRecord, config: PerpsHourlyBreakoutConfig) {
  const perpl = agent.config.perpl;
  if (
    agent.id !== config.agentId ||
    agent.tenantId !== config.tenantId ||
    agent.paused ||
    perpl?.version !== 2 ||
    perpl.network !== config.network ||
    config.markets.some((market) => !perpl.markets.includes(market.symbol))
  ) {
    throw new PilotError(
      "CONFIG_CHANGED",
      "Existing public-data permission does not match frozen capture",
    );
  }
  for (const tool of ["getPerpSnapshot", "getPerpOrderBook", "getPerpCandles"] as const) {
    requireTool(agent.config, tool);
  }
  return { id: agent.id, version: agent.version, permissionHash: digest(agent.config.perpl) };
}

export async function localPreflight(input: {
  config: PerpsHourlyBreakoutConfig;
  envFile: string;
  output: string;
  signal: AbortSignal;
  writer?: ArtifactWriter;
}) {
  const { PostgresResearchStore } = await import("@pickler/infrastructure/perps-lab");
  const research = new PostgresResearchStore(await localStudyDatabase(resolve(input.envFile)));
  try {
    input.signal.throwIfAborted();
    const permission = await verifyAgent(
      await research.agent({
        tenantId: input.config.tenantId,
        agentId: input.config.agentId,
      }),
      input.config,
    );
    const freeSpace = await requireFreeSpace(input.output);
    let awakeFailure: PilotError | undefined;
    const awake = await startAwakeGuard((error) => {
      awakeFailure = error;
    });
    try {
      await awake.check();
      if (awakeFailure) {
        throw awakeFailure;
      }
    } finally {
      awake.stop();
    }
    const { PostgresPerpsDiagnosticStore } = await import("@pickler/infrastructure/perps-lab");
    const store = new PostgresPerpsDiagnosticStore(research.pool);
    const databaseClock = await createSourceDatabaseClock().sample(
      () => store.sampleDatabaseClock(),
      async (proof) => {
        const writer = input.writer ?? budgetWriter(new ArtifactBudget());
        await writer.write(
          join(input.output, "preflight-clock-rejected.json"),
          Buffer.from(
            JSON.stringify({
              format: "hourly-breakout-preflight-clock-rejection-v1",
              phase: "LOCAL_PREFLIGHT_NO_PUBLIC_REQUESTS",
              proof,
              publicRequests: 0,
              modelCalls: 0,
              financialAcceptance: false,
              externalUTC: "UNVERIFIED",
            }) + "\n",
          ),
        );
      },
    );
    return {
      format: "hourly-breakout-local-preflight-v2",
      status: "LOCAL_ONLY_PREPARED_NOT_STARTED",
      completedAt: Date.now(),
      commit: checkoutCommit(),
      configHash: digest(input.config),
      permission,
      freeSpace,
      databaseClock,
      databaseClockPolicy: SOURCE_DATABASE_CLOCK_POLICY,
      databaseClockPolicyHash: digest(SOURCE_DATABASE_CLOCK_POLICY),
      publicRequests: 0,
      modelCalls: 0,
      financialAcceptance: false,
      externalUTC: "UNVERIFIED",
    };
  } finally {
    await research.pool.end();
  }
}

/** The only public command here is this explicitly selected one-shot source capture. */
export async function runSourceCapture(input: {
  config: PerpsHourlyBreakoutConfig;
  configPath: string;
  configText: string;
  envFile: string;
  output: string;
  signal: AbortSignal;
}) {
  requireCleanCheckout();
  const directory = await newDirectory(input.output);
  const budget = new ArtifactBudget();
  // A fixed-population terminal report must remain writable if original evidence exhausts
  // its share of the common ceiling. This is part of the same 16 GiB budget, not extra space.
  const terminalReportBytes = 128 * 1024 * 1024;
  const terminalReservation = budget.reserve(terminalReportBytes);
  // Reserve the exact externally written STOP marker before any capture/report writer starts.
  // This reservation stays counted even if no stop is requested, so a second process cannot
  // race the shared ceiling by adding unreserved control bytes.
  budget.reserve(Buffer.byteLength("OPERATOR_STOP\n"))();
  const writer = budgetWriter(budget);
  const preflight = await localPreflight({ ...input, output: directory, writer });
  const databaseClockObserver = createSourceDatabaseClock({ previous: preflight.databaseClock });
  // Every clock, denominator and immutable identity is fixed before any public import/call.
  const frozen = freezeSourceWindow(preflight.completedAt);
  await writer.write(
    join(directory, "STARTED"),
    Buffer.from(
      JSON.stringify({
        status: "ONE_SHOT_SOURCE_CAPTURE",
        configHash: digest(input.config),
        frozen,
      }) + "\n",
    ),
  );
  await writer.write(
    join(directory, "preflight.json"),
    Buffer.from(JSON.stringify(preflight) + "\n"),
  );
  const journals = {
    snapshots: new SegmentedJournal(directory, "snapshots", budget),
    clocks: new SegmentedJournal(directory, "clocks", budget),
    prepared: new SegmentedJournal(directory, "prepared", budget),
    versions: new SegmentedJournal(directory, "versions", budget),
    wire: new SegmentedJournal(directory, "wire", budget),
    http: new SegmentedJournal(directory, "http", budget),
    control: new SegmentedJournal(directory, "control", budget),
  };
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  let failure: unknown;
  let rejectedDatabaseClock: DatabaseClockSampleError | undefined;
  let ownershipLost = false;
  const fail = (error: unknown) => {
    if (error instanceof PilotError && error.code === "LEASE_LOST") {
      ownershipLost = true;
    }
    failure ??= error;
    controller.abort(error);
  };
  const clock = createBoundaryClock({
    appendAndSync: (record) => journals.clocks.append(record),
    scope: "source-local",
    acceptance: {
      accepted: true,
      provenance: [
        "OPERATOR_ACCEPTED_LOCAL_OS_SOURCE_JOURNAL_AUTHORITY",
        "CONDITIONAL_LOCAL_PAIRING_ONLY_NO_INDEPENDENT_UTC_OR_FUTURE_DRIFT_CLAIM",
      ],
    },
  });
  const { createLocalPerpsLabStore, PostgresPerpsDiagnosticStore } =
    await import("@pickler/infrastructure/perps-lab");
  const research = createLocalPerpsLabStore(
    await localStudyDatabase(resolve(input.envFile)),
    "execution",
    {
      failed: (error) => fail(error),
    },
  );
  const store = new PostgresPerpsDiagnosticStore(research.pool);
  const diagnosticScope = {
    tenantId: input.config.tenantId,
    sessionId: `breakout-source-${randomUUID()}`,
    network: input.config.network,
  };
  let lease: PerpsStudyLease | undefined;
  let reader: ReturnType<typeof createHourlyBreakoutPublicReader> | undefined;
  let awake: Awaited<ReturnType<typeof startAwakeGuard>> | undefined;
  let state: SourceManifest["processState"] = "running";
  let ready = false;
  let count = 0;
  let wireBytes = 0;
  let wireTruncated = false;
  let firstWireOmittedAt: number | null = null;
  let firstAttemptAt: number | null = null;
  let metadataAndWebSocketReadyAt: number | null = null;
  const preparations = new Set<string>();
  let renewal: Promise<void> | undefined;
  let monitor: Promise<void> | undefined;
  let background: Promise<void> | undefined;
  let reportSequence = 0;
  const cleanup = { socketClosed: false, leaseReleased: false, poolClosed: false };
  const manifest = (): SourceManifest => ({
    format: "hourly-breakout-source-capture-v1",
    protocol: input.config.protocol,
    version: 10,
    config: input.config,
    configHash: digest(input.config),
    captureCommit: preflight.commit,
    frozen,
    processState: state,
    failureCode: failure ? safeCode(failure) : null,
    databaseClockPolicy: SOURCE_DATABASE_CLOCK_POLICY,
    databaseClockPolicyHash: digest(SOURCE_DATABASE_CLOCK_POLICY),
    ...(rejectedDatabaseClock
      ? {
          clockFailure: {
            proof: rejectedDatabaseClock.proof,
            proofPersistenceCode: rejectedDatabaseClock.proofPersistenceCode ?? null,
          },
        }
      : {}),
    journals: Object.fromEntries(
      Object.entries(journals).map(([key, journal]) => [key, journal.snapshot()]),
    ) as SourceManifest["journals"],
    wire: {
      truncated: wireTruncated,
      retainedBytes: wireBytes,
      maximumBytes: BREAKOUT_BYTES.wirePrefix,
      firstOmittedAt: firstWireOmittedAt,
    },
    coldStart: {
      firstAttemptAt,
      metadataAndWebSocketReadyAt,
      within20Seconds:
        firstAttemptAt === null || metadataAndWebSocketReadyAt === null
          ? null
          : metadataAndWebSocketReadyAt - firstAttemptAt < 20000,
    },
    artifactBudget: budget.snapshot(),
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
    cleanup: { ...cleanup },
    stopMarkerReservedBytes: 14,
  });
  const publishManifest = async (frozenManifest: SourceManifest) => {
    const result = await atomicJson(directory, "source-manifest.json", frozenManifest, writer);
    budget.release(result.replacedBytes);
  };
  const reports = createReportQueue(async () => {
    const frozenManifest = manifest();
    await publishManifest(frozenManifest);
    await runSourceReportWorker(
      {
        sourceDirectory: directory,
        outputDirectory: directory,
        manifest: frozenManifest,
        generation: `generation-${String(reportSequence++).padStart(6, "0")}`,
      },
      budget,
      input.signal,
    );
  }, fail);
  const savePrepared = (value: BreakoutPreparedData) => {
    const hash = digest(value);
    if (!preparations.has(hash)) {
      journals.prepared.append({ kind: "prepared", hash, value });
      preparations.add(hash);
    }
    return hash;
  };
  const startPreparation = () => {
    if (background || signal.aborted) {
      return;
    }
    background = runBackgroundPreparation({
      startsAt: frozen.startsAt,
      endsAt: frozen.endsAt,
      signal,
      async prepare(operationId, dueAt, deadlineAt) {
        const prepared = await reader!.prepare({ operationId, dueAt, deadlineAt, signal });
        event({
          kind: "preparation-round",
          operationId,
          dueAt,
          completedAt: Date.now(),
          preparedHash: savePrepared(prepared),
          commonSymbols: prepared.commonSymbols,
        });
        reports.request();
      },
      missed(operationId, dueAt, reason) {
        event({ kind: "preparation-missed", operationId, dueAt, reason });
      },
      failed: fail,
    });
  };
  const guard = async () => {
    signal.throwIfAborted();
    if (!lease) {
      throw new PilotError("LEASE_LOST", "No diagnostic ownership exists");
    }
    try {
      await lstat(join(directory, "STOP"));
      throw new PilotError("OPERATOR_STOP", "Operator requested local capture stop");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    if ((await readFile(resolve(input.configPath), "utf8")) !== input.configText) {
      throw new PilotError("CONFIG_CHANGED", "Frozen source configuration changed");
    }
    await store.guard(diagnosticScope, lease);
  };
  const event = (value: unknown) => journals.control.append(value);
  const sourceDatabaseClock = async (kind: string, context: Record<string, unknown> = {}) => {
    try {
      return await databaseClockObserver.sample(
        () => store.sampleDatabaseClock(),
        (proof) => {
          event({ kind, ...context, rejected: true, sample: proof });
        },
      );
    } catch (error) {
      if (error instanceof DatabaseClockSampleError) {
        rejectedDatabaseClock ??= error;
      }
      throw error;
    }
  };
  try {
    await store.initialize({
      ...diagnosticScope,
      agentId: input.config.agentId,
      protocolId: "hourly-breakout-source-journal@1",
      protocolSha256: input.config.researchProtocolSha256,
      metadata: {
        configHash: digest(input.config),
        commit: preflight.commit,
        frozen,
        directory,
        databaseClockPolicy: SOURCE_DATABASE_CLOCK_POLICY,
        databaseClockPolicyHash: digest(SOURCE_DATABASE_CLOCK_POLICY),
      },
    });
    lease = await store.claim(diagnosticScope);
    event({
      kind: "diagnostic-claimed",
      diagnosticScope,
      at: Date.now(),
      leaseMs: 90000,
      renewalMs: 20000,
    });
    event({
      kind: "database-clock-preflight",
      sample: preflight.databaseClock,
    });
    event({
      kind: "database-clock-start",
      sample: await sourceDatabaseClock("database-clock-start"),
    });
    awake = await startAwakeGuard(fail);
    renewal = (async () => {
      while (!signal.aborted) {
        await wait(CAPTURE_GRID.renewalMs, undefined, { signal });
        await awake!.check();
        await guard();
        const before = clock.sample(
          { kind: "K", operationId: "lease-renewal-send" },
          () => undefined,
        );
        lease = await store.renew(diagnosticScope, lease!);
        const after = clock.sample(
          { kind: "K", operationId: "lease-renewal-receipt" },
          () => undefined,
        );
        event({
          kind: "database-clock-renewal",
          before: before.record.boundary,
          after: after.record.boundary,
          sample: await sourceDatabaseClock("database-clock-renewal", {
            before: before.record.boundary,
            after: after.record.boundary,
          }),
        });
      }
    })().catch((error) => {
      if (!signal.aborted) {
        fail(error);
      }
    });
    const { createHourlyBreakoutPublicReader: createReader } =
      await import("@pickler/agent-runtime/plugins/perps-paper/public-study");
    reader = createReader(
      research,
      { tenantId: input.config.tenantId, agentId: input.config.agentId },
      input.config.markets,
      {
        guard,
        onStream(value) {
          if (wireTruncated) {
            return;
          }
          const size = Buffer.byteLength(JSON.stringify(value) + "\n");
          if (wireBytes + size > BREAKOUT_BYTES.wirePrefix) {
            wireTruncated = true;
            firstWireOmittedAt = value.receivedAt;
            event({
              kind: "wire-prefix-truncated",
              maximumBytes: BREAKOUT_BYTES.wirePrefix,
              retainedBytes: wireBytes,
              firstOmittedAt: value.receivedAt,
            });
            return;
          }
          journals.wire.append(value, false);
          wireBytes += size;
        },
        onCandleVersion(value) {
          journals.versions.append(value, false);
        },
        async onResponse(value) {
          journals.http.append(
            {
              kind: "original-http-response",
              ...value,
              bodySha256: bytesHash(value.body),
              bodyBytes: Buffer.byteLength(value.body),
            },
            false,
          );
        },
      },
    );
    monitor = (async () => {
      while (!signal.aborted && Date.now() < frozen.endsAt) {
        await wait(CAPTURE_GRID.monitorMs, undefined, { signal });
        clock.sample({ kind: "K", operationId: `source-monitor:${Date.now()}` }, () => undefined);
      }
    })().catch((error) => {
      if (!signal.aborted) {
        fail(error);
      }
    });
    // Start endpoint is the actual trusted boundary, never a backdated scheduled instant.
    while (Date.now() < frozen.startsAt - 1000) {
      await wait(Math.min(1000, frozen.startsAt - 1000 - Date.now()), undefined, { signal });
    }
    clock.sample({ kind: "K", operationId: "source-window-start" }, () => undefined);
    while (Date.now() < frozen.startsAt) {
      await wait(Math.max(1, frozen.startsAt - Date.now()), undefined, { signal });
    }
    reports.request();
    await runSourceWindows({
      startsAt: frozen.startsAt,
      signal,
      capture(window) {
        if (window.index === 0) {
          firstAttemptAt = Date.now();
        }
        // The absolute operation deadline is enforced inside the reader. Its parent is the
        // capture lifetime: the scheduler closes each per-pump signal even after success.
        return reader!.capture({ ...window, signal });
      },
      async result(window, original, completedAt) {
        const { value: copied, record: receipt } = clock.sample(
          { kind: "K", operationId: `source-copy:${window.operationId}` },
          () => structuredClone(original),
        );
        if (!ready && copied.raw !== null && completedAt < window.deadlineAt) {
          metadataAndWebSocketReadyAt = completedAt;
          ready = true;
        }
        if (window.index === 0) {
          // Cold-start absence stays in the original denominator. Availability may recover
          // in a later original window; it never grants an extra bootstrap or retry window.
          startPreparation();
        }
        const preparedHash = savePrepared(copied.prepared);
        const { prepared: _prepared, ...snapshot } = copied;
        void _prepared; // Exact original preparation bytes are retained once by preparedHash.
        const sourceHash = digest(snapshot);
        const qualification = qualifySourceFrames({
          frames: copied.frames,
          network: input.config.network,
          markets: input.config.markets,
          receipt,
          window,
          completedAt,
        });
        const { qualifiedMarketIds } = qualification;
        const code = qualification.failures[0]?.code ?? null;
        for (const marketId of qualifiedMarketIds) {
          clock.shared(
            {
              kind: "J",
              operationId: window.operationId,
              marketId,
              sourceIdentity: sourceHash,
              acceptedProof: true,
            },
            receipt,
          );
        }
        if (qualifiedMarketIds.length === CAPTURE_GRID.markets) {
          clock.shared(
            {
              kind: "J",
              operationId: window.operationId,
              sourceIdentity: sourceHash,
              acceptedProof: true,
            },
            receipt,
          );
        }
        const pump: PumpRecord = {
          kind: "pump",
          window,
          completedAt,
          status: qualifiedMarketIds.length ? "CAPTURED" : "UNAVAILABLE",
          qualifiedMarketIds,
          qualificationFailures: qualification.failures,
          commonPreparedMarketIds: input.config.markets
            .filter((market) => copied.prepared.commonSymbols.includes(market.symbol))
            .map((market) => market.marketId),
          preparedHash,
          sourceHash,
          code,
          original: snapshot,
          copyReceipt: receipt,
        };
        journals.snapshots.append(pump);
        count++;
        if (window.canonicalMinute !== null) {
          reports.request();
        }
        console.log(
          JSON.stringify({
            sourcePump: window.index,
            canonicalMinute: window.canonicalMinute,
            status: pump.status,
            qualifiedMarkets: qualifiedMarketIds.length,
            observedPumps: count,
            modelCalls: 0,
          }),
        );
      },
      async missed(window, status) {
        journals.snapshots.append({
          kind: "pump",
          window,
          status,
          completedAt: null,
          qualifiedMarketIds: [],
          commonPreparedMarketIds: [],
          preparedHash: null,
          sourceHash: null,
          code: status,
        } satisfies PumpRecord);
        count++;
        if (window.index === 0) {
          startPreparation();
        }
        if (window.canonicalMinute !== null) {
          reports.request();
        }
      },
      async failed(error, window) {
        journals.snapshots.append({
          kind: "pump",
          window,
          status: "UNAVAILABLE",
          completedAt: Date.now(),
          qualifiedMarketIds: [],
          commonPreparedMarketIds: [],
          preparedHash: null,
          sourceHash: null,
          code: safeCode(error),
        } satisfies PumpRecord);
        count++;
        if (
          !(error instanceof PilotError) ||
          !["DATA_UNAVAILABLE", "BREAKOUT_WINDOW_EXPIRED", "STALE_MARKET_DATA"].includes(error.code)
        ) {
          fail(error);
        }
        if (window.index === 0) {
          startPreparation();
        }
        if (window.canonicalMinute !== null) {
          reports.request();
        }
      },
    });
    signal.throwIfAborted();
    clock.sample({ kind: "K", operationId: "source-window-end" }, () => undefined);
    state = "completed";
  } catch (error) {
    fail(error);
    state = "interrupted";
  } finally {
    // Close public work before relinquishing ownership. A lost owner performs only local cleanup.
    controller.abort(failure ?? new PilotError("CAPTURE_COMPLETE", "Source window ended"));
    try {
      await reader?.close();
      cleanup.socketClosed = Boolean(reader);
      event({ kind: "socket-closure-confirmed", at: Date.now(), confirmed: cleanup.socketClosed });
    } catch (error) {
      failure ??= error;
    }
    await Promise.allSettled(
      [renewal, monitor, background].filter((task): task is Promise<void> => Boolean(task)),
    );
    awake?.stop();
    if (lease) {
      const result = await cleanupDiagnosticOwnership({
        ownershipLost,
        failure,
        guard: () => store.guard(diagnosticScope, lease!),
        async sampleClock() {
          event({
            kind: "database-clock-end",
            sample: await sourceDatabaseClock("database-clock-end"),
          });
        },
        async verifyNoAccounts() {
          const view = await store.view(diagnosticScope);
          if (view.accountCount !== 0) {
            throw new PilotError(
              "BREAKOUT_FINANCIAL_POPULATION",
              "Diagnostic unexpectedly contains accounts",
            );
          }
        },
        release: (code) => store.release(diagnosticScope, lease!, code),
        event(value) {
          event({ ...value, diagnosticScope });
        },
      });
      cleanup.leaseReleased = result.leaseReleased;
      ownershipLost ||= result.ownershipLost;
      failure ??= result.failure;
      if (result.failureCodes.length) {
        try {
          event({ kind: "diagnostic-cleanup-errors", codes: result.failureCodes });
        } catch (error) {
          failure ??= error;
        }
      }
    }
    if (failure || !ready) {
      state = "interrupted";
    }
    try {
      await research.pool.end();
      cleanup.poolClosed = true;
      event({ kind: "database-pool-closed", at: Date.now() });
    } catch (error) {
      failure ??= error;
      state = "interrupted";
    }
    // Settle every earlier derived publication before publishing the one exact final manifest.
    for (const journal of Object.values(journals)) {
      journal.seal();
    }
    await reports.flush().catch((error) => {
      failure ??= error;
    });
    if (failure) {
      state = "interrupted";
    }
    terminalReservation();
    budget.release(terminalReportBytes);
    const finalManifest = manifest();
    await publishManifest(finalManifest);
    await runSourceReportWorker(
      {
        sourceDirectory: directory,
        outputDirectory: directory,
        manifest: finalManifest,
        generation: `generation-${String(reportSequence++).padStart(6, "0")}`,
      },
      budget,
    ).catch((error) => {
      failure ??= error;
    });
    if (failure) {
      state = "interrupted";
      await publishManifest(manifest());
    }
  }
  if (failure) {
    throw failure;
  }
  return { directory, sourceManifest: join(directory, "source-manifest.json"), state };
}
