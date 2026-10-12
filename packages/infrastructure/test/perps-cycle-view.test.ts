import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PTS_CATALOG } from "@pickler/trading/pts";
import type { PerpsStudyConfig } from "@pickler/trading/evaluation";
import { PostgresPerpsStudyStore } from "../src/persistence/perps-study-store.js";
import { exportPerpsAudit } from "../src/persistence/perps-audit-export.js";
import { createTestStore } from "./database.js";

const now = 1_791_000_000_000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function configuration(version: 7 | 8 | 9): PerpsStudyConfig {
  const common = {
    tenantId: "alpha",
    sessionId: `cycle-projection-${version}`,
    network: "mainnet" as const,
    budgetUsd: "5" as const,
    markets: PTS_CATALOG.map((m) => ({ ...m })),
  };
  if (version === 7) {
    return { ...common, version, hours: 6, protocol: "perps-sma-reentry-latency-v1" };
  }
  const prepared = {
    ...common,
    acquisitionPolicy: "stream-universe-component-paper-20s-v1" as const,
    history: { file: "history.json", sha256: "a".repeat(64) },
    preparedFor: "local-paper-only" as const,
  };
  if (version === 8) {
    return {
      ...prepared,
      version,
      hours: 336,
      protocol: "perps-pts-sma-v1",
      candidate: "pts-trend-reversal@0.2.0",
    };
  }
  return {
    ...prepared,
    version,
    hours: 24,
    protocol: "perps-pts-intraday-sma-v1",
    candidate: "pts-intraday@0.2.0-fast.1",
  };
}

for (const version of [8, 9] as const) {
  test(`v${version} cycle projection retains lifecycle data and every recent key without copying full evidence`, async (t) => {
    const db = await createTestStore(t, () => now);
    const study = new PostgresPerpsStudyStore(db.pool, () => now);
    const config = configuration(version);
    await study.initialize(config, { commit: "controlled" });
    const id = (
      await db.pool.query("SELECT id FROM pickler.perps_studies WHERE session_id=$1", [
        config.sessionId,
      ])
    ).rows[0]!.id;
    const payload = { history: "public-controlled-frame".repeat(50_000) };
    const events = [
      { key: "old-observation", at: now - 480_000, kind: "observation", data: { minute: 1 } },
      {
        key: "latest-observation",
        at: now - 420_000,
        kind: "observation-failed",
        data: { minute: 2, code: "DATA_UNAVAILABLE" },
      },
      { key: "slot-0", at: now - 60_000, kind: "slot-attempted", data: { slot: 0 } },
      { key: "input-0", at: now, kind: "execution-input", data: payload },
      { key: "gate-0", at: now, kind: "final-gate", data: payload },
      {
        key: "close-0",
        at: now,
        kind: "profile-execution",
        data: {
          slot: 0,
          variant: "sma-reference",
          symbol: "BTC",
          action: "close",
          status: "filled",
        },
      },
      {
        key: "exit-0",
        at: now,
        kind: "exit-detected",
        data: {
          variant: "sma-reference",
          positionId: "controlled-position",
          firstExecutableObservedAt: now - 1_000,
        },
      },
      {
        key: "missed-0",
        at: now,
        kind: "observation-missed",
        data: { minute: 3, code: "SLOT_MISSED" },
      },
      { key: "observed-0", at: now, kind: "observation", data: { minute: 4, valued: true } },
    ];
    // Keep the last observation outside the current range in a separate case below.
    for (const event of events) {
      await db.pool.query(
        "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5)",
        [id, event.key, event.at, event.kind, event.data],
      );
    }
    const before = await exportPerpsAudit(db.pool, config);
    const full = await study.view(config);

    const projected = await study.cycleView(config);

    assert.deepEqual(projected.record, full.record);
    assert.deepEqual(projected.rounds, []);
    assert.deepEqual(
      projected.events.map(({ key, at, kind }) => ({ key, at, kind })),
      full.events
        .filter((e) => e.at >= now - 60_000)
        .map(({ key, at, kind }) => ({ key, at, kind })),
    );
    for (const event of projected.events) {
      const original = full.events.find((e) => e.key === event.key)!;
      assert.deepEqual(
        event.data,
        [
          "observation",
          "observation-failed",
          "observation-missed",
          "profile-execution",
          "exit-detected",
        ].includes(event.kind)
          ? original.data
          : {},
      );
    }
    assert.deepEqual((await study.view(config)).events, full.events);
    assert.equal(hash(await exportPerpsAudit(db.pool, config)), hash(before));
  });
}

test("the cycle keeps the latest old observation and the exact cutoff while historical protocols retain complete views", async (t) => {
  const db = await createTestStore(t, () => now);
  const store = new PostgresPerpsStudyStore(db.pool, () => now);
  for (const version of [7, 9] as const) {
    const config = configuration(version);
    await store.initialize(config, {});
    const id = (
      await db.pool.query("SELECT id FROM pickler.perps_studies WHERE session_id=$1", [
        config.sessionId,
      ])
    ).rows[0]!.id;
    for (const event of [
      { key: "old-1", at: now - 420_000, kind: "observation", data: { minute: 1 } },
      { key: "old-2", at: now - 360_000, kind: "observation-missed", data: { minute: 2 } },
      {
        key: "boundary-close",
        at: now - 60_000,
        kind: "profile-execution",
        data: { action: "close", status: "filled" },
      },
      { key: "large", at: now, kind: "execution-input", data: { preserved: "original" } },
    ]) {
      await db.pool.query(
        "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5)",
        [id, event.key, event.at, event.kind, event.data],
      );
    }
    const full = await store.view(config);
    const cycle = await store.cycleView(config);
    if (version === 7) {
      assert.deepEqual(cycle, full);
    } else {
      assert.deepEqual(
        cycle.events.map((e) => e.key),
        ["old-2", "boundary-close", "large"],
      );
      assert.deepEqual(cycle.events[0]!.data, { minute: 2 });
      assert.deepEqual(cycle.events[1]!.data, { action: "close", status: "filled" });
      assert.deepEqual(cycle.events[2]!.data, {});
    }
  }
});

test("thirty paired controlled measurements preserve lifecycle results and record projection latency and payload", async (t) => {
  const db = await createTestStore(t, () => now);
  const config = configuration(9);
  const study = new PostgresPerpsStudyStore(db.pool, () => now);
  await study.initialize(config, { commit: "controlled-benchmark" });
  const id = (
    await db.pool.query("SELECT id FROM pickler.perps_studies WHERE session_id=$1", [
      config.sessionId,
    ])
  ).rows[0]!.id;
  let substitutions = 0;
  // The reference removes only the new CASE projection from the actual adapter's query.
  // Calendar, row locking, transaction and result ordering remain identical.
  const previousPool = new Proxy(db.pool, {
    get(object, property) {
      if (property === "connect") {
        return async () => {
          const client = await object.connect();
          return new Proxy(client, {
            get(target, field) {
              if (field === "query") {
                return (...args: unknown[]) => {
                  if (typeof args[0] === "string" && args[0].includes("END AS data")) {
                    args[0] = args[0].replace(
                      /CASE WHEN kind IN\s*\([\s\S]*?\) THEN data ELSE '\{\}'::jsonb END AS data/,
                      "data",
                    );
                    substitutions++;
                  }
                  return Reflect.apply(target.query, target, args);
                };
              }
              const value = Reflect.get(target, field, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        };
      }
      const value = Reflect.get(object, property, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
  }) as Pool;
  const previous = new PostgresPerpsStudyStore(previousPool, () => now);
  const summaries: unknown[] = [];
  for (const [scenario, bytes] of [
    ["small-control", 64],
    ["large-controlled-history", 5_517_646],
  ] as const) {
    await db.pool.query("DELETE FROM pickler.perps_study_events WHERE study_id=$1", [id]);
    const values = [
      ["input", "execution-input", { publicFrame: "x".repeat(bytes) }],
      ["gate", "final-gate", { publicFrame: "y".repeat(Math.floor(bytes / 12)) }],
      ["slot-0", "slot-attempted", { slot: 0 }],
      [
        "close",
        "profile-execution",
        { variant: "sma-reference", action: "close", status: "filled", slot: 0, symbol: "BTC" },
      ],
      ["observed", "observation", { minute: 0, valued: true }],
      [
        "exit",
        "exit-detected",
        { variant: "sma-reference", positionId: "controlled", firstExecutableObservedAt: now },
      ],
    ];
    for (const [key, kind, data] of values) {
      await db.pool.query(
        "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5)",
        [id, key, now, kind, data],
      );
    }
    const before = hash(await exportPerpsAudit(db.pool, config));
    const measurements = { before: [] as number[], after: [] as number[] };
    let beforeBytes = 0;
    let afterBytes = 0;
    for (let i = 0; i < 30; i++) {
      let prior: Awaited<ReturnType<typeof study.cycleView>> | undefined;
      let current: Awaited<ReturnType<typeof study.cycleView>> | undefined;
      for (const name of i % 2 === 0
        ? (["before", "after"] as const)
        : (["after", "before"] as const)) {
        const started = performance.now();
        const result = await (name === "before" ? previous : study).cycleView(config);
        measurements[name].push(performance.now() - started);
        if (name === "before") {
          prior = result;
        } else {
          current = result;
        }
      }
      assert.deepEqual(current!.record, prior!.record);
      assert.deepEqual(
        current!.events.map(({ key, at, kind }) => ({ key, at, kind })),
        prior!.events.map(({ key, at, kind }) => ({ key, at, kind })),
      );
      for (const event of current!.events.filter((e) =>
        ["profile-execution", "observation", "exit-detected"].includes(e.kind),
      )) {
        assert.deepEqual(
          event,
          prior!.events.find((e) => e.key === event.key),
        );
      }
      beforeBytes = Buffer.byteLength(JSON.stringify(prior));
      afterBytes = Buffer.byteLength(JSON.stringify(current));
      assert.ok(afterBytes < beforeBytes);
    }
    assert.equal(hash(await exportPerpsAudit(db.pool, config)), before);
    const summary = (times: number[]) => {
      const sorted = [...times].sort((a, b) => a - b);
      return {
        n: times.length,
        medianMs: (sorted[14]! + sorted[15]!) / 2,
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
      };
    };
    summaries.push({
      scenario,
      timing: "measured-monotonic-local-postgresql",
      before: { ...summary(measurements.before), payloadBytes: beforeBytes },
      after: { ...summary(measurements.after), payloadBytes: afterBytes },
      identicalLifecycle: true,
      sourceUnchanged: true,
    });
  }
  assert.equal(substitutions, 60);
  t.diagnostic(
    JSON.stringify({
      version: 1,
      controlledOnly: true,
      models: 0,
      providerCalls: 0,
      measurements: summaries,
    }),
  );
});
