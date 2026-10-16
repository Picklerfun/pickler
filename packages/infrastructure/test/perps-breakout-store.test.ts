import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  applyPaperObservation,
  applyPaperFill,
  simulatePerpsFill,
  type PerpsPaperPosition,
} from "@pickler/trading/perps";
import { breakoutWindowTimes, type BreakoutCloseObligation } from "@pickler/trading/evaluation";
import {
  PostgresPerpsHourlyBreakoutStore,
  type PerpsBreakoutFundingState,
} from "../src/persistence/perps-breakout-store.js";
import { PostgresPerpsStudyStore } from "../src/persistence/perps-study-store.js";
import { PostgresPerpsPaperStore } from "../src/persistence/perps-paper-store.js";
import { exportPerpsBreakoutAuditParts } from "../src/persistence/perps-breakout-audit.js";
import { exportPerpsAuditParts } from "../src/persistence/perps-audit-export.js";
import {
  breakoutFixture,
  controlledFrame,
  controlledFunding,
  closedPosition,
  discover,
  reserve,
  roleAccount,
  T0,
} from "./perps-breakout-fixture.js";

test("three new immutable accounts; discovered queue has no reservation, then native fills and duplicate receipts are exact", async (t) => {
  const f = await breakoutFixture(t);
  assert.deepEqual(
    f.initial.accounts.map((a) => [
      a.role,
      a.view.account.cash,
      a.view.account.positions.length,
      a.view.account.positionPolicy,
    ]),
    [
      ["C", "1000", 0, undefined],
      ["S", "1000", 0, undefined],
      ["L", "1000", 0, undefined],
    ],
  );
  const d = await discover(f, ["C", "L"]);
  assert.equal(d.discoveries.length, 2);
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_attempts"))
      .rows[0].n,
    0,
  );

  for (const discovery of d.discoveries) {
    const head = await reserve(f, discovery);
    const before = (await f.store.snapshot(f.config, f.lease)).accounts.find(
      (a) => a.role === discovery.role,
    )!.view.account;
    const expected = applyPaperFill(
      before,
      head.attempt,
      simulatePerpsFill(before, head.attempt.intent, d.finalSet.frames[0]!, f.now(), f.now()),
      f.now(),
    );
    const executed = await f.store.executeHead(f.config, f.lease, {
      head,
      finalSet: d.finalSet,
      deadline: T0 + 300000,
      expectedWindowDigest: discovery.windowDigest,
    });
    assert.equal(
      executed.status,
      "confirmed",
      executed.status === "rolled_back" ? executed.code : "unknown",
    );
    if (executed.status !== "confirmed") {
      throw new Error("Expected confirmed fill");
    }
    assert.equal(executed.value.account.cash, expected.account.cash);
    assert.deepEqual(
      executed.value.account.positions.map((position) =>
        Object.fromEntries(
          Object.entries(position).filter(([key]) => !key.startsWith("breakoutFunding")),
        ),
      ),
      expected.account.positions,
    );
    assert.equal(executed.value.attempts[0]!.reserved, "0");
    assert.equal(executed.acknowledgement.receiptStatus, "QUALIFIED");
    f.advance(1);
    const duplicate = await f.store.executeHead(f.config, f.lease, {
      head,
      finalSet: d.finalSet,
      deadline: T0 + 300000,
      expectedWindowDigest: discovery.windowDigest,
    });
    assert.equal(duplicate.status, "confirmed");
    if (duplicate.status === "confirmed") {
      assert.equal(duplicate.replayed, true);
      assert.deepEqual(duplicate.acknowledgement, executed.acknowledgement);
    }
  }
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_positions"))
      .rows[0].n,
    2,
  );
  const other = new PostgresPerpsHourlyBreakoutStore(f.database.pool, f.options);
  const state = await other.snapshot(f.config, f.lease);
  assert.ok(state.accounts.every((a) => a.view.account.positions.length <= 5));
  await assert.rejects(other.initialize(f.config, {}, f.acceptance), { code: "INVALID_INPUT" });
});

test("aging rolls back only financial phase, preserving discovery consumption and real101 head; exact proof releases once", async (t) => {
  const f = await breakoutFixture(t);
  const d = await discover(f);
  const head = await reserve(f, d.discoveries[0]!);
  f.onBeforeEffect(() => f.advance(6000));
  const outcome = await f.store.executeHead(f.config, f.lease, {
    head,
    finalSet: d.finalSet,
    deadline: T0 + 300000,
    expectedWindowDigest: head.discovery.windowDigest,
  });
  assert.equal(outcome.status, "rolled_back");
  assert.equal(
    (await f.store.snapshot(f.config, f.lease)).accounts[0]!.view.account.positions.length,
    0,
  );
  assert.equal(
    (await f.store.snapshot(f.config, f.lease)).accounts[0]!.view.attempts[0]!.reserved,
    "101",
  );
  assert.equal(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS n FROM pickler.perps_study_events WHERE kind='breakout-consumption'",
      )
    ).rows[0].n,
    1,
  );
  if (outcome.status !== "rolled_back") {
    throw new Error("Expected authoritative rollback");
  }
  const terminal = await f.store.rejectHead(f.config, f.lease, {
    head,
    code: "STALE_MARKET_DATA",
    noEffectAcknowledgement: outcome.acknowledgement,
  });
  assert.equal(terminal.status, "confirmed");
  const duplicate = await f.store.rejectHead(f.config, f.lease, {
    head,
    code: "STALE_MARKET_DATA",
    noEffectAcknowledgement: outcome.acknowledgement,
  });
  assert.equal(duplicate.status, "confirmed");
  const blocked = await f.store.reserveHead(f.config, f.lease, head.discovery);
  assert.equal(blocked.status, "rolled_back");
  assert.equal(
    (
      await f.database.pool.query(
        "SELECT document->>'reserved' AS reserved FROM pickler.perps_paper_attempts",
      )
    ).rows[0].reserved,
    "0",
  );
});

test("authoritative LIMIT2 pending mismatch cannot hide another native reservation", async (t) => {
  const f = await breakoutFixture(t);
  const d = await discover(f);
  const head = await reserve(f, d.discoveries[0]!);
  const account = await roleAccount(f, "C");
  await f.database.pool.query(
    "INSERT INTO pickler.perps_paper_attempts(account_id,key,document,owner,expires_at) VALUES($1,$2,$3,$4,$5)",
    [account.id, "foreign", { ...head.attempt, key: "foreign" }, "foreign-owner", f.now() + 60000],
  );

  const outcome = await f.store.executeHead(f.config, f.lease, {
    head,
    finalSet: d.finalSet,
    deadline: T0 + 300000,
    expectedWindowDigest: head.discovery.windowDigest,
  });
  assert.equal(outcome.status, "rolled_back");
  if (outcome.status === "rolled_back") {
    assert.equal(outcome.code, "PENDING_INVENTORY_MISMATCH");
  }
  await assert.rejects(f.store.snapshot(f.config, f.lease), { code: "PENDING_INVENTORY_MISMATCH" });
  await f.database.pool.query(
    "DELETE FROM pickler.perps_paper_attempts WHERE account_id=$1 AND key=$2",
    [account.id, head.attempt.key],
  );
  await assert.rejects(f.store.snapshot(f.config, f.lease), { code: "PENDING_INVENTORY_MISMATCH" });
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_positions"))
      .rows[0].n,
    0,
  );
});

test("proved untouched head releases before a required full close; original close fence survives", async (t) => {
  const f = await breakoutFixture(t);
  const d = await discover(f, ["C"], ["BTC", "ETH"]);
  const head = await reserve(f, d.discoveries[0]!);
  const account = await roleAccount(f, "C");
  const frame = d.finalSet.frames.find((item) => item.snapshot.market.symbol === "ETH")!;
  const position: PerpsPaperPosition = {
    ...closedPosition("required-held", frame.snapshot.market),
    openedAt: f.now() - 4 * 3600000,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
    markAt: f.now(),
  };
  account.document.positions = [position];
  await f.database.pool.query("UPDATE pickler.perps_paper_accounts SET document=$2 WHERE id=$1", [
    account.id,
    account.document,
  ]);
  await f.database.pool.query(
    "INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document) VALUES($1,$2,$3,null,$4)",
    [account.id, position.id, position.symbol, position],
  );
  const obligation: BreakoutCloseObligation = {
    id: "controlled-required-full-close",
    role: "C",
    marketId: frame.snapshot.market.marketId,
    symbol: position.symbol,
    positionId: position.id,
    side: position.side,
    quantity: position.quantity,
    originalOperationId: "controlled-original-initial",
    scheduledAt: T0,
    detectedAt: f.now(),
    reasons: ["AGE_4_HOURS", "TERMINAL"],
    evidence: { controlled: true },
    state: "DUE",
  };
  const latched = await f.store.latchCloses(f.config, f.lease, [obligation]);
  assert.equal(
    latched.status,
    "confirmed",
    latched.status === "rolled_back" ? latched.code : "unknown",
  );
  if (latched.status === "confirmed") {
    assert.equal(latched.value[0]!.state, "BLOCKED_PENDING");
  }
  const rejected = await f.store.rejectHead(f.config, f.lease, {
    head,
    code: "EXIT_REQUIRED_BEFORE_OPEN",
    noEffectAcknowledgement: null,
    knownUnexecuted: true,
  });
  assert.equal(rejected.status, "confirmed");
  const reduced = await f.store.close(f.config, f.lease, { obligation, finalSet: d.finalSet });
  assert.equal(
    reduced.status,
    "confirmed",
    reduced.status === "rolled_back" ? reduced.code : "unknown",
  );
  if (reduced.status !== "confirmed") {
    throw new Error("Expected confirmed close");
  }
  const movementCount = (
    await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_movements")
  ).rows[0].n;
  f.advance(1);
  const coldStore = new PostgresPerpsHourlyBreakoutStore(f.database.pool, f.options);
  const replay = await coldStore.close(f.config, f.lease, { obligation, finalSet: d.finalSet });
  assert.equal(replay.status, "confirmed");
  if (replay.status === "confirmed") {
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.acknowledgement, reduced.acknowledgement);
  }
  const changed = await f.store.close(f.config, f.lease, {
    obligation,
    finalSet: { ...d.finalSet, financialAt: d.finalSet.financialAt + 1 },
  });
  assert.equal(changed.status, "rolled_back");
  if (changed.status === "rolled_back") {
    assert.equal(changed.code, "CONFLICT");
  }
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_movements"))
      .rows[0].n,
    movementCount,
  );
  f.advance(-1);
  const state = await f.store.snapshot(f.config, f.lease);
  assert.equal(state.accounts[0]!.view.account.positions.length, 0);
  assert.equal(state.closeObligations[0]!.state, "CONFIRMED");
  assert.equal(state.closedFences[0]!.symbol, "ETH");
  assert.equal(
    (
      await f.database.pool.query(
        "SELECT closed_at FROM pickler.perps_paper_positions WHERE account_id=$1 AND id=$2",
        [account.id, position.id],
      )
    ).rows[0].closed_at,
    String(f.now()),
  );
});

test("every legacy study/paper/export path refuses v10 before expired reservation recovery", async (t) => {
  const f = await breakoutFixture(t);
  const d = await discover(f);
  const head = await reserve(f, d.discoveries[0]!);
  const state = await f.store.snapshot(f.config, f.lease);
  const scope = state.accounts[0]!.scope;
  const before = (
    await f.database.pool.query(
      "SELECT document,owner,expires_at FROM pickler.perps_paper_attempts",
    )
  ).rows;
  f.advance(120000);
  const study = new PostgresPerpsStudyStore(f.database.pool, f.now);
  const paper = new PostgresPerpsPaperStore(f.database.pool, f.now);
  const operations = [
    () => study.initialize(f.config, {}),
    () => study.view(f.config),
    () => study.cycleView(f.config),
    () => study.claim(f.config),
    () => study.renew(f.config, f.lease),
    () => study.release(f.config, f.lease),
    () => study.guard(f.config, f.lease),
    () => study.stop(f.config),
    () => study.claimSlot(f.config, f.lease, 0),
    () => paper.initialize(scope, 1),
    () => paper.view(scope),
    () => paper.snapshot(scope),
    () => paper.closeAdmissions(scope),
    () => paper.begin(scope, 1, "legacy", head.attempt.intent),
    () => paper.fail(scope, head.lease, "LEGACY_FAILURE"),
    () => exportPerpsAuditParts(f.database.pool, f.config, async () => {}),
  ];
  for (const operation of operations) {
    await assert.rejects(operation(), { code: "VERSIONED_STORE_REQUIRED" });
  }
  assert.deepEqual(
    (
      await f.database.pool.query(
        "SELECT document,owner,expires_at FROM pickler.perps_paper_attempts",
      )
    ).rows,
    before,
  );
  await assert.rejects(f.store.guard(f.config, f.lease), { code: "LEASE_LOST" });
  const frozen = await f.store.viewRecord(f.config);
  await assert.rejects(f.store.event(f.config, f.lease, "lost", "controlled-lost", {}), {
    code: "LEASE_LOST",
  });
  assert.deepEqual(await f.store.viewRecord(f.config), frozen);
});

test("definitive COMMIT with failed original receipt journal is known effect/V unproved", async (t) => {
  const f = await breakoutFixture(t);
  const d = await discover(f);
  const head = await reserve(f, d.discoveries[0]!);
  f.onAfterCommit(() => {
    throw new Error("controlled original journal failure");
  });
  const result = await f.store.executeHead(f.config, f.lease, {
    head,
    finalSet: d.finalSet,
    deadline: T0 + 300000,
    expectedWindowDigest: head.discovery.windowDigest,
  });
  assert.equal(result.status, "confirmed");
  if (result.status === "confirmed") {
    assert.equal(result.acknowledgement.receiptStatus, "KNOWN_EFFECT_V_UNPROVED");
  }
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_positions"))
      .rows[0].n,
    1,
  );
});

test("lost COMMIT acknowledgement stops all admissions and forbids affected account observation/funding", async (t) => {
  let failCommit = false;
  const transform = (pool: Pool) =>
    new Proxy(pool, {
      get(target, property) {
        if (property === "connect") {
          return async () => {
            const client = await target.connect();
            return new Proxy(client, {
              get(actual, key) {
                if (key === "query") {
                  return async (...args: unknown[]) => {
                    const result = await Reflect.apply(actual.query, actual, args);
                    if (args[0] === "COMMIT" && failCommit) {
                      failCommit = false;
                      throw new Error("controlled acknowledgement loss after COMMIT");
                    }
                    return result;
                  };
                }
                const value = Reflect.get(actual, key, actual);
                return typeof value === "function" ? value.bind(actual) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Pool;
  const f = await breakoutFixture(t, transform);
  const d = await discover(f, ["C", "L"]);
  const head = await reserve(
    f,
    d.discoveries.find((item) => item.role === "C")!,
  );
  failCommit = true;
  const result = await f.store.executeHead(f.config, f.lease, {
    head,
    finalSet: d.finalSet,
    deadline: T0 + 300000,
    expectedWindowDigest: head.discovery.windowDigest,
  });
  assert.equal(result.status, "unknown");
  if (result.status !== "unknown") {
    throw new Error("Expected unknown outcome");
  }
  await f.store.recordBarrier(f.config, f.lease, {
    operationId: result.operationId,
    affectedRoles: result.affectedRoles,
    code: result.code,
    detectedAt: f.now(),
  });
  const blocked = await f.store.reserveHead(
    f.config,
    f.lease,
    d.discoveries.find((item) => item.role === "L")!,
  );
  assert.equal(blocked.status, "rolled_back");
  const observed = await f.store.observe(f.config, f.lease, {
    operationId: "unknown-account-observe",
    financialAt: f.now(),
    receiptAt: f.now(),
    sourceDeadlineAt: f.now() + 20000,
    roles: ["C"],
    observation: d.finalSet.observation,
  });
  assert.equal(observed.status, "rolled_back");
  if (observed.status === "rolled_back") {
    assert.equal(observed.code, "UNKNOWN_ACCOUNT_OUTCOME");
  }
  const unaffected = await f.store.observe(f.config, f.lease, {
    operationId: "unaffected-account-observe",
    financialAt: f.now(),
    receiptAt: f.now(),
    sourceDeadlineAt: f.now() + 20000,
    roles: ["L"],
    observation: d.finalSet.observation,
  });
  assert.equal(unaffected.status, "confirmed");
});

test("paged closed-position funding equals native kernel; retained actual source is revisitable and last-page dispute rolls all new funding back", async (t) => {
  const f = await breakoutFixture(t);
  const frame = controlledFrame(f.now());
  const account = await roleAccount(f, "C");
  const positions = Array.from({ length: 97 }, (_, i) =>
    closedPosition(`archived-${String(i).padStart(5, "0")}`, frame.snapshot.market),
  );
  for (const position of positions) {
    await f.database.pool.query(
      "INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document) VALUES($1,$2,$3,$4,$5)",
      [account.id, position.id, position.symbol, position.closedAt, position],
    );
  }
  await f.database.pool.query(
    "UPDATE pickler.perps_paper_accounts SET document=document||jsonb_build_object('breakoutFundingState',$2::jsonb,'fundingPending',true) WHERE id=$1",
    [
      account.id,
      JSON.stringify({
        version: 1,
        closed: positions.length,
        pendingClosed: positions.length,
        disputedClosed: 0,
        uninitializedClosed: positions.length,
      }),
    ],
  );
  const history = controlledFunding(frame);
  const original = { ...account.document, positions };
  const expected = applyPaperObservation(
    original,
    [],
    { frames: [frame], funding: [history] },
    "golden",
    f.now(),
    f.now(),
  );
  const first = await f.store.observe(f.config, f.lease, {
    operationId: "funding-original",
    financialAt: f.now(),
    receiptAt: f.now(),
    sourceDeadlineAt: f.now() + 20000,
    roles: ["C"],
    observation: { frames: [frame], funding: [history] },
  });
  assert.equal(first.status, "confirmed", first.status === "rolled_back" ? first.code : "unknown");
  if (first.status !== "confirmed") {
    throw new Error("Expected complete funding");
  }
  assert.equal(first.value[0]!.view.account.cash, expected.account.cash);
  assert.equal(first.value[0]!.view.account.positions.length, 0);
  assert.equal(first.value[0]!.view.account.fundingPending, false);
  const retained = await f.store.observe(f.config, f.lease, {
    operationId: "funding-retained",
    financialAt: f.now(),
    receiptAt: f.now(),
    sourceDeadlineAt: f.now() + 20000,
    roles: ["C"],
    observation: { frames: [frame], funding: [] },
  });
  assert.equal(retained.status, "confirmed");
  if (retained.status === "confirmed") {
    assert.equal(retained.value[0]!.view.account.cash, expected.account.cash);
    assert.equal(retained.value[0]!.view.account.fundingPending, false);
  }
  const req = await f.store.fundingRequirements(f.config, f.lease, { limit: 64 });
  assert.equal(req.rows.length, 64);
  assert.ok(req.nextCursor);
  assert.ok(req.rows.every((r) => r.previousCheckedAt === f.now()));
  const tail = await f.store.fundingRequirements(f.config, f.lease, {
    after: req.nextCursor!,
    limit: 64,
  });
  assert.equal(tail.rows.length, 33);
  assert.equal(tail.nextCursor, null);
  const revisited = await f.store.fundingRequirements(f.config, f.lease, { limit: 1 });
  assert.equal(revisited.rows[0]!.positionId, positions[0]!.id);

  const extra = { ...history.events[0]!, eventBlock: 11 };
  const revision = { ...history, events: [...history.events, extra] };
  const lastKey = `funding:${positions.at(-1)!.id}:10`;
  await f.database.pool.query(
    "UPDATE pickler.perps_paper_movements SET document=jsonb_set(document,'{evidence,rate}','\"0.999\"'::jsonb) WHERE account_id=$1 AND key=$2",
    [account.id, lastKey],
  );
  const disputed = await f.store.observe(f.config, f.lease, {
    operationId: "funding-last-page-dispute",
    financialAt: f.now(),
    receiptAt: f.now(),
    sourceDeadlineAt: f.now() + 20000,
    roles: ["C"],
    observation: { frames: [frame], funding: [revision] },
  });
  assert.equal(disputed.status, "confirmed");
  if (disputed.status === "confirmed") {
    assert.equal(disputed.value[0]!.view.account.cash, expected.account.cash);
    assert.equal(disputed.value[0]!.view.account.fundingDisputed, true);
    assert.equal(disputed.value[0]!.view.account.fundingPending, true);
  }
  assert.equal(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS n FROM pickler.perps_paper_movements WHERE account_id=$1 AND key LIKE '%:11'",
        [account.id],
      )
    ).rows[0].n,
    0,
  );
  const a = await exportPerpsBreakoutAuditParts(f.database.pool, f.config, async () => {}, {
    pageSize: 1,
  });
  const b = await exportPerpsBreakoutAuditParts(f.database.pool, f.config, async () => {}, {
    pageSize: 64,
  });
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.positions, 97);
  assert.equal(a.movements, 100);
});

function interceptQueries(pool: Pool, after: (sql: string) => void): Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property === "connect") {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(actual, key) {
              if (key === "query") {
                return async (...args: unknown[]) => {
                  const result = await Reflect.apply(actual.query, actual, args);
                  after(String(args[0]));
                  return result;
                };
              }
              const value = Reflect.get(actual, key, actual);
              return typeof value === "function" ? value.bind(actual) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function seedHeld(
  f: Awaited<ReturnType<typeof breakoutFixture>>,
  id: string,
  symbol: "BTC" | "ETH" = "BTC",
) {
  const account = await roleAccount(f, "C");
  const frame = controlledFrame(f.now(), symbol);
  const position: PerpsPaperPosition = {
    ...closedPosition(id, frame.snapshot.market, f.now()),
    openedAt: f.now() - 4 * 3600000,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
    markAt: f.now(),
  };
  account.document.positions.push(position);
  await f.database.pool.query("UPDATE pickler.perps_paper_accounts SET document=$2 WHERE id=$1", [
    account.id,
    account.document,
  ]);
  await f.database.pool.query(
    "INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document) VALUES($1,$2,$3,null,$4)",
    [account.id, position.id, symbol, position],
  );
  const obligation: BreakoutCloseObligation = {
    id: `controlled-obligation:${id}`,
    role: "C",
    marketId: frame.snapshot.market.marketId,
    symbol,
    positionId: id,
    side: position.side,
    quantity: position.quantity,
    originalOperationId: `controlled-original:${id}`,
    scheduledAt: f.now(),
    detectedAt: f.now(),
    reasons: ["AGE_4_HOURS"],
    evidence: { controlled: true },
    state: "DUE",
  };
  return { account, position, frame, obligation };
}

test("a full close crossing immutable TV rolls back its fill, native attempt and source event", async (t) => {
  let onQuery: ((sql: string) => void) | undefined;
  const f = await breakoutFixture(t, (pool) => interceptQueries(pool, (sql) => onQuery?.(sql)));
  const d = await discover(f);
  const { TV } = breakoutWindowTimes(T0);
  f.setNow(TV - 1);
  await f.database.pool.query("UPDATE pickler.perps_studies SET expires_at=$1", [TV + 90000]);
  const held = await seedHeld(f, "cutoff-held");
  assert.equal(
    (await f.store.latchCloses(f.config, f.lease, [held.obligation])).status,
    "confirmed",
  );
  const finalSet = {
    ...d.finalSet,
    operationId: "controlled-cutoff-close",
    sourceDeadlineAt: f.now() + 20000,
    financialAt: f.now(),
    receiptAt: f.now(),
    frames: [held.frame],
    observation: { frames: [held.frame], funding: [], marksOnly: true },
  };
  onQuery = (sql) => {
    if (sql.includes("INSERT INTO pickler.perps_paper_attempts")) {
      f.advance(2);
    }
  };
  const outcome = await f.store.close(f.config, f.lease, { obligation: held.obligation, finalSet });
  assert.equal(outcome.status, "rolled_back");
  if (outcome.status === "rolled_back") {
    assert.equal(outcome.code, "CLOSING_WINDOW_CLOSED");
  }
  onQuery = undefined;
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_attempts"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_movements"))
      .rows[0].n,
    3,
  );
  assert.equal(
    (
      await f.database.pool.query(
        "SELECT closed_at FROM pickler.perps_paper_positions WHERE id=$1",
        [held.position.id],
      )
    ).rows[0].closed_at,
    null,
  );
  const state = await f.store.snapshot(f.config, f.lease);
  assert.equal(state.closeObligations[0]!.state, "DUE");
  assert.equal(state.closedFences.length, 0);
});

test("funding crossing immutable TF rolls back every posting and leaves pending archive counters intact", async (t) => {
  let onQuery: ((sql: string) => void) | undefined;
  const f = await breakoutFixture(t, (pool) => interceptQueries(pool, (sql) => onQuery?.(sql)));
  const { TF } = breakoutWindowTimes(T0);
  f.setNow(TF - 1);
  await f.database.pool.query("UPDATE pickler.perps_studies SET expires_at=$1", [TF + 90000]);
  const account = await roleAccount(f, "C");
  const frame = controlledFrame(f.now());
  const position = closedPosition("funding-cutoff-held", frame.snapshot.market, f.now());
  await f.database.pool.query(
    "INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document) VALUES($1,$2,$3,$4,$5)",
    [account.id, position.id, position.symbol, position.closedAt, position],
  );
  await f.database.pool.query(
    "UPDATE pickler.perps_paper_accounts SET document=document||jsonb_build_object('breakoutFundingState',$2::jsonb,'fundingPending',true) WHERE id=$1",
    [
      account.id,
      JSON.stringify({
        version: 1,
        closed: 1,
        pendingClosed: 1,
        disputedClosed: 0,
        uninitializedClosed: 1,
      }),
    ],
  );
  onQuery = (sql) => {
    if (sql.includes("RELEASE SAVEPOINT breakout_funding")) {
      f.advance(2);
    }
  };
  const outcome = await f.store.observe(f.config, f.lease, {
    operationId: "controlled-funding-cutoff",
    roles: ["C"],
    financialAt: f.now(),
    receiptAt: f.now(),
    sourceDeadlineAt: f.now() + 20000,
    observation: { frames: [], funding: [controlledFunding(frame, f.now())] },
  });
  onQuery = undefined;
  assert.equal(outcome.status, "rolled_back");
  if (outcome.status === "rolled_back") {
    assert.equal(outcome.code, "FUNDING_WINDOW_CLOSED");
  }
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_movements"))
      .rows[0].n,
    3,
  );
  const unchanged = await roleAccount(f, "C");
  assert.equal(unchanged.document.cash, "1000");
  assert.equal(unchanged.document.fundingPending, true);
  assert.equal(
    (
      unchanged.document as typeof unchanged.document & {
        breakoutFundingState: PerpsBreakoutFundingState;
      }
    ).breakoutFundingState.pendingClosed,
    1,
  );
});

test("archive counter mismatch fails before funding source or cash writes; unchanged unknown archives stay pending", async (t) => {
  const f = await breakoutFixture(t);
  const account = await roleAccount(f, "C");
  const frame = controlledFrame(f.now());
  const position = closedPosition("uninitialized-archive", frame.snapshot.market);
  await f.database.pool.query(
    "INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document) VALUES($1,$2,$3,$4,$5)",
    [account.id, position.id, position.symbol, position.closedAt, position],
  );
  const input = {
    operationId: "controlled-counter-mismatch",
    roles: ["C"] as const,
    financialAt: f.now(),
    receiptAt: f.now(),
    sourceDeadlineAt: f.now() + 20000,
    observation: { frames: [], funding: [] },
  };
  const mismatch = await f.store.observe(f.config, f.lease, input);
  assert.equal(mismatch.status, "rolled_back");
  if (mismatch.status === "rolled_back") {
    assert.equal(mismatch.code, "FUNDING_INVENTORY_MISMATCH");
  }
  await f.database.pool.query(
    "UPDATE pickler.perps_paper_accounts SET document=document||jsonb_build_object('breakoutFundingState',$2::jsonb,'fundingPending',true) WHERE id=$1",
    [
      account.id,
      JSON.stringify({
        version: 1,
        closed: 1,
        pendingClosed: 1,
        disputedClosed: 0,
        uninitializedClosed: 1,
      }),
    ],
  );
  const checked = await f.store.observe(f.config, f.lease, {
    ...input,
    operationId: "controlled-counter-verified",
  });
  assert.equal(checked.status, "confirmed");
  if (checked.status === "confirmed") {
    assert.equal(checked.value[0]!.view.account.fundingPending, true);
    assert.equal(checked.value[0]!.view.account.cash, "1000");
    assert.equal(checked.acknowledgement.receipt, undefined);
  }
});

test("selective retirement preserves mandatory and multi-reason intents and original canonical latches", async (t) => {
  const f = await breakoutFixture(t);
  const first = await seedHeld(f, "selective-held", "BTC");
  const second = await seedHeld(f, "mandatory-held", "ETH");
  const selective: BreakoutCloseObligation = {
    ...first.obligation,
    reasons: ["SELECTIVE_EXPOSURE"],
  };
  const mandatory: BreakoutCloseObligation = {
    ...second.obligation,
    reasons: ["SELECTIVE_EXPOSURE", "AGE_4_HOURS"],
  };
  assert.equal(
    (await f.store.latchCloses(f.config, f.lease, [selective, mandatory])).status,
    "confirmed",
  );
  const input = {
    operationId: "controlled-selective-reconciliation",
    observation: { frames: [first.frame, second.frame], funding: [], marksOnly: true },
  };
  assert.equal((await f.store.reconcileSelective(f.config, f.lease, input)).status, "confirmed");
  assert.equal((await f.store.reconcileSelective(f.config, f.lease, input)).status, "confirmed");
  const state = await f.store.snapshot(f.config, f.lease);
  assert.deepEqual(
    state.closeObligations.map((o) => o.id),
    [mandatory.id],
  );
  const events = await f.database.pool.query(
    "SELECT kind,data FROM pickler.perps_study_events WHERE kind IN ('breakout-close-latch','breakout-selective-retired') ORDER BY kind",
  );
  assert.equal(events.rows.filter((e) => e.kind === "breakout-selective-retired").length, 1);
  assert.equal(events.rows.find((e) => e.kind === "breakout-close-latch").data.length, 2);
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_attempts"))
      .rows[0].n,
    0,
  );
});

test("source acquisition inside twenty seconds may commit afterward while original native entry gates remain valid", async (t) => {
  const f = await breakoutFixture(t);
  const d = await discover(f);
  const head = await reserve(f, d.discoveries[0]!);
  f.setNow(T0 + 20900);
  const frame = controlledFrame(f.now());
  const finalSet = {
    ...d.finalSet,
    financialAt: f.now(),
    receiptAt: f.now(),
    frames: [frame],
    observation: { frames: [frame], funding: [], marksOnly: true },
    smaEvidence: { ...d.finalSet.smaEvidence!, observedAt: f.now(), frames: [frame] },
  };
  assert.ok(finalSet.financialAt <= finalSet.sourceDeadlineAt);
  f.onBeforeEffect(() => f.advance(200));
  const result = await f.store.executeHead(f.config, f.lease, {
    head,
    finalSet,
    deadline: T0 + 300000,
    expectedWindowDigest: head.discovery.windowDigest,
  });
  assert.ok(f.now() > finalSet.sourceDeadlineAt);
  assert.equal(
    result.status,
    "confirmed",
    result.status === "rolled_back" ? result.code : "unknown",
  );
});

test("uncertain discovery COMMIT stops every admission even with no financially affected role", async (t) => {
  let loseCommit = false;
  const f = await breakoutFixture(t, (pool) =>
    interceptQueries(pool, (sql) => {
      if (loseCommit && sql === "COMMIT") {
        loseCommit = false;
        throw new Error("Controlled lost original discovery commit acknowledgement");
      }
    }),
  );
  const d = await discover(f);
  loseCommit = true;
  const uncertain = await f.store.commitDiscovery(f.config, f.lease, {
    operationId: "controlled-empty-original-discovery",
    H: T0,
    D: f.now(),
    discoveries: [],
    initialEvidence: { controlled: true },
  });
  assert.equal(uncertain.status, "unknown");
  if (uncertain.status === "unknown") {
    assert.deepEqual(uncertain.affectedRoles, []);
  }
  for (const role of ["C", "S", "L"] as const) {
    const result = await f.store.reserveHead(f.config, f.lease, { ...d.discoveries[0]!, role });
    assert.equal(result.status, "rolled_back");
    if (result.status === "rolled_back") {
      assert.equal(result.code, "ADMISSIONS_CLOSED");
    }
  }
  assert.equal(
    (await f.database.pool.query("SELECT count(*)::int AS n FROM pickler.perps_paper_attempts"))
      .rows[0].n,
    0,
  );
});
