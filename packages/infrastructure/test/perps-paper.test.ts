import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "@pickler/core";
import { type PerpsPaperFill, paperUnits, type PerpsPaperScope } from "@pickler/trading/perps";
import { PostgresPerpsPaperStore } from "../src/persistence/perps-paper-store.js";
import { createTestStore } from "./database.js";
async function setup(t: TestContext) {
  let now = 1800000000000;
  const research = await createTestStore(t, () => now);
  const scope: PerpsPaperScope = {
    tenantId: "alpha",
    agentId: "pickle-alpha",
    sessionId: "test",
    network: "mainnet",
  };
  await research.updateConfig(scope, 1, {
    ...DEFAULT_CONFIG,
    perpl: { version: 1, network: "mainnet", markets: ["BTC", "ETH"] },
    perpsPaper: { version: 1, policy: "conservative-1x-v1" },
    plugins: { version: 1, enabled: ["perpl", "perps-paper"] },
  });
  const repo = new PostgresPerpsPaperStore(research.pool, () => now);
  const peer = new PostgresPerpsPaperStore(research.connectPeer().pool, () => now);
  return {
    research,
    scope,
    repo,
    peer,
    now: () => now,
    advance: (n: number) => {
      now += n;
    },
  };
}
const intent = {
  kind: "open" as const,
  symbol: "BTC" as const,
  side: "long" as const,
  notional: "100",
  feeReserve: "1",
};
const fill = (now: number): PerpsPaperFill => ({
  quantity: "0.001",
  price: "100000",
  notional: "100",
  fee: "0.1",
  block: 1,
  timestamp: now,
  evidence: { fixture: true },
});
test("parallel initialization grants capital exactly once and scope cannot cross accounts", async (t) => {
  const x = await setup(t);
  await Promise.all([x.repo.initialize(x.scope, 2), x.peer.initialize(x.scope, 2)]);
  const v = await x.repo.view(x.scope);
  assert.equal(v.account.cash, "1000");
  assert.equal(v.movements.length, 1);
  await assert.rejects(x.repo.view({ ...x.scope, tenantId: "beta" }));
  await assert.rejects(x.repo.view({ ...x.scope, network: "testnet" }));
  const other = await x.repo.initialize({ ...x.scope, sessionId: "other" }, 2);
  assert.equal(other.account.cash, "1000");
  const rls = await x.research.pool.query(
    "SELECT relrowsecurity FROM pg_class WHERE relname LIKE 'perps_paper_%' AND relkind='r'",
  );
  assert.ok(rls.rows.every((r) => r.relrowsecurity));
});
test("concurrent reservations have one owner and duplicate requests cannot refill", async (t) => {
  const x = await setup(t);
  await x.repo.initialize(x.scope, 2);
  const results = await Promise.all([
    x.repo.begin(x.scope, 2, "buy", intent),
    x.peer.begin(x.scope, 2, "buy", intent),
  ]);
  assert.equal(results.filter((r) => r.lease).length, 1);
  const lease = results.find((r) => r.lease)!.lease!;
  await assert.rejects(
    x.repo.begin(x.scope, 2, "buy", { ...intent, symbol: "ETH" }),
    /another intent/,
  );
  const other = await x.peer.begin(x.scope, 2, "other", { ...intent, symbol: "ETH" });
  assert.equal(other.attempt.status, "rejected");
  await x.repo.complete(x.scope, lease, fill(x.now()));
  const duplicate = await x.peer.begin(x.scope, 2, "buy", intent);
  assert.equal(duplicate.lease, null);
  assert.equal(duplicate.attempt.status, "filled");
  await assert.rejects(x.repo.complete(x.scope, lease, fill(x.now())), /lease/);
  const v = await x.repo.view(x.scope);
  assert.equal(v.account.cash, "999.9");
  assert.equal(v.account.positions.length, 1);
  assert.equal(v.movements.length, 2);
  assert.equal(
    v.movements.reduce((sum, m) => sum + paperUnits(m.delta), 0n),
    paperUnits(v.account.cash),
  );
});
test("lease expiration releases reservations without replay or allowing the old owner", async (t) => {
  const x = await setup(t);
  await x.repo.initialize(x.scope, 2);
  const a = await x.repo.begin(x.scope, 2, "expired", intent);
  x.advance(60000);
  const v = await x.peer.view(x.scope);
  assert.equal(v.attempts[0]!.status, "interrupted");
  assert.equal(v.attempts[0]!.reserved, "0");
  await assert.rejects(x.repo.complete(x.scope, a.lease!, fill(x.now())), /lease/);
  assert.equal((await x.repo.begin(x.scope, 2, "expired", intent)).lease, null);
});
test("revocation prevents finalization and failure can release the owned reservation", async (t) => {
  const x = await setup(t);
  await x.repo.initialize(x.scope, 2);
  const a = await x.repo.begin(x.scope, 2, "revoke", intent);
  const agent = await x.research.agent(x.scope);
  await x.research.updateConfig(x.scope, 2, {
    ...agent.config,
    plugins: { version: 1, enabled: [] },
  });
  await assert.rejects(x.repo.complete(x.scope, a.lease!, fill(x.now())), /configuration/);
  await x.repo.fail(x.scope, a.lease!, "CONFIG_CHANGED");
  const v = await x.repo.view(x.scope);
  assert.equal(v.account.cash, "1000");
  assert.equal(v.attempts[0]!.reserved, "0");
});
test("close is atomic, idempotent and does not double-release reserved margin", async (t) => {
  const x = await setup(t);
  await x.repo.initialize(x.scope, 2);
  const a = await x.repo.begin(x.scope, 2, "buy", intent);
  await x.repo.complete(x.scope, a.lease!, fill(x.now()));
  const closing = { ...intent, kind: "close" as const, notional: "0" };
  const c = await x.repo.begin(x.scope, 2, "close", closing);
  const v = await x.repo.complete(x.scope, c.lease!, {
    ...fill(x.now()),
    price: "110000",
    notional: "110",
    fee: "0.11",
    block: 2,
  });
  assert.equal(v.account.cash, "1009.79");
  assert.equal(v.account.positions[0]!.closedAt, x.now());
  assert.equal((await x.peer.begin(x.scope, 2, "close", closing)).lease, null);
  assert.equal((await x.repo.view(x.scope)).movements.length, 4);
});
