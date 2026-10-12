import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PTS_CATALOG } from "@pickler/trading/pts";
import type { PerpsStudyConfig } from "@pickler/trading/evaluation";
import { PostgresPerpsPaperStore } from "../src/persistence/perps-paper-store.js";
import { PostgresPerpsStudyStore } from "../src/persistence/perps-study-store.js";
import { exportPerpsAudit } from "../src/persistence/perps-audit-export.js";
import { guardPerpsLabPool } from "../src/persistence/perps-lab-pool.js";
import { createTestStore } from "./database.js";

const now = 1_791_791_460_000;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function configuration(version: 8 | 9): PerpsStudyConfig {
  const common = {
    tenantId: "alpha",
    sessionId: "controlled-read-isolation",
    network: "mainnet" as const,
    budgetUsd: "5" as const,
    markets: PTS_CATALOG.map((market) => ({ ...market })),
    acquisitionPolicy: "stream-universe-component-paper-20s-v1" as const,
    history: { file: "history.json", sha256: "a".repeat(64) },
    preparedFor: "local-paper-only" as const,
  };
  return version === 8
    ? {
        ...common,
        version,
        hours: 336,
        protocol: "perps-pts-sma-v1",
        candidate: "pts-trend-reversal@0.2.0",
      }
    : {
        ...common,
        version,
        hours: 24,
        protocol: "perps-pts-intraday-sma-v1",
        candidate: "pts-intraday@0.2.0-fast.1",
      };
}

function suspendedRead(original: Pool, statementPrefix = "SELECT id,document,owner,expires_at ") {
  let signalEntered!: () => void;
  let resume!: () => void;
  let suspended = false;
  let transactionReadOnly: string | undefined;
  let backendPid: number | undefined;
  const entered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const pool = new Proxy(original, {
    get(object, property) {
      if (property === "connect") {
        return async () => {
          const client = await object.connect();
          return new Proxy(client, {
            get(target, field) {
              if (field === "query") {
                return async (...args: unknown[]) => {
                  const result = await Reflect.apply(target.query, target, args);
                  if (
                    !suspended &&
                    typeof args[0] === "string" &&
                    args[0].startsWith(statementPrefix)
                  ) {
                    suspended = true;
                    transactionReadOnly = (await target.query("SHOW transaction_read_only"))
                      .rows[0]!.transaction_read_only;
                    backendPid = (await target.query("SELECT pg_backend_pid() AS pid")).rows[0]!
                      .pid;
                    signalEntered();
                    await released;
                  }
                  return result;
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
  return { pool, entered, resume, mode: () => transactionReadOnly, pid: () => backendPid };
}

function boundedWriter(original: Pool) {
  return guardPerpsLabPool(
    new Proxy(original, {
      get(object, property) {
        if (property === "connect") {
          return async () => {
            const client = await object.connect();
            await client.query("SET statement_timeout=500");
            return client;
          };
        }
        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      },
    }) as Pool,
  );
}

for (const version of [8, 9] as const) {
  for (const operation of ["view", "cycleView", "guard"] as const) {
    test(
      "v" + version + " " + operation + " does not hold an exclusive study lock while reading",
      { timeout: 15_000 },
      async (t) => {
        const db = await createTestStore(t, () => now);
        const config = configuration(version);
        const writer = new PostgresPerpsStudyStore(boundedWriter(db.pool), () => now);
        await writer.initialize(config, { commit: "controlled" });
        const lease = await writer.claim(config);
        const before = digest(await exportPerpsAudit(db.pool, config));
        const gate = suspendedRead(db.pool);
        const reader = new PostgresPerpsStudyStore(gate.pool, () => now);
        const reading =
          operation === "guard" ? reader.guard(config, lease) : reader[operation](config);
        // Attach immediately so a failed assertion never leaves an unhandled read rejection.
        const result = reading.then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        await gate.entered;

        try {
          await writer.renew(config, lease);
        } finally {
          gate.resume();
        }
        const complete = await result;

        assert.equal("error" in complete, false);
        assert.equal(gate.mode(), "on");
        assert.equal(digest(await exportPerpsAudit(db.pool, config)), before);
        await writer.release(config, lease);
      },
    );
  }
}

test("a nonlocking permission check rejects ownership revoked while its read was in progress", async (t) => {
  const db = await createTestStore(t, () => now);
  const config = configuration(9);
  const writer = new PostgresPerpsStudyStore(boundedWriter(db.pool), () => now);
  await writer.initialize(config, {});
  const lease = await writer.claim(config);
  const gate = suspendedRead(db.pool);
  const reader = new PostgresPerpsStudyStore(gate.pool, () => now);
  const outcome = reader.guard(config, lease).then(
    () => ({ code: "UNEXPECTED_SUCCESS", name: "UnexpectedSuccess" }),
    (error: { code?: string }) => error,
  );
  await gate.entered;

  try {
    await writer.release(config, lease);
  } finally {
    gate.resume();
  }
  assert.equal((await outcome).code, "LEASE_LOST");
  assert.equal(gate.mode(), "on");
});

for (const version of [8, 9] as const) {
  for (const variant of ["sma-reference", "pts"] as const) {
    test(
      "v" + version + " " + variant + " paper read permits study renewal without ledger writes",
      { timeout: 15_000 },
      async (t) => {
        const db = await createTestStore(t, () => now);
        const config = configuration(version);
        const study = new PostgresPerpsStudyStore(boundedWriter(db.pool), () => now);
        const initialized = await study.initialize(config, {});
        const lease = await study.claim(config);
        const arm = variant === "pts" ? (version === 8 ? "pts-basic" : "pts-intraday") : variant;
        const scope = { ...config, agentId: initialized.record.agentIds[arm]! };
        const before = digest(await exportPerpsAudit(db.pool, config));
        const original = await new PostgresPerpsPaperStore(db.pool, () => now).snapshot(scope);
        const gate = suspendedRead(
          db.pool,
          "SELECT id,document FROM pickler.perps_paper_accounts ",
        );
        const reader = new PostgresPerpsPaperStore(gate.pool, () => now, {
          ...config,
          owner: lease.owner,
          readPolicy: "pts-snapshot-v1",
        });
        const result = reader.view(scope).then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        await gate.entered;

        try {
          await study.renew(config, lease);
        } finally {
          gate.resume();
        }
        const complete = await result;

        assert.equal("error" in complete, false);
        assert.deepEqual("value" in complete ? complete.value : undefined, original);
        assert.equal(gate.mode(), "on");
        assert.equal(digest(await exportPerpsAudit(db.pool, config)), before);
        await study.release(config, lease);
      },
    );
  }
}

async function accountFixture(t: TestContext, clock: () => number = () => now) {
  const db = await createTestStore(t, clock);
  const config = configuration(9);
  const study = new PostgresPerpsStudyStore(boundedWriter(db.pool), clock);
  const initialized = await study.initialize(config, {});
  const lease = await study.claim(config);
  const scope = { ...config, agentId: initialized.record.agentIds["sma-reference"]! };
  const owner = { ...config, owner: lease.owner, readPolicy: "pts-snapshot-v1" as const };
  const gate = suspendedRead(db.pool, "SELECT id,document FROM pickler.perps_paper_accounts ");
  const reader = new PostgresPerpsPaperStore(gate.pool, clock, owner);
  return { db, config, study, lease, scope, owner, gate, reader };
}

test("a study view preserves its consistent cut while a concurrent event is committed", async (t) => {
  const db = await createTestStore(t, () => now);
  const config = configuration(9);
  const study = new PostgresPerpsStudyStore(boundedWriter(db.pool), () => now);
  await study.initialize(config, {});
  const lease = await study.claim(config);
  const gate = suspendedRead(db.pool);
  const result = new PostgresPerpsStudyStore(gate.pool, () => now).view(config);
  await gate.entered;

  try {
    await study.event(config, lease, "concurrent", "controlled-event", { preserved: true });
  } finally {
    gate.resume();
  }
  const original = await result;

  assert.equal(
    original.events.some((event) => event.key === "concurrent"),
    false,
  );
  assert.equal(
    (await study.view(config)).events.some((event) => event.key === "concurrent"),
    true,
  );
  await study.release(config, lease);
});

test("a guarded paper snapshot cannot return a mix of account and movement revisions", async (t) => {
  const x = await accountFixture(t);
  const result = x.reader.view(x.scope);
  await x.gate.entered;
  const client = await x.db.pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query(
      "UPDATE pickler.perps_paper_accounts SET document=jsonb_set(document,'{cash}',$3::jsonb) WHERE agent_id=$1 AND session_id=$2 RETURNING id",
      [x.scope.agentId, x.scope.sessionId, JSON.stringify("999")],
    );
    await client.query(
      "INSERT INTO pickler.perps_paper_movements(account_id,key,document) VALUES($1,$2,$3)",
      [
        row.rows[0]!.id,
        "controlled-delta",
        { key: "controlled-delta", kind: "fee", delta: "-1", at: now },
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    x.gate.resume();
  }
  const view = await result;

  assert.equal(view.account.cash, "1000");
  assert.equal(
    view.movements.some((movement) => movement.key === "controlled-delta"),
    false,
  );
  const current = await new PostgresPerpsPaperStore(x.db.pool, () => now, x.owner).view(x.scope);
  assert.equal(current.account.cash, "999");
  assert.equal(
    current.movements.some((movement) => movement.key === "controlled-delta"),
    true,
  );
  await x.study.release(x.config, x.lease);
});

for (const cause of ["released", "expired", "policy-changed", "aborted"] as const) {
  test("a guarded paper snapshot rejects " + cause + " during the consistent read", async (t) => {
    let clock = now;
    const x = await accountFixture(t, () => clock);
    const controller = new AbortController();
    const reader = new PostgresPerpsPaperStore(x.gate.pool, () => clock, {
      ...x.owner,
      signal: controller.signal,
    });
    const result = reader.view(x.scope).then(
      () => ({ code: "UNEXPECTED_SUCCESS", name: "UnexpectedSuccess" }),
      (error: { code?: string; name?: string }) => error,
    );
    await x.gate.entered;

    try {
      if (cause === "released") {
        await x.study.release(x.config, x.lease);
      } else if (cause === "expired") {
        clock += 90_000;
      } else if (cause === "policy-changed") {
        await x.db.pool.query(
          "UPDATE pickler.perps_paper_accounts SET document=jsonb_set(document,'{riskManagement}',$3::jsonb) WHERE agent_id=$1 AND session_id=$2",
          [x.scope.agentId, x.scope.sessionId, JSON.stringify("conservative-1x-v1")],
        );
      } else {
        controller.abort();
      }
    } finally {
      x.gate.resume();
    }
    const error = await result;

    assert.equal(
      typeof error.code === "string" ? error.code : error.name,
      cause === "policy-changed"
        ? "CONFIG_CHANGED"
        : cause === "aborted"
          ? "AbortError"
          : "LEASE_LOST",
    );
    if (cause !== "released" && cause !== "expired") {
      await x.study.release(x.config, x.lease);
    }
  });
}

test("guarded reads preserve unknown fields and project expired attempts without recovering them", async (t) => {
  const x = await accountFixture(t);
  const account = (
    await x.db.pool.query(
      "SELECT id FROM pickler.perps_paper_accounts WHERE agent_id=$1 AND session_id=$2",
      [x.scope.agentId, x.scope.sessionId],
    )
  ).rows[0]!.id;
  const attempt = {
    key: "controlled-expired",
    status: "reserved",
    reserved: "100",
    intent: { kind: "open", symbol: "BTC", side: "short", notional: "100", feeReserve: "1" },
    createdAt: now - 60_000,
    privateUnknownReservation: { usd: "0.25", status: "unknown" },
  };
  await x.db.pool.query(
    "INSERT INTO pickler.perps_paper_attempts(account_id,key,document,owner,expires_at) VALUES($1,$2,$3,$4,$5)",
    [account, attempt.key, attempt, "fixture-owner", now],
  );
  const before = digest(await exportPerpsAudit(x.db.pool, x.config));
  const reader = new PostgresPerpsPaperStore(x.db.pool, () => now, x.owner);

  const view = await reader.view(x.scope);

  assert.equal(view.attempts[0]!.status, "interrupted");
  assert.equal(view.attempts[0]!.reserved, "0");
  assert.equal(view.attempts[0]!.reason, "LEASE_EXPIRED");
  assert.deepEqual(
    (view.attempts[0] as unknown as typeof attempt).privateUnknownReservation,
    attempt.privateUnknownReservation,
  );
  assert.equal(digest(await exportPerpsAudit(x.db.pool, x.config)), before);
  const raw = await x.db.pool.query(
    "SELECT document FROM pickler.perps_paper_attempts WHERE account_id=$1",
    [account],
  );
  assert.deepEqual(raw.rows[0]!.document, attempt);
  await assert.rejects(reader.view({ ...x.scope, sessionId: "unrelated" }), { code: "FORBIDDEN" });
  await x.study.release(x.config, x.lease);
});

test("a guarded PTS read policy cannot be applied to a historical SMA protocol", async (t) => {
  const db = await createTestStore(t, () => now);
  const config = {
    tenantId: "alpha",
    sessionId: "historical-sma",
    network: "mainnet" as const,
    budgetUsd: "5" as const,
    version: 7 as const,
    protocol: "perps-sma-reentry-latency-v1" as const,
    hours: 6 as const,
    markets: PTS_CATALOG.map((market) => ({ ...market })),
  };
  const study = new PostgresPerpsStudyStore(db.pool, () => now);
  const initial = await study.initialize(config, {});
  const lease = await study.claim(config);
  const reader = new PostgresPerpsPaperStore(db.pool, () => now, {
    ...config,
    owner: lease.owner,
    readPolicy: "pts-snapshot-v1",
  });

  await assert.rejects(
    reader.view({ ...config, agentId: initial.record.agentIds["sma-reference"]! }),
    { code: "CONFIG_CHANGED" },
  );
  await study.release(config, lease);
});

test("PostgreSQL identifies the legacy account reader as the lease writer's actual blocker", async (t) => {
  const x = await accountFixture(t);
  const reader = new PostgresPerpsPaperStore(x.gate.pool, () => now, {
    ...x.config,
    owner: x.lease.owner,
  });
  const reading = reader.view(x.scope);
  await x.gate.entered;
  const renewed = x.study.renew(x.config, x.lease).then(
    () => ({ code: "RENEWED" }),
    (error: { code: string }) => error,
  );
  let matched = false;
  try {
    for (let probe = 0; probe < 10 && !matched; probe++) {
      const rows = await x.db.pool.query<{ blockers: number[] }>(
        "SELECT pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database()",
      );
      matched = rows.rows.some((row) => row.blockers.includes(x.gate.pid()!));
      if (!matched) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  } finally {
    x.gate.resume();
  }

  assert.equal((await renewed).code, "RENEWED");
  await reading;
  assert.equal(matched, true);
  t.diagnostic(
    JSON.stringify({
      protocol: "pts-study-lock-witness-v1",
      fixtureOnly: true,
      legacyAccountReadBlockedRenewal: matched,
      originalStudyBlockerIdentified: false,
    }),
  );
  await x.study.release(x.config, x.lease);
});

function latencySummary(values: readonly number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return {
    count: ordered.length,
    medianMs: (ordered[14]! + ordered[15]!) / 2,
    p95Ms: ordered[28]!,
  };
}

for (const pauseMs of [0, 50] as const) {
  test(
    "thirty paired account-read measurements with controlled pause " + pauseMs + "ms",
    async (t) => {
      const x = await accountFixture(t);
      const initial = await new PostgresPerpsPaperStore(x.db.pool, () => now).snapshot(x.scope);
      const before = digest(await exportPerpsAudit(x.db.pool, x.config));
      const samples: Record<"reference" | "corrected", { readMs: number; renewalMs: number }[]> = {
        reference: [],
        corrected: [],
      };
      for (let index = 0; index < 30; index++) {
        const order =
          index % 2 === 0
            ? (["reference", "corrected"] as const)
            : (["corrected", "reference"] as const);
        for (const policy of order) {
          const gate = suspendedRead(
            x.db.pool,
            "SELECT id,document FROM pickler.perps_paper_accounts ",
          );
          const pool = pauseMs ? gate.pool : x.db.pool;
          const owner = policy === "reference" ? { ...x.config, owner: x.lease.owner } : x.owner;
          const reader = new PostgresPerpsPaperStore(pool, () => now, owner);
          const started = performance.now();
          const reading = reader.view(x.scope);
          let timer: ReturnType<typeof setTimeout> | undefined;
          let readMs = 0;
          let renewalMs = 0;
          try {
            if (pauseMs) {
              await gate.entered;
              timer = setTimeout(gate.resume, pauseMs);
              const renewalStarted = performance.now();
              await x.study.renew(x.config, x.lease);
              renewalMs = performance.now() - renewalStarted;
              assert.deepEqual(await reading, initial);
              readMs = performance.now() - started;
            } else {
              assert.deepEqual(await reading, initial);
              readMs = performance.now() - started;
              const renewalStarted = performance.now();
              await x.study.renew(x.config, x.lease);
              renewalMs = performance.now() - renewalStarted;
            }
          } finally {
            if (timer !== undefined) {
              clearTimeout(timer);
            }
            gate.resume();
          }
          samples[policy].push({ readMs, renewalMs });
        }
      }

      assert.equal(digest(await exportPerpsAudit(x.db.pool, x.config)), before);
      t.diagnostic(
        JSON.stringify({
          protocol: "pts-read-isolation-benchmark-v1",
          scenario: pauseMs ? "delayed-account-read" : "uncontended-account-read",
          controlledPauseMs: pauseMs,
          measuredClock: "monotonic-performance-now",
          referencePath: "unchanged-locking-paper-view",
          correctedPath: "explicit-pts-snapshot-v1",
          inputsAndFinancialResultsIdentical: true,
          financialResultSha256: digest(initial),
          modelCalls: 0,
          reference: {
            read: latencySummary(samples.reference.map((sample) => sample.readMs)),
            renewal: latencySummary(samples.reference.map((sample) => sample.renewalMs)),
          },
          corrected: {
            read: latencySummary(samples.corrected.map((sample) => sample.readMs)),
            renewal: latencySummary(samples.corrected.map((sample) => sample.renewalMs)),
          },
          samples,
        }),
      );
      await x.study.release(x.config, x.lease);
    },
  );
}
