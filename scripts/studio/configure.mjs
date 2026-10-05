import { createECDH, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool } from "pg";

const directory = process.argv[2];
const { identity } = JSON.parse(await readFile(join(directory, "controlled-stack.json"), "utf8"));
const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
const url = new URL(status.DB_URL);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55522" ||
  url.pathname !== "/postgres" ||
  url.search ||
  status.API_URL !== "http://127.0.0.1:55521"
) {
  throw new Error("Refusing an uncontrolled stack");
}
const pool = new Pool({ connectionString: status.DB_URL, max: 1 });
try {
  const marker = await pool.query(
    "SELECT identity FROM pickler_worker_test.identity WHERE singleton=true",
  );
  if (marker.rows.length !== 1 || marker.rows[0].identity !== identity) {
    throw new Error("Wrong disposable database identity");
  }
} finally {
  await pool.end();
}
const key = createECDH("prime256v1");
key.generateKeys();
const common = {
  APP_ENV: "local",
  DATABASE_URL: status.DB_URL,
  CONTROLLED_TEST_DATABASE_ID: identity,
  PERPL_RUNTIME_ENABLED: "true",
  CHAIN_ID: "10143",
  MONAD_RPC_URL: "http://127.0.0.1:8798/rpc",
  ADMISSIONS_ENABLED: "false",
};
const policy = {
  version: 1,
  enabled: true,
  reviewedAt: new Date().toISOString(),
  perOperationMicros: "1000000",
  perDayMicros: "10000000",
  forecast: {
    baseUrl: "https://controlled.invalid/v1",
    model: "controlled-model",
    inputMicrosPerMillion: "100000",
    outputMicrosPerMillion: "100000",
  },
  jev: {
    model: "controlled-jev",
    inputMicrosPerMillion: "100000",
    outputMicrosPerMillion: "100000",
  },
};
const api = {
  ...common,
  SUPABASE_URL: status.API_URL,
  SUPABASE_SECRET_KEY: status.SERVICE_ROLE_KEY,
  JWT_ISSUER: `${status.API_URL}/auth/v1`,
  JWT_AUDIENCE: "authenticated",
  ALLOWED_ORIGINS: "http://localhost:8790,http://127.0.0.1:8790",
  TURNKEY_API_PUBLIC_KEY: key.getPublicKey("hex", "compressed"),
  TURNKEY_API_PRIVATE_KEY: key.getPrivateKey("hex"),
  TURNKEY_PARENT_ORG_ID: randomUUID(),
  TURNKEY_DELEGATED_API_PUBLIC_KEY: key.getPublicKey("hex", "compressed"),
  TURNKEY_RPID: "localhost",
  TURNKEY_APP_NAME: "Controlled Studio",
  PERPL_BOARD_NETWORK: "testnet",
};
const research = {
  ...common,
  MODEL_API_KEY: "controlled-test",
  MODEL_ID: "controlled-model",
  MODEL_BASE_URL: "https://controlled.invalid/v1",
  PERPS_JEV_API_KEY: "controlled-test",
  PERPS_RUNTIME_POLICY_JSON: JSON.stringify(policy),
};
const root = resolve(".");
const queue = { producers: [{ binding: "RESEARCH_QUEUE", queue: "pickler-studio-controlled" }] };
const base = {
  compatibility_date: "2026-09-01",
  compatibility_flags: ["nodejs_compat"],
  workers_dev: false,
  preview_urls: false,
};
const configurations = {
  api: {
    ...base,
    name: "pickler-api-staging",
    main: join(root, "workers/api/test/studio-fixture-worker.ts"),
    queues: queue,
    services: [{ binding: "CONTROLLED_RESEARCH", service: "pickler-research-staging" }],
  },
  research: {
    ...base,
    name: "pickler-research-staging",
    main: join(root, "workers/research/test/studio-fixture-worker.ts"),
    queues: {
      ...queue,
      consumers: [{ queue: "pickler-studio-controlled", max_batch_size: 1, max_concurrency: 1 }],
    },
  },
  web: {
    ...base,
    name: "pickler-web-staging",
    main: join(root, "apps/web/.open-next/worker.js"),
    assets: { directory: join(root, "apps/web/.open-next/assets"), binding: "ASSETS" },
    services: [
      { binding: "API", service: "pickler-api-staging" },
      { binding: "WORKER_SELF_REFERENCE", service: "pickler-web-staging" },
    ],
    vars: { NEXTJS_ENV: "production" },
  },
};
for (const [name, config] of Object.entries(configurations)) {
  const target = join(directory, name);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "wrangler.json"), JSON.stringify(config, null, 2), { mode: 0o600 });
  if (name !== "web") {
    await writeFile(
      join(target, ".dev.vars"),
      Object.entries(name === "api" ? api : research)
        .map(([name, value]) => {
          if (value.includes("'") || /[\r\n]/.test(value)) {
            throw new Error("Unexpected generated environment value");
          }
          return `${name}='${value}'`;
        })
        .join("\n") + "\n",
      { mode: 0o600 },
    );
  }
}
await writeFile(
  join(directory, "web-build.json"),
  JSON.stringify({
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    NEXT_PUBLIC_STUDIO_HOST: "studio.pickler.localhost:8790",
    NEXT_PUBLIC_MARKETPLACE_HOST: "market.pickler.localhost:8790",
    NEXT_PUBLIC_MERA_WEB: "off",
  }),
  { mode: 0o600 },
);
console.log("Private local configurations generated; no deployed configuration changed");
