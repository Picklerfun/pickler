import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./database.js";
import { reservePublicTokenRpc } from "../src/launch/public-trading.js";
test("public RPC global ceiling is atomic across different wallets and failed reservations roll back", async (t) => {
  const store = await createTestStore(t);
  const requests = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) => reservePublicTokenRpc(store.pool, "wallet" + i, 80)),
  );
  assert.equal(requests.filter((r) => r.status === "fulfilled").length, 2);
  const rows = await store.pool.query(
    "SELECT used FROM pickler.provider_quotas WHERE key='public-token-rpc'",
  );
  assert.equal(rows.rows[0].used, 80);
});
test("wallet minute throttle is shared across callers without resetting the daily ceiling", async (t) => {
  const store = await createTestStore(t);
  const requests = await Promise.allSettled(
    Array.from({ length: 10 }, () => reservePublicTokenRpc(store.pool, "visitor", 1000)),
  );
  assert.equal(requests.filter((r) => r.status === "fulfilled").length, 6);
  const rows = await store.pool.query(
    "SELECT used FROM pickler.provider_quotas WHERE key='public-token-rpc'",
  );
  assert.equal(rows.rows[0].used, 240);
});
