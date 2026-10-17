import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  BREAKOUT_MARKETS,
  BREAKOUT_PARAMETER_CONTRACT_SHA256,
  BREAKOUT_RESEARCH_PROTOCOL_SHA256,
  canonicalBreakoutJson,
  type PerpsHourlyBreakoutConfig,
  type BreakoutRunAcceptance,
  type BreakoutClockCertificate,
} from "@pickler/trading/evaluation";
import {
  initialPaperAccount,
  type PerpsPaperFrame,
  type PerpsPaperAccount,
} from "@pickler/trading/perps";
import type { PerpCandles, PerpMarketInfo } from "@pickler/core";
import type { BreakoutPreparedData } from "@pickler/agent-runtime/plugins/perps-paper/public-study";
import type { PerpsBreakoutAuditPart } from "@pickler/infrastructure/perps-lab";
import {
  financialWindows,
  validateFinancialAuthority,
  runAcceptedHourlyBreakout,
  FINANCIAL_RESOURCE_ENVELOPE,
} from "../src/hourly-breakout/financial-adapter.js";
import {
  analyzeFinancialAudit,
  publishPreparedFinancialGeneration,
  runFinancialOfflineCommand,
  type FinancialAuditManifest,
} from "../src/hourly-breakout/financial-report.js";
import {
  ArtifactBudget,
  SegmentedJournal,
  bytesHash,
  budgetWriter,
  digest,
} from "../src/hourly-breakout/files.js";

const config: PerpsHourlyBreakoutConfig = {
  version: 10,
  protocol: "perps-hourly-breakout-fixed-screen-v1",
  tenantId: "controlled",
  agentId: "existing-public-agent",
  sessionId: "controlled-financial",
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
  markets: BREAKOUT_MARKETS.map((m) => ({ ...m })),
};
const T0 = Date.UTC(2026, 0, 1);
const acceptance: BreakoutRunAcceptance = {
  protocolDigest: "1".repeat(64),
  T0,
  authorizedAt: T0 - 3600000,
  operator: { identity: "controlled", acknowledgementSha256: "2".repeat(64) },
  technicalAcceptanceSha256: "3".repeat(64),
  sourceQualificationSha256: "4".repeat(64),
  financialAuthorizationSha256: "5".repeat(64),
  acceptedClockCertificateIds: ["controlled-financial"],
};

function history(): BreakoutPreparedData {
  const market = {
    symbol: "BTC",
    marketId: 1,
    perpetualId: 1,
    instanceId: 1,
    exchangeAddress: "0x34b6552d57a35a1d042ccae1951bd1c370112a6f",
    collateral: {
      tokenId: 1,
      address: "0x00000000efe302beaa2b3e6e1b18d08d69a9012a",
      symbol: "AUSD",
      decimals: 6,
    },
    provenance: {
      provider: "perpl",
      pluginVersion: "1.1.0",
      network: "mainnet",
      chainId: 143,
      url: "https://controlled.invalid/metadata",
      receivedAt: T0,
      providerTimestamp: T0,
      block: 100,
    },
  } as PerpMarketInfo;
  const candles = Array.from({ length: 60 }, (_, i) => ({
    openTime: T0 - (60 - i) * 3600000,
    open: "100",
    high: "101",
    low: "99",
    close: i === 59 ? "110" : "100",
    volumeCollateral: "123.4500",
    trades: i,
    closed: true,
  }));
  const series: PerpCandles = {
    market,
    resolution: 3600,
    from: T0 - 60 * 3600000,
    to: T0,
    candles,
    missingOpenTimes: [],
    provenance: market.provenance,
  };
  return {
    candles: [series],
    commonSymbols: [],
    ptsHistory: [],
    excluded: [],
    versions: candles.map((candle) => ({
      format: "breakout-native-candle-version-v1",
      symbol: "BTC",
      marketId: 1,
      resolution: 3600,
      closeTime: candle.openTime + 3600000,
      contentHash: digest(candle),
      previousHash: null,
      firstReceivedAt: T0,
      requestId: "request-original",
      responseSha256: "a".repeat(64),
      sourceRecordId: "original-response",
      from: series.from,
      to: series.to,
      source: market.provenance,
      candle,
    })),
  };
}

function controlledFrame(at: number): PerpsPaperFrame {
  const market = {
    ...history().candles[0]!.market,
    configVersion: 1,
    priceDecimals: 2,
    sizeDecimals: 4,
    open: true,
    fundingIntervalSeconds: 3600,
    fundingIntervalBlocks: 100,
    initialMarginRaw: 100,
    maintenanceMarginRaw: 50,
    fees: { basis: "public-base-tier" as const, maker: "0", taker: "0.0002" },
    provenance: {
      ...history().candles[0]!.market.provenance,
      receivedAt: at,
      providerTimestamp: at,
      block: 100,
    },
  };
  return {
    snapshot: {
      market,
      ticker: {
        mark: "100",
        index: "100",
        last: "100",
        bid: "99",
        ask: "101",
        openInterestBase: "20",
        freshness: "fresh",
        provenance: market.provenance,
      },
      funding: null,
    },
    book: {
      market,
      requestedLevels: 20,
      depthLimited: true,
      bids: [{ price: "99", size: "1000", orders: 1 }],
      asks: [{ price: "101", size: "1000", orders: 1 }],
      freshness: "fresh",
      provenance: market.provenance,
    },
    hash: "a".repeat(64),
    streamEvidence: {
      policy: "stream-universe-component-paper-20s-v1",
      generation: 1,
      copiedAt: at,
      heartbeatSequence: 10,
      headBlock: 100,
      heartbeatReceivedAt: at,
    },
  };
}

test("financial windows select original hourly candles and preserve full provenance without backfilling", () => {
  const prepared = history();
  const windows = financialWindows(config, prepared, T0 + 2000);
  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.bars.length, 22);
  assert.equal(windows[0]!.bars[21]!.candle.volumeCollateral, "123.4500");
  assert.equal(windows[0]!.bars[21]!.provenance.firstReceiptAt, T0);
  assert.equal(windows[0]!.bars[21]!.provenance.responseSha256, "a".repeat(64));

  prepared.versions[59]!.source = { ...prepared.versions[59]!.source, block: null };
  assert.deepEqual(financialWindows(config, prepared, T0 + 2000), []);
});

test("a revised candle cannot reuse the old original bytes or a later window", () => {
  const prepared = history();
  prepared.candles[0]!.candles[59] = {
    ...prepared.candles[0]!.candles[59]!,
    volumeCollateral: "123.4501",
  };
  assert.deepEqual(financialWindows(config, prepared, T0 + 2000), []);
  assert.deepEqual(financialWindows(config, history(), T0 + 3600000), []);
});

test("financial run rejects absence of future authority before touching a nonexistent environment", async () => {
  await assert.rejects(
    runAcceptedHourlyBreakout({
      command: "run",
      config,
      configText: JSON.stringify(config),
      configPath: "/nonexistent/controlled-config.json",
      envFile: "/nonexistent/private.env",
      output: "/nonexistent/output",
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code: string }).code === "BREAKOUT_FUTURE_FINANCIAL_AUTHORIZATION_REQUIRED",
  );
});

test("authority cannot be supplied by disabled preparation or J-only source proof", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-authority-controlled-"));
  try {
    const path = join(directory, "authority.json");
    await writeFile(
      path,
      JSON.stringify({
        format: "hourly-breakout-preparation-v1",
        configHash: digest(config),
        implementationCommit: "controlled",
      }),
    );
    await assert.rejects(
      validateFinancialAuthority({ config, path, now: T0 - 1000, commit: "controlled" }),
      (error: unknown) =>
        (error as { code: string }).code === "BREAKOUT_FINANCIAL_AUTHORITY_INVALID",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function packet(
  directory: string,
  pending = false,
  extra: PerpsBreakoutAuditPart[] = [],
  acceptedClockPolicy?: unknown,
  storedConfig = config,
): Promise<FinancialAuditManifest> {
  const journal = new SegmentedJournal(directory, "financial-source", new ArtifactBudget());
  const parts: PerpsBreakoutAuditPart[] = [
    {
      kind: "record",
      value: {
        config: storedConfig,
        metadata: {
          commit: "controlled-original",
          ...(acceptedClockPolicy ? { acceptedClockPolicy } : {}),
        },
        acceptance,
        agentIds: { "hourly-breakout": "c", "sma-reference": "s", "hourly-long": "l" },
        agentVersions: { "hourly-breakout": 1, "sma-reference": 1, "hourly-long": 1 },
        createdAt: T0 - 1,
        startedAt: T0,
        status: "completed",
        lastAttemptedSlot: 8063,
        admissionsClosed: true,
        interruption: null,
        current: null,
        closeObligations: [],
        unknownBarriers: [],
        closedFences: [],
      },
    },
  ];
  for (const role of ["C", "S", "L"] as const) {
    const account = initialPaperAccount(
      { tenantId: "controlled", agentId: role, sessionId: config.sessionId, network: "mainnet" },
      1,
      T0,
    );
    account.fundingPending = pending && role === "C";
    parts.push({ kind: "account", role, value: account });
    if (pending && role === "C") {
      parts.push({
        kind: "attempt",
        role,
        value: {
          key: "unknown-opening",
          status: "pending",
          reserved: "101",
          createdAt: T0,
          finishedAt: null,
          reason: null,
          evidence: null,
          intent: { kind: "open", symbol: "BTC", side: "long", notional: "100", feeReserve: "1" },
        },
      });
    }
  }
  parts.push(...extra);
  const hash = createHash("sha256");
  for (const part of parts) {
    journal.append(part);
    hash.update(canonicalBreakoutJson(part) + "\n");
  }
  journal.seal();
  return {
    format: "hourly-breakout-financial-audit-v1",
    protocol: config.protocol,
    version: 10,
    config,
    configHash: digest(config),
    exporterCommit: "controlled-exporter",
    studyCommit: "controlled-original",
    capturedAt: T0 + (28 * 24 + 4 + 72) * 3600000,
    source: {
      sha256: hash.digest("hex"),
      rows: parts.length,
      protocol: "perps-breakout-canonical-segmented-v1",
      version: 3,
    },
    parts: journal.snapshot(),
    clocks: [],
    evidence: [],
    journalDirectory: null,
    clockSource: null,
    financialExecutionAuthorizedByThisExport: false,
  };
}

test("financial offline report preserves unknown reservations and never fabricates complete net returns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-financial-packet-"));
  try {
    const manifest = await packet(directory, true);
    const before = await analyzeFinancialAudit(directory, manifest);
    const after = await analyzeFinancialAudit(directory, manifest);
    assert.deepEqual(after, before);
    assert.equal(before.pending.C, 1);
    assert.equal(before.pendingReservationAUSD.C, "101");
    assert.equal(before.report.arms.find((a) => a.role === "C")!.netAUSD, null);
    assert.equal(before.report.positiveDescriptiveScreen, false);
    assert.equal(before.apiCostUSD, "0");
    assert.equal(before.report.N.netAUSD, "0");
    assert.equal((before.report.P_context as { financialPositions: number }).financialPositions, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("future financial terminal headroom stays inside its independently frozen local byte ceiling", () => {
  assert.deepEqual(FINANCIAL_RESOURCE_ENVELOPE, {
    artifactLimitBytes: 64 * 1024 ** 3,
    minimumFreeBytes: 80 * 1024 ** 3,
    terminalHeadroomBytes: 256 * 1024 ** 2,
  });
  const budget = new ArtifactBudget(0, FINANCIAL_RESOURCE_ENVELOPE.artifactLimitBytes);
  budget.reserve(FINANCIAL_RESOURCE_ENVELOPE.terminalHeadroomBytes)();
  budget.reserve(
    FINANCIAL_RESOURCE_ENVELOPE.artifactLimitBytes -
      FINANCIAL_RESOURCE_ENVELOPE.terminalHeadroomBytes,
  )();
  assert.throws(() => budget.reserve(1), { code: "BREAKOUT_ARTIFACT_LIMIT" });
  budget.release(FINANCIAL_RESOURCE_ENVELOPE.terminalHeadroomBytes);
  budget.reserve(FINANCIAL_RESOURCE_ENVELOPE.terminalHeadroomBytes)();
  assert.throws(() => budget.reserve(1), { code: "BREAKOUT_ARTIFACT_LIMIT" });
});

test("financial audit preserves configuration identity across PostgreSQL JSONB key order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-financial-jsonb-order-"));
  try {
    const storedConfig = Object.fromEntries(
      Object.entries(config).reverse(),
    ) as PerpsHourlyBreakoutConfig;
    const manifest = await packet(directory, false, [], undefined, storedConfig);
    const result = await analyzeFinancialAudit(directory, manifest);
    assert.equal(result.configHash, digest(config));
    assert.equal(result.pending.C, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("grace observations remain separate from the fixed 28-day admission population", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-financial-grace-"));
  try {
    const at = T0 + 28 * 24 * 3600000;
    const manifest = await packet(directory, false, [
      {
        kind: "event",
        value: {
          key: "grace-original-minute",
          kind: "breakout-host-grace-cells",
          at,
          data: {
            rows: [
              { scheduledAt: at, marketId: null, status: "QUALIFIED" },
              ...config.markets.map((market) => ({
                scheduledAt: at,
                marketId: market.marketId,
                status: "QUALIFIED",
              })),
            ],
          },
        },
      },
    ]);
    const result = await analyzeFinancialAudit(directory, manifest);
    assert.deepEqual(result.graceAvailability.cycles, {
      planned: 240,
      recorded: 1,
      qualified: 1,
      notRequired: 0,
      unavailable: 0,
      missing: 239,
    });
    assert.equal(result.graceAvailability.marketMinutes.qualified, 11);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function preparedGeneration(root: string, generation: string, budget: ArtifactBudget) {
  const directory = join(root, generation);
  await mkdir(directory);
  const writer = budgetWriter(budget);
  for (const file of [
    "report.html",
    "report.json",
    "report.csv",
    "financial-audit-manifest.json",
  ]) {
    await writer.write(join(directory, file), Buffer.from(file + "\n"));
  }
  return {
    directory: root,
    generation,
    writer,
    released: (bytes: number) => budget.release(bytes),
  };
}

test("financial publication verifies retained bytes and only prunes the older explicitly known generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-financial-publication-"));
  try {
    const budget = new ArtifactBudget();
    const unknown = join(directory, "generation-unpublished");
    await mkdir(unknown);
    await writeFile(join(unknown, "private-original"), "preserve");
    for (const generation of ["generation-first", "generation-second", "generation-third"]) {
      await publishPreparedFinancialGeneration(
        await preparedGeneration(directory, generation, budget),
      );
    }
    await assert.rejects(lstat(join(directory, "generation-first")), { code: "ENOENT" });
    assert.equal(await readFile(join(unknown, "private-original"), "utf8"), "preserve");
    const pointer = await readFile(join(directory, "financial-report-current.json"), "utf8");
    await writeFile(join(directory, "generation-third", "report.html"), "tampered\n");
    await assert.rejects(
      publishPreparedFinancialGeneration(
        await preparedGeneration(directory, "generation-fourth", budget),
      ),
      { code: "BREAKOUT_AUDIT_INVALID" },
    );
    assert.equal(await readFile(join(directory, "financial-report-current.json"), "utf8"), pointer);
    assert.ok((await lstat(join(directory, "generation-second"))).isDirectory());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("financial publication fails before pointer replacement on post-hash tampering or pointer write failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-financial-publication-failure-"));
  try {
    const budget = new ArtifactBudget();
    await publishPreparedFinancialGeneration(
      await preparedGeneration(directory, "generation-first", budget),
    );
    const pointer = await readFile(join(directory, "financial-report-current.json"), "utf8");
    const second = await preparedGeneration(directory, "generation-second", budget);
    await assert.rejects(
      publishPreparedFinancialGeneration({
        ...second,
        writer: {
          ...second.writer,
          async write(path, bytes) {
            await second.writer.write(path, bytes);
            if (path.endsWith("verified-generation.json")) {
              await writeFile(
                join(directory, "generation-second", "report.csv"),
                "changed after hashing",
              );
            }
          },
        },
      }),
      { code: "BREAKOUT_AUDIT_INVALID" },
    );
    const third = await preparedGeneration(directory, "generation-third", budget);
    await assert.rejects(
      publishPreparedFinancialGeneration({
        ...third,
        writer: {
          ...third.writer,
          async write(path, bytes) {
            if (path.includes(".financial-report-current-")) {
              throw new Error("Controlled publication failure");
            }
            await third.writer.write(path, bytes);
          },
        },
      }),
      /Controlled publication failure/,
    );
    assert.equal(await readFile(join(directory, "financial-report-current.json"), "utf8"), pointer);
    assert.ok((await lstat(join(directory, "generation-first"))).isDirectory());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("financial generation rejects symlink inventory and pinned manifest replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-financial-publication-path-"));
  try {
    const budget = new ArtifactBudget();
    const unsafe = await preparedGeneration(directory, "generation-unsafe", budget);
    await symlink("report.json", join(directory, "generation-unsafe", "linked.json"));
    await assert.rejects(publishPreparedFinancialGeneration(unsafe), {
      code: "BREAKOUT_AUDIT_INVALID",
    });
    await publishPreparedFinancialGeneration(
      await preparedGeneration(directory, "generation-first", budget),
    );
    const pointer = await readFile(join(directory, "financial-report-current.json"), "utf8");
    const manifestPath = join(directory, "generation-first", "verified-generation.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files[0].file = "../report.json";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      publishPreparedFinancialGeneration(
        await preparedGeneration(directory, "generation-next", budget),
      ),
      { code: "BREAKOUT_AUDIT_INVALID" },
    );
    assert.equal(await readFile(join(directory, "financial-report-current.json"), "utf8"), pointer);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline financial export checks byte integrity, safe output, deterministic report, and no network", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-financial-offline-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network access forbidden in offline controlled test");
  };
  try {
    const manifest = await packet(directory);
    const path = join(directory, "financial-audit-manifest.json");
    await writeFile(path, JSON.stringify(manifest));
    const output = join(directory, "new-report");
    await runFinancialOfflineCommand({
      command: "audit",
      state: path,
      output,
      signal: new AbortController().signal,
    });
    const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
    assert.equal(report.modelCalls, 0);
    assert.equal(report.report.positiveDescriptiveScreen, false);
    assert.match(await readFile(join(output, "report.html"), "utf8"), /P_context has no account/);
    await assert.rejects(
      runFinancialOfflineCommand({
        command: "replay",
        state: path,
        output: join(directory, "rejected"),
        envFile: "/never-read.env",
        signal: new AbortController().signal,
      }),
      /rejects credentials/,
    );
    const first = manifest.parts[0]!;
    const bytes = await readFile(join(directory, first.file));
    bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 1;
    await writeFile(join(directory, first.file), bytes);
    await assert.rejects(analyzeFinancialAudit(directory, manifest), /hash mismatch/);
    assert.notEqual(bytesHash(bytes), first.sha256);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("financial host claims the original slot, values before candle work, and never overlaps decisions", async () => {
  const { runFinancialDriver } = await import("../src/hourly-breakout/financial-adapter.js");
  const controller = new AbortController();
  let now = T0;
  const calls: string[] = [];
  const accounts = (["C", "S", "L"] as const).map((role) => {
    const scope = {
      tenantId: "controlled",
      agentId: role,
      sessionId: config.sessionId,
      network: "mainnet" as const,
    };
    return {
      role,
      scope,
      view: {
        account: {
          ...initialPaperAccount(scope, 1, T0),
          marketDataPolicy: "stream-universe-component-paper-20s-v1" as const,
          riskManagement: "buffered-selective-1x-v1" as const,
        },
        movements: [],
        attempts: [],
      },
    };
  });
  const snapshot = () => ({
    accounts,
    discoveries: [],
    closeObligations: [],
    unknownBarriers: [],
    closedFences: [],
  });
  const confirmed = <T>(value: T) => ({
    status: "confirmed" as const,
    value,
    acknowledgement: {
      operationId: "controlled",
      authoritativeRecordId: "controlled",
      receivedAt: now,
      receiptStatus: "QUALIFIED" as const,
    },
  });
  let busy = 0;
  let maximum = 0;
  const store = {
    async guard() {},
    async hasDiscoveryOperation() {
      return false;
    },
    async snapshot() {
      return snapshot();
    },
    async observe() {
      calls.push("valuation");
      return confirmed(accounts);
    },
    async commitDiscovery(
      _scope: unknown,
      _lease: unknown,
      input: { discoveries: readonly unknown[] },
    ) {
      busy++;
      maximum = Math.max(maximum, busy);
      calls.push("discovery");
      busy--;
      return confirmed(input.discoveries);
    },
    async latchCloses() {
      return confirmed([]);
    },
    async reconcileSelective() {
      return confirmed(undefined);
    },
    async event() {},
    async closeAdmissions() {
      return confirmed(undefined);
    },
    async claimSlot(_scope: unknown, _lease: unknown, slot: number) {
      calls.push(`claim:${slot}`);
      return true;
    },
    async fundingRequirements() {
      return { rows: [], nextCursor: null };
    },
  } as unknown as Parameters<typeof runFinancialDriver>[0]["store"];
  const prepared: BreakoutPreparedData = {
    candles: [],
    commonSymbols: [],
    ptsHistory: [],
    excluded: [],
    versions: [],
  };
  const reader = {
    async capture(input: { operationId: string; dueAt: number }) {
      calls.push(`capture:${input.operationId}`);
      return {
        operationId: input.operationId,
        dueAt: input.dueAt,
        at: now,
        frames: [],
        excluded: [],
        raw: null,
        prepared,
      };
    },
    async prepare() {
      calls.push("prepare");
      return prepared;
    },
    async reconcileRanges() {
      return { funding: [], completedKeys: [] };
    },
    async close() {},
  } as unknown as Parameters<typeof runFinancialDriver>[0]["reader"];
  await assert.rejects(
    runFinancialDriver({
      config,
      acceptance,
      store,
      lease: { owner: "controlled", expiresAt: T0 + 90000 },
      reader,
      signal: controller.signal,
      clock: () => now,
      async sleep(milliseconds) {
        now += Math.max(1000, milliseconds);
      },
      async guard() {
        controller.signal.throwIfAborted();
      },
      async evidence() {},
      reports() {},
      async progress() {
        if (now >= T0 + 60000) {
          controller.abort(new Error("controlled stop"));
        }
      },
    }),
    /controlled stop/,
  );
  assert.equal(maximum, 1);
  assert.ok(calls.indexOf("claim:0") < calls.indexOf(`capture:minute:${T0}`));
  assert.ok(calls.indexOf("valuation") < calls.indexOf("prepare"));
  assert.equal(calls.filter((call) => call === "claim:0").length, 1);
  assert.equal(calls.filter((call) => call === "discovery").length, 1);
});

test("later close confirmation cannot rescue an earlier failed original Q and historical emergencies survive day reset", async () => {
  const directory = await mkdtemp(join(tmpdir(), "breakout-financial-q-original-"));
  const original = {
    protocolDigest: acceptance.protocolDigest,
    role: "C",
    marketId: 1,
    action: "FULL_CLOSE",
    actionObligationId: "same-required-close",
    originalSourceAssignedBeforeAcquisition: true,
  };
  const event = (key: string, kind: string, data: unknown): PerpsBreakoutAuditPart => ({
    kind: "event",
    value: { key, kind, data, at: T0 },
  });
  try {
    const manifest = await packet(directory, false, [
      event("q-first", "breakout-action-obligation", {
        ...original,
        originalOperationId: "minute:first",
        scheduledAt: T0,
        finalOperationId: "final:first",
      }),
      event("q-second", "breakout-action-obligation", {
        ...original,
        originalOperationId: "minute:second",
        scheduledAt: T0 + 60000,
        finalOperationId: "final:second",
      }),
      event("source-second", "breakout-host-final", {
        operationId: "final:second",
        validMarketIds: [1],
        finalSet: {
          financialAt: T0 + 60000,
          receiptAt: T0 + 60000,
          frames: [controlledFrame(T0 + 60000)],
        },
      }),
      event("confirmed-close", "breakout-financial", {
        action: "FULL_CLOSE",
        attemptId: "second-close-attempt",
        sourceOperationId: "final:second",
        obligation: {
          role: "C",
          positionId: "controlled-position",
          id: "same-required-close",
          originalOperationId: "minute:second",
          reasons: ["DAILY_LOSS"],
        },
      }),
    ]);
    const result = await analyzeFinancialAudit(directory, manifest);
    const members = result.report.requiredFinals.originalMembers;
    assert.equal(members.length, 2);
    assert.equal(
      members.find((m) => m.originalOperationId === "minute:first")!.financialStatus,
      "UNATTEMPTED",
    );
    assert.equal(
      members.find((m) => m.originalOperationId === "minute:first")!.evidenceStatus,
      "UNPERFORMED",
    );
    assert.equal(
      members.find((m) => m.originalOperationId === "minute:second")!.financialStatus,
      "CONFIRMED",
    );
    assert.equal(
      members.find((m) => m.originalOperationId === "minute:second")!.evidenceStatus,
      "VALID",
    );
    assert.equal(result.report.candidateRiskFit, "REJECT_C_RISK_FIT");
    assert.equal(result.report.arms.find((a) => a.role === "C")!.riskStatus, "EMERGENCY_VERIFIED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("original joint V receipts keep ETH identity and source J never advances financial supervision", async () => {
  const { createBoundaryClock } = await import("../src/hourly-breakout/clock.js");
  const directory = await mkdtemp(join(tmpdir(), "breakout-financial-receipts-"));
  try {
    let now = T0 + 1000;
    let fractional = 0;
    const certificate: BreakoutClockCertificate = {
      id: "controlled-financial",
      scope: "financial-valuation",
      epochId: "controlled-epoch",
      compatibilityId: "controlled-mapping",
      validFromMs: T0 - 10000,
      validUntilMs: T0 + (28 * 24 + 4 + 72) * 3600000 + 10000,
      accepted: true,
      measuredBounds: {
        quantizationMs: 1,
        resolutionMs: 0.01,
        mappingUncertaintyMs: 10,
        offsetBoundMs: 10,
        driftBoundMs: 10,
      },
      provenance: ["controlled-explicit-financial"],
    };
    const journal = new SegmentedJournal(directory, "financial-clocks", new ArtifactBudget());
    const clock = { wall: () => now, monotonic: () => now - T0 + 1000000 + (fractional += 0.001) };
    const paired = createBoundaryClock({
      clock,
      scope: "financial-valuation",
      epochId: certificate.epochId,
      certificate,
      acceptance: { accepted: true, provenance: ["controlled-explicit-financial"] },
      appendAndSync: (record) => {
        journal.append(record);
      },
    });
    const source = createBoundaryClock({
      clock,
      scope: "source-local",
      acceptance: { accepted: true, provenance: ["controlled-source-only"] },
      appendAndSync: (record) => {
        journal.append(record);
      },
    });
    const event = (
      key: string,
      action: string,
      positionId: string,
      marketId: number,
    ): PerpsBreakoutAuditPart => ({
      kind: "event",
      value: {
        key,
        at: now,
        kind: "breakout-financial",
        data:
          action === "OPEN"
            ? {
                action,
                attemptId: positionId,
                sourceOperationId: "final:initial",
                discovery: {
                  role: "C",
                  allocationId: positionId,
                  initialOperationId: "initial",
                  episodeKey: positionId,
                },
              }
            : {
                action,
                attemptId: `close-${positionId}`,
                sourceOperationId: "final:close",
                obligation: {
                  role: "C",
                  positionId,
                  id: `obligation-${positionId}`,
                  marketId,
                  originalOperationId: "close",
                  reasons: ["AGE_4_HOURS"],
                },
              },
      },
    });
    const effects = [
      event("open-eth", "OPEN", "eth", 20),
      event("open-btc", "OPEN", "btc", 1),
      event("close-eth", "FULL_CLOSE", "eth", 20),
      event("close-btc", "FULL_CLOSE", "btc", 1),
    ];
    paired.sample(
      {
        kind: "A_BEFORE_EFFECT",
        operationId: "open-eth",
        accountRole: "C",
        marketIds: [20],
        authoritativeRecordId: "open-eth",
        sourceIdentity: "eth-source",
        acceptedProof: true,
      },
      () => undefined,
    );
    paired.sample(
      {
        kind: "A_BEFORE_EFFECT",
        operationId: "open-btc",
        accountRole: "C",
        marketIds: [1],
        authoritativeRecordId: "open-btc",
        sourceIdentity: "btc-source",
        acceptedProof: true,
      },
      () => undefined,
    );
    for (const elapsed of [60000, 120000]) {
      now = T0 + 1000 + elapsed;
      paired.sample(
        {
          kind: "V",
          operationId: `valuation-${elapsed}`,
          accountRole: "C",
          marketIds: [1, 20],
          authoritativeRecordId: `valuation-${elapsed}`,
          sourceIdentity: "joint-source",
          acceptedProof: true,
          acceptedRecords: [
            { marketId: 1, recordId: `valuation-${elapsed}`, sourceIdentity: "joint-source" },
            { marketId: 20, recordId: `valuation-${elapsed}`, sourceIdentity: "joint-source" },
          ],
        },
        () => undefined,
      );
      source.sample(
        {
          kind: "J",
          operationId: `source-${elapsed}`,
          marketId: 20,
          sourceIdentity: "source-only",
          acceptedProof: true,
        },
        () => undefined,
      );
      source.sample({ kind: "K", operationId: `source-monitor-${elapsed}` }, () => undefined);
    }
    now += 20000;
    paired.sample(
      {
        kind: "V_CLOSE",
        operationId: "close-eth",
        accountRole: "C",
        marketId: 20,
        authoritativeRecordId: "close-eth",
        sourceIdentity: "eth-close",
        acceptedProof: true,
      },
      () => undefined,
    );
    now += 10000;
    paired.sample(
      {
        kind: "V_CLOSE",
        operationId: "close-btc",
        accountRole: "C",
        marketId: 1,
        authoritativeRecordId: "close-btc",
        sourceIdentity: "btc-close",
        acceptedProof: true,
      },
      () => undefined,
    );
    journal.seal();
    const manifest = await packet(directory, false, effects, { certificate });
    manifest.clocks = journal.snapshot();
    const result = await analyzeFinancialAudit(directory, manifest);
    assert.equal(result.supervision.closedExposures, 2);
    assert.equal(result.supervision.failedIntervals, 0);
    assert.equal(result.supervision.complete, true);
    assert.equal(result.supervision.exposures.find((e) => e.positionId === "eth")!.accepted, true);
    now += 1000;
    paired.sample(
      {
        kind: "A_BEFORE_EFFECT",
        operationId: "unknown-opening",
        accountRole: "S",
        marketId: 1,
        authoritativeRecordId: "unknown-original-financial-record",
        sourceIdentity: "unknown-original-source",
        acceptedProof: true,
      },
      () => undefined,
    );
    now += 91000;
    paired.sample({ kind: "K", operationId: "unknown-exposure-monitor" }, () => undefined);
    journal.seal();
    manifest.clocks = journal.snapshot();
    const uncertain = await analyzeFinancialAudit(directory, manifest);
    assert.equal(uncertain.supervision.complete, false);
    assert.equal(uncertain.supervision.pendingExposures, 1);
    assert.equal(uncertain.supervision.possibleUnresolvedOpeningAnchors, 1);
    assert.ok(uncertain.supervision.failedIntervals > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "sixty-second preparation services the next original valuation and twenty-second funding never delays the decision",
  { timeout: 10000 },
  async () => {
    const { runFinancialDriver } = await import("../src/hourly-breakout/financial-adapter.js");
    const { applyPaperMarks } = await import("@pickler/trading/perps");
    const controller = new AbortController();
    let now = T0 + 1000;
    const calls: { kind: string; at: number }[] = [];
    const accounts = (["C", "S", "L"] as const).map((role) => {
      const scope = {
        tenantId: "controlled",
        agentId: role,
        sessionId: config.sessionId,
        network: "mainnet" as const,
      };
      const account: PerpsPaperAccount = {
        ...initialPaperAccount(scope, 1, T0),
        marketDataPolicy: "stream-universe-component-paper-20s-v1" as const,
        riskManagement: "buffered-selective-1x-v1" as const,
      };
      if (role === "C") {
        account.positions.push({
          id: "controlled-open-position",
          symbol: "BTC",
          side: "long",
          quantity: "1",
          entryPrice: "100",
          entryNotional: "100",
          openedAt: T0 + 1,
          entryBlock: 100,
          mark: "100",
          markAt: T0 + 1,
          closedAt: null,
          exitPrice: null,
          exitBlock: null,
        });
      }
      return { role, scope, view: { account, movements: [], attempts: [] } };
    });
    const confirmed = <T>(value: T) => ({
      status: "confirmed" as const,
      value,
      acknowledgement: {
        operationId: "controlled",
        authoritativeRecordId: "controlled",
        receivedAt: now,
        receiptStatus: "QUALIFIED" as const,
      },
    });
    const store = {
      async guard() {},
      async hasDiscoveryOperation() {
        return false;
      },
      async snapshot() {
        return {
          accounts,
          discoveries: [],
          closeObligations: [],
          unknownBarriers: [],
          closedFences: [],
        };
      },
      async observe(
        _scope: unknown,
        _lease: unknown,
        input: { observation: { frames: PerpsPaperFrame[] } },
      ) {
        for (const account of accounts) {
          account.view.account = applyPaperMarks(
            account.view.account,
            input.observation.frames,
            now,
            now,
          );
        }
        calls.push({ kind: "confirmed-native-valuation", at: now });
        return confirmed(accounts);
      },
      async commitDiscovery(
        _scope: unknown,
        _lease: unknown,
        input: { discoveries: readonly unknown[] },
      ) {
        calls.push({ kind: "decision", at: now });
        return confirmed(input.discoveries);
      },
      async latchCloses() {
        return confirmed([]);
      },
      async reconcileSelective() {
        return confirmed(undefined);
      },
      async event() {},
      async closeAdmissions() {
        return confirmed(undefined);
      },
      async claimSlot() {
        return true;
      },
      async fundingRequirements() {
        return {
          rows: [{ key: "controlled-funding", symbol: "BTC", marketId: 1, from: T0 + 1, to: now }],
          nextCursor: null,
        };
      },
    } as unknown as Parameters<typeof runFinancialDriver>[0]["store"];
    const prepared: BreakoutPreparedData = {
      candles: [],
      commonSymbols: [],
      ptsHistory: [],
      excluded: [],
      versions: [],
    };
    let preparation: { at: number; resolve(value: BreakoutPreparedData): void } | undefined;
    let funding:
      { at: number; resolve(value: { funding: []; completedKeys: [] }): void } | undefined;
    const reader = {
      async capture(input: { operationId: string; dueAt: number }) {
        return {
          operationId: input.operationId,
          dueAt: input.dueAt,
          at: now,
          frames: [controlledFrame(now)],
          excluded: [],
          raw: null,
          prepared,
        };
      },
      prepare() {
        calls.push({ kind: "prepare-start", at: now });
        return new Promise<BreakoutPreparedData>((resolve) => {
          preparation = { at: now + 60000, resolve };
        });
      },
      reconcileRanges() {
        calls.push({ kind: "funding-start", at: now });
        return new Promise<{ funding: []; completedKeys: [] }>((resolve) => {
          funding = { at: now + 20000, resolve };
        });
      },
      async close() {},
    } as unknown as Parameters<typeof runFinancialDriver>[0]["reader"];
    await assert.rejects(
      runFinancialDriver({
        config,
        acceptance,
        store,
        reader,
        lease: { owner: "controlled", expiresAt: T0 + 90000 },
        signal: controller.signal,
        clock: () => now,
        async guard() {
          controller.signal.throwIfAborted();
        },
        async sleep(milliseconds) {
          now += Math.max(1000, milliseconds);
          if (preparation && now >= preparation.at) {
            calls.push({ kind: "prepare-end", at: now });
            preparation.resolve(prepared);
            preparation = undefined;
          }
          if (funding && now >= funding.at) {
            calls.push({ kind: "funding-end", at: now });
            funding.resolve({ funding: [], completedKeys: [] });
            funding = undefined;
          }
        },
        async evidence() {},
        reports() {},
        async progress() {
          if (now >= T0 + 120000) {
            controller.abort(new Error("controlled priority stop"));
          }
        },
      }),
      /controlled priority stop/,
    );
    const valuationAtMinuteOne = calls.findIndex(
      (c) => c.kind === "confirmed-native-valuation" && c.at >= T0 + 60000,
    );
    const decision = calls.findIndex((c) => c.kind === "decision");
    assert.ok(valuationAtMinuteOne >= 0 && valuationAtMinuteOne < decision);
    assert.ok(calls[decision]!.at < calls.find((c) => c.kind === "funding-end")!.at);
    const valuations = calls
      .filter((c) => c.kind === "confirmed-native-valuation")
      .map((c) => c.at);
    assert.ok(Math.max(...valuations.slice(1).map((at, i) => at - valuations[i]!)) <= 60000);
    assert.ok(accounts[0]!.view.account.positions[0]!.markAt! >= T0 + 120000);
  },
);

test("prepared reference packets reproduce exact earlier bytes and never use later candles to repair missing evidence", async () => {
  const { verifyFinancialEvidence } = await import("../src/hourly-breakout/financial-report.js");
  const directory = await mkdtemp(join(tmpdir(), "breakout-exact-prepared-"));
  try {
    const evidence = new SegmentedJournal(directory, "financial-evidence", new ArtifactBudget());
    const originalBody = '{"controlled_public_candles":true}';
    const responseHash = bytesHash(originalBody);
    const prepared = history();
    for (const version of prepared.versions) {
      version.responseSha256 = responseHash;
    }
    evidence.append({
      kind: "original-public-http-response",
      body: originalBody,
      bodySha256: responseHash,
    });
    for (const version of prepared.versions) {
      evidence.append({ kind: "original-candle-version", sha256: digest(version), value: version });
    }
    const preparedHash = digest(prepared);
    evidence.append({
      kind: "prepared-exact-reference",
      format: "breakout-prepared-exact-reference-v1",
      sha256: preparedHash,
      value: { ...prepared, versions: prepared.versions.map((v) => digest(v)) },
    });
    const sourcePrice = {
      operationId: "controlled-source",
      dueAt: T0,
      at: T0,
      frames: [controlledFrame(T0)],
      excluded: [],
      raw: null,
    };
    evidence.append({
      kind: "source-copy-receipt",
      preparedSha256: preparedHash,
      sourcePrice,
      sourcePriceSha256: digest(sourcePrice),
      sourceSetIdentity: bytesHash(canonicalBreakoutJson(sourcePrice.frames)),
    });
    const passed = await verifyFinancialEvidence(directory, evidence.snapshot());
    assert.equal(passed.status, "VERIFIED_EXACT_ORIGINAL_REFERENCES");
    assert.equal(passed.versionRows, 60);
    assert.equal(passed.sourceCopies, 1);

    const later = { ...prepared.versions[59]!, firstReceivedAt: T0 + 5000 };
    const withoutOriginal = { ...prepared, versions: [...prepared.versions.slice(0, 59), later] };
    evidence.append({
      kind: "prepared-exact-reference",
      format: "breakout-prepared-exact-reference-v1",
      sha256: digest(withoutOriginal),
      value: { ...withoutOriginal, versions: withoutOriginal.versions.map((v) => digest(v)) },
    });
    evidence.append({ kind: "original-candle-version", sha256: digest(later), value: later });
    evidence.seal();
    const failed = await verifyFinancialEvidence(directory, evidence.snapshot());
    assert.equal(failed.status, "NOT_VERIFIABLE");
    assert.equal(failed.missingReferences, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
