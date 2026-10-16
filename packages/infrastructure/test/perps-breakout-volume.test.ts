import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { canonicalBreakoutJson } from "@pickler/trading/evaluation";
import { PostgresPerpsHourlyBreakoutStore } from "../src/persistence/perps-breakout-store.js";
import type { Pool } from "pg";
import { paperDecimal, paperUnits } from "@pickler/trading/perps";
import { exportPerpsBreakoutAuditParts } from "../src/persistence/perps-breakout-audit.js";
import {
  breakoutFixture,
  closedPosition,
  controlledFrame,
  controlledFunding,
  T0,
  roleAccount,
} from "./perps-breakout-fixture.js";

test("28-day adverse filled-history load exports through bounded PK pages with page-independent hash", async (t) => {
  const f = await breakoutFixture(t);
  const count = (672 + 672 + 8064) * 5;
  const account = await roleAccount(f, "C");
  const frame = controlledFrame(f.now());
  const history = { ...controlledFunding(frame), events: [] };
  const sourceSha256 = createHash("sha256").update(canonicalBreakoutJson(history)).digest("hex");
  const sourceKey = `breakout-funding-source:${sourceSha256}`;
  const studyId = (
    await f.database.pool.query("SELECT id FROM pickler.perps_studies WHERE session_id=$1", [
      f.config.sessionId,
    ])
  ).rows[0].id;
  await f.database.pool.query(
    "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,'breakout-funding-source',$4)",
    [studyId, sourceKey, f.now(), { version: 1, sha256: sourceSha256, history }],
  );
  const position = {
    ...closedPosition("synthetic", frame.snapshot.market),
    exitPrice: "100.04",
    breakoutFundingStatus: { version: 1, pending: false, disputed: false, uninitialized: false },
    breakoutFunding: {
      version: 1,
      sourceKey,
      sourceSha256,
      checkedAt: f.now(),
      operationId: "controlled-seed",
      pending: false,
      originalSourceKey: sourceKey,
      completeSourceKey: sourceKey,
      from: history.from,
      to: history.to,
      complete: true,
    },
  };
  let seedQueries = 0;
  for (let start = 1; start <= count; start += 512) {
    const end = Math.min(start + 511, count);
    const firstId = `volume-${String(start).padStart(6, "0")}`;
    const lastId = `volume-${String(end).padStart(6, "0")}`;
    await f.database.pool.query(
      `INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document)
       SELECT $1,'volume-'||lpad(i::text,6,'0'),'BTC',$3,
         $2::jsonb||jsonb_build_object('id','volume-'||lpad(i::text,6,'0'))
       FROM generate_series($4::integer,$5::integer) i`,
      [account.id, position, position.closedAt, start, end],
    );
    await f.database.pool.query(
      `INSERT INTO pickler.perps_paper_attempts(account_id,key,document)
       SELECT $1,p.id||v.suffix,jsonb_build_object(
         'key',p.id||v.suffix,'intent',jsonb_build_object('kind',v.kind,'symbol','BTC','side','long',
         'notional',v.notional,'feeReserve','1'),'status','filled','reserved','0',
         'createdAt',$4::bigint,'finishedAt',$5::bigint,'reason',null,'evidence',jsonb_build_object('controlled',true))
       FROM pickler.perps_paper_positions p
       CROSS JOIN (VALUES ('','open','100'),(':close','close','0')) AS v(suffix,kind,notional)
       WHERE p.account_id=$1 AND p.id >= $2 AND p.id <= $3`,
      [account.id, firstId, lastId, position.openedAt, position.closedAt],
    );
    await f.database.pool.query(
      `INSERT INTO pickler.perps_paper_movements(account_id,key,document)
       SELECT $1,p.id||v.suffix,jsonb_build_object('key',p.id||v.suffix,'kind',v.kind,
         'delta',v.delta,'at',$4::bigint,'evidence',jsonb_build_object('positionId',p.id,'symbol','BTC','controlled',true))
       FROM pickler.perps_paper_positions p
       CROSS JOIN (VALUES (':fee','fee','-0.02'),(':close:fee','fee','-0.020008'),
         (':close:pnl','realized-pnl','0.04'),(':funding:10','funding','0')) AS v(suffix,kind,delta)
       WHERE p.account_id=$1 AND p.id >= $2 AND p.id <= $3`,
      [account.id, firstId, lastId, position.closedAt],
    );
    seedQueries += 3;
  }
  const cash = paperDecimal(paperUnits("1000") - BigInt(count) * paperUnits("0.000008"));
  await f.database.pool.query(
    "UPDATE pickler.perps_paper_accounts SET document=jsonb_set(document,'{cash}',to_jsonb($2::text)) WHERE id=$1",
    [account.id, cash],
  );
  await f.database.pool.query(
    "UPDATE pickler.perps_paper_accounts SET document=document||jsonb_build_object('breakoutFundingState',$2::jsonb) WHERE id=$1",
    [
      account.id,
      JSON.stringify({
        version: 1,
        closed: count,
        pendingClosed: 0,
        disputedClosed: 0,
        uninitializedClosed: 0,
      }),
    ],
  );
  await f.database.pool.query(
    `UPDATE pickler.perps_paper_positions SET closed_at=$3,document=document||jsonb_build_object('openedAt',$2::bigint,'closedAt',$3::bigint)
     WHERE account_id=$1 AND id=$4`,
    [account.id, T0 - 10000, T0 - 5000, `volume-${String(count).padStart(6, "0")}`],
  );
  const eventCount = 100000;
  for (let start = 1; start <= eventCount; start += 1000) {
    await f.database.pool.query(
      `INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data)
       SELECT $1,'volume-event-'||lpad(i::text,6,'0'),$2,'controlled-canonical-event',jsonb_build_object('sequence',i,'controlled',true)
       FROM generate_series($3::integer,$4::integer) i`,
      [studyId, f.now(), start, Math.min(start + 999, eventCount)],
    );
    seedQueries++;
  }
  const stats = {
    queries: 0,
    checkouts: 0,
    active: 0,
    highWaterClients: 0,
    maximumReturnedRows: 0,
    longestQueryMs: 0,
  };
  const observed = new Proxy(f.database.pool, {
    get(target, property) {
      if (property === "connect") {
        return async () => {
          const client = await target.connect();
          stats.checkouts++;
          stats.active++;
          stats.highWaterClients = Math.max(stats.highWaterClients, stats.active);
          return new Proxy(client, {
            get(actual, key) {
              if (key === "query") {
                return async (...args: unknown[]) => {
                  stats.queries++;
                  const started = performance.now();
                  const result = await Reflect.apply(actual.query, actual, args);
                  stats.longestQueryMs = Math.max(
                    stats.longestQueryMs,
                    performance.now() - started,
                  );
                  stats.maximumReturnedRows = Math.max(
                    stats.maximumReturnedRows,
                    result.rows.length,
                  );
                  return result;
                };
              }
              if (key === "release") {
                return (...args: unknown[]) => {
                  stats.active--;
                  return Reflect.apply(actual.release, actual, args);
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
  const measuredStore = new PostgresPerpsHourlyBreakoutStore(observed, f.options);
  const funding = await measuredStore.observe(f.config, f.lease, {
    operationId: "controlled-volume-one-held-range",
    financialAt: f.now(),
    receiptAt: f.now(),
    sourceDeadlineAt: f.now() + 20000,
    roles: ["C"],
    observation: { frames: [], funding: [{ ...history, from: T0 - 11000, to: T0 - 4000 }] },
  });
  assert.equal(
    funding.status,
    "confirmed",
    funding.status === "rolled_back" ? funding.code : "unknown",
  );
  if (funding.status === "confirmed") {
    assert.equal(funding.value[0]!.view.account.cash, cash);
    assert.equal(funding.value[0]!.view.account.fundingPending, false);
    assert.equal(funding.acknowledgement.receipt, undefined);
  }
  assert.ok(stats.queries < 32);
  assert.ok(stats.maximumReturnedRows <= 32);
  assert.equal(stats.highWaterClients, 1);
  const fundingStats = { ...stats };
  Object.assign(stats, {
    queries: 0,
    checkouts: 0,
    active: 0,
    highWaterClients: 0,
    maximumReturnedRows: 0,
    longestQueryMs: 0,
  });
  const first = await exportPerpsBreakoutAuditParts(
    observed,
    f.config,
    async (part) => {
      if (part.kind === "account") {
        assert.ok(part.value.positions.length <= 5);
      }
      if (part.kind === "attempt") {
        assert.equal(Object.hasOwn(part.value, "owner"), false);
      }
    },
    { pageSize: 32 },
  );
  const second = await exportPerpsBreakoutAuditParts(observed, f.config, async () => {}, {
    pageSize: 256,
  });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.positions, count);
  assert.equal(first.attempts, count * 2);
  assert.equal(first.movements, count * 4 + 3);
  assert.equal(first.events, eventCount + 3);
  assert.equal(first.rows, count * 7 + 7 + eventCount + 3);
  assert.equal(stats.highWaterClients, 1);
  assert.equal(stats.active, 0);
  assert.equal(stats.checkouts, 2);
  assert.ok(stats.maximumReturnedRows <= 256);
  assert.equal((await f.store.snapshot(f.config, f.lease)).accounts[0]!.view.account.cash, cash);
  t.diagnostic(
    JSON.stringify({
      controlledOnly: true,
      positions: count,
      canonicalRowsPerExport: first.rows,
      seedQueries,
      fundingStats,
      ...stats,
    }),
  );
});
