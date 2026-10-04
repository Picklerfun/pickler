import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const ACCOUNT = "bc8d4adf4860284fda426b24e7377bc2";
export const WORKERS = [
  ["research", "workers/research/wrangler.jsonc"],
  ["trading", "workers/trading/wrangler.jsonc"],
  ["api", "workers/api/wrangler.staging.jsonc"],
  ["web", "apps/web/wrangler.jsonc"],
];

export function preflight(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REPOSITORY !== "Picklerfun/pickler"
  ) {
    throw new Error("Deployment requires this repository's main-branch GitHub Actions run");
  }
  if (env.STAGING_DEPLOYMENT_ENABLED !== "true" || env.STAGING_WORKER_BUILDS_DISABLED !== "true") {
    throw new Error("Complete the Worker Builds cutover before enabling coordinated deployment");
  }
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") || env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT) {
    throw new Error("Unexpected commit or Cloudflare account");
  }
  for (const key of [
    "CLOUDFLARE_API_TOKEN",
    "DATABASE_MIGRATION_URL",
    "DATABASE_MIGRATION_CA_CERT",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]) {
    if (!env[key]?.trim()) {
      throw new Error(`Missing deployment setting: ${key}`);
    }
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("TLS verification must remain enabled");
  }
  let db;
  let publicUrl;
  try {
    db = new URL(env.DATABASE_MIGRATION_URL);
    publicUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    throw new Error("Invalid staging endpoint configuration");
  }
  const project = /^([a-z0-9]+)\.supabase\.co$/.exec(publicUrl.hostname)?.[1];
  const sameProject =
    db.hostname === `db.${project}.supabase.co` ||
    (db.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(db.username) === `postgres.${project}`);
  if (
    !project ||
    publicUrl.protocol !== "https:" ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.pathname !== "/" ||
    publicUrl.search ||
    publicUrl.hash ||
    !sameProject ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    db.port !== "5432" ||
    db.pathname !== "/postgres" ||
    db.search ||
    db.hash
  ) {
    throw new Error(
      "Deployment requires matching Supabase staging endpoints and a direct/session migration connection",
    );
  }
}

/** No shell interpolation, no automatic retries, and no commands after an abort. */
export function command(program, args, env, signal, capture = false) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    const stop = () => {
      if (!child.pid) {
        return;
      }
      try {
        // npm/npx can spawn descendants. Terminate the whole release command group.
        if (process.platform === "win32") {
          child.kill("SIGTERM");
        } else {
          process.kill(-child.pid, "SIGTERM");
        }
      } catch {
        // The command may already have exited.
      }
    };
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) {
      stop();
    }
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", () => reject(new Error(`Could not complete ${program}`)));
    child.once("close", (code) => {
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) {
        reject(new Error("Release command cancelled"));
      } else if (code !== 0) {
        reject(new Error(`${program} failed; subsequent release steps are stopped`));
      } else {
        resolve(output.trim());
      }
    });
  });
}

export async function release(env, run = command, signal, record = async () => {}) {
  preflight(env);
  const report = {
    commit: env.GITHUB_SHA,
    migration: "not-started",
    workers: [],
    status: "preparing",
  };
  const publicEnv = { ...env };
  delete publicEnv.DATABASE_MIGRATION_URL;
  delete publicEnv.DATABASE_MIGRATION_CA_CERT;
  const migrationEnv = { ...env };
  delete migrationEnv.CLOUDFLARE_API_TOKEN;
  const gitEnv = { ...publicEnv };
  delete gitEnv.CLOUDFLARE_API_TOKEN;
  try {
    signal?.throwIfAborted();
    const current = await run("git", ["rev-parse", "HEAD"], gitEnv, signal, true);
    signal?.throwIfAborted();
    const remote = await run(
      "git",
      ["ls-remote", "origin", "refs/heads/main"],
      gitEnv,
      signal,
      true,
    );
    if (current !== env.GITHUB_SHA || remote.split(/\s+/)[0] !== env.GITHUB_SHA) {
      throw new Error("Checkout is not current main; refuse an obsolete release");
    }
    report.migration = "started";
    await record(report);
    signal?.throwIfAborted();
    await run("npm", ["run", "db:migrate"], migrationEnv, signal);
    report.migration = "applied";
    await record(report);
    for (const [worker, config] of WORKERS) {
      signal?.throwIfAborted();
      await run(
        "npx",
        [
          "--no-install",
          "wrangler",
          "deploy",
          "--config",
          config,
          "--tag",
          env.GITHUB_SHA,
          "--message",
          `GitHub Actions commit ${env.GITHUB_SHA}`,
        ],
        publicEnv,
        signal,
      );
      report.workers.push(worker);
      await record(report);
    }
    report.status = "completed";
  } catch (error) {
    report.status = "failed";
    await record(report);
    throw error;
  }
  await record(report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] ?? "--check";
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => controller.abort());
  }
  try {
    preflight(process.env);
    if (mode === "--check") {
      console.log("Staging deployment settings validated; no remote changes made.");
    } else if (mode === "--run") {
      await release(process.env, command, controller.signal, async (report) => {
        await mkdir(".data", { recursive: true });
        await writeFile(".data/staging-deployment.json", JSON.stringify(report, null, 2));
      });
    } else {
      throw new Error("Use --check or --run");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
