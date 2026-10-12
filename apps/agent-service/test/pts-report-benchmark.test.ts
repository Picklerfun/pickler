import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createTestStore } from "@pickler/infrastructure/testing";
import { PostgresPerpsStudyStore, exportPerpsAudit } from "@pickler/infrastructure/perps-lab";
import type { PerpsPtsConfig } from "@pickler/trading/pts";
import { digest } from "../src/pts-study/files.js";
import { exportPtsReportSource } from "../src/pts-study/report-source.js";
import { readPtsExportManifest } from "../src/pts-study/parts.js";

/** Controlled source-only measurement; neither path is historical market-performance evidence. */
test("thirty paired source exports preserve hashes while measuring host-thread isolation and startup cost", async (t) => {
  const db = await createTestStore(t);
  const configuration = JSON.parse(
    await readFile(new URL("../src/pts-study/pts-intraday-template.json", import.meta.url), "utf8"),
  ) as PerpsPtsConfig;
  configuration.tenantId = "alpha";
  const study = new PostgresPerpsStudyStore(db.pool);
  await study.initialize(configuration, { commit: "controlled-benchmark" });
  const id = (
    await db.pool.query("SELECT id FROM pickler.perps_studies WHERE session_id=$1", [
      configuration.sessionId,
    ])
  ).rows[0]!.id;
  // Deliberately synthetic JSON load: it is not a candle, book, signal or financial return.
  const round = {
    key: "round-000",
    slot: 0,
    status: "completed",
    executionStatus: "complete",
    createdAt: 1,
    calls: {},
    controlledSerializationLoad: "public-fixture-".repeat(300_000),
  };
  await db.pool.query(
    "INSERT INTO pickler.perps_study_rounds(study_id,key,document) VALUES($1,$2,$3)",
    [id, round.key, round],
  );
  const expected = digest(await exportPerpsAudit(db.pool, configuration));
  const root = await mkdtemp(join(tmpdir(), "pts-report-source-benchmark-"));
  const envFile = join(root, "database-only.env");
  await writeFile(envFile, "DATABASE_URL=" + db.pool.options.connectionString! + "\n", {
    mode: 0o600,
  });
  const workerModule = new URL("../src/pts-study/report-source.ts", import.meta.url).href;
  const api = import.meta.resolve("tsx/esm/api");
  async function isolated(source: {
    envFile: string;
    configuration: PerpsPtsConfig;
    directory: string;
  }) {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require("node:worker_threads");
      (async () => {
        const { tsImport } = await import(workerData.api);
        const { exportPtsReportSource } = await tsImport(workerData.module, workerData.module);
        await exportPtsReportSource(workerData.source, "controlled-benchmark");
        parentPort.postMessage({ completed: true });
      })().catch(() => { process.exitCode = 1; }).finally(() => parentPort.close());
    `,
      { eval: true, env: {}, workerData: { api, module: workerModule, source } },
    );
    let completed = false;
    await new Promise<void>((resolve, reject) => {
      worker.on("message", (message) => {
        completed = message.completed === true;
      });
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code === 0 && completed) {
          resolve();
        } else {
          reject(Error("Controlled export worker failed"));
        }
      });
    });
  }
  const samples: {
    index: number;
    path: string;
    elapsedMs: number;
    maxHostHeartbeatGapMs: number;
    callbacks: number;
    payloadHash: string;
  }[] = [];
  for (let index = 0; index < 30; index++) {
    for (const path of index % 2 ? ["worker", "host"] : ["host", "worker"]) {
      const source = { envFile, configuration, directory: join(root, path + "-" + index) };
      let last = performance.now();
      let gap = 0;
      let callbacks = 0;
      const ticker = setInterval(() => {
        const now = performance.now();
        gap = Math.max(gap, now - last);
        last = now;
        callbacks++;
      }, 5);
      const started = performance.now();
      try {
        if (path === "worker") {
          await isolated(source);
        } else {
          await exportPtsReportSource(source, "controlled-benchmark");
        }
      } finally {
        gap = Math.max(gap, performance.now() - last);
        clearInterval(ticker);
      }
      const elapsedMs = performance.now() - started;
      const manifest = await readPtsExportManifest(join(source.directory, "export.json"));
      assert.equal(manifest.payloadHash, expected);
      samples.push({
        index,
        path,
        elapsedMs,
        maxHostHeartbeatGapMs: gap,
        callbacks,
        payloadHash: manifest.payloadHash,
      });
    }
  }
  const percentile = (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!;
  const median = (values: number[]) => {
    const ordered = [...values].sort((a, b) => a - b);
    const half = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[half]! : (ordered[half - 1]! + ordered[half]!) / 2;
  };
  const metrics = ["host", "worker"].map((path) => {
    const values = samples.filter((sample) => sample.path === path);
    return {
      path,
      n: values.length,
      elapsedMs: {
        median: median(values.map((v) => v.elapsedMs)),
        p95: percentile(
          values.map((v) => v.elapsedMs),
          0.95,
        ),
      },
      maxHostHeartbeatGapMs: {
        median: median(values.map((v) => v.maxHostHeartbeatGapMs)),
        p95: percentile(
          values.map((v) => v.maxHostHeartbeatGapMs),
          0.95,
        ),
      },
      callbacks: values.reduce((sum, sample) => sum + sample.callbacks, 0),
    };
  });
  const result = {
    version: 1,
    protocol: "pts-report-source-isolation-benchmark-v1",
    capturedAt: Date.now(),
    controlled: true,
    sourceOnly: true,
    syntheticLoadBytes: Buffer.byteLength(round.controlledSerializationLoad),
    pairedMeasurements: 30,
    totalMeasurements: 60,
    reportPoolLimitBothPaths: 1,
    workerStartupIncluded: true,
    quantiles: { median: "middle pair average", p95: "nearest rank" },
    providerCalls: 0,
    modelCalls: 0,
    payloadHash: expected,
    metrics,
    samples,
    limits:
      "Measures identical controlled read-only source capture on the host thread versus a new worker. Rendering, provider latency, historical failure causality and P&L are outside this benchmark.",
  };
  await writeFile(join(root, "benchmark.json"), JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  if (process.env.PTS_REPORT_BENCHMARK_OUTPUT) {
    await writeFile(
      process.env.PTS_REPORT_BENCHMARK_OUTPUT,
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  }
  t.diagnostic(
    JSON.stringify({
      artifact: join(root, "benchmark.json"),
      metrics,
      pairedMeasurements: 30,
      hashesVerified: 60,
      workerStartupIncluded: true,
    }),
  );
});
