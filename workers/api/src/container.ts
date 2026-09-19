import {
  createAgentQueries,
  createPaperService,
  createAuthenticateAgent,
  createAuthenticateRequest,
  createProfileService,
  parseEmailAllowlist,
} from "@pickler/core";
import {
  createSupabaseAdmin,
  createSupabaseAgentEventLog,
  createSupabaseAgentRegistry,
  createSupabaseApiKeyDirectory,
  createSupabaseJwtVerifier,
  createSupabaseProfileRepository,
  createSupabaseWorkspaceDirectory,
  decryptAes256Gcm,
  PostgresResearchStore,
  PostgresPaperStore,
  PolymarketData,
  PostgresConsoleDirectory,
  PostgresBudgetLedger,
} from "@pickler/infrastructure";
import type { Services } from "./app";
import type { Env } from "./env";

import { createGrowthServices } from "./growth/services";

const encoder = new TextEncoder();
const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
}

function required<
  K extends "SUPABASE_URL" | "SUPABASE_SECRET_KEY" | "JWT_ISSUER" | "ENCRYPTION_KEY",
>(env: Env, name: K): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing binding ${name}`);
  }
  return value;
}

/** Request-scoped composition; no model, provider credentials or lab initialization. */
export function createServices(env: Env): Services & { close(): Promise<void> } {
  const connectionString =
    env.HYPERDRIVE?.connectionString ?? (env.APP_ENV === "local" ? env.DATABASE_URL : undefined);
  if (!connectionString) {
    throw new Error("Missing HYPERDRIVE binding");
  }
  const repository = new PostgresResearchStore(connectionString);
  const directory = new PostgresConsoleDirectory(repository.pool);
  const db = createSupabaseAdmin({
    url: required(env, "SUPABASE_URL"),
    secretKey: required(env, "SUPABASE_SECRET_KEY"),
  });
  const issuer = required(env, "JWT_ISSUER");
  const workspaces = createSupabaseWorkspaceDirectory(db);
  const agents = createSupabaseAgentRegistry(db);
  const now = () => new Date();

  const authenticate = createAuthenticateRequest({
    tokens: createSupabaseJwtVerifier({
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      issuer,
      ...(env.JWT_AUDIENCE ? { audience: env.JWT_AUDIENCE } : {}),
    }),
    workspaces,
    apiKeys: createSupabaseApiKeyDirectory(db),
    sha256Hex,
    now,
    superAdminEmails: parseEmailAllowlist(env.SUPER_ADMIN_EMAILS),
  });
  return {
    authenticate,
    growth: createGrowthServices(env),
    close: () => repository.close(),
    onboard: (userId) => directory.onboard(userId),
    console: {
      admissionsEnabled: env.ADMISSIONS_ENABLED === "true",
      authenticate,
      directory,
      repository,
      paper: createPaperService(new PostgresPaperStore(repository.pool), new PolymarketData()),
      notifyQueued: async () => {
        if (!env.RESEARCH_QUEUE) {
          throw new Error("Missing research queue");
        }
        await env.RESEARCH_QUEUE.send({ kind: "research-wakeup" });
      },
    },
    authenticateAgent: createAuthenticateAgent({
      agents,
      // Relayer encrypts agent secrets with ENCRYPTION_KEY; the same key must be bound here.
      decryptSecret: (ciphertext) => decryptAes256Gcm(ciphertext, required(env, "ENCRYPTION_KEY")),
      sha256Hex,
      hmacSha256Hex,
      now,
    }),
    findWorkspace: (id) => workspaces.findById(id),
    agentQueries: createAgentQueries({ agents, events: createSupabaseAgentEventLog(db), now }),
    budgets: new PostgresBudgetLedger(repository.pool),
    profiles: createProfileService(createSupabaseProfileRepository(db)),
  };
}
