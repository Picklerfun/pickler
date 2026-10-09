import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { canonicalAudit } from "@pickler/trading/evaluation";
import { runTimingCheck } from "../src/perps-study/timing-check.js";
import { timingReport } from "../src/perps-study/timing-report.js";
import { localStudyDatabase } from "../src/perps-study/database-env.js";
import { runPerpsAudit } from "../src/perps-study/audit.js";
import { timeEvaluationPool } from "@pickler/infrastructure";
import { evidence, config } from "./perps-reentry-fixtures.js";

test("offline timing-check verifies inputs, thirty paired denominators and financial parity without network", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sma-timing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const payload = {
    study: { record: { metadata: { commit: "a".repeat(40) } }, rounds: [{ evidence: evidence() }] },
  };
  const packet = {
    version: 1,
    protocol: "perps-decision-audit-export-v1",
    payload,
    payloadHash: createHash("sha256").update(canonicalAudit(payload)).digest("hex"),
  };
  const path = join(directory, "export.json");
  await writeFile(path, JSON.stringify(packet));
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Network is forbidden for offline timing");
  });
  await runTimingCheck(path, join(directory, "output"), new AbortController().signal);
  const result = JSON.parse(await readFile(join(directory, "output/timing.json"), "utf8"));
  assert.equal(result.calls, 0);
  assert.equal(result.financialParity, true);
  for (const scenario of result.scenarios) {
    assert.equal(scenario.before.count, 30);
    assert.equal(scenario.after.count, 30);
    assert.equal(scenario.samples.before.length, 30);
    assert.equal(scenario.samples.after.length, 30);
    assert.match(scenario.outputHash, /^[a-f0-9]{64}$/);
  }
  assert.ok(result.calendar.every((c: { afterDelayMs: number }) => c.afterDelayMs === 1));
  assert.equal(network.mock.callCount(), 0);
  await writeFile(path, JSON.stringify({ ...packet, payloadHash: "b".repeat(64) }));
  await assert.rejects(
    runTimingCheck(path, join(directory, "tampered"), new AbortController().signal),
    { code: "AUDIT_HASH_INVALID" },
  );
  const cli = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--",
      "src/evaluate.ts",
      "timing-check",
      "--state",
      path,
      "--output",
      join(directory, "forbidden"),
      "--env-file",
      join(directory, "must-not-read"),
    ],
    { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 30000 },
  );
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stderr, /INVALID_INPUT/);
});

test("timing projection drops sensitive fields and reports measured denominators", () => {
  const output = timingReport(
    JSON.stringify({
      operation: "prices",
      version: 1,
      cycle: "slot-0",
      durationMs: 12,
      at: 123,
      authorization: "never-export",
      body: "never-export",
      headers: { token: "never-export" },
    }) + "\n",
  );
  assert.equal(output.operations[0]!.count, 1);
  assert.equal(output.operations[0]!.p95Ms, 12);
  assert.ok(!JSON.stringify(output).includes("never-export"));
});

test("public-only environment refuses model settings without constructing clients", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sma-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "database.env");
  await writeFile(
    file,
    "DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:55432/test\nMODEL_API_KEY=controlled-do-not-load\n",
  );
  await assert.rejects(localStudyDatabase(file), /dedicated/);
  const configPath = join(directory, "study.json");
  await writeFile(configPath, JSON.stringify(config));
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Audit cannot access providers");
  });
  await assert.rejects(
    runPerpsAudit({
      command: "audit-export",
      configPath,
      envFile: file,
      output: join(directory, "forbidden-export"),
    }),
    /dedicated/,
  );
  assert.equal(network.mock.callCount(), 0);
  await writeFile(file, "DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:55432/test\n");
  assert.match(await localStudyDatabase(file), /127\.0\.0\.1/);
});

test("connection failure retains the safe PostgreSQL code without private error details", async () => {
  const failure = Object.assign(new Error("PRIVATE_CONNECTION_DETAIL"), { code: "3D000" });
  const pool = {
    connect: async () => {
      throw failure;
    },
  } as unknown as Parameters<typeof timeEvaluationPool>[0];
  const rows: unknown[] = [];
  const timed = timeEvaluationPool(
    pool,
    (e) => rows.push(e),
    () => "controlled-connect",
  );
  await assert.rejects(timed.connect(), { code: "3D000" });
  assert.equal((rows[0] as { code: string }).code, "3D000");
  assert.ok(!JSON.stringify(rows).includes("PRIVATE_CONNECTION_DETAIL"));
});
