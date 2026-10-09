import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { auditUniverseCapture, assertPerpsStudyConfig } from "@pickler/trading/evaluation";
import { runReaderAudit } from "../src/perps-study/reader-audit.js";
import { runUniverseStability } from "../src/perps-study/universe-stability.js";
import { config } from "./perps-reentry-fixtures.js";

const capture = () => ({
  version: 1,
  protocol: "perps-universe-stability-v1",
  commit: "a".repeat(40),
  configurationHash: "b".repeat(64),
  startedAt: 1000,
  endsAt: 1801000,
  ownershipFailures: 0,
  credentials: "PRIVATE_VALUE_MUST_NOT_LEAVE_INPUT",
  cycles: [
    {
      slot: 0,
      at: 1000,
      scheduledAt: 1000,
      valid: false,
      missed: false,
      markets: [{ symbol: "BTC", valid: false }],
      acquisition: [
        {
          symbol: "BTC",
          at: 3406,
          tickerAt: 0,
          bookAt: 10000,
          skewMs: 10000,
          code: "INCONSISTENT_MARKET_DATA",
        },
        {
          symbol: "BTC",
          at: 16703,
          tickerAt: 0,
          bookAt: 10000,
          skewMs: 10000,
          code: "INCONSISTENT_MARKET_DATA",
        },
      ],
      requests: [
        {
          operation: "ticker",
          startedAt: 3000,
          status: 200,
          queueMs: 650,
          durationMs: 300,
          phase: "complete",
          code: null,
          rawBody: "PRIVATE_RESPONSE_MUST_NOT_LEAVE_INPUT",
        },
      ],
    },
  ],
});

test("recorded reader audit measures checks without inventing network/cache attribution", () => {
  const result = auditUniverseCapture(capture());
  const btc = result.rows.find((row) => row.symbol === "BTC")!;
  assert.equal(btc.firstCheckMs, 2406);
  assert.equal(btc.firstRecoveryCheckMs, 15703);
  assert.equal(btc.recoveryDelayMs, 13297);
  assert.equal(btc.repeatedTickerDateChecks, 1);
  assert.equal(btc.cacheReads, null);
  assert.equal(btc.networkReads, null);
  assert.equal(btc.finalValid, false);
  assert.equal(result.rows.find((row) => row.symbol === "ETH")!.finalValid, null);
  assert.equal(result.counts.http200, 1);
  assert.equal(result.counts.validCycles, 0);
  assert.deepEqual(result, auditUniverseCapture(capture()));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|rawBody|credentials/);
});

test("valid checks are not classified as failed recovery and later failures stay explicit", () => {
  const input = capture();
  input.cycles[0]!.acquisition.unshift({
    ...input.cycles[0]!.acquisition[0]!,
    at: 2000,
    code: "VALID",
  });
  const row = auditUniverseCapture(input).rows.find((row) => row.symbol === "BTC")!;
  assert.equal(row.firstCheckMs, 1000);
  assert.equal(row.firstInvalidCheckMs, 2406);
  assert.equal(row.recoveryDelayMs, 13297);
  input.cycles[0]!.acquisition = [input.cycles[0]!.acquisition[0]!];
  assert.equal(
    auditUniverseCapture(input).rows.find((row) => row.symbol === "BTC")!.recoveryDelayMs,
    null,
  );
});

test("reader audit accepts explicit v2 cache/network evidence without reinterpreting v1", () => {
  const input = {
    ...capture(),
    version: 2,
    acquisitionPolicy: "rest-universe-coherent-20s-v2",
    cycles: [
      {
        ...capture().cycles[0],
        tickerReads: [
          { source: "network", symbols: [{ symbol: "BTC" }] },
          { source: "cache", symbols: [{ symbol: "BTC" }] },
        ],
      },
    ],
  };
  const row = auditUniverseCapture(input).rows.find((row) => row.symbol === "BTC")!;
  assert.equal(row.networkReads, 1);
  assert.equal(row.cacheReads, 1);
  assert.equal(auditUniverseCapture(capture()).rows[0]!.networkReads, null);
  const missingMember = {
    ...input,
    cycles: [
      {
        ...input.cycles[0],
        tickerReads: [{ source: "network", requestedSymbols: ["BTC"], symbols: [] }],
      },
    ],
  };
  assert.equal(
    auditUniverseCapture(missingMember).rows.find((row) => row.symbol === "BTC")!.networkReads,
    1,
  );
});

test("three public reader captures remain diagnostic evidence, never qualification", () => {
  const input = {
    ...capture(),
    version: 2,
    protocol: "perpl-reader-check-v1",
    acquisitionPolicy: "rest-universe-coherent-20s-v2",
    qualification: "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE",
    expectedCycles: 3,
    requiredValid: null,
    passed: false,
    cycles: [0, 1, 2].map((slot) => ({ ...capture().cycles[0], slot })),
  };
  assert.equal(auditUniverseCapture(input).counts.cycles, 3);
  assert.equal(auditUniverseCapture(input).rows.length, 33);
  assert.throws(() => auditUniverseCapture({ ...input, passed: true }), /qualification/);
  assert.throws(() => auditUniverseCapture({ ...input, expectedCycles: 30 }), /qualification/);
  assert.throws(
    () =>
      auditUniverseCapture({
        ...input,
        cycles: [...input.cycles, { ...input.cycles[0], slot: 3 }],
      }),
    /qualification/,
  );
});

test("reader audit rejects duplicates, invalid provenance and regressing check dates", () => {
  const input = capture();
  assert.throws(() =>
    auditUniverseCapture({ ...input, cycles: [input.cycles[0], input.cycles[0]] }),
  );
  assert.throws(() => auditUniverseCapture({ ...input, commit: "<script>" }));
  assert.throws(() => auditUniverseCapture({ ...input, protocol: "perps-four-way-v2" }));
  const reversed = structuredClone(input);
  reversed.cycles[0]!.acquisition.reverse();
  assert.throws(() => auditUniverseCapture(reversed), /regress/);
  const duplicated = structuredClone(input);
  duplicated.cycles[0]!.markets.push({ symbol: "BTC", valid: false });
  assert.throws(() => auditUniverseCapture(duplicated), /Duplicate/);
  const unsafe = structuredClone(input);
  unsafe.cycles[0]!.requests[0]!.operation = "PRIVATE_RESPONSE_MUST_NOT_LEAVE_INPUT";
  assert.doesNotMatch(JSON.stringify(auditUniverseCapture(unsafe)), /PRIVATE_/);
  assert.throws(
    () => auditUniverseCapture({ ...input, acquisitionPolicy: "PRIVATE_SECRET" }),
    /acquisition policy/,
  );
});

test("v7 opts into the corrected reader; absent or explicit v1 retains historical policy", () => {
  assertPerpsStudyConfig(config);
  assertPerpsStudyConfig({ ...config, acquisitionPolicy: "rest-universe-20s-v1" });
  assertPerpsStudyConfig({ ...config, acquisitionPolicy: "rest-universe-coherent-20s-v2" });
  assert.throws(() =>
    assertPerpsStudyConfig({ ...config, acquisitionPolicy: "automatic-fallback" } as never),
  );
  assert.throws(() =>
    assertPerpsStudyConfig({
      ...config,
      version: 6,
      protocol: "perps-sma-profile-risk-v1",
      acquisitionPolicy: "rest-universe-coherent-20s-v2",
    } as never),
  );
});

test("offline reader report filters secrets, hashes exact bytes and never overwrites", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "perpl-reader-audit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, "capture.json");
  const input = JSON.stringify(capture());
  await writeFile(state, input);
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network is forbidden in this test");
  };
  t.after(() => {
    globalThis.fetch = previous;
  });
  const first = await runReaderAudit(state, join(directory, "first"), new AbortController().signal);
  const second = await runReaderAudit(
    state,
    join(directory, "second"),
    new AbortController().signal,
  );
  assert.deepEqual(first, second);
  assert.match(first.sourceBytesHash, /^[a-f0-9]{64}$/);
  for (const file of ["report.json", "report.html", "markets.csv", "requests.csv"]) {
    const content = await readFile(join(directory, "first", file), "utf8");
    assert.doesNotMatch(content, /PRIVATE_|credentials|rawBody/);
    assert.equal(content, await readFile(join(directory, "second", file), "utf8"));
  }
  assert.equal(await readFile(state, "utf8"), input);
  await assert.rejects(
    runReaderAudit(state, join(directory, "first"), new AbortController().signal),
    { code: "EEXIST" },
  );
});

test("reader audit CLI rejects environment and provider flags before reading them", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--",
      "src/evaluate.ts",
      "reader-audit",
      "--state",
      "missing-capture.json",
      "--output",
      "missing-output",
      "--env-file",
      "must-not-read.env",
    ],
    { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INVALID_INPUT.*Offline reader-audit/);
  assert.doesNotMatch(result.stderr, /ENOENT|DATABASE_URL/);
});

test("reader-check rejects legacy or paid mode before environment/provider construction", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "perpl-reader-gate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(config));
  const input = {
    configPath: path,
    envFile: join(directory, "must-not-read.env"),
    output: join(directory, "must-not-create"),
    diagnosticOnly: true,
  };
  await assert.rejects(
    runUniverseStability(input, new AbortController().signal),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "INVALID_INPUT" &&
      /explicitly selected/.test(error.message),
  );
  await assert.rejects(
    runUniverseStability({ ...input, allowPaid: true }, new AbortController().signal),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "INVALID_INPUT" &&
      /paid calls forbidden/.test(error.message),
  );
  await assert.rejects(readFile(input.output), { code: "ENOENT" });
});
