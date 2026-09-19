import {
  createAgentQueries,
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
} from "@pickler/infrastructure";
import type { Services } from "./app";
import { createDurableBudgetGateway } from "./budget/budget-gateway";
import type { Env } from "./env";

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

/** Composition root. Built once per isolate from bindings. */
export function createServices(env: Env): Services {
  const db = createSupabaseAdmin({
    url: required(env, "SUPABASE_URL"),
    secretKey: required(env, "SUPABASE_SECRET_KEY"),
  });
  const issuer = required(env, "JWT_ISSUER");
  const workspaces = createSupabaseWorkspaceDirectory(db);
  const agents = createSupabaseAgentRegistry(db);
  const now = () => new Date();

  return {
    authenticate: createAuthenticateRequest({
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
    }),
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
    budgets: createDurableBudgetGateway(env.AGENT_LEDGER),
    profiles: createProfileService(createSupabaseProfileRepository(db)),
  };
}
