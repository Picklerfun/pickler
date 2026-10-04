import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ACCOUNT, preflight, release, WORKERS } from "./deploy-staging.mjs";

const sha = "a".repeat(40);
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "Picklerfun/pickler",
  GITHUB_SHA: sha,
  STAGING_DEPLOYMENT_ENABLED: "true",
  STAGING_WORKER_BUILDS_DISABLED: "true",
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  CLOUDFLARE_API_TOKEN: "controlled-not-a-token",
  DATABASE_MIGRATION_URL:
    "postgresql://postgres.project:controlled@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
  DATABASE_MIGRATION_CA_CERT: "controlled-not-a-certificate",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "controlled-public-key",
};
const git = (args) => (args[0] === "rev-parse" ? sha : `${sha}\trefs/heads/main`);

test("cutover, main branch, credentials and project identity fail closed without secret values", () => {
  assert.doesNotThrow(() => preflight(env));
  for (const patch of [
    { GITHUB_REF: "refs/pull/1/merge" },
    { GITHUB_REPOSITORY: "other/pickler" },
    { STAGING_WORKER_BUILDS_DISABLED: "false" },
    { STAGING_DEPLOYMENT_ENABLED: "false" },
    { CLOUDFLARE_API_TOKEN: "" },
    { DATABASE_MIGRATION_CA_CERT: "" },
    { CLOUDFLARE_ACCOUNT_ID: "other" },
    { DATABASE_MIGRATION_URL: env.DATABASE_MIGRATION_URL + "?sslmode=disable" },
    { DATABASE_MIGRATION_URL: env.DATABASE_MIGRATION_URL.replace(":5432", ":6543") },
    { NEXT_PUBLIC_SUPABASE_URL: "https://another.supabase.co" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
  ]) {
    assert.throws(
      () => preflight({ ...env, ...patch }),
      (error) => {
        assert.ok(!error.message.includes("controlled"));
        return true;
      },
    );
  }
});

test("only current main migrates once before ordered releases, with phase-specific secrets", async () => {
  const actions = [];
  const result = await release(env, async (program, args, childEnv) => {
    if (program === "git") {
      return git(args);
    }
    actions.push([program, args]);
    if (program === "npm") {
      assert.equal(childEnv.CLOUDFLARE_API_TOKEN, undefined);
      assert.equal(childEnv.DATABASE_MIGRATION_URL, env.DATABASE_MIGRATION_URL);
    } else {
      assert.equal(childEnv.DATABASE_MIGRATION_URL, undefined);
      assert.equal(childEnv.DATABASE_MIGRATION_CA_CERT, undefined);
      assert.ok(args.includes(sha));
    }
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.workers, ["research", "trading", "api", "web"]);
  assert.equal(actions.filter(([p]) => p === "npm").length, 1);
  assert.deepEqual(
    actions.slice(1).map(([, a]) => a[a.indexOf("--config") + 1]),
    WORKERS.map(([, config]) => config),
  );
});

test("obsolete commits, migration failures and partial publication stop without retries", async () => {
  for (const failure of ["obsolete", "migration", "api"]) {
    const writes = [];
    const reports = [];
    await assert.rejects(
      release(
        env,
        async (program, args) => {
          if (program === "git") {
            return failure === "obsolete" && args[0] === "ls-remote" ? "b".repeat(40) : git(args);
          }
          writes.push(program === "npm" ? "migration" : args[args.indexOf("--config") + 1]);
          if (
            (failure === "migration" && program === "npm") ||
            (failure === "api" && args.includes("workers/api/wrangler.staging.jsonc"))
          ) {
            throw new Error("controlled failure");
          }
        },
        undefined,
        async (report) => reports.push(structuredClone(report)),
      ),
    );
    assert.equal(reports.at(-1).status, "failed");
    if (failure === "obsolete") {
      assert.deepEqual(writes, []);
    } else if (failure === "migration") {
      assert.deepEqual(writes, ["migration"]);
    } else {
      assert.equal(writes.length, 4);
      assert.deepEqual(reports.at(-1).workers, ["research", "trading"]);
    }
  }
});

test("cancellation during preparation or publishing never starts a later phase", async () => {
  for (const phase of ["prepare", "publish"]) {
    const controller = new AbortController();
    const writes = [];
    await assert.rejects(
      release(
        env,
        async (program, args) => {
          if (program === "git") {
            if (phase === "prepare") {
              controller.abort();
            }
            return git(args);
          }
          writes.push(program);
          if (phase === "publish" && program === "npx") {
            controller.abort();
          }
        },
        controller.signal,
      ),
    );
    assert.deepEqual(writes, phase === "prepare" ? [] : ["npm", "npx"]);
  }
});

test("workflow isolates migration secrets from build/test steps and excludes PR deployments", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/staging-deploy.yml", import.meta.url),
    "utf8",
  );
  assert.ok(!workflow.includes("pull_request:"));
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment: staging/);
  const checks = workflow.slice(
    workflow.indexOf("- run: npm run format:check"),
    workflow.indexOf("- name: Migrate then publish"),
  );
  assert.ok(!checks.includes("secrets."));
  assert.match(checks, /npm test/);
  assert.match(checks, /npm run build:workers/);
  for (const [, config] of WORKERS) {
    assert.ok((await readFile(config, "utf8")).includes(ACCOUNT));
  }
});
