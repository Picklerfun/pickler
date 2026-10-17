import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  exportBaselineDatabase,
  localBaselineUrl,
  restoreBaselineDatabase,
  type BaselinePgTools,
} from "../src/trading-baseline/database.js";
import { baselineProcess, BaselineFailure } from "../src/trading-baseline/process.js";

const signal = new AbortController().signal;
test("only literal loopback PostgreSQL URLs without option overrides are accepted", () => {
  for (const value of [
    "https://localhost/local",
    "postgresql://hosted.example/db",
    "postgresql://127.0.0.1.attacker.example/db",
    "postgresql://127.0.0.1/db?host=remote",
    "postgresql://127.0.0.1/db#secret",
    "invalid",
  ]) {
    assert.throws(() => localBaselineUrl(value), /LOCAL_DATABASE_REQUIRED/);
  }
  assert.equal(
    localBaselineUrl("postgresql://controlled:private@127.0.0.1:55432/fixture").port,
    "55432",
  );
  assert.equal(localBaselineUrl("postgresql://controlled:private@[::1]/fixture").hostname, "[::1]");
});

test("child process failures never retain raw errors or inherited provider credentials", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-process-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, "probe.mjs");
  await writeFile(
    script,
    'if(process.env.BASELINE_SECRET) { process.exit(9); } console.error("sk-do-not-persist-controlled"); process.exit(4);',
  );
  const before = process.env.BASELINE_SECRET;
  process.env.BASELINE_SECRET = "private";
  t.after(() => {
    if (before === undefined) {
      delete process.env.BASELINE_SECRET;
    } else {
      process.env.BASELINE_SECRET = before;
    }
  });
  await assert.rejects(
    baselineProcess({ command: process.execPath, args: [script], signal }),
    (e: unknown) =>
      e instanceof BaselineFailure &&
      e.message === "BASELINE_PROCESS_FAILED" &&
      !JSON.stringify(e).includes("sk-do"),
  );
  await assert.rejects(
    baselineProcess({ command: "/nonexistent/executable", args: [], signal }),
    /PROCESS_FAILED/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    baselineProcess({ command: process.execPath, args: [script], signal: controller.signal }),
  );
});

test("shared read-only snapshot and isolated PostgreSQL restore preserve every financial row", async (t) => {
  if (
    !process.env.BASELINE_PG_TOOLS ||
    !process.env.BASELINE_RESTORE_DATABASE_URL ||
    !process.env.BASELINE_RESTORE_PG_TOOLS
  ) {
    t.skip("Explicit local source tools and separate restore cluster required");
    return;
  }
  const adminConnectionString =
    process.env.TEST_DATABASE_URL ??
    "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler";
  const admin = new Pool({ connectionString: adminConnectionString, max: 1 });
  const database = `pickler_baseline_fixture_${randomUUID().replaceAll("-", "")}`;
  const sourceUrl = new URL(adminConnectionString);
  sourceUrl.pathname = `/${database}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const source = new Pool({ connectionString: sourceUrl.toString(), max: 1 });
  const directory = await mkdtemp(join(tmpdir(), "baseline-pg-fixture-"));
  const restoredDatabases: string[] = [];
  t.after(async () => {
    await source.end();
    await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
    if (restoredDatabases.length) {
      const restoreAdmin = new Pool({
        connectionString: process.env.BASELINE_RESTORE_DATABASE_URL,
        max: 1,
      });
      for (const restoredDatabase of restoredDatabases) {
        await restoreAdmin.query(`DROP DATABASE "${restoredDatabase}"`);
      }
      await restoreAdmin.end();
    }
    await rm(directory, { recursive: true, force: true });
  });
  await source.query(`CREATE SCHEMA pickler; CREATE SCHEMA mastra;
    CREATE TABLE pickler.perps_studies (id text PRIMARY KEY, document jsonb NOT NULL);
    CREATE TABLE pickler.financial_rows (id bigserial, value numeric(38,18), recorded_at timestamptz, document jsonb NOT NULL);
    CREATE TABLE mastra.history (value jsonb);`);
  const rows = [
    { status: "unknown", reservedUsd: "0.034560000", consumedUsd: null },
    { position: "open", funding: null, netPnl: "-3.717712", omissions: 2 },
    { status: "pending", virtualFees: "0.550708", disabled: true },
  ];
  for (const row of rows) {
    await source.query(
      "INSERT INTO pickler.financial_rows(value, recorded_at, document) VALUES ($1, $2, $3)",
      ["-0.000000000000000001", "2026-10-10T01:00:00Z", row],
    );
  }
  await source.query("INSERT INTO pickler.perps_studies VALUES ('controlled-history', $1)", [
    rows[0],
  ]);
  await source.query("INSERT INTO mastra.history VALUES ($1), ($1)", [
    { duplicate: true, unicode: "ñ" },
  ]);
  await admin.query(`ALTER DATABASE "${database}" SET default_transaction_read_only = on`);
  const tools = JSON.parse(process.env.BASELINE_PG_TOOLS) as BaselinePgTools;
  const dumpPath = join(directory, "history.dump");
  const snapshot = await exportBaselineDatabase({
    connectionString: sourceUrl.toString(),
    tools,
    dumpPath,
    signal,
  });
  assert.equal(snapshot.consistency, "per-database-repeatable-read-shared-with-pg-dump");
  assert.equal(snapshot.tables.length, 3);
  assert.equal(snapshot.tables.find((r) => r.name === "history")!.rows, 2);
  assert.deepEqual(snapshot.studies[0]!.ids, ["controlled-history"]);
  assert.equal(snapshot.sequences[0]!.lastValue, "3");
  assert.ok((await readFile(dumpPath)).subarray(0, 5).equals(Buffer.from("PGDMP")));
  await assert.rejects(
    restoreBaselineDatabase({
      adminConnectionString,
      sources: [snapshot.identity],
      expected: snapshot,
      tools,
      dumpPath,
      signal,
    }),
    /ORIGINAL_RESTORE_TARGET_FORBIDDEN/,
  );
  assert.equal(
    (await source.query("SELECT count(*)::int AS count FROM pickler.financial_rows")).rows[0].count,
    3,
  );
  const result = await restoreBaselineDatabase({
    adminConnectionString: process.env.BASELINE_RESTORE_DATABASE_URL,
    sources: [snapshot.identity],
    expected: snapshot,
    tools: JSON.parse(process.env.BASELINE_RESTORE_PG_TOOLS) as BaselinePgTools,
    dumpPath,
    signal,
  });
  restoredDatabases.push(result.database);
  assert.equal(result.verified, true);
  assert.deepEqual(result.actual.tables, snapshot.tables);
  assert.deepEqual(result.actual.sequences, snapshot.sequences);
  assert.deepEqual(result.actual.studies, snapshot.studies);
  const targetUrl = new URL(process.env.BASELINE_RESTORE_DATABASE_URL);
  targetUrl.pathname = `/${result.database}`;
  const target = new Pool({ connectionString: targetUrl.toString(), max: 1 });
  try {
    assert.deepEqual(
      (await target.query("SELECT document FROM pickler.financial_rows ORDER BY id")).rows.map(
        (r) => r.document,
      ),
      rows,
    );
    assert.equal(
      (await target.query("SHOW default_transaction_read_only")).rows[0]
        .default_transaction_read_only,
      "on",
    );
    await assert.rejects(
      target.query("INSERT INTO pickler.financial_rows(document) VALUES ('{}')"),
      (e: unknown) => (e as { code: string }).code === "25006",
    );
  } finally {
    await target.end();
  }
});
