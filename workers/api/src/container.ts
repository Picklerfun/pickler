import {
  createAgentQueries,
  createCustodyService,
  createPaperService,
  createAuthenticateAgent,
  createAuthenticateRequest,
  createProfileService,
  createWalletSignIn,
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
  PostgresCustodyStore,
  createAddPasskeyActivityBuilder,
  createBalanceReader,
  createSubOrganizationCreator,
  createTurnkeyActivityForwarder,
  createTurnkeyReader,
  createWalletAccounts,
  createSignatureVerifier,
  buildSiweMessage,
  parseSiweMessage,
  PostgresWalletIdentityStore,
} from "@pickler/infrastructure";
import type { Services } from "./app";
import type { Env } from "./env";
import type { SigningRouteServices } from "./routes/signing";
import type { WalletAuthServices } from "./routes/wallet-auth";
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

/** Monad testnet, the same default the web carries in NEXT_PUBLIC_SIWE_CHAIN_ID. */
const DEFAULT_CHAIN_ID = 10143;

/**
 * Composed only when every Turnkey binding is present, so a deployment without them serves the
 * rest of the API rather than failing to start. The parent API key lives here and nowhere near a
 * sub-organization: it creates them and reads activities back, and cannot sign inside one.
 */
function custodyServices(
  env: Env,
  pool: PostgresResearchStore["pool"],
  authenticate: Services["authenticate"],
): SigningRouteServices | undefined {
  const apiPublicKey = env.TURNKEY_API_PUBLIC_KEY;
  const apiPrivateKey = env.TURNKEY_API_PRIVATE_KEY;
  const parentOrganizationId = env.TURNKEY_PARENT_ORG_ID;
  const rpId = env.TURNKEY_RPID;
  const appName = env.TURNKEY_APP_NAME;
  if (!apiPublicKey || !apiPrivateKey || !parentOrganizationId || !rpId || !appName) {
    return undefined;
  }

  const parentKey = { apiPublicKey, apiPrivateKey };
  const store = new PostgresCustodyStore(pool);
  const turnkey = createSubOrganizationCreator({ ...parentKey, parentOrganizationId });
  const activities = createAddPasskeyActivityBuilder();
  const forwarder = createTurnkeyActivityForwarder({ reader: createTurnkeyReader(parentKey) });

  return {
    authenticate,
    balances: createBalanceReader({
      chainId: Number(env.CHAIN_ID ?? DEFAULT_CHAIN_ID),
      ...(env.MONAD_RPC_URL ? { rpcUrl: env.MONAD_RPC_URL } : {}),
    }),
    // Only the service itself is per-request: it is a closure over the adapters above, and this
    // is what lets the orphan report name the request that produced it.
    custody: (requestId: string) =>
      createCustodyService({
        challenges: store,
        repository: store,
        turnkey,
        activities,
        forwarder,
        rpId,
        appName,
        now: () => new Date(),
        randomId: () => crypto.randomUUID(),
        // A sub-organization that exists in Turnkey and belongs to nobody. Nothing automatic
        // cleans it up; this line is the only record that it is there.
        reportOrphan: ({ userId, subOrganizationId }) =>
          console.warn(
            `[${requestId}] orphaned Turnkey sub-organization ${subOrganizationId} from a lost registration race for user ${userId}; reconcile out of band`,
          ),
      }),
  };
}

function walletAuthServices(
  env: Env,
  pool: PostgresResearchStore["pool"],
  authenticate: Services["authenticate"],
): WalletAuthServices | undefined {
  const domain = env.SIWE_DOMAIN;
  const emailDomain = env.WALLET_EMAIL_DOMAIN;
  if (!domain || !emailDomain) {
    return undefined;
  }

  const store = new PostgresWalletIdentityStore(pool);
  const supabase = {
    url: required(env, "SUPABASE_URL"),
    secretKey: required(env, "SUPABASE_SECRET_KEY"),
  };

  return {
    authenticate,
    signIn: createWalletSignIn({
      clock: { now: () => new Date() },
      domain,
      nonces: store,
      links: store,
      verifier: createSignatureVerifier(),
      accounts: createWalletAccounts({
        admin: createSupabaseAdmin(supabase),
        emailDomain,
        // The admin API has no lookup by email — `listUsers` is paged with no filter — so the
        // recovery path reads the uniquely indexed column directly.
        findUserIdByEmail: async (email) => {
          const { rows } = await pool.query<{ id: string }>(
            `SELECT id FROM auth.users WHERE email = $1 LIMIT 1`,
            [email],
          );
          return rows[0]?.id ?? null;
        },
        // A throwaway per exchange: `verifyOtp` leaves the session on whichever client performs
        // it, and this isolate's admin client is shared across requests.
        sessionClient: () => createSupabaseAdmin(supabase),
      }),
      // The hyphens must go. viem's builder enforces /^[a-zA-Z0-9]{8,}$/ on the nonce, but its
      // parser reads `Nonce: (?<nonce>[a-zA-Z0-9]+)` — so a hyphenated nonce does not fail on the
      // way back, it silently truncates at the first hyphen and stops matching what was issued.
      randomNonce: () => crypto.randomUUID().replace(/-/g, ""),
      // Core's MessageFields and viem's SiweFields do not match, and core deliberately knows
      // nothing about `uri` or viem's naming. The adapter belongs on this side of the port.
      buildMessage: (fields) =>
        buildSiweMessage({
          domain: fields.domain,
          address: fields.address as `0x${string}`,
          statement: "Sign in to Pickler",
          uri: `https://${fields.domain}`,
          chainId: fields.chainReference,
          nonce: fields.nonce,
          issuedAt: fields.issuedAt,
        }),
      parseMessage: parseSiweMessage,
    }),
  };
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
  const custody = custodyServices(env, repository.pool, authenticate);
  const walletAuth = walletAuthServices(env, repository.pool, authenticate);
  return {
    authenticate,
    ...(custody ? { custody } : {}),
    ...(walletAuth ? { walletAuth } : {}),
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
