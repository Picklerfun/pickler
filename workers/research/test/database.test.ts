import test from "node:test";
import assert from "node:assert/strict";
import { researchDatabase } from "../src/database.js";
import type { Env } from "../src/index.js";

test("research uses the binding and never silently falls back to a hosted secret", () => {
  const env = {
    APP_ENV: "staging",
    DATABASE_URL: "unused-secret",
    DATABASE: {
      connectionString: "postgresql://user:secret@binding.hyperdrive.local:5432/postgres",
    },
    ALLOW_INSECURE_STAGING_DATABASE: "true",
  } as unknown as Env;
  assert.deepEqual(researchDatabase(env), {
    url: env.DATABASE!.connectionString,
    options: { environment: "staging", transport: "hyperdrive" },
  });
  assert.throws(
    () => researchDatabase({ ...env, DATABASE: undefined } as unknown as Env),
    /binding unavailable/,
  );
  assert.deepEqual(researchDatabase({ APP_ENV: "local", DATABASE_URL: "local" } as Env), {
    url: "local",
    options: { environment: "local" },
  });
});
