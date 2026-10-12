import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PilotError } from "@pickler/core";
import { createTestStore } from "@pickler/infrastructure/testing";
import {
  createLocalPerpsLabStore,
  PostgresPerpsStudyStore,
  exportPerpsAudit,
} from "@pickler/infrastructure/perps-lab";
import { profileProposals } from "@pickler/trading/evaluation";
import { ptsProposals, ptsPolicy, type PerpsPtsConfig } from "@pickler/trading/pts";
import { intradayEvidence, intradayTime } from "@pickler/trading/testing/pts-intraday";
import { digest } from "../src/pts-study/files.js";
import { readPtsExportManifest, ptsPartsPayloadHash } from "../src/pts-study/parts.js";
import {
  runPtsReportWorker,
  ptsReportWorkerCode,
  type PtsReportPersistenceDiagnostic,
} from "../src/pts-study/report-worker-client.js";

async function fixture(t: Parameters<typeof createTestStore>[0]) {
  const database = await createTestStore(t);
  const configuration = JSON.parse(
    await readFile(new URL("../src/pts-study/pts-intraday-template.json", import.meta.url), "utf8"),
  ) as PerpsPtsConfig;
  configuration.tenantId = "alpha";
  const execution = createLocalPerpsLabStore(database.pool.options.connectionString!, "execution");
  const study = new PostgresPerpsStudyStore(execution.pool);
  const root = await mkdtemp(join(tmpdir(), "pts-report-isolation-"));
  await mkdir(join(root, "report"));
  const envFile = join(root, "database-only.env");
  await writeFile(envFile, "DATABASE_URL=" + database.pool.options.connectionString! + "\n", {
    mode: 0o600,
  });
  try {
    await study.initialize(configuration, { commit: "controlled-isolation-fixture" });
    const lease = await study.claim(configuration);
    const source = await exportPerpsAudit(execution.pool, configuration);
    const evidence = intradayEvidence(intradayTime, false, "0.40", digest);
    const record = {
      ...source.study.record,
      startedAt: intradayTime,
      endsAt: intradayTime + 86400000,
      graceUntil: intradayTime + 87300000,
      lastRoundSlot: 0,
      lastObservationAt: intradayTime,
    };
    const proposals = {
      "sma-reference": profileProposals(
        { evidence, account: source.accounts["sma-reference"]!.account },
        configuration,
        "sma-reference",
      ),
      "pts-intraday": ptsProposals(
        { evidence, account: source.accounts["pts-intraday"]!.account },
        configuration,
      ),
    };
    const round = {
      key: "round-000",
      slot: 0,
      status: "completed",
      executionStatus: "complete",
      createdAt: intradayTime,
      finishedAt: intradayTime,
      evidence,
      proposals,
      calls: {},
      accounts: Object.fromEntries(
        Object.entries(source.accounts).map(([variant, view]) => [variant, view!.account]),
      ),
    };
    const id = (
      await execution.pool.query("SELECT id FROM pickler.perps_studies WHERE session_id=$1", [
        configuration.sessionId,
      ])
    ).rows[0]!.id;
    await execution.pool.query("UPDATE pickler.perps_studies SET document=$2 WHERE id=$1", [
      id,
      record,
    ]);
    await execution.pool.query(
      "INSERT INTO pickler.perps_study_rounds(study_id,key,document) VALUES($1,$2,$3)",
      [id, round.key, round],
    );
    const events = [
      {
        key: "round-000:execution-input",
        at: intradayTime,
        kind: "execution-input",
        data: { evidence },
      },
      ...Object.entries(proposals).map(([variant, value]) => ({
        key: "round-000:" + variant + ":final-gate",
        at: intradayTime,
        kind: "final-gate",
        data: { initial: value, final: value },
      })),
    ];
    for (const event of events) {
      await execution.pool.query(
        "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5)",
        [id, event.key, event.at, event.kind, event.data],
      );
    }
    const input = {
      source: { envFile, configuration, directory: join(root, "evidence") },
      coverage: [],
      state: "process-unverified",
      output: join(root, "report"),
      commit: "controlled-isolation-fixture",
      policyHash: digest(ptsPolicy("0.1.0")),
    };
    return { database, execution, study, configuration, lease, root, input };
  } catch (error) {
    await execution.close();
    throw error;
  }
}

async function reportBackend(database: Awaited<ReturnType<typeof createTestStore>>) {
  return (
    await database.pool.query(
      `SELECT pid,wait_event_type FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active' AND query LIKE '%FROM pickler.perps_study_rounds%'`,
    )
  ).rows;
}
async function waitUntil(check: () => Promise<boolean>, milliseconds = 5000) {
  const until = performance.now() + milliseconds;
  while (performance.now() < until) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("controlled condition did not arrive within the bounded wait");
}

test("real report worker exports consistent native evidence separately and leaves financial history unchanged", async (t) => {
  const f = await fixture(t);
  try {
    const before = await exportPerpsAudit(f.execution.pool, f.configuration);
    await runPtsReportWorker(f.input);
    const after = await exportPerpsAudit(f.execution.pool, f.configuration);
    assert.deepEqual(after, before);
    const manifest = await readPtsExportManifest(join(f.root, "evidence/export.json"));
    assert.equal(manifest.payloadHash, digest(before));
    assert.equal(await ptsPartsPayloadHash(join(f.root, "evidence"), manifest), digest(before));
    assert.equal(manifest.rounds.length, 1);
    const report = JSON.parse(await readFile(join(f.root, "report/report.json"), "utf8"));
    assert.equal(report.sourceHash, digest(before));
    assert.equal(report.processState, "process-unverified");
    assert.equal(f.execution.pool.options.max, 4);
    assert.equal((await reportBackend(f.database)).length, 0, "the report backend has exited");
    await f.study.release(f.configuration, f.lease);
  } finally {
    await f.execution.close();
  }
});

test("a blocked report keeps permission, valuation reads and lease renewal available; its ten-second timeout is specific", async (t) => {
  const f = await fixture(t);
  const lock = await f.database.pool.connect();
  const controller = new AbortController();
  const notices: PtsReportPersistenceDiagnostic[] = [];
  let pending: Promise<void> | undefined;
  try {
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE pickler.perps_study_rounds IN ACCESS EXCLUSIVE MODE");
    pending = runPtsReportWorker(f.input, {
      signal: controller.signal,
      onPersistenceFailure: (error, diagnostic) => {
        notices.push(diagnostic);
        controller.abort(error);
      },
    });
    const rejected = assert.rejects(pending, { code: "PERSISTENCE_QUERY_TIMEOUT" });
    await waitUntil(async () =>
      (await reportBackend(f.database)).some((r) => r.wait_event_type === "Lock"),
    );
    const reportPid = (await reportBackend(f.database))[0]!.pid;
    const first = await exportPerpsAccountValues(f);
    const oldExpiry = f.lease.expiresAt;
    for (let index = 0; index < 3; index++) {
      await f.execution.agent({
        tenantId: f.configuration.tenantId,
        agentId: (await f.study.cycleView(f.configuration)).record.agentIds["sma-reference"]!,
      });
      await f.study.renew(f.configuration, f.lease);
      assert.deepEqual(await exportPerpsAccountValues(f), first);
    }
    assert.ok(f.lease.expiresAt >= oldExpiry);
    await rejected;
    assert.equal(notices.length, 1);
    const failed = notices[0]!.queries.firstFailure!;
    assert.equal(failed.code, "PERSISTENCE_QUERY_TIMEOUT");
    assert.equal(failed.driverCode, "57014");
    // The read-only fingerprint now starts with its materialized key-page CTE.
    assert.equal(failed.statement, "WITH");
    assert.ok(failed.backendPid);
    assert.ok(failed.durationMs! >= 9000);
    assert.equal(notices[0]!.origin, "report-worker");
    await waitUntil(
      async () =>
        !(
          await f.database.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid=$1",
            [reportPid],
          )
        ).rows.length,
      12_000,
    );
    await assert.rejects(stat(join(f.root, "report/report.html")), { code: "ENOENT" });
    await lock.query("ROLLBACK");
    await f.study.release(f.configuration, f.lease);
  } finally {
    controller.abort(new PilotError("CANCELLED", "Controlled cleanup"));
    await pending?.catch(() => {});
    await lock.query("ROLLBACK").catch(() => {});
    lock.release();
    await f.execution.close();
  }
});

async function exportPerpsAccountValues(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await f.execution.pool.query(
      "SELECT document FROM pickler.perps_paper_accounts WHERE tenant_id=$1 AND session_id=$2 ORDER BY agent_id",
      [f.configuration.tenantId, f.configuration.sessionId],
    )
  ).rows;
}

test("ownership cancellation terminates an in-flight read-only report and preserves the original failure", async (t) => {
  const f = await fixture(t);
  const lock = await f.database.pool.connect();
  const controller = new AbortController();
  let pending: Promise<void> | undefined;
  try {
    const before = await exportPerpsAudit(f.execution.pool, f.configuration);
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE pickler.perps_study_rounds IN ACCESS EXCLUSIVE MODE");
    pending = runPtsReportWorker(f.input, { signal: controller.signal });
    const reason = new PilotError("LEASE_LOST", "Controlled lease cancellation");
    const rejected = assert.rejects(pending, (error) => error === reason);
    await waitUntil(async () =>
      (await reportBackend(f.database)).some((r) => r.wait_event_type === "Lock"),
    );
    const pid = (await reportBackend(f.database))[0]!.pid;
    controller.abort(reason);
    await rejected;
    await waitUntil(
      async () =>
        !(
          await f.database.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid=$1",
            [pid],
          )
        ).rows.length,
      12_000,
    );
    await lock.query("ROLLBACK");
    assert.deepEqual(await exportPerpsAudit(f.execution.pool, f.configuration), before);
    await assert.rejects(stat(join(f.root, "report/report.html")), { code: "ENOENT" });
    await f.study.release(f.configuration, f.lease);
  } finally {
    controller.abort();
    await pending?.catch(() => {});
    await lock.query("ROLLBACK").catch(() => {});
    lock.release();
    await f.execution.close();
  }
});

test("pre-aborted report never reads environment and safe failure classification never exposes driver text", async () => {
  const controller = new AbortController();
  const reason = new PilotError("LEASE_LOST", "Controlled cancellation");
  controller.abort(reason);
  await assert.rejects(
    runPtsReportWorker(
      {
        manifestPath: "/does/not/exist",
        coverage: [],
        state: "interrupted",
        output: "/does/not/exist",
        commit: "fixture",
        policyHash: "fixture",
      },
      { signal: controller.signal },
    ),
    (error) => error === reason,
  );
  assert.equal(
    ptsReportWorkerCode({ code: "PERSISTENCE_QUERY_TIMEOUT", message: "private" }),
    "PERSISTENCE_QUERY_TIMEOUT",
  );
  assert.equal(ptsReportWorkerCode({ code: "PRIVATE_SECRET" }), "PTS_REPORT_FAILED");
  assert.equal(
    ptsReportWorkerCode({
      get code() {
        throw Error("private");
      },
    }),
    "PTS_REPORT_FAILED",
  );
});

test("worker composition rejects providers and receives no model or trading environment", async (t) => {
  const f = await fixture(t);
  try {
    const guard = join(f.root, "restricted-guard.mjs");
    await writeFile(
      guard,
      `
      import { registerHooks } from "node:module";
      import { isMainThread } from "node:worker_threads";
      if (!isMainThread && (process.env.MODEL_API_KEY || process.env.TRADING_PRIVATE_KEY)) {
        throw Error("Forbidden inherited provider environment");
      }
      registerHooks({ resolve(specifier, context, next) {
        if (specifier.startsWith("@pickler/agent-runtime") || /@ai-sdk|@mastra|@turnkey/.test(specifier) ||
          (specifier.startsWith("@pickler/infrastructure") && specifier !== "@pickler/infrastructure/perps-lab")) {
          throw Error("Forbidden provider composition");
        }
        return next(specifier, context);
      }});
      globalThis.fetch = () => { throw Error("Public provider transport forbidden"); };
    `,
    );
    const input = join(f.root, "worker-input.json");
    await writeFile(input, JSON.stringify(f.input), { mode: 0o600 });
    const script = join(f.root, "restricted-worker.mjs");
    await writeFile(
      script,
      `
      import { readFile } from "node:fs/promises";
      import { runPtsReportWorker } from ${JSON.stringify(new URL("../src/pts-study/report-worker-client.ts", import.meta.url).href)};
      await runPtsReportWorker(JSON.parse(await readFile(process.argv[2], "utf8")));
    `,
    );
    const child = spawn(process.execPath, ["--import", "tsx", "--import", guard, script, input], {
      cwd: new URL("../", import.meta.url),
      env: {
        PATH: process.env.PATH,
        MODEL_API_KEY: "controlled-canary",
        TRADING_PRIVATE_KEY: "controlled-canary",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let diagnostic = "";
    child.stderr.on("data", (data) => {
      diagnostic += String(data);
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0, diagnostic);
    assert.equal((await reportBackend(f.database)).length, 0);
    await f.study.release(f.configuration, f.lease);
  } finally {
    await f.execution.close();
  }
});
