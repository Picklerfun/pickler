import {
  VENUE_CONTRACTS,
  createAgentQueries,
  createCustodyService,
  createPaperService,
  createPaperSettlementService,
  createAuthenticateAgent,
  createAuthenticateRequest,
  createProfileService,
  createWalletSignIn,
  parseEmailAllowlist,
} from "@pickler/core";
import {
  createSupabaseAdmin,
  createSupabaseJwtVerifier,
  decryptAes256Gcm,
  PostgresResearchStore,
  PostgresPaperStore,
  PolymarketData,
  PolymarketPaperResolution,
  PostgresStudioDirectory,
  PostgresBudgetLedger,
  PostgresAgentEventLog,
  PostgresAgentRegistry,
  PostgresApiKeyDirectory,
  PostgresProfileRepository,
  PostgresWorkspaceDirectory,
  PostgresCustodyStore,
  createActivityBuilders,
  createAddPasskeyActivityBuilder,
  createBalanceReader,
  createAusdBalanceReader,
  createAusdDepositChain,
  createSubOrganizationCreator,
  createTurnkeyActivityForwarder,
  createTurnkeyReader,
  createAuthUserLookup,
  createWalletAccounts,
  createSignatureVerifier,
  buildSiweMessage,
  parseSiweMessage,
  PostgresWalletIdentityStore,
  createOpenAiCompatibleDrafter,
  PostgresTradingStore,
} from "@pickler/infrastructure";
import { agentDraftSchema } from "@pickler/api-schema";
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

/** A compressed P-256 public key in hex, the format Turnkey API keys use. */
const COMPRESSED_P256 = /^0[23][0-9a-f]{64}$/i;

/**
 * Pickler's delegated public key, or null when it is absent or malformed. A malformed one is
 * treated as not configured — the ceremony answers 503 rather than asking a person to approve a
 * user whose key Turnkey would reject — and says so by variable name, never by value. Only the
 * public half is read; the private half stays in the environment, unused until live trading.
 */
export function delegatedPublicKeyFrom(
  env: Pick<Env, "TURNKEY_DELEGATED_API_PUBLIC_KEY">,
  log: (message: string) => void = console.error,
): string | null {
  const value = env.TURNKEY_DELEGATED_API_PUBLIC_KEY;
  if (!value) {
    return null;
  }
  if (!COMPRESSED_P256.test(value)) {
    log(
      "TURNKEY_DELEGATED_API_PUBLIC_KEY is not a compressed P-256 public key in hex; agent wallets are off",
    );
    return null;
  }
  return value;
}

/**
 * The log line for a deposit that was broadcast and could not be recorded: the AUSD moved and no
 * row says so, and this line is how it is reconciled. Ids, hash and amount only.
 */
export function reportUnrecordedDeposit(
  requestId: string,
  log: (message: string) => void = console.error,
) {
  return (deposit: { agentId: string; txHash: string; amountMicroUsd: bigint }) =>
    log(
      `[${requestId}] unrecorded deposit ${deposit.txHash} of ${deposit.amountMicroUsd} micro-USD to agent ${deposit.agentId}; it was broadcast, record it out of band`,
    );
}

/**
 * Composed only when every Turnkey binding is present, so a deployment without them serves the
 * rest of the API rather than failing to start. The parent API key lives here and nowhere near a
 * sub-organization: it creates them and reads activities back, and cannot sign inside one.
 */
function custodyServices(
  env: Env,
  pool: PostgresResearchStore["pool"],
  authenticate: Services["authenticate"],
  profiles: SigningRouteServices["profiles"],
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
  const agentActivities = createActivityBuilders();
  const delegatedPublicKey = delegatedPublicKeyFrom(env);
  const forwarder = createTurnkeyActivityForwarder({ reader: createTurnkeyReader(parentKey) });
  // AUSD deposits from the master wallet, on the studio's chain and endpoint; a sent deposit
  // drops the studio reader's cached balance for the agent's address.
  const deposits = createAusdDepositChain({
    chainId: Number(env.CHAIN_ID ?? DEFAULT_CHAIN_ID),
    ...(env.MONAD_RPC_URL ? { rpcUrl: env.MONAD_RPC_URL } : {}),
    balances: ausdBalances(env),
  });

  return {
    authenticate,
    profiles,
    walletEmailDomain: env.WALLET_EMAIL_DOMAIN,
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
        agentActivities,
        agentWallets: store,
        deposits,
        delegatedPublicKey,
        venueContracts: VENUE_CONTRACTS,
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
        // A Pickler user Turnkey created and Pickler could not record, from two delegated-user
        // confirms racing. Ids only: nothing here carries key material.
        reportUnrecordedDelegatedUser: ({ userId, subOrganizationId, delegatedUserId }) =>
          console.error(
            `[${requestId}] unrecorded delegated user ${delegatedUserId} in Turnkey sub-organization ${subOrganizationId} for user ${userId}; delete it out of band`,
          ),
        reportUnrecordedDeposit: reportUnrecordedDeposit(requestId),
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
        // The admin API has no lookup by email and does not say whether a password is set, so
        // this reads auth.users and auth.identities where they are reachable (a deployment's
        // DATABASE), and falls back to the admin API where they are not (local Docker).
        findAuthUser: createAuthUserLookup({ pool, admin: createSupabaseAdmin(supabase) }),
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

/**
 * The research worker's model, used to draft an agent from one line. Null unless all three are set
 * and the base URL parses, so a bad value turns drafting off (503) and leaves every other route alone.
 */
function drafter(env: Env) {
  if (!env.MODEL_BASE_URL || !env.MODEL_ID || !env.MODEL_API_KEY) {
    return null;
  }
  if (!URL.canParse(env.MODEL_BASE_URL)) {
    return null;
  }
  return createOpenAiCompatibleDrafter({
    baseUrl: env.MODEL_BASE_URL,
    apiKey: env.MODEL_API_KEY,
    modelId: env.MODEL_ID,
    validate: (raw) => agentDraftSchema.parse(raw),
  });
}

const ausdReaders = new Map<string, ReturnType<typeof createAusdBalanceReader>>();

/**
 * AUSD balances for the studio, cached 15 s per address. Services are composed per request, so the
 * reader is kept per isolate (per chain and endpoint) or its cache would never be hit. A failed
 * read fails the request; it is never reported as a zero balance.
 */
function ausdBalances(env: Env) {
  const chainId = Number(env.CHAIN_ID ?? DEFAULT_CHAIN_ID);
  const key = `${chainId}|${env.MONAD_RPC_URL ?? ""}`;
  let reader = ausdReaders.get(key);
  if (!reader) {
    reader = createAusdBalanceReader({
      chainId,
      ...(env.MONAD_RPC_URL ? { rpcUrl: env.MONAD_RPC_URL } : {}),
    });
    ausdReaders.set(key, reader);
  }
  return reader;
}

/** Request-scoped composition; no research model, provider credentials or lab initialization. */
export function createServices(env: Env): Services & { close(): Promise<void> } {
  const database = apiDatabase(env);
  // Validate all required bindings before allocating the invocation's pool.
  required(env, "SUPABASE_URL");
  required(env, "SUPABASE_SECRET_KEY");
  required(env, "JWT_ISSUER");
  const repository = new PostgresResearchStore(database.url, undefined, database.options);
  const directory = new PostgresStudioDirectory(repository.pool);
  // Product data goes through this pool only. Supabase is reached for auth alone — the JWKS
  // verifier below and the admin API in the wallet sign-in — so a local run, whose DATABASE_URL is
  // the Docker Postgres, never reads or writes the hosted project's tables.
  const issuer = required(env, "JWT_ISSUER");
  const workspaces = new PostgresWorkspaceDirectory(repository.pool);
  const agents = new PostgresAgentRegistry(repository.pool);
  const now = () => new Date();

  const authenticate = createAuthenticateRequest({
    tokens: createSupabaseJwtVerifier({
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      issuer,
      ...(env.JWT_AUDIENCE ? { audience: env.JWT_AUDIENCE } : {}),
    }),
    workspaces,
    apiKeys: new PostgresApiKeyDirectory(repository.pool),
    sha256Hex,
    now,
    superAdminEmails: parseEmailAllowlist(env.SUPER_ADMIN_EMAILS),
  });
  // A profile is refused until its user has a custody account, read from the same table
  // `register` writes; composed whether or not Turnkey is bound, so without it nobody can pass.
  const custodyAccounts = new PostgresCustodyStore(repository.pool);
  const profiles = createProfileService(new PostgresProfileRepository(repository.pool), {
    hasCustodyAccount: async (userId) => (await custodyAccounts.findByUserId(userId)) !== null,
  });
  const custody = custodyServices(env, repository.pool, authenticate, profiles);
  const walletAuth = walletAuthServices(env, repository.pool, authenticate);
  return {
    authenticate,
    ...(custody ? { custody } : {}),
    ...(walletAuth ? { walletAuth } : {}),
    growth: createGrowthServices(repository.pool),
    close: () => repository.close(),
    onboard: (userId) => directory.onboard(userId),
    studio: {
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
      drafter: drafter(env),
      directory,
      repository,
      wallets: new PostgresCustodyStore(repository.pool),
      balances: ausdBalances(env),
      ...(custody ? { custody: custody.custody } : {}),
      paper: {
        ...createPaperService(new PostgresPaperStore(repository.pool), new PolymarketData()),
        ...createPaperSettlementService(
          new PostgresPaperStore(repository.pool),
          new PolymarketPaperResolution(),
        ),
      },
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
    agentQueries: createAgentQueries({
      agents,
      events: new PostgresAgentEventLog(repository.pool),
      now,
    }),
    budgets: new PostgresBudgetLedger(repository.pool),
    profiles,
  };
}
