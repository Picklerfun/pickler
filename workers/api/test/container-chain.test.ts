import assert from "node:assert/strict";
import test from "node:test";
import { DepositsUnavailableError } from "@pickler/core";
import { createTestStore } from "@pickler/infrastructure/testing";
import { createApp } from "../src/app";
import { createServices } from "../src/container";
import type { Env } from "../src/env";
import { HttpError } from "../src/http/http-error";

const ADDRESS = "0x1111111111111111111111111111111111111111";

const base = {
  APP_ENV: "local",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "test-only",
  JWT_ISSUER: "https://example.supabase.co/auth/v1",
  TURNKEY_API_PUBLIC_KEY: `02${"ab".repeat(32)}`,
  TURNKEY_API_PRIVATE_KEY: "cd".repeat(32),
  TURNKEY_PARENT_ORG_ID: "parent",
  TURNKEY_RPID: "localhost",
  TURNKEY_APP_NAME: "Pickler",
} as Env;

for (const CHAIN_ID of ["1", "abc"]) {
  test(`CHAIN_ID=${CHAIN_ID} turns balances and deposits off and leaves the rest serving`, async (t) => {
    const store = await createTestStore(t);
    const logged: unknown[] = [];
    t.mock.method(console, "error", (...line: unknown[]) => logged.push(line));
    const env = { ...base, CHAIN_ID, DATABASE_URL: store.pool.options.connectionString } as Env;

    const services = createServices(env);
    const app = createApp(services);

    for (const path of [
      "/v1/health",
      "/v1/marketplace/agents",
      "/v1/handles/somebody/availability",
    ]) {
      const response = await app.request(path, {}, env);
      assert.equal(response.status, 200, path);
    }
    await assert.rejects(services.studio!.balances.read(ADDRESS), {
      code: "BALANCES_UNAVAILABLE",
    });
    await assert.rejects(
      services.studio!.custody!("request-1").prepareDeposit("user", "agent", 10),
      DepositsUnavailableError,
    );
    await assert.rejects(
      services.custody!.balances.read(ADDRESS),
      (error) =>
        error instanceof HttpError &&
        error.status === 503 &&
        error.extras?.error === "balances_unavailable",
    );
    await services.close();
    assert.match(JSON.stringify(logged), /CHAIN_ID/);
  });
}

test("a supported CHAIN_ID composes the balance reader and deposits", async (t) => {
  const store = await createTestStore(t);
  const env = { ...base, DATABASE_URL: store.pool.options.connectionString } as Env;

  const services = createServices(env);

  try {
    assert.equal(typeof services.studio!.balances.read, "function");
    // Past the chain check: the person has no custody account in an empty database.
    await assert.rejects(
      services.studio!.custody!("request-1").prepareDeposit(
        "00000000-0000-4000-8000-000000000000",
        "agent",
        10,
      ),
      { name: "NoCustodyAccountError" },
    );
  } finally {
    await services.close();
  }
});

test("TURNKEY_RPID on Mera's relying party turns custody off and leaves the rest serving", async (t) => {
  const store = await createTestStore(t);
  const logged: unknown[] = [];
  t.mock.method(console, "error", (...line: unknown[]) => logged.push(line));
  const env = {
    ...base,
    TURNKEY_RPID: "pickler.fun",
    DATABASE_URL: store.pool.options.connectionString,
  } as Env;

  const services = createServices(env);
  const app = createApp(services);

  try {
    assert.equal(services.custody, undefined);
    assert.equal((await app.request("/v1/health", {}, env)).status, 200);
    assert.equal((await app.request("/v1/signing/wallets", {}, env)).status, 404);
    assert.match(JSON.stringify(logged), /TURNKEY_RPID is refused \(shared_with_mera\)/);
  } finally {
    await services.close();
  }
});
