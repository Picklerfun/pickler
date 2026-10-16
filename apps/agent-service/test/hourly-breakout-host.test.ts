import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import {
  BREAKOUT_MARKETS,
  BREAKOUT_PARAMETER_CONTRACT_SHA256,
  BREAKOUT_RESEARCH_PROTOCOL_SHA256,
  compareBreakoutBoundaries,
  type BreakoutClockBoundary,
  type BreakoutClockCertificate,
  type PerpsHourlyBreakoutConfig,
} from "@pickler/trading/evaluation";
import {
  createBoundaryClock,
  createFinancialReceiptHooks,
  createFinancialReceiptRecorder,
  sampleDatabaseClock,
  type BreakoutClockRecord,
} from "../src/hourly-breakout/clock.js";
import {
  ArtifactBudget,
  SegmentedJournal,
  budgetWriter,
  digest,
  inventoryBytes,
} from "../src/hourly-breakout/files.js";
import {
  freezeSourceWindow,
  runBackgroundPreparation,
  runSourceWindows,
  sourceWindowAt,
  type CaptureScheduleClock,
} from "../src/hourly-breakout/schedule.js";
import {
  analyzeSource,
  exportSourcePacket,
  publishReportGeneration,
  safeCsv,
  type SourceManifest,
} from "../src/hourly-breakout/report.js";
import { runHourlyBreakoutCommand } from "../src/hourly-breakout/index.js";
import { runSourceReportWorker } from "../src/hourly-breakout/report-worker-client.js";

const config: PerpsHourlyBreakoutConfig = {
  version: 10,
  protocol: "perps-hourly-breakout-fixed-screen-v1",
  tenantId: "controlled",
  agentId: "existing-public-agent",
  sessionId: "controlled-breakout",
  network: "mainnet",
  hours: 672,
  budgetUsd: "5",
  enabled: false,
  financiallyExecutable: false,
  T0: null,
  operator: null,
  parameterContractSha256: BREAKOUT_PARAMETER_CONTRACT_SHA256,
  researchProtocolSha256: BREAKOUT_RESEARCH_PROTOCOL_SHA256,
  acquisitionPolicy: "stream-universe-component-paper-20s-v1",
  markets: structuredClone([...BREAKOUT_MARKETS]),
};

class ManualClock implements CaptureScheduleClock {
  time = 1000;
  pending: { at: number; resolve(): void; reject(reason: unknown): void; signal: AbortSignal }[] =
    [];
  now() {
    return this.time;
  }
  sleepUntil(at: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (at <= this.time) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const item = { at, resolve, reject, signal };
      this.pending.push(item);
      signal.addEventListener(
        "abort",
        () => {
          this.pending = this.pending.filter((value) => value !== item);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }
  async advance(at: number) {
    this.time = at;
    const ready = this.pending.filter((item) => item.at <= at);
    this.pending = this.pending.filter((item) => item.at > at);
    for (const item of ready) {
      item.resolve();
    }
    await tick();
  }
}

test("24h freeze crosses UTC rollover with all 4320 original disjoint windows", () => {
  const preflight = Date.UTC(2026, 9, 15, 23, 58);
  const frozen = freezeSourceWindow(preflight);
  assert.equal(frozen.startsAt, Date.UTC(2026, 9, 16, 0, 1));
  assert.equal(frozen.endsAt - frozen.startsAt, 86400000);
  assert.equal(frozen.crossesUTCRollover, true);
  const windows = Array.from({ length: 4320 }, (_, index) =>
    sourceWindowAt(frozen.startsAt, index),
  );
  assert.equal(new Set(windows.map((window) => window.operationId)).size, 4320);
  assert.equal(windows.filter((window) => window.canonicalMinute !== null).length, 1440);
  assert.equal(windows.length * 11, 47520);
  assert.equal(windows.filter((window) => window.offsetSeconds === 0).length * 11, 15840);
  for (let index = 1; index < windows.length; index++) {
    assert.equal(windows[index]!.dueAt, windows[index - 1]!.deadlineAt);
  }
  assert.equal(windows.at(-1)!.deadlineAt, frozen.endsAt);
});

test("an occupied price operation produces MISSED_BUSY without overlap or shifted deadlines", async () => {
  const clock = new ManualClock();
  const controller = new AbortController();
  const misses: { index: number; status: string }[] = [];
  const captures: number[] = [];
  let release!: () => void;
  let active = 0;
  let maximum = 0;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = runSourceWindows({
    startsAt: 1000,
    count: 4,
    signal: controller.signal,
    clock,
    async capture(window) {
      captures.push(window.index);
      maximum = Math.max(maximum, ++active);
      if (window.index === 0) {
        await first;
      }
      active--;
      return window.index;
    },
    async result() {},
    async missed(window, status) {
      misses.push({ index: window.index, status });
    },
    async failed(error) {
      throw error;
    },
  });
  await tick();
  await clock.advance(21000);
  await clock.advance(41000);
  assert.deepEqual(misses, [
    { index: 1, status: "MISSED_BUSY" },
    { index: 2, status: "MISSED_BUSY" },
  ]);
  release();
  await tick();
  await clock.advance(61000);
  await clock.advance(81000);
  await running;
  assert.equal(maximum, 1);
  assert.deepEqual(captures, [0, 3]);
  assert.equal(sourceWindowAt(1000, 3).deadlineAt, 81000);
});

test("expired timer windows and early stops retain every original denominator without catch-up", async () => {
  const clock = new ManualClock();
  clock.time = 100000;
  const misses: string[] = [];
  let calls = 0;
  await runSourceWindows({
    startsAt: 1000,
    count: 4,
    signal: new AbortController().signal,
    clock,
    async capture() {
      calls++;
    },
    async result() {},
    async failed() {},
    async missed(_window, status) {
      misses.push(status);
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(misses, Array(4).fill("MISSED_TIMER"));
  const stopped = new AbortController();
  stopped.abort();
  let stoppedWindows = 0;
  await runSourceWindows({
    startsAt: 1000,
    signal: stopped.signal,
    clock,
    async capture() {
      calls++;
    },
    async result() {},
    async failed() {},
    async missed(_window, status) {
      assert.equal(status, "NOT_OBSERVED_AFTER_STOP");
      stoppedWindows++;
    },
  });
  assert.equal(stoppedWindows, 4320);
  assert.equal(calls, 0);
});

test("successful original pumps retain the same non-aborted continuous-reader lifetime", async () => {
  const clock = new ManualClock();
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  const running = runSourceWindows({
    startsAt: 1000,
    count: 3,
    signal: controller.signal,
    clock,
    async capture(_window, signal) {
      signals.push(signal);
      signal.throwIfAborted();
      return {};
    },
    async result() {},
    async missed() {
      assert.fail("Available original window was missed");
    },
    async failed(error) {
      throw error;
    },
  });
  await tick();
  await clock.advance(21000);
  await clock.advance(41000);
  await clock.advance(61000);
  await running;
  assert.equal(signals.length, 3);
  assert.ok(signals.every((signal) => signal === controller.signal && !signal.aborted));
});

test("background preparation has exactly 288 original five-minute opportunities with sixty-second budgets", async () => {
  const controller = new AbortController();
  let at = 1000;
  const originals: { dueAt: number; deadlineAt: number }[] = [];
  const misses: number[] = [];
  await runBackgroundPreparation({
    startsAt: 1000,
    endsAt: 1000 + 86400000,
    signal: controller.signal,
    clock: {
      now: () => at,
      async sleepUntil(next) {
        at = next;
        await tick();
      },
    },
    async prepare(_id, dueAt, deadlineAt) {
      originals.push({ dueAt, deadlineAt });
    },
    missed(_id, dueAt) {
      misses.push(dueAt);
    },
    failed(error) {
      throw error;
    },
  });
  assert.equal(originals.length, 288);
  assert.equal(misses.length, 0);
  assert.ok(
    originals.every(
      (r, index) => r.dueAt === 1000 + index * 300000 && r.deadlineAt - r.dueAt === 60000,
    ),
  );
});

test("all artifacts reserve concurrently before writes and immutable journals rotate at part boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-byte-test-"));
  try {
    const budget = new ArtifactBudget(0, 180);
    const reservationA = budget.reserve(100);
    assert.throws(() => budget.reserve(81), /ceiling/);
    const reservationB = budget.reserve(80);
    reservationA();
    reservationB();
    assert.deepEqual(budget.snapshot(), { usedBytes: 180, reservedBytes: 0, limitBytes: 180 });
    budget.release(180);
    const journal = new SegmentedJournal(directory, "snapshots", budget, 64);
    for (let index = 0; index < 4; index++) {
      journal.append({ index, value: "original" }, false);
    }
    journal.seal();
    const parts = journal.snapshot();
    assert.equal(parts.length, 2);
    assert.ok(parts.every((part) => part.bytes <= 64));
    assert.equal(
      parts.reduce((sum, part) => sum + part.records, 0),
      4,
    );
    assert.throws(() => journal.append({ value: "x".repeat(100) }), /exceeds/);
    assert.equal(await inventoryBytes(directory), budget.snapshot().usedBytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function controlledClock(scope: "source-local" | "financial-valuation" = "financial-valuation") {
  let wall = 1800000000000;
  let mono = 100000;
  const order: string[] = [];
  const records: BreakoutClockRecord[] = [];
  const clock = createBoundaryClock({
    scope,
    epochId: "controlled-epoch",
    acceptance: {
      accepted: true,
      provenance: ["CONTROLLED_FIXTURE_NOT_ACTUAL_FINANCIAL_ACCEPTANCE"],
    },
    clock: {
      wall() {
        order.push("W");
        return wall;
      },
      monotonic() {
        order.push("M");
        return mono;
      },
    },
    appendAndSync(record) {
      records.push(record);
      order.push("SYNC");
    },
  });
  order.length = 0;
  return {
    clock,
    records,
    order,
    advance(ms: number) {
      wall += ms;
      mono += ms;
    },
  };
}

test("ordered paired boundaries sync opening anchors before effect and original ACK before callback", () => {
  const fixture = controlledClock();
  fixture.clock.sample({ kind: "K", operationId: "ordered" }, () => fixture.order.push("BOUNDARY"));
  assert.deepEqual(fixture.order, ["M", "W", "BOUNDARY", "W", "M", "SYNC"]);
  assert.ok(
    fixture.records[0]!.boundary.financial.upperMs > fixture.records[0]!.boundary.financial.lowerMs,
  );
  assert.ok(
    fixture.records[0]!.boundary.monotonic.upperMs > fixture.records[0]!.boundary.monotonic.lowerMs,
  );
  fixture.order.length = 0;
  const recorder = createFinancialReceiptRecorder(fixture.clock);
  recorder.beforeOpening({ operationId: "open", role: "C", marketId: 1, sourceIdentity: "frame" });
  fixture.order.push("COMMIT");
  assert.equal(fixture.order.at(-2), "SYNC");
  const receipt = {
    operationId: "open",
    role: "C" as const,
    authoritativeRecordId: "record",
    sourceIdentity: "frame",
    acceptedMarkets: [1],
    outcome: "COMMIT_ACK" as const,
    ownershipValid: true as const,
    valuationRiskProofValid: true as const,
  };
  const first = recorder.definitive(receipt, () => fixture.order.push("CALLBACK"));
  assert.equal(fixture.order.at(-2), "SYNC");
  assert.equal(fixture.order.at(-1), "CALLBACK");
  fixture.advance(1000);
  assert.deepEqual(recorder.definitive(receipt), first);
  assert.equal(first[0]!.marketId, 1);
  assert.equal(fixture.records.filter((record) => record.boundary.kind === "V").length, 1);
  recorder.loseOwner();
  assert.throws(
    () => recorder.definitive({ ...receipt, operationId: "new" }),
    /Lost financial owner/,
  );
});

test("one authoritative outer ACK shares a first paired receipt across exact per-role markets", () => {
  const fixture = controlledClock();
  const hooks = createFinancialReceiptHooks({
    clock: fixture.clock,
    guard() {},
    getSourceIdentity: () => "original-frame",
  });
  const context = {
    operationId: "observe",
    action: "OBSERVE" as const,
    role: "C" as const,
    marketIds: [1, 20],
    authoritativeRecordId: "outer-commit",
    sourceIdentity: "original-frame",
  };
  const c = hooks.afterCommit(context);
  fixture.advance(100);
  const s = hooks.afterCommit({ ...context, role: "S" });
  assert.deepEqual(c.financial, s.financial);
  assert.deepEqual(c.monotonic, s.monotonic);
  assert.deepEqual(
    c.acceptedRecords?.map((record) => record.marketId),
    [1, 20],
  );
  assert.equal(hooks.afterCommit(context).id, c.id);
  assert.throws(() => hooks.afterCommit({ ...context, marketIds: [1] }), /receipt changed/);
  for (let index = 0; index < 520; index++) {
    hooks.afterCommit({
      ...context,
      operationId: `later-${index}`,
      authoritativeRecordId: `record-${index}`,
    });
  }
  assert.throws(() => hooks.afterCommit(context), /cannot be resampled/);
  assert.equal(hooks.getAcknowledgement?.("observe"), null);
});

function boundary(
  id: string,
  kind: "J" | "V",
  lower: number,
  upper: number,
): BreakoutClockBoundary {
  return {
    id,
    kind,
    operationId: id,
    certificateId: `cert-${id}`,
    epochId: "paired",
    financial: { lowerMs: lower, upperMs: upper },
    monotonic: { lowerMs: lower, upperMs: upper },
    marketId: 1,
    ...(kind === "V" ? { accountRole: "C" as const, authoritativeRecordId: id } : {}),
    sourceIdentity: id,
    acceptedProof: true,
  };
}
function certificate(value: BreakoutClockBoundary): BreakoutClockCertificate {
  return {
    id: value.certificateId,
    epochId: value.epochId,
    compatibilityId: "accepted-controlled-pair",
    scope: value.kind === "J" ? "source-local" : "financial-valuation",
    accepted: true,
    validFromMs: value.financial.lowerMs,
    validUntilMs: value.financial.upperMs,
    measuredBounds: {
      quantizationMs: 0.0001,
      resolutionMs: 0.0001,
      mappingUncertaintyMs: 0.0001,
      offsetBoundMs: 0.0001,
      driftBoundMs: 0.0001,
    },
    provenance: ["CONTROLLED_INTERVAL_FIXTURE"],
  };
}

for (const example of [
  { id: "A1_SOURCE_VS_ACCEPTANCE", accepted: [5, 90007], gap: 90002 },
  { id: "A4_SOURCE_VS_ACCEPTANCE", accepted: [100, 90101], gap: 90001 },
]) {
  test(`${example.id}: passing source J never proves financial V supervision`, () => {
    const base = 100000;
    const source = [
      boundary("source-first", "J", base, base + 0.01),
      boundary("source-next", "J", base + 89999.99, base + 90000),
    ];
    const accepted = [
      boundary(
        "accepted-first",
        "V",
        base + example.accepted[0]! - 0.01,
        base + example.accepted[0]! + 0.01,
      ),
      boundary(
        "accepted-next",
        "V",
        base + example.accepted[1]! - 0.01,
        base + example.accepted[1]! + 0.01,
      ),
    ];
    assert.equal(90000 - 0, 90000);
    assert.equal(example.accepted[1]! - example.accepted[0]!, example.gap);
    assert.equal(
      compareBreakoutBoundaries(source[0]!, source[1]!, source.map(certificate), "source-local")
        .status,
      "COMPLIANT",
    );
    assert.equal(
      compareBreakoutBoundaries(accepted[0]!, accepted[1]!, accepted.map(certificate)).status,
      "PROVED_GAP_BREACH",
    );
    assert.equal(
      compareBreakoutBoundaries(
        source[0]!,
        accepted[1]!,
        [...source, ...accepted].map(certificate),
        "financial-valuation",
      ).status,
      "GAP_COMPLIANCE_UNPROVED",
    );
  });
}

test("uncertain 90003ms upper bound is unproved; regression and DB full RTT remain distinct", async () => {
  const previous = boundary("previous", "V", 100000, 100002);
  const next = boundary("next", "V", 190000, 190003);
  const unproved = compareBreakoutBoundaries(previous, next, [
    certificate(previous),
    certificate(next),
  ]);
  assert.equal(unproved.status, "GAP_COMPLIANCE_UNPROVED");
  assert.deepEqual(unproved.financial, { lowerMs: 89998, upperMs: 90003 });
  const regressed = boundary("regressed", "V", 99990, 99991);
  assert.equal(
    compareBreakoutBoundaries(previous, regressed, [certificate(previous), certificate(regressed)])
      .status,
    "CLOCK_PROOF_FAILURE",
  );
  let wall = 1000;
  let mono = 1000;
  const sample = await sampleDatabaseClock(
    async () => {
      wall += 40;
      mono += 40;
      return { databaseAt: 1020 };
    },
    { wall: () => wall, monotonic: () => mono },
  );
  assert.equal(sample.roundTripMs, 40);
  assert.deepEqual(sample.databaseOffsetInterval, { lowerMs: -21, upperMs: 21 });
  await assert.rejects(
    sampleDatabaseClock(async () => ({ databaseAt: wall + 100 }), {
      wall: () => wall,
      monotonic: () => mono,
    }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "CLOCK_INCOMPATIBLE",
  );
});

test("future financial clock uses an immutable separately accepted certificate and rejects observed violations", () => {
  let wall = 100000;
  let mono = 10;
  const certificate: BreakoutClockCertificate = {
    id: "future-controlled-financial-certificate",
    scope: "financial-valuation",
    epochId: "future-controlled-epoch",
    compatibilityId: "future-controlled-local-policy",
    validFromMs: 90000,
    validUntilMs: 200000,
    accepted: true,
    measuredBounds: {
      quantizationMs: 1,
      resolutionMs: 0.001,
      mappingUncertaintyMs: 5,
      offsetBoundMs: 5,
      driftBoundMs: 5,
    },
    provenance: ["CONTROLLED_ONLY_NOT_OPERATOR_ACCEPTANCE"],
  };
  const records: BreakoutClockRecord[] = [];
  const create = () =>
    createBoundaryClock({
      scope: "financial-valuation",
      epochId: certificate.epochId,
      acceptance: { accepted: true, provenance: ["CONTROLLED_FUTURE_AUTHORIZATION"] },
      certificate,
      clock: { wall: () => wall, monotonic: () => mono },
      appendAndSync(record) {
        records.push(record);
      },
    });
  const paired = create();
  paired.sample({ kind: "K", operationId: "original" }, () => undefined);
  wall += 1000;
  mono += 1000;
  paired.sample({ kind: "K", operationId: "next" }, () => undefined);
  assert.deepEqual(
    records.map((r) => r.certificate),
    [certificate, certificate],
  );
  assert.ok(records.every((r) => r.observedBounds.quantizationMs > 0));
  wall += 20;
  assert.throws(
    () => paired.sample({ kind: "K", operationId: "bad-drift" }, () => undefined),
    /preaccepted financial certificate/,
  );
  assert.equal(records.length, 2);
  wall = 200001;
  assert.throws(
    () => create().sample({ kind: "K", operationId: "expired" }, () => undefined),
    /preaccepted financial certificate/,
  );
  assert.throws(
    () =>
      createBoundaryClock({
        scope: "source-local",
        epochId: certificate.epochId,
        certificate,
        acceptance: { accepted: true, provenance: ["NO_J_TO_V_PROMOTION"] },
        appendAndSync() {},
      }),
    /preaccepted financial clock certificate/,
  );
});

async function scalePacket(directory: string, budget: ArtifactBudget) {
  const snapshots = new SegmentedJournal(directory, "snapshots", budget);
  const frozen = freezeSourceWindow(Date.UTC(2026, 9, 15, 12));
  for (let index = 0; index < 4320; index++) {
    snapshots.append(
      {
        kind: "pump",
        window: sourceWindowAt(frozen.startsAt, index),
        status: "NOT_OBSERVED_AFTER_STOP",
        completedAt: null,
        qualifiedMarketIds: [],
        commonPreparedMarketIds: [],
        preparedHash: null,
        sourceHash: null,
        code: "OPERATOR_STOP",
      },
      false,
    );
  }
  snapshots.seal();
  const manifest: SourceManifest = {
    format: "hourly-breakout-source-capture-v1",
    protocol: config.protocol,
    version: 10,
    config,
    configHash: digest(config),
    captureCommit: "a".repeat(40),
    frozen,
    processState: "interrupted",
    failureCode: "OPERATOR_STOP",
    journals: {
      snapshots: snapshots.snapshot(),
      clocks: [],
      prepared: [],
      versions: [],
      wire: [],
      http: [],
      control: [],
    },
    wire: { truncated: false, retainedBytes: 0, maximumBytes: 33554432, firstOmittedAt: null },
    coldStart: { firstAttemptAt: null, metadataAndWebSocketReadyAt: null, within20Seconds: null },
    cleanup: { socketClosed: true, leaseReleased: true, poolClosed: true },
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
  };
  await budgetWriter(budget).write(
    join(directory, "source-manifest.json"),
    Buffer.from(JSON.stringify(manifest) + "\n"),
  );
  return manifest;
}

test("full-scale offline analysis retains 15840 rows, verified current+previous and immutable source", async () => {
  const root = await mkdtemp(join(tmpdir(), "breakout-scale-test-"));
  try {
    const budget = new ArtifactBudget(0, 128 * 1024 * 1024);
    const manifest = await scalePacket(root, budget);
    const original = await readFile(join(root, manifest.journals.snapshots[0]!.file));
    const analyzed = await analyzeSource(root, manifest);
    assert.equal(analyzed.rows.length, 15840);
    assert.equal(analyzed.pumpRows.length, 47520);
    assert.equal(analyzed.coverage.originalPumps.recorded, 4320);
    assert.equal(analyzed.coverage.originalPumpCells.planned, 47520);
    assert.equal(analyzed.coverage.canonicalMarketMinutes.planned, 15840);
    assert.equal(analyzed.financialAcceptance, false);
    for (let index = 0; index < 3; index++) {
      await publishReportGeneration({
        sourceDirectory: root,
        outputDirectory: root,
        manifest,
        generation: `generation-test-${index}`,
        writer: budgetWriter(budget),
        released: (bytes) => budget.release(bytes),
      });
    }
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.startsWith("generation-")).sort(),
      ["generation-test-1", "generation-test-2"],
    );
    const pointer = JSON.parse(await readFile(join(root, "current-report.json"), "utf8"));
    assert.equal(pointer.generation, "generation-test-2");
    assert.equal(pointer.previous, "generation-test-1");
    const page = await readFile(join(root, pointer.generation, "report.html"), "utf8");
    assert.match(page, /OPERATOR_STOP/);
    assert.match(page, /href="minutes.csv"/);
    assert.match(page, /href="pumps.csv"/);
    assert.match(page, /No return was measured/);
    assert.match(page, new RegExp(new Date(manifest.frozen.endsAt).toISOString()));
    assert.deepEqual(await readFile(join(root, manifest.journals.snapshots[0]!.file)), original);
    assert.equal(await inventoryBytes(root), budget.snapshot().usedBytes);
    const offline = await mkdtemp(join(tmpdir(), "breakout-export-test-"));
    try {
      await exportSourcePacket(
        join(root, "source-manifest.json"),
        offline,
        budgetWriter(new ArtifactBudget()),
      );
      assert.deepEqual(await analyzeSource(offline, manifest), analyzed);
      await runSourceReportWorker(
        {
          sourceDirectory: offline,
          outputDirectory: offline,
          manifest,
          generation: "generation-worker",
        },
        new ArtifactBudget(await inventoryBytes(offline)),
      );
    } finally {
      await rm(offline, { recursive: true, force: true });
    }
    assert.equal(safeCsv('=HYPERLINK("unsafe")'), '"\'=HYPERLINK(""unsafe"")"');
    await writeFile(join(root, manifest.journals.snapshots[0]!.file), "corrupt\n");
    await assert.rejects(
      analyzeSource(root, manifest),
      /prefix is unavailable|bytes or count differ/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disabled run rejects before nonexistent database/provider environment is opened", async () => {
  const root = await mkdtemp(join(tmpdir(), "breakout-command-test-"));
  try {
    const configPath = join(root, "config.json");
    await writeFile(configPath, JSON.stringify(config));
    await assert.rejects(
      runHourlyBreakoutCommand({
        command: "run",
        configPath,
        envFile: join(root, "NEVER_OPEN_THIS_ENV"),
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        (error as { code?: string }).code === "BREAKOUT_FUTURE_FINANCIAL_AUTHORIZATION_REQUIRED",
    );
    await assert.rejects(
      runHourlyBreakoutCommand({
        command: "prepare",
        configPath,
        envFile: join(root, "NEVER_OPEN_THIS_ENV"),
        output: join(root, "new"),
        signal: new AbortController().signal,
      }),
      /rejects an environment/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the actual evaluate script preserves private env arguments until authorization", async () => {
  const root = await mkdtemp(join(tmpdir(), "breakout-cli-env-test-"));
  try {
    const configPath = join(root, "config.json");
    await writeFile(configPath, JSON.stringify(config));
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const [executable, ...arguments_] = packageJson.scripts.evaluate.split(" ");
    assert.equal(executable, "node");
    const result = spawnSync(
      process.execPath,
      [
        ...arguments_,
        "run",
        "--config",
        configPath,
        "--env-file",
        join(root, "NEVER_OPEN_THIS_ENV"),
      ],
      { cwd: new URL("../", import.meta.url), env: {}, encoding: "utf8", timeout: 10000 },
    );

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BREAKOUT_FUTURE_FINANCIAL_AUTHORIZATION_REQUIRED/);
    assert.doesNotMatch(result.stderr, /not found|ENOENT|DATABASE_URL/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
