import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { PostgresResearchStore } from "@pickler/infrastructure";
import { decisionV2Schema } from "@pickler/api-schema";

const app = fileURLToPath(new URL("../../../", import.meta.url));
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const varsPath = fileURLToPath(new URL(".dev.vars", import.meta.url));
const statePath = `${app}.data/cf-queue.json`;
const command = process.argv[2];
const base = "http://127.0.0.1:8799";

if (command === "prepare") {
  if (existsSync(statePath) || existsSync(varsPath)) {
    throw new Error("Queue experiment already configured; preserve existing state.");
  }
  const source = parse(readFileSync(`${app}.env`));
  const keys = ["MODEL_BASE_URL", "MODEL_ID", "MODEL_API_KEY", "EXA_API_KEY"];
  for (const key of [...keys, "DATABASE_URL"]) {
    if (!source[key]) {
      throw new Error(`Missing ${key}`);
    }
  }
  const url = new URL(source.DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Preparation requires local PostgreSQL.");
  }
  const database = `pickler_cf_queue_${randomUUID().replaceAll("-", "")}`;
  const admin = new PostgresResearchStore(url.toString());
  try {
    await admin.pool.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.close();
  }
  url.pathname = `/${database}`;
  const vars = Object.fromEntries(keys.map((key) => [key, source[key]]));
  Object.assign(vars, {
    DATABASE_URL: url.toString(),
    TENANT_ALPHA_TOKEN: randomBytes(32).toString("hex"),
    TENANT_BETA_TOKEN: randomBytes(32).toString("hex"),
  });
  mkdirSync(`${app}.data`, { recursive: true });
  writeFileSync(statePath, JSON.stringify(vars), { mode: 0o600 });
  writeFileSync(
    varsPath,
    Object.entries(vars)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  execFileSync("npm", ["run", "db:migrate"], {
    cwd: root,
    env: { ...process.env, DATABASE_MIGRATION_URL: vars.DATABASE_URL },
    stdio: "inherit",
  });
  const store = new PostgresResearchStore(vars.DATABASE_URL);
  try {
    await store.init();
    for (const tenantId of ["alpha", "beta"]) {
      const scope = { tenantId, agentId: `pickle-${tenantId}` };
      const agent = await store.agent(scope);
      await store.updateConfig(scope, agent.version, { ...agent.config, categoryIds: ["1"] });
    }
  } finally {
    await store.close();
  }
  console.log(`Prepared ${database}; Sports selected; scheduling disabled; no providers called.`);
} else {
  const vars = JSON.parse(readFileSync(statePath, "utf8"));
  const tenant = process.env.LAB_TENANT ?? "alpha";
  if (!["alpha", "beta"].includes(tenant)) {
    throw new Error("LAB_TENANT must be alpha or beta");
  }
  const request = async (path, method = "GET", body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${vars[`TENANT_${tenant.toUpperCase()}_TOKEN`]}`,
        "Content-Type": "application/json",
        "Idempotency-Key": process.env.RUN_KEY ?? randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(360_000),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${result.error}`);
    }
    return { http: response.status, result };
  };
  if (command === "worker") {
    execFileSync(process.execPath, ["--import", "tsx", "src/workers/main.ts"], {
      cwd: app,
      env: { ...process.env, ...vars },
      stdio: "inherit",
    });
  } else if (command === "policy") {
    const store = new PostgresResearchStore(vars.DATABASE_URL);
    try {
      await store.setConcurrency(Number(process.argv[3]), Number(process.argv[4]));
      console.log("Shared execution limits updated; active jobs were not aborted.");
    } finally {
      await store.close();
    }
  } else if (command === "run") {
    const started = Date.now();
    const accepted = await request(`/agents/pickle-${tenant}/runs`, "POST", {});
    console.log({ ...accepted, acceptanceMs: Date.now() - started });
  } else if (command === "poll") {
    const runId = process.argv[3];
    if (!/^[a-f0-9-]{36}$/.test(runId ?? "")) {
      throw new Error("Supply runId");
    }
    const { result: run } = await request(`/runs/${runId}`);
    const { result: evidence } = await request(`/runs/${runId}/events`);
    if (run.status === "completed") {
      decisionV2Schema.parse(run.decision);
    }
    const output = `${app}.data/cf-queue-${runId}.json`;
    writeFileSync(output, JSON.stringify({ run, ...evidence }, null, 2), { mode: 0o600 });
    console.log({
      runId,
      status: run.status,
      error: run.error,
      action: run.decision?.action,
      events: evidence.events.length,
      output,
    });
  } else if (command === "tick") {
    const response = await fetch(`${base}/__scheduled`);
    console.log({ http: response.status });
  } else if (command === "check") {
    console.log(await request("/connections/check", "POST", {}));
  } else {
    throw new Error(
      "Use prepare, run, poll <runId>, tick, check, worker or policy <global> <tenant>.",
    );
  }
}
