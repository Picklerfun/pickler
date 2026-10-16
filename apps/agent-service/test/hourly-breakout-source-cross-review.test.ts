import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PilotError, type PerpMarketInfo } from "@pickler/core";
import {
  BREAKOUT_MARKETS,
  BREAKOUT_PARAMETER_CONTRACT_SHA256,
  BREAKOUT_RESEARCH_PROTOCOL_SHA256,
  type PerpsHourlyBreakoutConfig,
} from "@pickler/trading/evaluation";
import type { PerpsPaperFrame } from "@pickler/trading/perps";
import { createBoundaryClock } from "../src/hourly-breakout/clock.js";
import {
  ArtifactBudget,
  SegmentedJournal,
  budgetWriter,
  bytesHash,
  digest,
} from "../src/hourly-breakout/files.js";
import {
  analyzeSource,
  publishReportGeneration,
  type PumpRecord,
  type SourceManifest,
} from "../src/hourly-breakout/report.js";
import {
  freezeSourceWindow,
  runSourceWindows,
  sourceWindowAt,
} from "../src/hourly-breakout/schedule.js";
import { qualifySourceFrames } from "../src/hourly-breakout/source-qualification.js";
import {
  createSourceDatabaseClock,
  SOURCE_DATABASE_CLOCK_POLICY,
} from "../src/hourly-breakout/source-database-clock.js";

const config: PerpsHourlyBreakoutConfig = {
  version: 10,
  protocol: "perps-hourly-breakout-fixed-screen-v1",
  tenantId: "cross-review",
  agentId: "controlled-public-agent",
  sessionId: "controlled-source-review",
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
  markets: [...BREAKOUT_MARKETS],
};

function frames(at: number): PerpsPaperFrame[] {
  return config.markets.map(({ marketId, symbol }) => {
    const provenance = {
      provider: "perpl" as const,
      pluginVersion: "1.1.0" as const,
      network: "mainnet" as const,
      chainId: 143,
      url: "https://controlled.example/never-requested",
      receivedAt: at - 2,
      providerTimestamp: at - 2,
      block: 1,
    };
    const market: PerpMarketInfo = {
      marketId,
      perpetualId: marketId,
      symbol,
      instanceId: 1,
      exchangeAddress: "0x34b6552d57a35a1d042ccae1951bd1c370112a6f",
      collateral: {
        tokenId: 1,
        address: "0x00000000efe302beaa2b3e6e1b18d08d69a9012a",
        symbol: "AUSD",
        decimals: 6,
      },
      configVersion: 1,
      priceDecimals: 2,
      sizeDecimals: 4,
      open: true,
      fundingIntervalSeconds: 3600,
      fundingIntervalBlocks: 100,
      initialMarginRaw: 100,
      maintenanceMarginRaw: 50,
      fees: { basis: "public-base-tier", maker: "0", taker: "0.0002" },
      provenance,
    };
    return {
      snapshot: {
        market,
        ticker: {
          mark: "100",
          index: "100",
          last: "100",
          bid: "99.9",
          ask: "100.1",
          openInterestBase: "1",
          freshness: "fresh",
          provenance: { ...provenance },
        },
        funding: null,
      },
      book: {
        market: structuredClone(market),
        requestedLevels: 20,
        depthLimited: true,
        bids: [{ price: "99.9", size: "100", orders: 1 }],
        asks: [{ price: "100.1", size: "100", orders: 1 }],
        freshness: "fresh",
        provenance: { ...provenance },
      },
      hash: digest([marketId, at]),
      streamEvidence: {
        policy: "stream-universe-component-paper-20s-v1",
        generation: 1,
        copiedAt: at - 2,
        heartbeatSequence: 1,
        headBlock: 1,
        heartbeatReceivedAt: at - 2,
      },
    };
  });
}

function fixtureClock(appendAndSync: Parameters<typeof createBoundaryClock>[0]["appendAndSync"]) {
  let at = 0;
  const clock = createBoundaryClock({
    scope: "source-local",
    epochId: "controlled-review-epoch",
    clock: { wall: () => at, monotonic: () => at },
    acceptance: { accepted: true, provenance: ["CONTROLLED_FIXTURE_ONLY"] },
    appendAndSync,
  });
  return {
    clock,
    set(atMs: number) {
      at = atMs;
    },
  };
}

test("one market expiring at the outward receipt bound preserves ten peer cells and no joint copy", () => {
  const at = Date.UTC(2027, 0, 4, 1, 0, 1);
  const fixture = fixtureClock(() => {});
  fixture.set(at);
  const receipt = fixture.clock.sample(
    { kind: "K", operationId: "controlled-copy" },
    () => {},
  ).record;
  const original = frames(at);
  original[0]!.snapshot.ticker.provenance.providerTimestamp = at - 30000;
  const qualified = qualifySourceFrames({
    frames: original,
    network: "mainnet",
    markets: config.markets,
    receipt,
    window: sourceWindowAt(at - 1000, 0),
    completedAt: at,
  });
  assert.equal(qualified.qualifiedMarketIds.length, 10);
  assert.deepEqual(qualified.failures, [{ marketId: 1, code: "STALE_MARKET_DATA" }]);
  assert.equal(qualified.qualifiedMarketIds.includes(1), false);
  original[0]!.snapshot.market.exchangeAddress = "0x" + "2".repeat(40);
  assert.throws(
    () =>
      qualifySourceFrames({
        frames: original,
        network: "mainnet",
        markets: config.markets,
        receipt,
        window: sourceWindowAt(at - 1000, 0),
        completedAt: at,
      }),
    (error: unknown) => error instanceof PilotError && error.code === "PERPL_MARKET_IDENTITY",
  );
});

async function passingPacket(root: string, budget: ArtifactBudget, independentClocks = false) {
  const snapshots = new SegmentedJournal(root, "snapshots", budget);
  const clocks = new SegmentedJournal(root, "clocks", budget);
  const fixture = fixtureClock((record) => clocks.append(record, false));
  const frozen = freezeSourceWindow(Date.UTC(2026, 9, 15, 12));
  fixture.set(frozen.startsAt - 2);
  fixture.clock.sample({ kind: "K", operationId: "source-window-start" }, () => {});
  for (let index = 0; index < 4320; index++) {
    const window = sourceWindowAt(frozen.startsAt, index);
    if (window.canonicalMinute === null) {
      snapshots.append(
        {
          kind: "pump",
          window,
          status: "MISSED_TIMER",
          completedAt: null,
          qualifiedMarketIds: [],
          commonPreparedMarketIds: [],
          preparedHash: null,
          sourceHash: null,
          code: "MISSED_TIMER",
        } satisfies PumpRecord,
        false,
      );
      continue;
    }
    const at = window.dueAt + 100;
    fixture.set(at);
    const original = { operationId: window.operationId, dueAt: window.dueAt, frames: frames(at) };
    const sourceHash = digest(original);
    const receipt = fixture.clock.sample(
      { kind: "K", operationId: `source-copy:${window.operationId}` },
      () => original,
    ).record;
    for (const market of config.markets) {
      fixture.clock.shared(
        {
          kind: "J",
          operationId: window.operationId,
          marketId: market.marketId,
          sourceIdentity: sourceHash,
          acceptedProof: true,
        },
        receipt,
      );
    }
    fixture.clock.shared(
      {
        kind: "J",
        operationId: window.operationId,
        sourceIdentity: sourceHash,
        acceptedProof: true,
      },
      receipt,
    );
    snapshots.append(
      {
        kind: "pump",
        window,
        status: "CAPTURED",
        completedAt: at,
        qualifiedMarketIds: config.markets.map((market) => market.marketId),
        commonPreparedMarketIds: [],
        preparedHash: null,
        sourceHash,
        code: null,
        original,
        copyReceipt: receipt,
      } satisfies PumpRecord,
      false,
    );
  }
  fixture.set(frozen.endsAt);
  fixture.clock.sample({ kind: "K", operationId: "source-window-end" }, () => {});
  snapshots.seal();
  clocks.seal();
  const manifest: SourceManifest = {
    format: "hourly-breakout-source-capture-v1",
    protocol: config.protocol,
    version: 10,
    config,
    configHash: digest(config),
    captureCommit: "a".repeat(40),
    frozen,
    processState: "completed",
    failureCode: null,
    journals: {
      snapshots: snapshots.snapshot(),
      clocks: clocks.snapshot(),
      prepared: [],
      versions: [],
      wire: [],
      http: [],
      control: [],
    },
    wire: { truncated: false, retainedBytes: 0, maximumBytes: 33554432, firstOmittedAt: null },
    coldStart: {
      firstAttemptAt: frozen.startsAt,
      metadataAndWebSocketReadyAt: frozen.startsAt + 100,
      within20Seconds: true,
    },
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
  if (independentClocks) {
    const control = new SegmentedJournal(root, "control", budget);
    let at = frozen.preflightCompletedAt;
    let wallReads = 0;
    let monoReads = 0;
    const databaseClock = createSourceDatabaseClock({
      clock: {
        wall: () => at + wallReads++,
        monotonic: () => at - frozen.preflightCompletedAt + monoReads++ * 0.5,
      },
    });
    const append = async (kind: string, when: number) => {
      at = when;
      wallReads = 0;
      monoReads = 0;
      control.append(
        { kind, sample: await databaseClock.sample(async () => ({ databaseAt: at - 3 })) },
        false,
      );
    };
    await append("database-clock-preflight", frozen.preflightCompletedAt);
    await append("database-clock-start", frozen.preflightCompletedAt + 2);
    for (let dueAt = frozen.startsAt; dueAt < frozen.endsAt; dueAt += 20000) {
      await append("database-clock-renewal", dueAt);
    }
    await append("database-clock-end", frozen.endsAt + 2);
    control.seal();
    manifest.databaseClockPolicy = SOURCE_DATABASE_CLOCK_POLICY;
    manifest.databaseClockPolicyHash = digest(SOURCE_DATABASE_CLOCK_POLICY);
    manifest.journals.control = control.snapshot();
    manifest.artifactBudget = budget.snapshot();
  }
  return manifest;
}

test("controlled 24-hour source acceptance uses independent database clocks without changing J limits or financial acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "breakout-independent-clocks-"));
  try {
    const budget = new ArtifactBudget();
    const manifest = await passingPacket(root, budget, true);
    const report = await analyzeSource(root, manifest);
    assert.equal(report.result, "PASS_NONFINANCIAL_SOURCE_ACCEPTANCE");
    assert.equal(report.coverage.canonicalMinutes.qualified, 1440);
    assert.equal(report.coverage.canonicalMarketMinutes.qualified, 15840);
    assert.equal(report.continuity.maximumAllowedMs, 90000);
    assert.equal(report.financialAcceptance, false);
    assert.equal(report.databaseClock?.samples, 4323);
    assert.equal(report.databaseClock?.observedNonzeroOffsetSamples, 4323);
    assert.equal(report.databaseClock?.offsetLowerMinimumMs, -5);
    assert.equal(report.databaseClock?.offsetUpperMaximumMs, -2);
    const part = manifest.journals.control.at(-1)!;
    const bytes = await readFile(join(root, part.file));
    const lastLine = bytes.subarray(bytes.lastIndexOf(10, bytes.length - 2) + 1);
    const prefix = bytes.subarray(0, bytes.length - lastLine.length);
    const missingEnd = await analyzeSource(root, {
      ...manifest,
      journals: {
        ...manifest.journals,
        control: [
          { ...part, bytes: prefix.length, records: part.records - 1, sha256: bytesHash(prefix) },
        ],
      },
    });
    assert.equal(missingEnd.result, "FAIL_NONFINANCIAL_SOURCE_ACCEPTANCE");
    assert.equal(missingEnd.databaseClock?.endRecorded, false);
    await assert.rejects(
      analyzeSource(root, { ...manifest, databaseClockPolicyHash: "0".repeat(64) }),
      (error: unknown) => error instanceof PilotError && error.code === "BREAKOUT_SOURCE_INVALID",
    );
    const { databaseClockPolicy: _policy, ...missingPolicy } = manifest;
    void _policy;
    await assert.rejects(
      analyzeSource(root, missingPolicy),
      (error: unknown) => error instanceof PilotError && error.code === "BREAKOUT_SOURCE_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("controlled successful 24-hour qualification preserves fixed denominators and rejects missing endpoint or cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "breakout-positive-cross-review-"));
  try {
    const budget = new ArtifactBudget();
    const manifest = await passingPacket(root, budget);
    const report = await analyzeSource(root, manifest);
    assert.equal(report.result, "PASS_NONFINANCIAL_SOURCE_ACCEPTANCE");
    assert.equal(report.coverage.canonicalMinutes.qualified, 1440);
    assert.equal(report.coverage.canonicalMarketMinutes.qualified, 15840);
    assert.equal(report.coverage.originalPumps.recorded, 4320);
    assert.equal(report.coverage.originalPumpCells.qualified, 15840);
    assert.equal(report.continuity.provedBreaches, 0);
    assert.equal(report.financialAcceptance, false);
    assert.equal(
      report.coverage.commonPreparationJointMinutes,
      0,
      "PTS/common preparation does not become an extra source-only acceptance gate",
    );
    const missingCleanup = await analyzeSource(root, {
      ...manifest,
      cleanup: { ...manifest.cleanup, socketClosed: false },
    });
    assert.equal(missingCleanup.result, "FAIL_NONFINANCIAL_SOURCE_ACCEPTANCE");
    const last = manifest.journals.clocks.at(-1)!;
    const bytes = await readFile(join(root, last.file));
    const lastLine = bytes.subarray(bytes.lastIndexOf(10, bytes.length - 2) + 1);
    const prefix = bytes.subarray(0, bytes.length - lastLine.length);
    const missingEnd = await analyzeSource(root, {
      ...manifest,
      journals: {
        ...manifest.journals,
        clocks: [
          ...manifest.journals.clocks.slice(0, -1),
          { ...last, bytes: prefix.length, records: last.records - 1, sha256: bytesHash(prefix) },
        ],
      },
    });
    assert.equal(missingEnd.result, "FAIL_NONFINANCIAL_SOURCE_ACCEPTANCE");
    assert.equal(missingEnd.continuity.endpointsCovered, false);
    const writer = budgetWriter(budget);
    await publishReportGeneration({
      sourceDirectory: root,
      outputDirectory: root,
      manifest,
      generation: "generation-cross-review-0",
      writer,
      released: (bytes) => budget.release(bytes),
    });
    const published = JSON.parse(
      await readFile(join(root, "generation-cross-review-0", "report.json"), "utf8"),
    );
    const source = JSON.parse(
      await readFile(join(root, "generation-cross-review-0", "source-manifest.json"), "utf8"),
    );
    assert.equal(published.sourceManifestHash, digest(source));
    assert.deepEqual(await analyzeSource(root, source), published);
    await writeFile(join(root, "generation-cross-review-0", "report.html"), "tampered\n");
    await assert.rejects(
      publishReportGeneration({
        sourceDirectory: root,
        outputDirectory: root,
        manifest,
        generation: "generation-cross-review-1",
        writer,
        released: (bytes) => budget.release(bytes),
      }),
      /Published derived file is absent|Published derived bytes differ/,
    );
    const pointer = JSON.parse(await readFile(join(root, "current-report.json"), "utf8"));
    assert.equal(pointer.generation, "generation-cross-review-0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed diagnostic callback interrupts through the awaited scheduler without a background rejection", async () => {
  const controller = new AbortController();
  let captures = 0;
  let failedWrites = 0;
  const brokenJournal = new PilotError("BREAKOUT_ARTIFACT_LIMIT", "Controlled journal ceiling");
  await assert.rejects(
    runSourceWindows({
      startsAt: 1000,
      signal: controller.signal,
      count: 3,
      clock: {
        now: () => 1000,
        async sleepUntil(at, signal) {
          if (at <= 1000) {
            return;
          }
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
      async capture() {
        captures++;
        return {};
      },
      async result() {
        throw brokenJournal;
      },
      async failed() {
        failedWrites++;
        throw brokenJournal;
      },
      async missed() {
        assert.fail("A fatal journal failure must stop further records");
      },
    }),
    (error: unknown) => error === brokenJournal,
  );
  assert.equal(captures, 1);
  assert.equal(failedWrites, 1);
  assert.equal(controller.signal.aborted, false);
});
