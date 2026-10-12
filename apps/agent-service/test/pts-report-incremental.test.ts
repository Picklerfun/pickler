import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestStore } from "@pickler/infrastructure/testing";
import {
  exportPerpsAudit,
  exportPerpsAuditParts,
  PostgresPerpsStudyStore,
} from "@pickler/infrastructure/perps-lab";
import type { PerpsStudyView } from "@pickler/trading/evaluation";
import { profileProposals } from "@pickler/trading/evaluation";
import { ptsProposals, ptsPolicy, type PerpsPtsConfig } from "@pickler/trading/pts";
import { ptsEvidence, ptsTime } from "@pickler/trading/testing/pts";
import { intradayEvidence, intradayTime } from "@pickler/trading/testing/pts-intraday";
import { fastEvidence, fastTime } from "@pickler/trading/testing/pts-intraday-fast";
import { digest } from "../src/pts-study/files.js";
import {
  createPtsPartsExport,
  readPtsExportManifest,
  ptsPartsPayloadHash,
  readPtsPart,
} from "../src/pts-study/parts.js";
import { ptsPartReport } from "../src/pts-study/part-report.js";
import { runPtsReportWorker } from "../src/pts-study/report-worker-client.js";

async function fixture(t: Parameters<typeof createTestStore>[0], version: 8 | 9 | "fast" = 9) {
  const db = await createTestStore(t);
  const template = version === 8 ? "basic" : version === "fast" ? "intraday-fast" : "intraday";
  const config = JSON.parse(
    await readFile(
      new URL("../src/pts-study/pts-" + template + "-template.json", import.meta.url),
      "utf8",
    ),
  ) as PerpsPtsConfig;
  config.tenantId = "alpha";
  const study = new PostgresPerpsStudyStore(db.pool);
  await study.initialize(config, { commit: "controlled-incremental-source" });
  const root = await mkdtemp(join(tmpdir(), "pts-incremental-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const envFile = join(root, "database-only.env");
  await writeFile(envFile, "DATABASE_URL=" + db.pool.options.connectionString! + "\n", {
    mode: 0o600,
  });
  const original = await exportPerpsAudit(db.pool, config);
  const time = version === 8 ? ptsTime : version === "fast" ? fastTime : intradayTime;
  const evidence = (
    version === 8 ? ptsEvidence : version === "fast" ? fastEvidence : intradayEvidence
  )(time, false, "0.40", digest);
  const ptsVariant = version === 8 ? "pts-basic" : "pts-intraday";
  const proposals = {
    "sma-reference": profileProposals(
      { evidence, account: original.accounts["sma-reference"]!.account },
      config,
      "sma-reference",
    ),
    [ptsVariant]: ptsProposals(
      { evidence, account: original.accounts[ptsVariant]!.account },
      config,
    ),
  };
  const round = {
    key: "round-000",
    slot: 0,
    status: "completed",
    executionStatus: "complete",
    createdAt: time,
    finishedAt: time,
    evidence,
    proposals,
    calls: {},
    accounts: Object.fromEntries(
      Object.entries(original.accounts).map(([v, a]) => [v, a!.account]),
    ),
  };
  const id = (
    await db.pool.query("SELECT id FROM pickler.perps_studies WHERE session_id=$1", [
      config.sessionId,
    ])
  ).rows[0]!.id;
  await db.pool.query(
    "INSERT INTO pickler.perps_study_rounds(study_id,key,document) VALUES($1,$2,$3)",
    [id, round.key, round],
  );
  const events = [
    { key: "round-000:execution-input", at: time, kind: "execution-input", data: { evidence } },
    {
      key: "round-000:sma-reference:final-gate",
      at: time,
      kind: "final-gate",
      data: { initial: proposals["sma-reference"], final: proposals["sma-reference"] },
    },
    {
      key: "round-000:" + ptsVariant + ":final-gate",
      at: time,
      kind: "final-gate",
      data: { initial: proposals[ptsVariant], final: proposals[ptsVariant] },
    },
  ];
  for (const e of events) {
    await db.pool.query(
      "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5)",
      [id, e.key, e.at, e.kind, e.data],
    );
  }
  return { db, config, study, root, envFile, id, round, events };
}

async function capture(
  f: Awaited<ReturnType<typeof fixture>>,
  directory: string,
  incremental = true,
) {
  const exporter = await createPtsPartsExport(directory, "controlled-export", {
    reuseSource: incremental,
  });
  const stats = await exportPerpsAuditParts(
    f.db.pool,
    f.config,
    exporter.emit,
    incremental ? { reuse: exporter.reuse } : {},
  );
  return exporter.finish(stats);
}

for (const version of [8, 9, "fast"] as const) {
  test(
    "unchanged native parts reuse without fetching payloads; v1 hash/rows preserved for " + version,
    async (t) => {
      const f = await fixture(t, version);
      const before = await exportPerpsAudit(f.db.pool, f.config);
      const directory = join(f.root, "incremental");
      const first = await capture(f, directory);
      assert.equal(first.sourceCapture!.roundsFetched, 1);
      assert.equal(first.sourceCapture!.eventsFetched, 3);
      const second = await capture(f, directory);
      assert.equal(second.payloadHash, digest(before));
      assert.deepEqual(second.sourceCapture, {
        version: 1,
        policy: "postgres-jsonb-sha256-v1",
        roundsChecked: 1,
        roundsFetched: 0,
        roundsReused: 1,
        eventsChecked: 3,
        eventsFetched: 0,
        eventsReused: 3,
      });
      assert.equal(await ptsPartsPayloadHash(directory, second), digest(before));
      const fullDirectory = join(f.root, "full");
      const full = await capture(f, fullDirectory, false);
      if (version !== 8) {
        const replay = await ptsPartReport(directory, second);
        const original = await ptsPartReport(fullDirectory, full);
        assert.deepEqual(replay.rows, original.rows);
        assert.deepEqual(replay.report.financial, original.report.financial);
      }
      assert.deepEqual(await exportPerpsAudit(f.db.pool, f.config), before);
    },
  );
}

test("changed/deleted/backdated rows and accounts appear in the fresh snapshot", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "incremental");
  await capture(f, directory);
  const changed = {
    ...f.round,
    evidence: { ...f.round.evidence, sourceIds: ["controlled-revision"] },
  };
  await f.db.pool.query(
    "UPDATE pickler.perps_study_rounds SET document=$3 WHERE study_id=$1 AND key=$2",
    [f.id, changed.key, changed],
  );
  await f.db.pool.query(
    "UPDATE pickler.perps_study_events SET at=at-1,kind=$3,data=$4 WHERE study_id=$1 AND key=$2",
    [f.id, f.events[1]!.key, "controlled-change", { value: "changed" }],
  );
  await f.db.pool.query("DELETE FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2", [
    f.id,
    f.events[2]!.key,
  ]);
  await f.db.pool.query(
    "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5)",
    [f.id, "backdated", 1, "controlled", { originalDate: 1 }],
  );
  await f.db.pool.query(
    "UPDATE pickler.perps_paper_accounts SET document=document || $3::jsonb WHERE tenant_id=$1 AND session_id=$2",
    [f.config.tenantId, f.config.sessionId, { controlledRevision: 1 }],
  );
  const expected = await exportPerpsAudit(f.db.pool, f.config);
  const next = await capture(f, directory);
  assert.equal(next.payloadHash, digest(expected));
  assert.equal(next.sourceCapture!.roundsFetched, 1);
  assert.equal(next.sourceCapture!.eventsFetched, 2);
  assert.equal(next.sourceCapture!.eventsReused, 1);
  assert.equal(next.events[0]!.key, "backdated");
  assert.ok(!next.events.some((e) => e.key === f.events[2]!.key));
  await f.db.pool.query("DELETE FROM pickler.perps_study_rounds WHERE study_id=$1", [f.id]);
  const deleted = await capture(f, directory);
  assert.equal(deleted.rounds.length, 0);
  assert.equal(deleted.payloadHash, digest(await exportPerpsAudit(f.db.pool, f.config)));
});

test("reuse and misses remain at one read-only cut while concurrent updates commit", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "incremental");
  await capture(f, directory);
  const expected = await exportPerpsAudit(f.db.pool, f.config);
  const exporter = await createPtsPartsExport(directory, "controlled", { reuseSource: true });
  await exportPerpsAuditParts(
    f.db.pool,
    f.config,
    async (part) => {
      if (part.kind === "record") {
        await f.db.pool.query(
          "UPDATE pickler.perps_study_rounds SET document=document || $2::jsonb WHERE study_id=$1",
          [f.id, { controlledConcurrentUpdate: 1 }],
        );
        await f.db.pool.query(
          "UPDATE pickler.perps_study_events SET data=$2 WHERE study_id=$1 AND key=$3",
          [f.id, { concurrent: true }, f.events[0]!.key],
        );
        await f.db.pool.query(
          "UPDATE pickler.perps_paper_accounts SET document=document || $3::jsonb WHERE tenant_id=$1 AND session_id=$2",
          [f.config.tenantId, f.config.sessionId, { controlledConcurrentUpdate: 1 }],
        );
      }
      await exporter.emit(part);
    },
    { reuse: exporter.reuse },
  );
  const snapshot = await exporter.finish();
  assert.equal(snapshot.payloadHash, digest(expected));
  const after = await exportPerpsAudit(f.db.pool, f.config);
  assert.notEqual(digest(after), digest(expected));
  assert.equal((await capture(f, directory)).payloadHash, digest(after));
});

test("missing parts refetch, corruption fails closed, and failed reuse leaves publication unchanged", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "incremental");
  const first = await capture(f, directory);
  await unlink(join(directory, first.rounds[0]!.file));
  const recovered = await capture(f, directory);
  assert.equal(recovered.payloadHash, first.payloadHash);
  assert.equal(recovered.sourceCapture!.roundsFetched, 1);
  assert.equal(recovered.sourceCapture!.eventsFetched, 0);
  const saved = await readFile(join(directory, "export.json"));
  const before = await exportPerpsAudit(f.db.pool, f.config);
  const exporter = await createPtsPartsExport(directory, "controlled", { reuseSource: true });
  await assert.rejects(
    exportPerpsAuditParts(f.db.pool, f.config, exporter.emit, {
      reuse: async () => {
        throw Error("Controlled reuse failure");
      },
    }),
    /Controlled reuse failure/,
  );
  assert.deepEqual(await readFile(join(directory, "export.json")), saved);
  assert.deepEqual(await exportPerpsAudit(f.db.pool, f.config), before);
  assert.equal(f.db.pool.waitingCount, 0);
  await writeFile(join(directory, recovered.events[0]!.file), "{}");
  await assert.rejects(capture(f, directory), { code: "AUDIT_HASH_MISMATCH" });
});

test("index integrity, native revision policy and scoped configuration constrain reuse", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "incremental");
  const first = await capture(f, directory);
  const manifestFile = join(directory, "export.json");
  const changed = structuredClone(first);
  changed.rounds[0]!.sourceRevision!.sha256 = "a".repeat(64);
  await writeFile(manifestFile, JSON.stringify(changed));
  await assert.rejects(capture(f, directory), { code: "AUDIT_HASH_MISMATCH" });
  await writeFile(manifestFile, JSON.stringify(first));
  const exporter = await createPtsPartsExport(directory, "controlled", { reuseSource: true });
  const record = await readPtsPart<PerpsStudyView["record"]>(directory, first.record);
  await exporter.emit({
    kind: "record",
    value: { ...record, config: { ...record.config, sessionId: "other-study" } },
  });
  assert.equal(await exporter.reuse(first.rounds[0]!.sourceRevision!), false);
  const existing = await createPtsPartsExport(directory, "controlled", { reuseSource: true });
  await existing.emit({ kind: "record", value: record });
  assert.equal(
    await existing.reuse({ ...first.rounds[0]!.sourceRevision!, version: 2 } as never),
    false,
  );
});

test("legacy segmented packet upgrades on fresh capture, without changing its canonical payload", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "legacy");
  const legacyExporter = await createPtsPartsExport(directory, "legacy");
  await exportPerpsAuditParts(f.db.pool, f.config, legacyExporter.emit);
  const legacy = await legacyExporter.finish();
  assert.equal(legacy.sourceIndexHash, undefined);
  const upgraded = await capture(f, directory);
  assert.equal(upgraded.payloadHash, legacy.payloadHash);
  assert.equal(upgraded.sourceCapture!.roundsReused, 0);
  assert.equal((await capture(f, directory)).sourceCapture!.roundsReused, 1);
});

test("actual report worker uses warm capture and preserves rows, accounts and financial history", async (t) => {
  const f = await fixture(t, "fast");
  const input = {
    source: { envFile: f.envFile, configuration: f.config, directory: join(f.root, "evidence") },
    coverage: [],
    state: "process-unverified",
    output: join(f.root, "report"),
    commit: "controlled",
    policyHash: digest(ptsPolicy("0.2.0-fast.1")),
  };
  const before = await exportPerpsAudit(f.db.pool, f.config);
  const backendQuery =
    "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() ORDER BY pid";
  const originalBackends = (await f.db.pool.query(backendQuery)).rows;
  await mkdir(input.output, { mode: 0o700 });
  await runPtsReportWorker(input);
  const first = JSON.parse(await readFile(join(input.output, "report.json"), "utf8"));
  const rows = await readFile(join(input.output, "report.csv"));
  await runPtsReportWorker(input);
  const second = JSON.parse(await readFile(join(input.output, "report.json"), "utf8"));
  const manifest = await readPtsExportManifest(join(input.source.directory, "export.json"));
  assert.equal(manifest.sourceCapture!.roundsFetched, 0);
  assert.equal(manifest.sourceCapture!.eventsFetched, 0);
  assert.equal(second.sourceHash, first.sourceHash);
  assert.deepEqual(second.financial, first.financial);
  assert.deepEqual(await readFile(join(input.output, "report.csv")), rows);
  assert.deepEqual(await exportPerpsAudit(f.db.pool, f.config), before);
  assert.deepEqual((await f.db.pool.query(backendQuery)).rows, originalBackends);
});

test("thirty paired warm/full captures measure source work with identical verified hashes", async (t) => {
  const f = await fixture(t);
  const load = "controlled-public-serialization-".repeat(65536);
  await f.db.pool.query(
    "UPDATE pickler.perps_study_rounds SET document=document || $2::jsonb WHERE study_id=$1",
    [f.id, { controlledLoad: load }],
  );
  await f.db.pool.query(
    "UPDATE pickler.perps_study_events SET data=data || $2::jsonb WHERE study_id=$1",
    [f.id, { controlledLoad: load }],
  );
  const expected = digest(await exportPerpsAudit(f.db.pool, f.config));
  const directory = join(f.root, "warm");
  await capture(f, directory);
  const samples: {
    index: number;
    path: string;
    durationMs: number;
    fetched: number;
    reused: number;
    hash: string;
  }[] = [];
  for (let index = 0; index < 30; index++) {
    for (const path of index % 2 ? ["incremental", "full"] : ["full", "incremental"]) {
      const started = performance.now();
      let manifest;
      if (path === "incremental") {
        manifest = await capture(f, directory);
      } else {
        manifest = await capture(f, join(f.root, "full"), false);
      }
      const durationMs = performance.now() - started;
      assert.equal(manifest.payloadHash, expected);
      const stats = manifest.sourceCapture!;
      samples.push({
        index,
        path,
        durationMs,
        fetched: stats.roundsFetched + stats.eventsFetched,
        reused: stats.roundsReused + stats.eventsReused,
        hash: manifest.payloadHash,
      });
    }
  }
  const metrics = ["full", "incremental"].map((path) => {
    const values = samples.filter((sample) => sample.path === path);
    const durations = values.map((sample) => sample.durationMs).sort((a, b) => a - b);
    return {
      path,
      n: values.length,
      medianMs: (durations[14]! + durations[15]!) / 2,
      p95Ms: durations[28]!,
      fetched: values.reduce((sum, s) => sum + s.fetched, 0),
      reused: values.reduce((sum, s) => sum + s.reused, 0),
    };
  });
  const artifact = join(tmpdir(), "pts-incremental-benchmark-" + Date.now() + ".json");
  await writeFile(
    artifact,
    JSON.stringify(
      {
        version: 1,
        protocol: "pts-incremental-source-benchmark-v1",
        synthetic: true,
        sourceOnly: true,
        pairedMeasurements: 30,
        policy: "postgres-jsonb-sha256-v1",
        payloadHash: expected,
        loadBytesPerPart: Buffer.byteLength(load),
        sourceLargeParts: 4,
        providerCalls: 0,
        modelCalls: 0,
        startupIncluded: false,
        samePoolBothPaths: true,
        metrics,
        samples,
        limitations:
          "Native fingerprints still scan JSONB on the server and complete payload hashes still read verified files. No rendering, provider latency, historical causal claim or P&L is measured.",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  t.diagnostic(JSON.stringify({ artifact, metrics, hashesVerified: 60 }));
});

test("thirty paired cold/delta captures expose initial-capture overhead and changing-source behavior", async (t) => {
  const f = await fixture(t);
  const load = "controlled-public-serialization-".repeat(65536);
  await f.db.pool.query(
    "UPDATE pickler.perps_study_rounds SET document=document || $2::jsonb WHERE study_id=$1",
    [f.id, { controlledLoad: load }],
  );
  await f.db.pool.query(
    "UPDATE pickler.perps_study_events SET data=data || $2::jsonb WHERE study_id=$1",
    [f.id, { controlledLoad: load }],
  );
  const samples: {
    scenario: string;
    index: number;
    path: string;
    durationMs: number;
    fetched: number;
    reused: number;
    hash: string;
  }[] = [];
  const deltaDirectory = join(f.root, "delta");
  await capture(f, deltaDirectory);
  for (const scenario of ["cold", "delta"]) {
    for (let index = 0; index < 30; index++) {
      if (scenario === "delta") {
        await f.db.pool.query(
          "UPDATE pickler.perps_study_events SET data=data || $3::jsonb WHERE study_id=$1 AND key=$2",
          [f.id, f.events[0]!.key, { controlledRevision: index }],
        );
      }
      const expected = digest(await exportPerpsAudit(f.db.pool, f.config));
      for (const path of index % 2 ? ["incremental", "full"] : ["full", "incremental"]) {
        const directory =
          scenario === "cold"
            ? join(f.root, "cold-" + path)
            : path === "incremental"
              ? deltaDirectory
              : join(f.root, "delta-full");
        if (scenario === "cold") {
          await rm(directory, { recursive: true, force: true });
        }
        const started = performance.now();
        const manifest = await capture(f, directory, path === "incremental");
        const durationMs = performance.now() - started;
        assert.equal(manifest.payloadHash, expected);
        const stats = manifest.sourceCapture!;
        const fetched = stats.roundsFetched + stats.eventsFetched;
        const reused = stats.roundsReused + stats.eventsReused;
        assert.equal(fetched, scenario === "delta" && path === "incremental" ? 1 : 4);
        samples.push({
          scenario,
          index,
          path,
          durationMs,
          fetched,
          reused,
          hash: manifest.payloadHash,
        });
      }
    }
  }
  const metrics = ["cold", "delta"].flatMap((scenario) =>
    ["full", "incremental"].map((path) => {
      const values = samples.filter((s) => s.scenario === scenario && s.path === path);
      const durations = values.map((s) => s.durationMs).sort((a, b) => a - b);
      return {
        scenario,
        path,
        n: values.length,
        medianMs: (durations[14]! + durations[15]!) / 2,
        p95Ms: durations[28]!,
        fetched: values.reduce((sum, s) => sum + s.fetched, 0),
        reused: values.reduce((sum, s) => sum + s.reused, 0),
      };
    }),
  );
  const artifact = join(tmpdir(), "pts-incremental-delta-benchmark-" + Date.now() + ".json");
  await writeFile(
    artifact,
    JSON.stringify(
      {
        version: 1,
        protocol: "pts-incremental-source-benchmark-v1",
        synthetic: true,
        sourceOnly: true,
        pairedMeasurementsPerScenario: 30,
        policy: "postgres-jsonb-sha256-v1",
        samePoolBothPaths: true,
        startupIncluded: false,
        loadBytesPerPart: Buffer.byteLength(load),
        sourceLargeParts: 4,
        providerCalls: 0,
        modelCalls: 0,
        metrics,
        samples,
        limitations:
          "Cold includes new files and fingerprint/miss queries. Delta changes one original event per pair. Native server fingerprints and local full-payload verification still scan all parts. No rendering, historical causal claim or P&L.",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  t.diagnostic(JSON.stringify({ artifact, metrics, hashesVerified: 120 }));
});
