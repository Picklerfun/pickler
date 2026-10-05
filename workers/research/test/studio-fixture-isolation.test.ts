import assert from "node:assert/strict";
import test from "node:test";
import researchFixture from "./studio-fixture-worker.js";
import type { Env as ResearchEnv } from "../src/index.js";

test("Studio fixture HTTP, Queue and Cron reject ordinary storage before composition", async () => {
  const environment = {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://local:disposable@127.0.0.1:54522/postgres",
  };
  const ctx = {} as ExecutionContext;
  await assert.rejects(
    researchFixture.fetch(new Request("http://controlled/dispatch"), environment as ResearchEnv),
    /dedicated Supabase database/,
  );
  await assert.rejects(
    researchFixture.queue({} as never, environment as ResearchEnv, ctx),
    /dedicated Supabase database/,
  );
  await assert.rejects(
    researchFixture.scheduled({} as never, environment as ResearchEnv, ctx),
    /dedicated Supabase database/,
  );
});
