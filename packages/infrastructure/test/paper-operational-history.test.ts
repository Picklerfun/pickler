import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  initialPaperAccount,
  applyPaperObservation,
  paperFundingRange,
  type PerpsPaperPosition,
  type PerpsPaperScope,
} from "@pickler/trading/perps";
import type { PerpFundingHistory } from "@pickler/core";
import { createTestStore } from "./database.js";
import { PostgresPerpsPaperStore } from "../src/persistence/perps-paper-store.js";
import { PaperFundingEpochs } from "../src/persistence/paper-funding-epochs.js";
import { migratePaperAccount } from "../src/persistence/paper-storage-migration.js";

async function fixture(t: TestContext, count = 0) {
  const db = await createTestStore(t);
  const scope: PerpsPaperScope = {
    tenantId: "alpha",
    agentId: "pickle-alpha",
    sessionId: "product",
    network: "testnet",
  };
  const now = Date.now() - 10000;
  const account = initialPaperAccount(scope, 1, now, "1000");
  await db.pool.query(
    "INSERT INTO pickler.perps_paper_accounts(id,tenant_id,agent_id,session_id,network,document) VALUES('account','alpha','pickle-alpha','product','testnet',$1)",
    [account],
  );
  await db.pool.query(
    `INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document)
    SELECT 'account','position-'||lpad(n::text,6,'0'),'BTC',$1,
      jsonb_build_object('id','position-'||lpad(n::text,6,'0'),'symbol','BTC','side','short',
        'quantity','1','entryPrice','100','entryNotional','100','openedAt',$1::bigint-1,'entryBlock',1,
        'mark',NULL,'markAt',NULL,'closedAt',$1::bigint,'exitPrice','100','exitBlock',3)
    FROM generate_series(1,$2::int) n`,
    [now, count],
  );
  return { db, scope, now, repo: new PostgresPerpsPaperStore(db.pool, () => now) };
}

test("100000 historical rows do not enter an execution snapshot; legacy writers are fenced", async (t) => {
  const f = await fixture(t, 100000);
  assert.deepEqual(await f.repo.closedPositions(f.scope), {
    items: [],
    nextCursor: null,
    complete: false,
  });
  await f.db.pool.query(
    `INSERT INTO pickler.perps_paper_movements(account_id,key,document)
    SELECT 'account','historical-'||n,jsonb_build_object('key','historical-'||n,'kind','fee','delta','-0.1','at',$1::bigint-86400000,'evidence',repeat('x',100))
    FROM generate_series(1,100000) n`,
    [f.now],
  );
  await f.db.pool.query(
    "INSERT INTO pickler.paper_storage(account_id,mode) VALUES('account','operational')",
  );

  let statements = 0,
    returnedRows = 0;
  const measuredPool = {
    connect: async () => {
      const client = await f.db.pool.connect();
      return {
        query: async (sql: string, values?: unknown[]) => {
          statements++;
          const result = await client.query(sql, values);
          returnedRows += result.rows.length;
          return result;
        },
        release: () => client.release(),
      };
    },
  } as unknown as Pool;
  const state = await new PostgresPerpsPaperStore(measuredPool, () => f.now).executionSnapshot(
    f.scope,
  );
  assert.equal(statements, 3); // BEGIN, one operational SELECT, COMMIT (fixed controlled clock).
  assert.equal(returnedRows, 1);
  const footprint = (
    await f.db.pool.query(
      `SELECT
    (SELECT count(*) FROM pickler.perps_paper_positions WHERE account_id='account')+
    (SELECT count(*) FROM pickler.perps_paper_movements WHERE account_id='account')+1 AS legacy_rows,
    (SELECT sum(octet_length(document::text)) FROM pickler.perps_paper_positions WHERE account_id='account')+
    (SELECT sum(octet_length(document::text)) FROM pickler.perps_paper_movements WHERE account_id='account') AS legacy_document_bytes,
    octet_length($1::jsonb::text) AS operational_bytes`,
      [JSON.stringify(state)],
    )
  ).rows[0];
  assert.equal(Number(footprint.legacy_rows), 200001);
  assert.ok(Number(footprint.legacy_document_bytes) > 10000000);
  assert.ok(Number(footprint.operational_bytes) < 1500);
  t.diagnostic(
    JSON.stringify({
      legacyRows: Number(footprint.legacy_rows),
      legacyDocumentBytesLowerBound: Number(footprint.legacy_document_bytes),
      operationalRows: returnedRows,
      operationalBytes: Number(footprint.operational_bytes),
      operationalStatements: statements,
    }),
  );

  assert.equal(state.account.positions.length, 0);
  assert.equal(state.attempts.length, 0);
  assert.equal(state.movements.length, 0);
  assert.ok(JSON.stringify(state).length < 1500);
  await assert.rejects(
    f.db.pool.query("UPDATE pickler.perps_paper_accounts SET document=document WHERE id='account'"),
    /PAPER_WRITER_VERSION_REQUIRED/,
  );
  await f.db.pool.query(
    "INSERT INTO pickler.paper_position_totals(account_id,position_id,pnl) SELECT account_id,id,0 FROM pickler.perps_paper_positions",
  );
  const page = await f.repo.closedPositions(f.scope);
  assert.equal(page.items.length, 50);
  assert.ok(page.nextCursor);
  assert.equal(page.complete, true);
  const foreign = JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString("utf8"));
  foreign.account = "another-account";
  await assert.rejects(
    f.repo.closedPositions(f.scope, {
      cursor: Buffer.from(JSON.stringify(foreign)).toString("base64url"),
    }),
    { code: "INVALID_INPUT" },
  );
  const writer = await f.db.pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query("SELECT set_config('pickler.paper_writer','2',true)");
    await writer.query(`INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document)
      SELECT account_id,'new-close',symbol,closed_at,document||'{"id":"new-close"}'::jsonb FROM pickler.perps_paper_positions WHERE id='position-000001'`);
    await writer.query(
      "INSERT INTO pickler.paper_position_totals(account_id,position_id,pnl) VALUES('account','new-close',0)",
    );
    await writer.query("COMMIT");
  } finally {
    writer.release();
  }
  const older = await f.repo.closedPositions(f.scope, { cursor: page.nextCursor! });
  assert.equal(older.items.length, 50);
  assert.equal(
    older.items.some((item) => item.position.id === "new-close"),
    false,
  );
  await f.db.pool.query("DELETE FROM pickler.paper_position_totals WHERE position_id='new-close'");
  await assert.rejects(f.repo.closedPositions(f.scope), { code: "DATA_UNAVAILABLE" });
});

const anchor = async (expected?: { number: number; hash: string; timestamp: number }) =>
  expected ?? { number: 1_000_000_000, hash: "0x" + "a".repeat(64), timestamp: Date.now() };
const funding = async (_position: unknown, from: number, to: number) =>
  ({
    market: { symbol: "BTC", provenance: { network: "testnet" } },
    from,
    to,
    complete: true,
    pages: [],
    events: [
      {
        eventBlock: 2,
        appliesAt: from,
        rate: "0.01",
        index: "100",
        estimated: false,
        provenance: { network: "testnet" },
      },
    ],
  }) as unknown as PerpFundingHistory;

test("funding epochs retain their cohort and cash stays unchanged until every page commits", async (t) => {
  const f = await fixture(t, 105);
  await f.db.pool.query(
    "INSERT INTO pickler.paper_storage(account_id,mode,coverage_required) SELECT 'account','operational',max(closed_sequence) FROM pickler.perps_paper_positions",
  );
  const audit = new PaperFundingEpochs(f.db.pool);

  const first = await audit.pass(f.scope, funding, anchor);
  assert.equal(first.kind, "continued");
  const epoch = (
    await f.db.pool.query(
      "SELECT id,cutoff_at,max_sequence,cursor FROM pickler.paper_funding_epochs",
    )
  ).rows[0];
  assert.equal((await f.repo.executionSnapshot(f.scope)).account.cash, "1000");
  assert.equal(Number(epoch.cursor), 50);
  assert.equal(
    Number(
      (await f.db.pool.query("SELECT count(*) AS n FROM pickler.paper_funding_postings")).rows[0].n,
    ),
    50,
  );

  const second = await new PaperFundingEpochs(f.db.pool).pass(f.scope, funding, anchor);
  assert.equal(second.kind, "continued");
  assert.equal((await f.repo.executionSnapshot(f.scope)).account.cash, "1000");
  const third = await audit.pass(f.scope, funding, anchor);
  assert.equal(third.kind, "complete");
  assert.equal(Number((await f.repo.executionSnapshot(f.scope)).account.cash), 1105);
  const committed = (
    await f.db.pool.query(
      "SELECT id,cutoff_at,max_sequence,status FROM pickler.paper_funding_epochs",
    )
  ).rows[0];
  assert.equal(committed.id, epoch.id);
  assert.equal(committed.cutoff_at, epoch.cutoff_at);
  assert.equal(committed.max_sequence, epoch.max_sequence);
  assert.equal(committed.status, "committed");
});

test("conversion processes100 parent entities per transaction and resumes a frozen account", async (t) => {
  const f = await fixture(t, 205);
  await f.db.pool.query(
    `UPDATE pickler.perps_paper_positions SET document=document||jsonb_build_object('margin','305','sizeUps',
    (SELECT jsonb_agg(jsonb_build_object('at',$1::bigint,'margin','1') ORDER BY n) FROM generate_series(1,205) n))
    WHERE account_id='account' AND id='position-000001'`,
    [f.now],
  );
  await f.db.pool
    .query(`UPDATE pickler.perps_paper_accounts SET document=jsonb_set(document,'{positions}',
    (SELECT jsonb_agg(document ORDER BY sequence) FROM pickler.perps_paper_positions WHERE account_id='account')) WHERE id='account'`);
  const preflight = await migratePaperAccount(f.db.pool, "account");
  assert.equal(preflight.mode, "legacy");
  assert.equal(preflight.eligible, true);

  const first = await migratePaperAccount(f.db.pool, "account", true);
  assert.equal(first.mode, "frozen");
  assert.equal(first.cursor, "100");
  await assert.rejects(
    f.db.pool.query("UPDATE pickler.perps_paper_accounts SET document=document WHERE id='account'"),
    /PAPER_MIGRATION_FROZEN/,
  );
  let last: Awaited<ReturnType<typeof migratePaperAccount>> = first;
  for (let count = 0; count < 30 && !last.complete; count++) {
    last = await migratePaperAccount(f.db.pool, "account", true);
  }
  assert.equal(last.complete, true);
  assert.equal((await f.repo.executionSnapshot(f.scope)).account.positions.length, 0);
  const archive = await f.repo.snapshot(f.scope);
  assert.equal(archive.account.positions.length, 205);
  assert.equal(archive.account.positions[0]!.sizeUps?.length, 205);
  assert.deepEqual(
    archive.account.positions[0]!.sizeUps,
    Array.from({ length: 205 }, () => ({ at: f.now, margin: "1" })),
  );
  assert.equal(
    Number(
      (await f.db.pool.query("SELECT count(*) AS n FROM pickler.paper_position_sizeups")).rows[0].n,
    ),
    205,
  );
});

test("incremental funding advances only confirmed windows and keeps immutable entry identity", () => {
  const scope: PerpsPaperScope = {
    tenantId: "alpha",
    agentId: "pickle-alpha",
    sessionId: "product",
    network: "testnet",
  };
  const now = 36_001_000;
  const account = initialPaperAccount(scope, 1, 1000, "1000");
  const position: PerpsPaperPosition = {
    id: "position",
    symbol: "BTC",
    side: "short",
    quantity: "1",
    entryPrice: "100",
    entryNotional: "100",
    openedAt: 1000,
    entryBlock: 1,
    mark: null,
    markAt: null,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
  };
  account.positions = [position];
  const range = paperFundingRange(account.positions, "BTC", now);
  assert.deepEqual(range, { from: 1000, to: 3_601_000 });
  const history = {
    market: { symbol: "BTC", provenance: { network: "testnet" } },
    from: range.from,
    to: range.to,
    complete: true,
    pages: [],
    events: [{ eventBlock: 2, appliesAt: 2000, rate: "0.01", index: "100", estimated: false }],
  } as unknown as PerpFundingHistory;
  const first = applyPaperObservation(
    account,
    [],
    { frames: [], funding: [history], incrementalFunding: true },
    "pass",
    now,
  );
  assert.equal(first.account.positions[0]!.openedAt, 1000);
  assert.equal(first.account.positions[0]!.fundingCoveredThrough, range.to);
  assert.equal(first.account.fundingPending, true);
  assert.equal(first.account.lastFundingAt, undefined);
  assert.equal(first.account.cash, "1001");
  const retry = applyPaperObservation(
    first.account,
    first.movements,
    { frames: [], funding: [{ ...history, complete: false }], incrementalFunding: true },
    "retry",
    now,
  );
  assert.equal(retry.account.positions[0]!.fundingCoveredThrough, range.to);
  assert.equal(retry.account.cash, "1001");
  const disputed = applyPaperObservation(
    account,
    first.movements,
    {
      frames: [],
      funding: [{ ...history, events: [{ ...history.events[0]!, rate: "0.02" }] }],
      incrementalFunding: true,
    },
    "changed",
    now,
  );
  assert.equal(disputed.account.fundingDisputed, true);
  assert.equal(disputed.account.positions[0]!.fundingCoveredThrough, undefined);
  assert.deepEqual(disputed.movements, []);
});

test("a failed historical page resumes after committed position cursors without booking partial cash", async (t) => {
  const f = await fixture(t, 5);
  await f.db.pool.query(
    "INSERT INTO pickler.paper_storage(account_id,mode,coverage_required) SELECT 'account','operational',max(closed_sequence) FROM pickler.perps_paper_positions",
  );
  let calls = 0;
  await assert.rejects(
    new PaperFundingEpochs(f.db.pool).pass(
      f.scope,
      async (position, from, to) => {
        if (++calls === 3) {
          throw new Error("controlled interruption");
        }
        return funding(position, from, to);
      },
      anchor,
    ),
    /controlled interruption/,
  );
  const staged = (
    await f.db.pool.query("SELECT cursor,owner,status FROM pickler.paper_funding_epochs")
  ).rows[0];
  assert.equal(Number(staged.cursor), 2);
  assert.equal(staged.owner, null);
  assert.equal((await f.repo.executionSnapshot(f.scope)).account.cash, "1000");
  let resumed = 0;
  const done = await new PaperFundingEpochs(f.db.pool).pass(
    f.scope,
    async (position, from, to) => {
      resumed++;
      return funding(position, from, to);
    },
    anchor,
  );
  assert.equal(done.kind, "complete");
  assert.equal(resumed, 3);
  assert.equal(Number((await f.repo.executionSnapshot(f.scope)).account.cash), 1005);
});

test("a close beyond a fixed anchor stays uncovered and a fresh epoch promptly catches up", async (t) => {
  const f = await fixture(t, 1);
  await f.db.pool.query(
    "INSERT INTO pickler.paper_storage(account_id,mode) VALUES('account','operational')",
  );
  const early = { number: 100, hash: "0x" + "a".repeat(64), timestamp: f.now - 2 };
  const late = { number: 200, hash: "0x" + "b".repeat(64), timestamp: f.now + 1 };
  const first = await new PaperFundingEpochs(f.db.pool).pass(
    f.scope,
    funding,
    async (expected) => expected ?? early,
  );
  assert.equal(first.kind, "complete");
  assert.equal((await f.repo.executionSnapshot(f.scope)).account.fundingPending, true);
  assert.equal((await f.repo.executionSnapshot(f.scope)).account.cash, "1000");
  const second = await new PaperFundingEpochs(f.db.pool).pass(
    f.scope,
    funding,
    async (expected) => expected ?? late,
  );
  assert.equal(second.kind, "complete");
  assert.equal(Number((await f.repo.executionSnapshot(f.scope)).account.cash), 1001);
  assert.equal((await f.repo.executionSnapshot(f.scope)).account.fundingPending, false);
  assert.equal(
    Number(
      (await f.db.pool.query("SELECT count(*) AS n FROM pickler.paper_funding_epochs")).rows[0].n,
    ),
    2,
  );
});
