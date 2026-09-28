import {
  createAgentQueries,
  createAuthenticateAgent,
  createAuthenticateRequest,
  createProfileService,
  parseEmailAllowlist,
} from "@pickler/core";
import { createPaperPlugin } from "@pickler/agent-runtime/plugins/paper-trading";
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
  PostgresLaunchReadModel,
  PostgresPaperStore,
  PolymarketData,
  PolymarketPaperResolution,
  PostgresConsoleDirectory,
  PostgresBudgetLedger,
  PostgresTradingStore,
} from "@pickler/infrastructure";
import type { Services } from "./app";
import type { Env } from "./env";
import { apiDatabase } from "./database";

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
  const database = apiDatabase(env);
  // Validate all required bindings before allocating the invocation's pool.
  required(env, "SUPABASE_URL");
  required(env, "SUPABASE_SECRET_KEY");
  required(env, "JWT_ISSUER");
  const repository = new PostgresResearchStore(database.url, undefined, database.options);
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
    launches: new PostgresLaunchReadModel(repository.pool),
    close: () => repository.close(),
    onboard: (userId) => directory.onboard(userId),
    console: {
      admissionsEnabled: env.ADMISSIONS_ENABLED === "true",
      trading: {
        repository: new PostgresTradingStore(repository.pool),
        admissionsEnabled: env.TRADING_ADMISSIONS_ENABLED === "true",
        async invoke(path, input) {
          if (!env.TRADING_EXECUTOR) {
            throw new Error("Trading executor unavailable");
          }
          return env.TRADING_EXECUTOR.fetch(
            new Request(`https://trading.internal${path}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            }),
          );
        },
        async notify() {
          await env.TRADING_QUEUE?.send({ kind: "trading-wakeup" });
        },
      },
      authenticate,
      directory,
      repository,
      paper: createPaperPlugin(
        new PostgresPaperStore(repository.pool),
        new PolymarketData(),
        new PolymarketPaperResolution(),
      ),
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
