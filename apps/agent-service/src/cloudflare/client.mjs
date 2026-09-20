import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { PostgresResearchStore } from "@pickler/infrastructure";
import { decisionV2Schema } from "@pickler/api-schema";

const app = fileURLToPath(new URL("../../", import.meta.url));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const stateFile = `${app}.data/cf-probe.json`;
const command = process.argv[2];

if (command === "prepare") {
  if (existsSync(stateFile)) {
    throw new Error("Probe configuration already exists; preserve or explicitly remove it first.");
  }
  config({ path: `${root}.env`, quiet: true });
  process.env.DATABASE_URL = process.env.AGENT_DATABASE_URL ?? process.env.LOCAL_DATABASE_URL;
  const keys = ["MODEL_BASE_URL", "MODEL_ID", "MODEL_API_KEY", "EXA_API_KEY"];
  for (const key of [...keys, "DATABASE_URL"]) {
    if (!process.env[key]) {
      throw new Error(`Missing ${key}`);
    }
  }
  const url = new URL(process.env.DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Preparation requires a local PostgreSQL administrator connection.");
  }
  const database = `pickler_cf_probe_${randomUUID().replaceAll("-", "")}`;
  const admin = new PostgresResearchStore(url.toString());
  try {
    await admin.pool.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.close();
  }
  url.pathname = `/${database}`;
  const vars = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  vars.DATABASE_URL = url.toString();
  vars.PROBE_TOKEN = randomBytes(32).toString("hex");
  mkdirSync(`${app}.data`, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(vars), { mode: 0o600 });
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: vars.DATABASE_URL },
    stdio: "inherit",
  });
  const store = new PostgresResearchStore(vars.DATABASE_URL);
  try {
    await store.init();
    const scope = { tenantId: "beta", agentId: "pickle-beta" };
    const agent = await store.agent(scope);
    await store.updateConfig(scope, agent.version, { ...agent.config, categoryIds: ["1"] });
  } finally {
    await store.close();
  }
  console.log(`Prepared isolated database ${database}. No providers called.`);
} else if (command === "serve") {
  const vars = JSON.parse(readFileSync(stateFile, "utf8"));
  const child = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--config",
      "wrangler.probe.jsonc",
      "--ip",
      "127.0.0.1",
      "--port",
      "8797",
      ...process.argv.slice(3),
    ],
    {
      cwd: app,
      stdio: "inherit",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
        ...vars,
      },
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", () => {
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else if (
  ["health", "check", "research", "interrupt", "research-ephemeral", "hold"].includes(command)
) {
  const base = new URL(process.env.PROBE_BASE_URL ?? "http://127.0.0.1:8797");
  const remote = base.protocol === "https:" && base.hostname.endsWith(".workers.dev");
  if (!remote && !(base.protocol === "http:" && base.hostname === "127.0.0.1")) {
    throw new Error("Use loopback or the explicitly configured workers.dev probe endpoint.");
  }
  const vars = JSON.parse(
    readFileSync(remote ? `${app}.data/cf-remote-secrets.json` : stateFile, "utf8"),
  );
  const start = Date.now();
  const response = await fetch(new URL(`/${command}`, base), {
    method: command === "health" ? "GET" : "POST",
    headers: { Authorization: `Bearer ${vars.PROBE_TOKEN}` },
    signal: AbortSignal.timeout(360_000),
  });
  const result = await response.json();
  const output = `${app}.data/cf-${remote ? "remote" : "local"}-${command}-${start}.json`;
  writeFileSync(output, JSON.stringify(result, null, 2), { mode: 0o600 });
  if (result.run?.status === "completed") {
    decisionV2Schema.parse(result.run.decision);
  }
  console.log({
    http: response.status,
    durationMs: Date.now() - start,
    runId: result.run?.id,
    status: result.run?.status,
    error: result.run?.error ?? result.error,
    action: result.run?.decision?.action,
    output,
  });
  if (!response.ok || (result.run?.status === "failed" && command !== "interrupt")) {
    process.exitCode = 1;
  }
} else {
  throw new Error("Use prepare, health, check, research, interrupt or research-ephemeral or hold.");
}
