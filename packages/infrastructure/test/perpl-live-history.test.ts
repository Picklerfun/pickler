import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type Pool } from "pg";
import {
  emptyPerplLiveDocument,
  type PerplLiveDocument,
  type PerplLiveOrder,
  type PerplLiveSession,
} from "@pickler/trading/perpl-live";
import { PostgresPerplLiveStore } from "../src/persistence/perpl-live-store.js";
import { PerplLiveMigration } from "../src/persistence/perpl-live-migration.js";
import { tokenFixture } from "./token-fixture.js";

const terms = {
  symbol: "BTC" as const,
  marginMicros: "5000000",
  leverage: 1 as const,
  cycles: 1,
  holdSeconds: 30,
};
function session(now: number): PerplLiveSession {
  return {
    id: randomUUID(),
    key: randomUUID(),
    settings: terms,
    configVersion: 1,
    status: "completed",
    completedCycles: 1,
    openedAt: null,
    createdAt: now,
    error: null,
    signalSource: "controlled-sequence-v1",
  };
}
function order(s: PerplLiveSession, rq: number): PerplLiveOrder {
  return {
    id: randomUUID(),
    sessionId: s.id,
    request: { rq, acc: 7, mkt: 16, t: 1, p: 0, s: 100, fl: 4, ms: 100, lv: 100, lb: 200 },
    market: {
      id: 16,
      symbol: "BTC",
      mark: 1000000,
      priceDecimals: 1,
      sizeDecimals: 5,
      maxLeverage: 15,
      maxSlippageBps: 100,
      ttlBlocks: 20,
      takerFeeMicros: 345,
    },
    status: "cancelled",
    createdAt: s.createdAt,
    submittedAt: null,
    evidence: null,
    verifiedTxHashes: [],
    error: null,
  };
}
async function writer(pool: Pool, sql: string, values: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('pickler.perpl_writer_version','2',true)");
    const result = await client.query(sql, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function legacy(pool: Pool, agent: string, address: string, count = 125) {
  const now = Date.now() - 2 * 86400000;
  const s = session(now);
  const document: PerplLiveDocument = {
    ...emptyPerplLiveDocument(address, agent),
    accountId: 7,
    encryptedKey: "controlled-encrypted",
    encryptedToken: "controlled-encrypted",
    publicKey: "controlled-public",
    keyExpiresAt: Date.now() + 86400000,
    nextRequestId: count,
    sessions: [s],
    orders: Array.from({ length: count }, (_, i) => order(s, i + 1)),
    setup: Array.from({ length: count }, () => ({
      id: randomUUID(),
      key: randomUUID(),
      kind: "deposit" as const,
      status: "failed" as const,
      amountMicros: "0",
      createdAt: now,
      activity: null,
      privatePreparation: null,
      activityId: null,
      txHash: null,
      error: "CONTROLLED",
    })),
  };
  await writer(
    pool,
    "INSERT INTO pickler.perpl_live_accounts(product_agent_id,document) VALUES($1,$2) ON CONFLICT(product_agent_id) DO UPDATE SET document=$2,storage_mode='legacy',operational=NULL",
    [agent, document],
  );
  return document;
}

test("server-side normalization resumes each phase, preserves evidence and fences old writers", async (t) => {
  const f = await tokenFixture(t);
  const scope = { userId: f.scope.userId, productAgentId: f.scope.agentId };
  const repo = new PostgresPerplLiveStore(f.store.pool);
  const address = (await repo.read(scope)).authority.address;
  const original = await legacy(f.store.pool, scope.productAgentId, address);
  let migration = new PerplLiveMigration(f.store.pool);
  assert.equal((await migration.inspect(scope.productAgentId)).storage_mode, "legacy");
  assert.equal((await migration.begin(scope.productAgentId)).storage_mode, "converting");
  await assert.rejects(
    f.store.pool.query(
      "UPDATE pickler.perpl_live_accounts SET document=document WHERE product_agent_id=$1",
      [scope.productAgentId],
    ),
    { code: "55000" },
  );
  await assert.rejects(repo.inspectKeyChange(scope, {}), { code: "PERPL_MIGRATION_BUSY" });
  let progress = await migration.page(scope.productAgentId);
  assert.equal(progress.phase, "orders");
  migration = new PerplLiveMigration(f.store.connectPeer().pool);
  progress = await migration.page(scope.productAgentId);
  assert.equal(progress.offset, 100);
  assert.equal(
    (await f.store.pool.query("SELECT count(*)::int AS n FROM pickler.perpl_live_orders")).rows[0]
      .n,
    100,
  );
  migration = new PerplLiveMigration(f.store.pool);
  progress = await migration.page(scope.productAgentId);
  assert.equal(progress.phase, "setup");
  assert.equal((await migration.page(scope.productAgentId)).offset, 100);
  migration = new PerplLiveMigration(f.store.connectPeer().pool);
  assert.equal((await migration.page(scope.productAgentId)).phase, "ready");
  await migration.cutover(scope.productAgentId);
  await migration.cutover(scope.productAgentId);
  const state = await repo.read(scope);
  assert.equal(state.document!.orders.length, 100);
  assert.equal(state.document!.nextRequestId, 125);
  assert.deepEqual(
    (await repo.history(scope, "orders")).items,
    original.orders.slice(-100).reverse(),
  );
  const first = await repo.history(scope, "orders");
  const second = await repo.history(scope, "orders", first.nextCursor!);
  assert.equal(second.items.length, 25);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(await repo.requestMembership(scope, [1, 125, 126]), [
    { requestId: 1, orderType: 1, sessionId: original.sessions[0]!.id },
    { requestId: 125, orderType: 1, sessionId: original.sessions[0]!.id },
  ]);
  await assert.rejects(
    f.store.pool.query(
      "UPDATE pickler.perpl_live_accounts SET document=document WHERE product_agent_id=$1",
      [scope.productAgentId],
    ),
    { code: "55000" },
  );
  // New normalized evidence after cutover must survive a controlled reconstruction.
  await writer(
    f.store.pool,
    "UPDATE pickler.perpl_live_orders SET status='filled',filled_size=100,document=jsonb_set(jsonb_set(document,'{status}','\"filled\"'),'{evidence}', $2::jsonb) WHERE product_agent_id=$1 AND request_id=1",
    [scope.productAgentId, JSON.stringify({ filledSize: 100, txHashes: ["controlled-fill"] })],
  );
  await writer(
    f.store.pool,
    "UPDATE pickler.perpl_live_accounts SET operational=jsonb_set(operational,'{nextRequestId}','126'::jsonb) WHERE product_agent_id=$1",
    [scope.productAgentId],
  );
  const closing = {
    ...original.orders[0]!,
    id: randomUUID(),
    request: { ...original.orders[0]!.request, rq: 126, t: 3 },
    status: "filled",
    evidence: { filledSize: 100, txHashes: ["controlled-close"] },
  };
  await f.store.pool.query(
    `INSERT INTO pickler.perpl_live_orders(product_agent_id,id,session_id,request_id,order_type,status,created_at,filled_size,leverage,document) VALUES($1,$2,$3,126,3,'filled',$4,100,100,$5)`,
    [scope.productAgentId, closing.id, closing.sessionId, closing.createdAt, closing],
  );
  await f.store.pool.query(
    "UPDATE pickler.perpl_live_sessions SET order_count=126,net_filled=0,opening_request_id=1,opening_leverage=100 WHERE product_agent_id=$1",
    [scope.productAgentId],
  );
  await migration.rollback(scope.productAgentId);
  const rolled = await repo.read(scope);
  assert.equal(rolled.document!.nextRequestId, 126);
  assert.equal(rolled.document!.orders[0]!.evidence!.filledSize, 100);
  assert.equal(rolled.document!.orders.length, 126);
  assert.equal(rolled.document!.orders.at(-1)!.evidence!.filledSize, 100);
  await assert.rejects(
    f.store.pool.query(
      "UPDATE pickler.perpl_live_accounts SET document=document WHERE product_agent_id=$1",
      [scope.productAgentId],
    ),
    { code: "55000" },
  );
});

test("migration defers active or ambiguous work and parity failures cannot cut over", async (t) => {
  const f = await tokenFixture(t);
  const scope = { userId: f.scope.userId, productAgentId: f.scope.agentId };
  const repo = new PostgresPerplLiveStore(f.store.pool);
  const doc = await legacy(
    f.store.pool,
    scope.productAgentId,
    (await repo.read(scope)).authority.address,
    1,
  );
  const migration = new PerplLiveMigration(f.store.pool);
  doc.orders[0]!.status = "unknown";
  await writer(
    f.store.pool,
    "UPDATE pickler.perpl_live_accounts SET document=$2 WHERE product_agent_id=$1",
    [scope.productAgentId, doc],
  );
  assert.equal((await migration.begin(scope.productAgentId)).reason, "ACTIVE_OR_UNCERTAIN_WORK");
  doc.orders[0]!.status = "cancelled";
  await writer(
    f.store.pool,
    "UPDATE pickler.perpl_live_accounts SET document=$2 WHERE product_agent_id=$1",
    [scope.productAgentId, doc],
  );
  await migration.begin(scope.productAgentId);
  await migration.page(scope.productAgentId);
  await migration.page(scope.productAgentId);
  await migration.page(scope.productAgentId);
  await f.store.pool.query(
    "UPDATE pickler.perpl_live_orders SET document=jsonb_set(document,'{error}','\"changed\"')",
  );
  await assert.rejects(migration.cutover(scope.productAgentId), { code: "PERPL_MIGRATION_PARITY" });
  assert.equal((await migration.inspect(scope.productAgentId)).storage_mode, "converting");
  await migration.abort(scope.productAgentId);
  assert.equal((await migration.inspect(scope.productAgentId)).storage_mode, "legacy");
});

test("100000 historical orders stay out of operational mutations, daily sums and request membership remain exact", async (t) => {
  const f = await tokenFixture(t);
  const scope = { userId: f.scope.userId, productAgentId: f.scope.agentId };
  const repo = new PostgresPerplLiveStore(f.store.pool);
  const original = await repo.inspectKeyChange(scope, {});
  await repo.connectKey(scope, {
    original,
    useKeyWallet: false,
    connected: {
      accountId: 7,
      publicKey: "controlled",
      encryptedKey: "controlled",
      encryptedToken: "controlled",
      snapshot: {
        instanceId: 1,
        lockedMicros: "0",
        unmanagedOrders: false,
        accountId: 7,
        forwarding: true,
        frozen: false,
        balanceMicros: "100000000",
        lastRequestId: 100000,
        head: 100,
        at: Date.now(),
        markets: [],
        positions: [],
        orders: [],
      },
    },
  });
  const s = session(Date.now() - 2 * 86400000);
  const sample = order(s, 1);
  await f.store.pool.query(
    `INSERT INTO pickler.perpl_live_sessions(product_agent_id,id,request_key,status,created_at,margin_micros,document) VALUES($1,$2,$3,'completed',$4,$5,$6)`,
    [scope.productAgentId, s.id, s.key, s.createdAt, s.settings.marginMicros, s],
  );
  await f.store.pool.query(
    `INSERT INTO pickler.perpl_live_orders(product_agent_id,id,session_id,request_id,order_type,status,created_at,leverage,document)
 SELECT $1,'old-'||i,$2,i,1,'cancelled',$3,100,$4::jsonb||jsonb_build_object('id','old-'||i,'request',($4::jsonb->'request')||jsonb_build_object('rq',i)) FROM generate_series(1,100000) i`,
    [scope.productAgentId, s.id, s.createdAt, sample],
  );
  const claim = await repo.claimLease(scope, { owner: "controlled-lease" });
  assert.equal(claim!.document.orders.length, 1);
  assert.equal(claim!.document.facts!.entryDayMicros, "0");
  assert.equal(JSON.stringify(claim).length < 10000, true);
  await repo.releaseLease(scope, { owner: "controlled-lease" });
  const state = await repo.read(scope);
  assert.equal(state.document!.orders.length, 100);
  assert.equal(JSON.stringify(state).length < 200000, true);
  assert.equal((await repo.history(scope, "orders")).items.length, 100);
  await assert.rejects(
    repo.requestMembership(
      scope,
      Array.from({ length: 4001 }, (_, i) => i),
    ),
    { code: "INVALID_INPUT" },
  );
  await f.store.pool.query(
    "UPDATE pickler.perpl_live_orders SET status='unknown',document=jsonb_set(document,'{status}','\"unknown\"') WHERE product_agent_id=$1 AND request_id=1",
    [scope.productAgentId],
  );
  const withOldPending = (await repo.read(scope)).document!;
  assert.equal(withOldPending.orders.length, 101);
  assert.deepEqual(
    withOldPending.orders.slice(-100).map((o) => o.request.rq),
    Array.from({ length: 100 }, (_, i) => 99901 + i),
  );
  await f.store.pool.query(
    "UPDATE pickler.perpl_live_orders SET status='cancelled',document=jsonb_set(document,'{status}','\"cancelled\"') WHERE product_agent_id=$1 AND request_id=1",
    [scope.productAgentId],
  );

  assert.equal((await repo.requestMembership(scope, [1, 50000, 100000])).length, 3);
  assert.equal(
    (await repo.startSession(scope, { settings: terms, key: s.key, id: randomUUID() })).id,
    s.id,
  );
  await assert.rejects(repo.startSession(scope, { settings: terms, key: randomUUID(), id: s.id }), {
    code: "PERPL_EVIDENCE_MISMATCH",
  });
  await f.store.pool.query(
    "UPDATE pickler.perpl_live_orders SET document=jsonb_set(document,'{verifiedTxHashes}','[\"controlled-verified-hash\"]') WHERE product_agent_id=$1 AND request_id=1",
    [scope.productAgentId],
  );
  assert.deepEqual(await repo.verifiedTransactions(scope, [1, 2]), ["controlled-verified-hash"]);

  const setupSample = {
    id: randomUUID(),
    key: "controlled-setup",
    kind: "approve",
    status: "failed",
    amountMicros: "0",
    createdAt: s.createdAt,
    activity: null,
    privatePreparation: null,
    activityId: null,
    txHash: null,
    error: null,
  };
  await f.store.pool.query(
    `INSERT INTO pickler.perpl_live_setup(product_agent_id,id,request_key,kind,status,created_at,amount_micros,document)
    SELECT $1,id::text,'setup-'||i,'approve',CASE WHEN i=1 THEN 'awaiting_signature' ELSE 'failed' END,$2,'0',
      $3::jsonb||jsonb_build_object('id',id,'key','setup-'||i,'status',CASE WHEN i=1 THEN 'awaiting_signature' ELSE 'failed' END)
    FROM (SELECT i,gen_random_uuid() AS id FROM generate_series(1,101) i) seed`,
    [scope.productAgentId, s.createdAt, setupSample],
  );
  const setupContext = (await repo.read(scope)).document!.setup;
  assert.equal(setupContext.length, 101);
  assert.equal(setupContext[0]!.status, "awaiting_signature");
  assert.equal(
    setupContext.slice(-100).every((step) => step.status === "failed"),
    true,
  );
  await f.store.pool.query(
    "UPDATE pickler.perpl_live_setup SET status='failed',document=jsonb_set(document,'{status}','\"failed\"') WHERE product_agent_id=$1 AND status='awaiting_signature'",
    [scope.productAgentId],
  );
  const started = await repo.startSession(scope, {
    settings: terms,
    key: randomUUID(),
    id: randomUUID(),
  });
  assert.equal(started.status, "active");
  assert.equal((await repo.read(scope)).document!.nextRequestId, 100000);
  const pending = await repo.reserveWakeups("publisher-a");
  assert.equal(pending.length, 1);
  // A crash before acknowledgement does not permit another immediate publication.
  assert.equal((await repo.reserveWakeups("publisher-b")).length, 0);
  await repo.acknowledgeWakeup(scope, "publisher-a", pending[0]!.generation);
  assert.equal(await repo.claimWakeup(scope, "publisher-a", pending[0]!.generation), true);
  assert.equal(await repo.claimWakeup(scope, "publisher-a", pending[0]!.generation), false);
  await f.store.pool.query(
    "UPDATE pickler.perpl_live_accounts SET wake_expires_at=0 WHERE product_agent_id=$1",
    [scope.productAgentId],
  );
  const redrive = await repo.reserveWakeups("publisher-b");
  assert.equal(redrive.length, 1);
  assert.equal(await repo.claimWakeup(scope, "publisher-a", redrive[0]!.generation), false);
  assert.equal(await repo.claimWakeup(scope, "publisher-b", redrive[0]!.generation), true);
  // Both original budget predicates use original session margin and order creation day.
  await f.store.pool.query(
    `UPDATE pickler.perpl_live_orders SET created_at=(extract(epoch FROM clock_timestamp())*1000)::bigint WHERE product_agent_id=$1 AND request_id IN (1,2)`,
    [scope.productAgentId],
  );
  const budget = await repo.claimLease(scope, { owner: "budget" });
  assert.equal(budget!.document.facts!.entryDayMicros, "10000000");
  assert.equal(budget!.document.facts!.noncancelledEntryDayMicros, "0");
});

test("split-state partial fills retain net ownership, unknown requests never resend and IDs stay monotonic", async (t) => {
  const f = await tokenFixture(t);
  const scope = { userId: f.scope.userId, productAgentId: f.scope.agentId };
  const repo = new PostgresPerplLiveStore(f.store.pool);
  const original = await repo.inspectKeyChange(scope, {});
  const now = Date.now();
  const market = order(session(now), 1).market;
  const snapshot = {
    instanceId: 1,
    lockedMicros: "0",
    unmanagedOrders: false,
    accountId: 7,
    forwarding: true,
    frozen: false,
    balanceMicros: "100000000",
    lastRequestId: 200,
    head: 100,
    at: now,
    markets: [market],
    positions: [] as NonNullable<PerplLiveDocument["snapshot"]>["positions"],
    orders: [] as NonNullable<PerplLiveDocument["snapshot"]>["orders"],
  };
  await repo.connectKey(scope, {
    original,
    useKeyWallet: false,
    connected: {
      accountId: 7,
      publicKey: "controlled",
      encryptedKey: "controlled",
      encryptedToken: "controlled",
      snapshot,
    },
  });
  await repo.startSession(scope, { settings: terms, key: randomUUID(), id: randomUUID() });
  await repo.claimLease(scope, { owner: "first" });
  const opening = await repo.reserveOrder(scope, {
    owner: "first",
    snapshot,
    verified: [],
    admissions: true,
    id: randomUUID(),
  });
  assert.equal(opening!.order.request.rq, 201);
  await repo.beginDispatch(scope, {
    owner: "first",
    increasing: true,
    head: 101,
    snapshotHead: 100,
    orderId: opening!.order.id,
  });
  await repo.completeDispatch(scope, {
    owner: "first",
    orderId: opening!.order.id,
    status: "unknown",
  });
  await repo.releaseLease(scope, { owner: "first" });
  await repo.claimLease(scope, { owner: "second" });
  assert.equal(
    await repo.reserveOrder(scope, {
      owner: "second",
      snapshot,
      verified: [],
      admissions: true,
      id: randomUUID(),
    }),
    null,
  );
  assert.equal((await repo.history(scope, "orders")).items.length, 1);
  await repo.controlSession(scope, { action: "close", admissions: false });
  const size = Math.floor(opening!.order.request.s / 2);
  snapshot.at = Date.now();
  snapshot.lastRequestId = 201;
  snapshot.orders = [
    {
      originalSize: opening!.order.request.s,
      leverage: 100,
      requestId: 201,
      accountId: 7,
      marketId: 16,
      orderId: 901,
      type: 1,
      status: "partial",
      filledSize: size,
      fillPrice: market.mark,
      feeMicros: "1",
      txHashes: [],
    },
  ];
  snapshot.positions = [
    {
      requestId: 201,
      id: 8,
      marketId: 16,
      side: "long",
      size,
      entryPrice: market.mark,
      collateralMicros: "2500000",
      leverage: 100,
      feeMicros: "1",
      realizedPnlMicros: null,
      fundingMicros: null,
      exitPrice: null,
      closed: false,
    },
  ];
  const closing = await repo.reserveOrder(scope, {
    owner: "second",
    snapshot,
    verified: [],
    admissions: false,
    id: randomUUID(),
  });
  assert.equal(closing!.order.request.rq, 202);
  assert.equal(closing!.order.request.t, 3);
  assert.equal(closing!.order.request.s, size);
  const rowVersion = async () =>
    (
      await f.store.pool.query(
        "SELECT xmin::text AS version FROM pickler.perpl_live_orders WHERE product_agent_id=$1 AND request_id=201",
        [scope.productAgentId],
      )
    ).rows[0].version;
  const beforeVersion = await rowVersion();
  assert.equal(
    await repo.reserveOrder(scope, {
      owner: "second",
      snapshot,
      verified: [],
      admissions: false,
      id: randomUUID(),
    }),
    null,
  );
  assert.equal(await rowVersion(), beforeVersion);

  const compact = await f.store.pool.query(
    "SELECT operational#>'{snapshot,orders}' AS orders FROM pickler.perpl_live_accounts WHERE product_agent_id=$1",
    [scope.productAgentId],
  );
  assert.deepEqual(compact.rows[0].orders, []);

  const projection = await f.store.pool.query(
    "SELECT net_filled::text,order_count::text,opening_leverage FROM pickler.perpl_live_sessions WHERE product_agent_id=$1",
    [scope.productAgentId],
  );
  assert.equal(projection.rows[0].net_filled, String(size));
  assert.equal(projection.rows[0].order_count, "2");
  assert.equal(projection.rows[0].opening_leverage, 100);

  await writer(
    f.store.pool,
    "UPDATE pickler.perpl_live_accounts SET operational=jsonb_set(operational,'{lease,expiresAt}','0') WHERE product_agent_id=$1",
    [scope.productAgentId],
  );
  const takeover = await repo.claimLease(scope, { owner: "recovered-exit" });
  assert.equal(
    takeover!.document.orders.find((order) => order.id === closing!.order.id)!.status,
    "cancelled",
  );
  assert.equal(takeover!.document.sessions.at(-1)!.retryExitOrderId, closing!.order.id);
  assert.equal(takeover!.document.facts!.entryDayMicros, "5000000");
  assert.equal(takeover!.document.facts!.noncancelledEntryDayMicros, "5000000");
  await assert.rejects(
    repo.beginDispatch(scope, {
      owner: "second",
      increasing: false,
      head: 102,
      snapshotHead: 100,
      orderId: closing!.order.id,
    }),
    { code: "PERPL_LEASE_LOST" },
  );
  snapshot.at = Date.now();
  const retry = await repo.reserveOrder(scope, {
    owner: "recovered-exit",
    snapshot,
    verified: [],
    admissions: false,
    id: randomUUID(),
  });
  assert.equal(retry!.order.request.rq, 203);
  assert.equal(retry!.order.request.s, size);
  assert.equal(retry!.order.request.lv, 100);
  await repo.beginDispatch(scope, {
    owner: "recovered-exit",
    increasing: false,
    head: 102,
    snapshotHead: 100,
    orderId: retry!.order.id,
  });
  await repo.completeDispatch(scope, {
    owner: "recovered-exit",
    orderId: retry!.order.id,
    status: "accepted",
  });
  await repo.releaseLease(scope, { owner: "recovered-exit" });
  await repo.claimLease(scope, { owner: "third" });
  // A foreign addition cannot become this session's exit target.
  snapshot.positions[0]!.size++;
  snapshot.orders.push({
    originalSize: size,
    leverage: 100,
    requestId: 203,
    accountId: 7,
    marketId: 16,
    orderId: 902,
    type: 3,
    status: "rejected",
    filledSize: 0,
    fillPrice: 0,
    feeMicros: "0",
    txHashes: [],
  });
  assert.equal(
    await repo.reserveOrder(scope, {
      owner: "third",
      snapshot,
      verified: [],
      admissions: false,
      id: randomUUID(),
    }),
    null,
  );
  assert.equal((await repo.read(scope)).document!.sessions.at(-1)!.status, "frozen");
  assert.equal((await repo.history(scope, "orders")).items.length, 3);
});

test("normalized crash recovery freezes unsent entries, preserves both budgets and never resends dispatch ambiguity", async (t) => {
  const f = await tokenFixture(t);
  const scope = { userId: f.scope.userId, productAgentId: f.scope.agentId };
  const repo = new PostgresPerplLiveStore(f.store.pool);
  const original = await repo.inspectKeyChange(scope, {});
  const snapshot = {
    instanceId: 1,
    lockedMicros: "0",
    unmanagedOrders: false,
    accountId: 7,
    forwarding: true,
    frozen: false,
    balanceMicros: "100000000",
    lastRequestId: 0,
    head: 100,
    at: Date.now(),
    markets: [order(session(Date.now()), 1).market],
    positions: [],
    orders: [],
  };
  await repo.connectKey(scope, {
    original,
    useKeyWallet: false,
    connected: {
      accountId: 7,
      publicKey: "controlled",
      encryptedKey: "controlled",
      encryptedToken: "controlled",
      snapshot,
    },
  });
  await repo.startSession(scope, { settings: terms, key: randomUUID(), id: randomUUID() });
  await repo.claimLease(scope, { owner: "crashed-before-dispatch" });
  const entry = await repo.reserveOrder(scope, {
    owner: "crashed-before-dispatch",
    snapshot,
    verified: [],
    admissions: true,
    id: randomUUID(),
  });
  assert.equal(entry!.order.request.rq, 1);
  assert.equal(await repo.claimLease(scope, { owner: "not-yet-expired" }), null);
  const expire = () =>
    writer(
      f.store.pool,
      "UPDATE pickler.perpl_live_accounts SET operational=jsonb_set(operational,'{lease,expiresAt}','0') WHERE product_agent_id=$1",
      [scope.productAgentId],
    );
  await expire();
  const recovered = await repo.claimLease(scope, { owner: "recovered" });
  assert.equal(recovered!.document.orders[0]!.status, "cancelled");
  assert.equal(recovered!.document.sessions[0]!.status, "frozen");
  assert.equal(recovered!.document.facts!.entryDayMicros, "5000000");
  assert.equal(recovered!.document.facts!.noncancelledEntryDayMicros, "0");
  await repo.controlSession(scope, { action: "stop", admissions: false });
  assert.equal(
    await repo.reserveOrder(scope, {
      owner: "recovered",
      snapshot,
      verified: [],
      admissions: false,
      id: randomUUID(),
    }),
    null,
  );
  await repo.releaseLease(scope, { owner: "recovered" });
  await repo.startSession(scope, { settings: terms, key: randomUUID(), id: randomUUID() });
  await repo.claimLease(scope, { owner: "crashed-at-dispatch" });
  snapshot.at = Date.now();
  const ambiguous = await repo.reserveOrder(scope, {
    owner: "crashed-at-dispatch",
    snapshot,
    verified: [],
    admissions: true,
    id: randomUUID(),
  });
  assert.equal(ambiguous!.order.request.rq, 2);
  await repo.beginDispatch(scope, {
    owner: "crashed-at-dispatch",
    increasing: true,
    head: 101,
    snapshotHead: 100,
    orderId: ambiguous!.order.id,
  });
  await expire();
  const takeover = await repo.claimLease(scope, { owner: "reconcile-only" });
  assert.equal(
    takeover!.document.orders.find((order) => order.id === ambiguous!.order.id)!.status,
    "dispatching",
  );
  assert.equal(
    await repo.reserveOrder(scope, {
      owner: "reconcile-only",
      snapshot,
      verified: [],
      admissions: true,
      id: randomUUID(),
    }),
    null,
  );
  await assert.rejects(
    repo.beginDispatch(scope, {
      owner: "reconcile-only",
      increasing: true,
      head: 102,
      snapshotHead: 100,
      orderId: ambiguous!.order.id,
    }),
    { code: "PERPL_ORDER_NOT_PREPARED" },
  );
  const state = (await repo.read(scope)).document!;
  assert.equal(state.orders.length, 2);
  assert.equal(state.orders.at(-1)!.status, "unknown");
  assert.equal(state.nextRequestId, 2);
});
