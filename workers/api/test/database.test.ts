import assert from "node:assert/strict";
import test from "node:test";
import { databasePoolConfig } from "@pickler/infrastructure";
import { apiDatabase } from "../src/database";
import { createServices } from "../src/container";
import type { Env } from "../src/env";

const env = {
  APP_ENV: "staging",
  DATABASE_URL: "must-not-be-used",
  DATABASE: {
    connectionString:
      "postgresql://user:secret@binding.hyperdrive.local:5432/postgres?sslmode=disable",
  },
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "test-only",
  JWT_ISSUER: "https://example.supabase.co/auth/v1",
} as Env;

test("API requires its binding in hosted environments even when a legacy URL exists", () => {
  const database = apiDatabase(env);
  assert.equal(database.url, env.DATABASE!.connectionString);
  assert.equal(database.options.transport, "hyperdrive");
  assert.equal(databasePoolConfig(database.url, database.options).max, 2);
  for (const APP_ENV of ["staging", "production", "preview"]) {
    assert.throws(
      () => apiDatabase({ ...env, APP_ENV, DATABASE: undefined } as unknown as Env),
      /binding unavailable/,
    );
  }
});

test("API local transport requires an explicit loopback URL", () => {
  const local = {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:54522/postgres",
  } as Env;
  const database = apiDatabase(local);
  assert.equal(databasePoolConfig(database.url, database.options).ssl, false);
  assert.throws(() => apiDatabase({ APP_ENV: "local" } as Env), /Missing local/);
  assert.throws(
    () => databasePoolConfig("postgresql://test:test@example.com:5432/postgres", database.options),
    /loopback/,
  );
});

test("API composition allocates independent services without model credentials or network calls", async () => {
  const first = createServices(env);
  const second = createServices(env);
  try {
    assert.notEqual(first.console!.repository, second.console!.repository);
    assert.equal(first.console!.admissionsEnabled, false);
    assert.ok(first.launches);
    assert.equal(first.launches.pool, first.console!.repository.pool);
    assert.notEqual(first.launches.pool, second.launches!.pool);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
