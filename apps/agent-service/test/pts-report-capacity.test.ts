import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
import {
  canonicalAudit,
  canonicalAuditChunks,
  profileProposals,
  type PerpsStudyView,
} from "@pickler/trading/evaluation";
import {
  auditPtsStudy,
  auditPtsDecisionRows,
  ptsProposals,
  ptsTemporalProfile,
  type PerpsPtsConfig,
} from "@pickler/trading/pts";
import { initialPaperAccount, type PerpsPaperView } from "@pickler/trading/perps";
import { intradayEvidence, intradayTime } from "@pickler/trading/testing/pts-intraday";
import { digest, bytesHash, publish } from "../src/pts-study/files.js";
import { jsonChunks, jsonDocument } from "../src/pts-study/serialization.js";
import {
  createPtsPartsExport,
  readPtsExportManifest,
  ptsPartsPayloadHash,
} from "../src/pts-study/parts.js";
import { ptsPartReport } from "../src/pts-study/part-report.js";
import { ptsReport } from "../src/pts-study/report.js";
import { runPtsCommand } from "../src/pts-study/index.js";

test("canonical chunks preserve historical bytes, holes, ordering and Unicode; native JSON preserves data semantics", () => {
  const sparse = new Array(3);
  sparse[1] = undefined;
  const cases: unknown[] = [
    null,
    false,
    -0,
    NaN,
    "emoji 🌒",
    sparse,
    { z: undefined, a: [1, "é"], "10": 10, "2": 2 },
    new Date(0),
  ];
  for (const value of cases) {
    const legacy = canonicalAudit(value);
    assert.equal([...canonicalAuditChunks(value)].join(""), legacy);
    assert.equal(digest(value), createHash("sha256").update(legacy).digest("hex"));
  }
  const casesNative = [...cases, { omitted: { toJSON: () => undefined }, retained: Object(2) }];
  for (const value of casesNative) {
    assert.equal([...jsonChunks(value)].join(""), JSON.stringify(value));
  }
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.throws(() => [...jsonChunks(circular)], /Circular/);
});

test("large container publication never serializes the whole object; interruption leaves the prior atomic file intact", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "pts-json-capacity-"));
  const value = {
    histories: Array.from({ length: 96 }, (_, slot) => ({ slot, text: "🌒".repeat(16000) })),
  };
  const stringify = JSON.stringify;
  t.mock.method(JSON, "stringify", ((input: unknown, ...args: unknown[]) => {
    if (input === value || input === value.histories) {
      throw new RangeError("Invalid string length: controlled container ceiling");
    }
    return Reflect.apply(stringify, JSON, [input, ...args]);
  }) as typeof JSON.stringify);
  const files = await publish(output, { "large.json": jsonDocument(value) });
  const bytes = await readFile(join(output, "large.json"), "utf8");
  assert.deepEqual(JSON.parse(bytes), value);
  assert.equal(files["large.json"]!.sha256, bytesHash(bytes));
  assert.equal(files["large.json"]!.bytes, Buffer.byteLength(bytes));
  function* failed() {
    yield "partial replacement";
    throw new Error("controlled disk failure");
  }
  await assert.rejects(publish(output, { "large.json": failed() }), /controlled disk failure/);
  assert.equal(await readFile(join(output, "large.json"), "utf8"), bytes);
  assert.ok((await readdir(output)).every((name) => !name.endsWith(".tmp")));
});

test("HTML stays compact while streamed JSON retains full source details and interrupted state", async () => {
  const output = await mkdtemp(join(tmpdir(), "pts-report-summary-"));
  const raw = { historicalOnly: "never-inline-native-history-" + "x".repeat(1024 * 1024) };
  await ptsReport(
    output,
    {
      protocol: "perps-pts-intraday-sma-v1",
      processState: "interrupted",
      roundDetails: [raw, raw],
      executionDetails: [raw],
      events: [raw],
      audit: { accounts: raw },
    },
    [{ symbol: "<script>bad</script>", reason: "=bad" }],
  );
  const html = await readFile(join(output, "report.html"), "utf8");
  assert.ok(html.includes("Comparison interrupted"));
  assert.ok(!html.includes("never-inline-native-history-"));
  assert.ok(!html.includes("<script>bad</script>"));
  assert.ok((await stat(join(output, "report.html"))).size < 30000);
  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  assert.deepEqual(report.roundDetails, [raw, raw]);
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.reportHash, digest(report));
  assert.equal(
    manifest.files["report.json"],
    bytesHash(await readFile(join(output, "report.json"), "utf8")),
  );
});

async function fixture() {
  const config = JSON.parse(
    await readFile(new URL("../src/pts-study/pts-intraday-template.json", import.meta.url), "utf8"),
  ) as PerpsPtsConfig;
  const accounts: Record<string, PerpsPaperView> = {};
  for (const variant of ["sma-reference", "pts-intraday"]) {
    const account = initialPaperAccount({ ...config, agentId: variant }, 1, intradayTime);
    account.riskManagement = "buffered-selective-1x-v1";
    if (variant === "pts-intraday") {
      account.positionPolicy = ptsTemporalProfile("0.1.0").accountPolicy;
      account.consumedPtsSetups = [];
    }
    accounts[variant] = { account, attempts: [], movements: [] };
  }
  const evidence = intradayEvidence(intradayTime, false, "0.40", digest);
  const proposals = {
    "sma-reference": profileProposals(
      { evidence, account: accounts["sma-reference"]!.account },
      config,
      "sma-reference",
    ),
    "pts-intraday": ptsProposals({ evidence, account: accounts["pts-intraday"]!.account }, config),
  };
  const study: PerpsStudyView = {
    record: {
      config,
      metadata: { commit: "controlled-capacity-source" },
      agentIds: { "sma-reference": "sma", "pts-intraday": "pts" },
      agentVersions: { "sma-reference": 1, "pts-intraday": 1 },
      createdAt: intradayTime,
      startedAt: intradayTime,
      endsAt: intradayTime + 86400000,
      graceUntil: intradayTime + 87300000,
      status: "interrupted",
      decisionStopReason: "PTS_REPORT_SERIALIZATION_FAILED",
      stopRequested: false,
      lastObservationAt: intradayTime,
      lastRoundSlot: 0,
    },
    rounds: [
      {
        key: "round-000",
        slot: 0,
        status: "completed",
        executionStatus: "complete",
        createdAt: intradayTime,
        finishedAt: intradayTime,
        evidence,
        accounts: Object.fromEntries(
          Object.entries(accounts).map(([variant, view]) => [variant, view.account]),
        ),
        proposals,
        calls: {},
      },
    ],
    events: [
      {
        key: "round-000:execution-input",
        at: intradayTime,
        kind: "execution-input",
        data: { evidence },
      },
      ...Object.entries(proposals).map(([variant, initial]) => ({
        key: "round-000:" + variant + ":final-gate",
        at: intradayTime,
        kind: "final-gate",
        data: { initial, final: initial },
      })),
    ],
  };
  return JSON.parse(JSON.stringify({ study, accounts })) as {
    study: PerpsStudyView;
    accounts: Record<string, PerpsPaperView>;
  };
}

test("segmented export reproduces v1 source hash and per-slot decisions offline, including every unrecorded slot", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw Error("offline network forbidden");
  });
  const source = await fixture();
  const root = await mkdtemp(join(tmpdir(), "pts-parts-parity-"));
  const exporter = await createPtsPartsExport(root, "controlled-exporter");
  await exporter.emit({ kind: "record", value: source.study.record });
  for (const value of source.study.rounds) {
    await exporter.emit({ kind: "round", value });
  }
  for (const value of source.study.events) {
    await exporter.emit({ kind: "event", value });
  }
  for (const [variant, value] of Object.entries(source.accounts)) {
    await exporter.emit({ kind: "account", variant, value });
  }
  const manifest = await exporter.finish();
  assert.equal(manifest.payloadHash, digest(source));
  assert.equal(await ptsPartsPayloadHash(root, manifest), digest(source));
  const legacy = auditPtsStudy(source.study, source.accounts, digest);
  assert.deepEqual(
    auditPtsDecisionRows(source.study, digest, [0]),
    legacy.rows.filter((row) => row.slot === 0),
  );
  const segmented = await ptsPartReport(
    root,
    await readPtsExportManifest(join(root, "export.json")),
  );
  assert.deepEqual(segmented.rows, legacy.rows);
  assert.deepEqual(segmented.report.financial, legacy.financial);
  assert.equal(segmented.report.sourceHash, legacy.sourceHash);
  const originalNow = Date.now;
  const fixedNow = t.mock.method(Date, "now", () => manifest.capturedAt + 60_000);
  const again = await ptsPartReport(root, manifest);
  fixedNow.mock.restore();
  assert.equal(Date.now, originalNow);
  assert.deepEqual(again.report, segmented.report);
  assert.deepEqual(again.rows, segmented.rows);
  const output = join(root, "audit");
  await runPtsCommand({
    command: "audit",
    state: join(root, "export.json"),
    output,
    signal: new AbortController().signal,
  });
  const result = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  assert.equal(result.processState, "interrupted");
  assert.equal(result.rows.length, 24 * 12 * 11 * 2);
  assert.equal(network, 0);
  const guard = join(root, "offline-guard.mjs");
  await writeFile(
    guard,
    `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.startsWith("@pickler/infrastructure") || specifier.startsWith("@pickler/agent-runtime") || /@ai-sdk|@mastra|@turnkey/.test(specifier)) {
        throw Error("Provider composition forbidden in offline CLI");
      }
      return next(specifier, context);
    }});
    globalThis.fetch = () => { throw Error("Network forbidden in offline CLI"); };
  `,
  );
  const command = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      guard,
      "src/evaluate.ts",
      "audit",
      "--state",
      join(root, "export.json"),
      "--output",
      join(root, "cli-audit"),
    ],
    {
      cwd: new URL("../", import.meta.url),
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    },
  );
  assert.equal(command.status, 0, command.stderr);
  assert.equal(
    JSON.parse(await readFile(join(root, "cli-audit/report.json"), "utf8")).sourceHash,
    legacy.sourceHash,
  );
  await assert.rejects(
    runPtsCommand({
      command: "audit",
      state: join(root, "export.json"),
      envFile: "never-read",
      output: join(root, "bad-env"),
      signal: new AbortController().signal,
    }),
    { code: "INVALID_INPUT" },
  );
  await writeFile(join(root, manifest.rounds[0]!.file), "{}", { flag: "w" });
  await assert.rejects(ptsPartReport(root, manifest), { code: "AUDIT_HASH_MISMATCH" });
});

test("worker reports a safe specific source failure and exits; it never publishes success after failure", async () => {
  const output = await mkdtemp(join(tmpdir(), "pts-worker-failure-"));
  const worker = new Worker(new URL("../src/pts-study/report-worker.mjs", import.meta.url), {
    workerData: { manifestPath: join(output, "missing.json"), output },
  });
  const messages: unknown[] = [];
  const code = await new Promise<number>((resolve, reject) => {
    worker.on("message", (message) => messages.push(message));
    worker.once("error", reject);
    worker.once("exit", resolve);
  });
  assert.equal(code, 1);
  assert.deepEqual(messages, [
    { published: false, code: "PTS_REPORT_FAILED", phase: "source-validation" },
  ]);
  assert.deepEqual(await readdir(output), []);
});
