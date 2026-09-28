import assert from "node:assert/strict";
import test from "node:test";
import { createServices, delegatedPublicKeyFrom } from "../src/container";
import type { Env } from "../src/env";

const env = {
  APP_ENV: "staging",
  DATABASE: {
    connectionString:
      "postgresql://user:secret@binding.hyperdrive.local:5432/postgres?sslmode=disable",
  },
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "test-only",
  JWT_ISSUER: "https://example.supabase.co/auth/v1",
  MODEL_ID: "m",
  MODEL_API_KEY: "test-only",
} as Env;

test("a malformed model base URL turns drafting off and leaves the rest of the API composed", async () => {
  const services = createServices({ ...env, MODEL_BASE_URL: "not a url" });
  try {
    assert.equal(services.studio!.drafter, null);
    assert.ok(services.studio!.repository);
    assert.ok(services.authenticate);
    assert.ok(services.profiles);
  } finally {
    await services.close();
  }
});

test("a valid model base URL composes a drafter; a missing one composes none", async () => {
  const configured = createServices({ ...env, MODEL_BASE_URL: "https://model.example/v1" });
  const missing = createServices(env);
  try {
    assert.equal(typeof configured.studio!.drafter?.draft, "function");
    assert.equal(missing.studio!.drafter, null);
  } finally {
    await Promise.all([configured.close(), missing.close()]);
  }
});

test("the delegated public key is used only when it is a compressed P-256 key", () => {
  const logged: string[] = [];
  const log = (message: string) => logged.push(message);
  const valid = `02${"ab".repeat(32)}`;

  assert.equal(delegatedPublicKeyFrom({ TURNKEY_DELEGATED_API_PUBLIC_KEY: valid }, log), valid);
  assert.equal(delegatedPublicKeyFrom({}, log), null);
  assert.deepEqual(logged, []);

  const malformed = `04${"ab".repeat(64)}`;
  assert.equal(delegatedPublicKeyFrom({ TURNKEY_DELEGATED_API_PUBLIC_KEY: malformed }, log), null);
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /TURNKEY_DELEGATED_API_PUBLIC_KEY/);
  assert.equal(logged[0]!.includes(malformed), false, "the value is never logged");
});
