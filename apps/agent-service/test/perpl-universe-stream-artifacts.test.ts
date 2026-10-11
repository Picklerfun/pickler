import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { canonicalAudit, auditUniverseCapture } from "@pickler/trading/evaluation";
import { PERPL_LAB_SYMBOLS } from "@pickler/core";
import { PilotError } from "@pickler/core";
import { setTimeout as wait } from "node:timers/promises";
import { createStreamCapture, publicMarketCsv } from "../src/perps-study/stream-capture.js";
import { runReaderAudit } from "../src/perps-study/reader-audit.js";
import { captureFailureCode } from "../src/perps-study/universe-stability.js";
import { universeStreamValidation, UNIVERSE_COMPONENT_STREAM_POLICY } from "@pickler/trading/perps";
import { runSmaReentry } from "../src/perps-study/reentry-host.js";

test("between-slot timer cancellation preserves the original reader error rather than a generic failure", async () => {
  const controller = new AbortController();
  const pending = wait(1000, undefined, { signal: controller.signal });
  controller.abort(new PilotError("PERPL_STREAM_MESSAGE_LIMIT", "Public reader stopped"));
  await assert.rejects(pending, (error) => {
    assert.equal((error as { name: string }).name, "AbortError");
    assert.equal(captureFailureCode(error, controller.signal), "PERPL_STREAM_MESSAGE_LIMIT");
    return true;
  });
  assert.equal(captureFailureCode(new Error("private transport text")), "STABILITY_FAILED");
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal(captureFailureCode(new Error("timer cancellation"), cancelled.signal), "CANCELLED");
});

test("bounded public capture retains a hashed contiguous prefix and continues counters after truncation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "perpl-stream-capture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const capture = await createStreamCapture(directory, 120);
  capture.record({ kind: "connected", receivedAt: 1000, generation: 1 });
  for (let i = 0; i < 10; i++) {
    capture.record({
      kind: "message",
      receivedAt: 1001 + i,
      generation: 1,
      publicMessage: { mt: 100, sn: i + 1, h: i + 100 },
    });
  }
  capture.record({
    kind: "error",
    receivedAt: 1019,
    generation: 1,
    code: "PERPL_STREAM_MESSAGE_LIMIT",
    limit: { component: "message-queue", observed: 33, maximum: 32 },
  });
  capture.record({ kind: "closed", receivedAt: 1020, generation: 2 });
  await capture.flush();
  const source = await readFile(join(directory, "events.jsonl"));
  const facts = capture.summary();
  assert.ok(source.length <= 120);
  assert.equal(facts.bytes, source.length);
  assert.equal(facts.hash, createHash("sha256").update(source).digest("hex"));
  assert.equal(facts.truncated, true);
  assert.equal(facts.socketClosed, true);
  assert.equal(facts.messages, 10);
  assert.deepEqual(facts.errors[0]!.limit, {
    component: "message-queue",
    observed: 33,
    maximum: 32,
  });
  assert.ok(facts.droppedEvents > 0);
});

test("stream offline audit emits 330 identities, verifies frozen hashes and never forwards extra fields", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "perpl-stream-audit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const config = {
    markets: PERPL_LAB_SYMBOLS.map((symbol, i) => ({ symbol, marketId: i + 1 })),
    acquisitionPolicy: "stream-universe-20s-v1",
  };
  const capture = {
    version: 3,
    protocol: "perps-universe-stability-v1",
    commit: "a".repeat(40),
    configurationHash: digest(canonicalAudit(config)),
    catalogHash: digest(canonicalAudit(config.markets)),
    config,
    acquisitionPolicy: "stream-universe-20s-v1",
    adapterVersion: "public-universe-stream-v1",
    startedAt: 1000,
    endsAt: 1801000,
    ownershipFailures: 0,
    reconstructionErrors: 0,
    leaseReleased: true,
    credentials: "DO_NOT_FORWARD_PRIVATE_FIELD",
    stream: {
      bytes: 0,
      hash: digest(""),
      truncated: false,
      socketClosed: true,
      connections: 1,
      disconnects: 0,
      messages: 0,
    },
    cycles: Array.from({ length: 30 }, (_, slot) => ({
      slot,
      at: 1000 + slot * 60000,
      scheduledAt: 1000 + slot * 60000,
      valid: false,
      missed: false,
      durationMs: 20000,
      markets: config.markets.map((m) => ({ ...m, valid: false })),
      acquisition: [],
      frames: [],
      requests: [],
    })),
  };
  const result = auditUniverseCapture(capture);
  assert.equal(result.rows.length, 330);
  assert.equal(result.counts.attemptedCycles, 30);
  assert.equal(result.counts.notAdmittedCycles, 0);
  assert.equal(result.rows[0]!.slotOutcome, "TECHNICAL_FAILURE");
  assert.equal(result.streamEvidence!.acquisitionMs.observations, 0);
  for (const adapterVersion of ["public-universe-stream-v2", "public-universe-stream-v3"]) {
    const revised = { ...capture, adapterVersion };
    assert.equal(auditUniverseCapture(revised).streamEvidence!.adapterVersion, adapterVersion);
    const diagnostic = {
      ...revised,
      protocol: "perpl-reader-check-v1",
      qualification: "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE",
      expectedCycles: 3,
      requiredValid: null,
      passed: false,
      cycles: revised.cycles.slice(0, 3),
    };
    const audited = auditUniverseCapture(diagnostic);
    assert.equal(audited.sourceQualification, "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE");
    assert.equal(audited.rows.length, 33);
    assert.throws(() => auditUniverseCapture({ ...diagnostic, passed: true }), {
      code: "INVALID_INPUT",
    });
  }
  const experimentalConfig = { ...config, acquisitionPolicy: UNIVERSE_COMPONENT_STREAM_POLICY };
  const experimental = {
    ...capture,
    version: 4,
    adapterVersion: "public-universe-stream-v4",
    acquisitionPolicy: UNIVERSE_COMPONENT_STREAM_POLICY,
    config: experimentalConfig,
    configurationHash: digest(canonicalAudit(experimentalConfig)),
    dataValidation: universeStreamValidation(UNIVERSE_COMPONENT_STREAM_POLICY),
    strictValidCycles: 0,
    cycles: capture.cycles.map((cycle) => ({
      ...cycle,
      strictJointValid: false,
      financialExecutable: false,
      markets: cycle.markets.map((market) => ({ ...market, strictValid: false })),
    })),
  };
  const componentAudit = auditUniverseCapture(experimental);
  assert.equal(componentAudit.protocol, "perpl-reader-audit-v4");
  assert.equal(componentAudit.strictValidCycles, 0);
  assert.equal(componentAudit.rows.length, 330);
  assert.equal(componentAudit.dataValidation!.tickerBookSkewGateMs, null);
  assert.throws(() => auditUniverseCapture({ ...experimental, strictValidCycles: 1 }), {
    code: "INVALID_INPUT",
  });
  assert.throws(
    () =>
      auditUniverseCapture({
        ...experimental,
        dataValidation: { ...experimental.dataValidation, financialAdmission: true },
      }),
    { code: "INVALID_INPUT" },
  );
  const promoted = structuredClone(experimental);
  promoted.cycles[0]!.financialExecutable = true;
  assert.throws(() => auditUniverseCapture(promoted), { code: "INVALID_INPUT" });
  const interrupted = structuredClone(capture);
  Object.assign(interrupted.cycles[2]!, {
    missed: true,
    code: "NOT_ADMITTED_AFTER_INTERRUPTION",
  });
  const interruption = auditUniverseCapture(interrupted);
  assert.equal(interruption.counts.attemptedCycles, 29);
  assert.equal(interruption.counts.notAdmittedCycles, 1);
  assert.equal(interruption.counts.windowMissedCycles, 0);
  assert.equal(
    interruption.rows.find((row) => row.slot === 2)!.slotOutcome,
    "NOT_ADMITTED_AFTER_INTERRUPTION",
  );
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_FORWARD|credentials/);
  const statePath = join(directory, "report.json");
  await writeFile(statePath, JSON.stringify(capture));
  const one = await runReaderAudit(statePath, join(directory, "one"), new AbortController().signal);
  const two = await runReaderAudit(statePath, join(directory, "two"), new AbortController().signal);
  assert.deepEqual(one, two);
  assert.equal((one.replay as { status: string }).status, "NOT_VERIFIABLE");
  assert.equal(
    (await readFile(join(directory, "one", "markets.csv"), "utf8")).trim().split("\n").length,
    331,
  );
  capture.catalogHash = "0".repeat(64);
  await writeFile(statePath, JSON.stringify(capture));
  await assert.rejects(
    runReaderAudit(statePath, join(directory, "bad"), new AbortController().signal),
    { code: "INVALID_INPUT" },
  );
});
test("financial host rejects the experimental capture policy before loading any environment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "perpl-component-financial-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ids = [1, 10, 20, 31, 40, 50, 60, 70, 90, 100, 110];
  const path = join(directory, "study.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 7,
      protocol: "perps-sma-reentry-latency-v1",
      tenantId: "alpha",
      sessionId: "component-capture",
      network: "mainnet",
      hours: 6,
      budgetUsd: "5",
      markets: PERPL_LAB_SYMBOLS.map((symbol, index) => ({ symbol, marketId: ids[index]! })),
      acquisitionPolicy: UNIVERSE_COMPONENT_STREAM_POLICY,
    }),
  );
  await assert.rejects(
    runSmaReentry(
      {
        command: "prepare",
        configPath: path,
        envFile: join(directory, "ENVIRONMENT_MUST_NOT_BE_READ"),
        output: join(directory, "NO_ACCOUNTS"),
      },
      new AbortController().signal,
    ),
    { code: "DIAGNOSTIC_ACQUISITION_ONLY" },
  );
});

test("market CSV protects formulas and quotes in recorded diagnostics", () => {
  const csv = publicMarketCsv([
    { slot: 0, markets: [{ symbol: "BTC", code: '=HYPERLINK("bad")', valid: false }] },
  ]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /""bad""/);
});
