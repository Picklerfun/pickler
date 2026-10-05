import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./studio-fixture-worker.js";
import type { Env } from "../src/env.js";

test("Studio fixture API rejects ordinary storage before composing services", async () => {
  const environment = {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://local:disposable@127.0.0.1:54522/postgres",
  } as Env;
  await assert.rejects(
    fixture.fetch(
      new Request("http://controlled/v1/studio/agents"),
      environment,
      {} as ExecutionContext,
    ),
    /dedicated Supabase database/,
  );
});
