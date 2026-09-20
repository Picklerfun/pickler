import assert from "node:assert/strict";
import { test } from "node:test";
import { childEnvironment, selectEnvironment } from "../environment.mjs";

test("web receives public settings only, including when the shell contains secrets", () => {
  const values = selectEnvironment(
    {
      LOCAL_NEXT_PUBLIC_SUPABASE_URL: "https://public.test",
      LOCAL_SUPABASE_SECRET_KEY: "private",
      MODEL_API_KEY: "model",
      STAGING_DATABASE_PASSWORD: "password",
    },
    "web",
  );
  const env = childEnvironment(values, {
    PATH: "/bin",
    DATABASE_URL: "secret",
    SUPABASE_SECRET_KEY: "secret",
    CLOUDFlARE_API_TOKEN: "secret",
  });
  assert.deepEqual(env, { PATH: "/bin", NEXT_PUBLIC_SUPABASE_URL: "https://public.test" });
});

test("API and researcher receive independent capabilities", () => {
  const source = {
    LOCAL_DATABASE_URL: "postgres://local",
    LOCAL_SUPABASE_SECRET_KEY: "auth",
    MODEL_API_KEY: "model",
    TENANT_ALPHA_TOKEN: "tenant",
  };
  assert.equal(selectEnvironment(source, "api").MODEL_API_KEY, undefined);
  assert.equal(selectEnvironment(source, "research").SUPABASE_SECRET_KEY, undefined);
  assert.equal(selectEnvironment(source, "research").TENANT_ALPHA_TOKEN, undefined);
  assert.equal(selectEnvironment(source, "research").MODEL_API_KEY, "model");
});

test("staging never falls back to local database or Auth credentials", () => {
  const source = {
    LOCAL_DATABASE_URL: "postgres://local",
    DATABASE_URL: "postgres://legacy",
    LOCAL_SUPABASE_SECRET_KEY: "auth",
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
    MODEL_API_KEY: "model",
  };
  assert.equal(selectEnvironment(source, "api", "staging").DATABASE_URL, undefined);
  assert.equal(selectEnvironment(source, "api", "staging").SUPABASE_SECRET_KEY, undefined);
  assert.equal(selectEnvironment(source, "web", "staging").NEXT_PUBLIC_SUPABASE_URL, undefined);
  assert.equal(selectEnvironment(source, "research", "staging").MODEL_API_KEY, "model");
});

test("password components are URL encoded and Studio retains its independent local database", () => {
  const source = {
    STAGING_DATABASE_HOST: "aws-0-us-east-1.pooler.supabase.com",
    STAGING_DATABASE_USER: "postgres.test",
    STAGING_DATABASE_PASSWORD: 'a@b:#$"',
    AGENT_DATABASE_URL: "postgres://studio",
    LOCAL_DATABASE_URL: "postgres://workers",
  };
  const result = selectEnvironment(source, "database", "staging");
  assert.equal(
    decodeURIComponent(new URL(result.DATABASE_URL).password),
    source.STAGING_DATABASE_PASSWORD,
  );
  assert.equal(new URL(result.DATABASE_URL).port, "5432");
  assert.equal(selectEnvironment(source, "agent").DATABASE_URL, "postgres://studio");
  assert.equal(selectEnvironment(source, "agent").DATABASE_MIGRATION_URL, "postgres://studio");
  assert.equal(selectEnvironment(source, "api").DATABASE_URL, "postgres://workers");
});

test("admissions default closed and invalid selections fail", () => {
  assert.equal(selectEnvironment({}, "research").ADMISSIONS_ENABLED, "false");
  assert.throws(() => selectEnvironment({}, "unknown"));
  assert.throws(() => selectEnvironment({}, "api", "production"));
});

test("OpenNext build controls survive the filtered nested Next.js build", () => {
  const env = childEnvironment(
    {},
    {
      NEXT_PRIVATE_STANDALONE: "true",
      NEXT_PRIVATE_OUTPUT_TRACE_ROOT: "/workspace",
      NEXT_PRIVATE_SECRET: "private",
    },
  );
  assert.deepEqual(env, {
    NEXT_PRIVATE_STANDALONE: "true",
    NEXT_PRIVATE_OUTPUT_TRACE_ROOT: "/workspace",
  });
});

test("compiled web never receives the Next-dev loopback override or database credentials", () => {
  const source = {
    LOCAL_PICKLER_API_LOCAL_URL: "http://127.0.0.1:8787",
    STAGING_DATABASE_PASSWORD: "secret",
    STAGING_DATABASE_HOST: "aws-0-us-east-1.pooler.supabase.com",
    STAGING_DATABASE_USER: "postgres.test",
  };
  assert.equal(selectEnvironment(source, "web-worker").PICKLER_API_LOCAL_URL, undefined);
  assert.equal(selectEnvironment(source, "web-worker", "staging").DATABASE_URL, undefined);
});
