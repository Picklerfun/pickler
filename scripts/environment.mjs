import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
const providers = [
  "MODEL_BASE_URL",
  "MODEL_ID",
  "MODEL_API_KEY",
  "EXA_API_KEY",
  "BALLDONTLIE_API_KEY",
  "THE_ODDS_API_KEY",
];
const auth = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
  "ALLOWED_ORIGINS",
  "ENCRYPTION_KEY",
];
const database = ["DATABASE_URL", "DATABASE_CA_CERT"];
const targets = {
  fixture: [...database, "CONTROLLED_TEST_DATABASE_ID", "ADMISSIONS_ENABLED"],
  web: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SIWE_CHAIN_ID",
    "PICKLER_API_LOCAL_URL",
  ],
  "web-worker": [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SIWE_CHAIN_ID",
  ],
  api: [...database, ...auth, "ADMISSIONS_ENABLED"],
  research: [...database, ...providers, "ADMISSIONS_ENABLED"],
  agent: [
    ...database,
    ...providers,
    "DATABASE_MIGRATION_URL",
    "TENANT_ALPHA_TOKEN",
    "TENANT_BETA_TOKEN",
  ],
  database: [...database, "DATABASE_MIGRATION_URL"],
};

export function selectEnvironment(source, target, environment = "local") {
  if (
    !targets[target] ||
    !["local", "staging"].includes(environment) ||
    (target === "fixture" && environment !== "local")
  ) {
    throw new Error("Choose web, api, research, agent or database and local or staging");
  }
  const values = {};
  const prefix = environment === "staging" ? "STAGING_" : "LOCAL_";
  for (const key of targets[target]) {
    // Hosted values never fall back to local credentials. Provider keys may be shared by the operator.
    const value =
      source[prefix + key] ??
      (environment === "local" || providers.includes(key) ? source[key] : undefined);
    if (value) {
      values[key] = value;
    }
  }
  if (
    environment === "staging" &&
    !["web", "web-worker"].includes(target) &&
    !values.DATABASE_URL &&
    source.STAGING_DATABASE_PASSWORD
  ) {
    const url = new URL(
      `postgresql://${source.STAGING_DATABASE_HOST}:${source.STAGING_DATABASE_PORT ?? "5432"}/${source.STAGING_DATABASE_NAME ?? "postgres"}`,
    );
    url.username = source.STAGING_DATABASE_USER;
    url.password = source.STAGING_DATABASE_PASSWORD;
    values.DATABASE_URL = url.toString();
  }
  if (target === "agent" && environment === "local" && source.AGENT_DATABASE_URL) {
    values.DATABASE_URL = source.AGENT_DATABASE_URL;
    values.DATABASE_MIGRATION_URL =
      source.AGENT_DATABASE_MIGRATION_URL ?? source.AGENT_DATABASE_URL;
  }
  if (target === "database" || target === "agent") {
    values.DATABASE_MIGRATION_URL ??= values.DATABASE_URL;
  }
  if (["api", "research", "fixture"].includes(target)) {
    values.APP_ENV = environment;
    values.ADMISSIONS_ENABLED ??= "false";
  }
  return values;
}

export function readEnvironment(path = `${root}.env`) {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

export function childEnvironment(selected, inherited = process.env) {
  // Do not leak operator/database/provider variables to the web or another Worker.
  const result = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "USER",
    "SHELL",
    "LANG",
    "TERM",
    "CI",
    "NODE_ENV",
    "FORCE_COLOR",
    "NO_COLOR",
    "SystemRoot",
    "NEXT_PRIVATE_STANDALONE",
    "NEXT_PRIVATE_OUTPUT_TRACE_ROOT",
  ]) {
    if (inherited[key] !== undefined) {
      result[key] = inherited[key];
    }
  }
  return { ...result, ...selected };
}
