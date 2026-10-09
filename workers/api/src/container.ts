import { AUSD } from "@pickler/chain";
import { tokenReferenceEconomics, createTokenLaunchService } from "@pickler/core";
import { PostgresTokenLaunchStore } from "@pickler/infrastructure";
import { createXOAuthService } from "@pickler/core";
import { PostgresStudioAccessRequests } from "@pickler/infrastructure";
import {
  createAdviceService,
  createPaidAdvice,
  type AdviceRepository,
  type UnrecordedSettlement,
} from "@pickler/core";
import {
  createAusdAuthorizationGateway,
  PostgresAdvicePayments,
  PostgresAdviceStore,
} from "@pickler/infrastructure";
import { parseAdvicePolicy } from "@pickler/trading/perps";
import {
  VENUE_CONTRACTS,
  createAgentQueries,
  createCustodyService,
  createAuthenticateAgent,
  createAuthenticateRequest,
  createProfileService,
  createWalletSignIn,
  parseEmailAllowlist,
  PilotError,
  turnkeyRelyingPartyProblem,
  type WalletBalanceReader,
} from "@pickler/core";
import { createPaperPlugin } from "@pickler/agent-runtime/plugins/paper-trading";
import {
  createSupabaseAdmin,
  createSupabaseJwtVerifier,
  decryptAes256Gcm,
  PostgresResearchStore,
  PostgresLaunchReadModel,
  PostgresPaperStore,
  PostgresPreviewStore,
  PolymarketData,
  PerplMarketData,
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
  PostgresTradingStore,
  PostgresXOAuthStore,
  createXOAuthProvider,
  parseXApiPolicy,
  xSecrets,
  PostgresPerpsOwnerStore,
  PostgresPerpsPaperStore,
  PostgresPerpsRuntimeStore,
  listTransfers,
} from "@pickler/infrastructure";
import type { PerpNetwork } from "@pickler/core";
import type { PerpsPaperMark } from "@pickler/trading/perps";
import type { Services } from "./app";
import type { Env } from "./env";
import { HttpError } from "./http/http-error";
import type { SigningRouteServices } from "./routes/signing";
import type { WalletAuthServices } from "./routes/wallet-auth";
import { apiDatabase } from "./database";

import { createGrowthServices, marketBoardFor } from "./growth/services";

/**
 * Fresh BTC/ETH marks for the studio's paper positions, from the same per-isolate market board as
 * /v1/marketplace/markets. A stale board, a sample or a bad number gives no mark (P&L unknown).
 */
export async function perpsBoardMarks(network: PerpNetwork): Promise<PerpsPaperMark[]> {
  const markets = await marketBoardFor(network).listMarkets();
  const marks: PerpsPaperMark[] = [];
  for (const market of markets) {
    const fresh = market.source.venue === "perpl" && !market.source.stale;
    if (
      fresh &&
      /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(market.base) &&
      markets.filter((row) => row.base === market.base).length === 1 &&
      Number.isFinite(market.mark) &&
      market.mark > 0
    ) {
      marks.push({ network, symbol: market.base, mark: market.mark.toFixed(8) });
    }
  }
  return marks;
}

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
 * The chain balances and deposits run on, or null when `CHAIN_ID` is not a chain Pickler supports.
 * A bad value turns those two off (503) and leaves every other route alone, and says so by
 * variable name, never by value.
 */
export function supportedChainId(
  env: Pick<Env, "CHAIN_ID" | "MONAD_RPC_URL">,
  log: (message: string) => void = console.error,
): number | null {
  const chainId = Number(env.CHAIN_ID ?? DEFAULT_CHAIN_ID);
  try {
    // The adapters refuse an unsupported chain when they are built; building the cached reader
    // here is that check, made once.
    ausdBalances(env, chainId);
    return chainId;
  } catch {
    log("CHAIN_ID is not a chain Pickler supports; balances and deposits are off");
    return null;
  }
}

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

/** A secp256k1 private key in 0x-prefixed hex, the format viem's `privateKeyToAccount` takes. */
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

/**
 * A paid request that refuses every call with 503 `ADVICE_UNAVAILABLE`: x402 is on but cannot sell,
 * and a free analysis must never stand in for a paid one.
 */
function unavailablePaidAdvice(): ReturnType<typeof createPaidAdvice> {
  return {
    async request() {
      throw new PilotError("ADVICE_UNAVAILABLE", "Paid analyses are not configured");
    },
  };
}

/**
 * The paid advice request (x402), or undefined when it is off. It is off unless
 * `ADVICE_X402_ENABLED` is "true"; off, `POST /v1/agent-advice/.../recommendations` is free exactly
 * as before. On, it sells only with both the relayer key and `MONAD_RPC_URL`: the flag without
 * them, or with a key viem refuses, fails closed (every request answers 503) and says so by
 * variable name, never by value.
 */
export function paidAdviceFrom(
  env: Pick<Env, "ADVICE_X402_ENABLED" | "X402_RELAYER_PRIVATE_KEY" | "MONAD_RPC_URL">,
  deps: {
    advice: ReturnType<typeof createAdviceService>;
    repository: AdviceRepository;
    pool: PostgresResearchStore["pool"];
  },
  log: (message: string) => void = console.error,
): ReturnType<typeof createPaidAdvice> | undefined {
  if (env.ADVICE_X402_ENABLED !== "true") {
    return undefined;
  }
  const relayerPrivateKey = env.X402_RELAYER_PRIVATE_KEY;
  const rpcUrl = env.MONAD_RPC_URL;
  if (!relayerPrivateKey || !rpcUrl) {
    log("x402 is on but its relayer or RPC is missing; advice requests are refused");
    return unavailablePaidAdvice();
  }
  if (!PRIVATE_KEY.test(relayerPrivateKey)) {
    log("X402_RELAYER_PRIVATE_KEY is not a 32-byte hex private key; advice requests are refused");
    return unavailablePaidAdvice();
  }
  let gateway: ReturnType<typeof createAusdAuthorizationGateway>;
  try {
    gateway = createAusdAuthorizationGateway({
      rpcUrl,
      relayerPrivateKey: relayerPrivateKey as `0x${string}`,
    });
  } catch {
    // The error is dropped unread: it may quote the key.
    log("X402_RELAYER_PRIVATE_KEY or MONAD_RPC_URL was refused; advice requests are refused");
    return unavailablePaidAdvice();
  }
  return createPaidAdvice({
    advice: deps.advice,
    repository: deps.repository,
    store: new PostgresAdvicePayments(deps.pool),
    gateway,
    now: () => Date.now(),
    resourceBase: "https://pickler.fun/api",
    reportUnrecordedSettlement: reportUnrecordedSettlement(log),
  });
}

/**
 * The log line for an x402 payment whose AUSD may have moved (or did) without a `settled` row:
 * the start of its manual reconciliation. Ids, payer, nonce and hash only; core never hands over
 * the signature.
 */
export function reportUnrecordedSettlement(log: (message: string) => void = console.error) {
  return (settlement: UnrecordedSettlement) => {
    const hash = settlement.txHash ?? "unknown";
    log(
      `unrecorded advice settlement (${settlement.reason}) payment ${settlement.paymentId} tx ${hash} for user ${settlement.userId} agent ${settlement.publicAgentId} key ${JSON.stringify(settlement.key)} payer ${settlement.payer} nonce ${settlement.nonce}; reconcile out of band`,
    );
  };
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
 * The same line for a transfer between the master and an agent wallet: the funds moved and no row
 * says so. Ids, hash, token and amount (micro-AUSD or wei) only.
 */
export function reportUnrecordedTransfer(
  requestId: string,
  log: (message: string) => void = console.error,
) {
  return (transfer: {
    userId: string;
    fromWalletId: string;
    toWalletId: string;
    token: "ausd" | "mon";
    amount: bigint;
    txHash: string;
  }) =>
    log(
      `[${requestId}] unrecorded transfer ${transfer.txHash} of ${transfer.amount} ${transfer.token} base units from wallet ${transfer.fromWalletId} to wallet ${transfer.toWalletId} for user ${transfer.userId}; it was broadcast, record it out of band`,
    );
}

/**
 * The custody service's balances, from the chain reader: base units, null where a read failed,
 * nothing cached. AUSD's base units are taken as micro-AUSD, so a token of other precision is
 * refused rather than misread.
 */
export function walletBalances(reader: SigningRouteServices["balances"]): WalletBalanceReader {
  return {
    async read(address) {
      const read = await reader.read(address);
      if (read.token.decimals !== 6) {
        throw new Error("AUSD base units are assumed to be micro-AUSD");
      }
      return {
        monWei: read.native.raw === null ? null : BigInt(read.native.raw),
        ausdMicro: read.token.raw === null ? null : BigInt(read.token.raw),
      };
    },
  };
}

/**
 * Composed only when every Turnkey binding is present and `TURNKEY_RPID` is one custody may use
 * (never Mera's relying party, never `localhost` on a deployed environment), so a deployment
 * without them serves the rest of the API rather than failing to start. The parent API key lives
 * here and nowhere near a
 * sub-organization: it creates them and reads activities back, and cannot sign inside one.
 */
function custodyServices(
  env: Env,
  pool: PostgresResearchStore["pool"],
  authenticate: Services["authenticate"],
  profiles: SigningRouteServices["profiles"],
  chainId: number | null,
  log: (message: string) => void = console.error,
): SigningRouteServices | undefined {
  const apiPublicKey = env.TURNKEY_API_PUBLIC_KEY;
  const apiPrivateKey = env.TURNKEY_API_PRIVATE_KEY;
  const parentOrganizationId = env.TURNKEY_PARENT_ORG_ID;
  const rpId = env.TURNKEY_RPID;
  const appName = env.TURNKEY_APP_NAME;
  if (!apiPublicKey || !apiPrivateKey || !parentOrganizationId || !rpId || !appName) {
    return undefined;
  }
  // A passkey enrolled against the wrong relying party cannot be moved afterwards, so a refused
  // value turns custody off here rather than letting the first registration decide it.
  const problem = turnkeyRelyingPartyProblem(rpId, env.APP_ENV);
  if (problem) {
    log(`TURNKEY_RPID is refused (${problem}); custody is off and /v1/signing is not mounted`);
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
  // Without a supported chain there is no deposit chain, and core answers deposits with
  // `DepositsUnavailableError` (503); the passkey ceremonies do not read the chain and stay on.
  const endpoint = env.MONAD_RPC_URL ? { rpcUrl: env.MONAD_RPC_URL } : {};
  const deposits =
    chainId === null
      ? undefined
      : createAusdDepositChain({ chainId, ...endpoint, balances: ausdBalances(env, chainId) });
  // MON and AUSD read fresh for the wallets list, transfers and the minimums to start. Without a
  // chain those answer `DepositsUnavailableError` (503) as deposits do.
  const chainBalances = chainId === null ? null : createBalanceReader({ chainId, ...endpoint });

  return {
    authenticate,
    profiles,
    walletEmailDomain: env.WALLET_EMAIL_DOMAIN,
    balances: chainBalances ?? {
      read: async () => {
        throw new HttpError(503, "Balances are not available", {
          error: "balances_unavailable",
        });
      },
    },
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
        ...(deposits ? { deposits } : {}),
        ...(chainBalances ? { balances: walletBalances(chainBalances) } : {}),
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
        reportUnrecordedTransfer: reportUnrecordedTransfer(requestId),
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
  const profiles = new PostgresProfileRepository(pool);
  const custodyAccounts = new PostgresCustodyStore(pool);
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
      // A username is what makes an account worth keeping: `join` gives up only one without.
      hasProfile: async (userId) => (await profiles.findByUserId(userId)) !== null,
      // A sub-organization and its master wallet have no row tied to the auth user, so an account
      // that has them is never removed: read from the table `register` writes.
      hasCustodyAccount: async (userId) => (await custodyAccounts.findByUserId(userId)) !== null,
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
          // Core writes the sentence: it is what the signature is for, and core checks it.
          statement: fields.statement,
          uri: `https://${fields.domain}`,
          chainId: fields.chainReference,
          nonce: fields.nonce,
          issuedAt: fields.issuedAt,
        }),
      parseMessage: parseSiweMessage,
    }),
  };
}

const ausdReaders = new Map<string, ReturnType<typeof createAusdBalanceReader>>();

/**
 * AUSD balances for the studio, cached 15 s per address. Services are composed per request, so the
 * reader is kept per isolate (per chain and endpoint) or its cache would never be hit. A failed
 * read fails the request; it is never reported as a zero balance.
 */
function ausdBalances(env: Pick<Env, "MONAD_RPC_URL">, chainId: number) {
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

/** The studio's balances where `CHAIN_ID` is unusable: every read is 503 BALANCES_UNAVAILABLE. */
const noBalances = {
  read: async (): Promise<number> => {
    throw new PilotError("BALANCES_UNAVAILABLE", "Balances are not available");
  },
  forget: (): void => {},
};

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
  const chainId = supportedChainId(env);
  const custody = custodyServices(env, repository.pool, authenticate, profiles, chainId);
  const walletAuth = walletAuthServices(env, repository.pool, authenticate);
  // One advice store and service per invocation, shared by the free and the paid request.
  const adviceStore = new PostgresAdviceStore(repository.pool);
  const adviceService = createAdviceService(adviceStore, {
    enabled: env.ADVICE_ENABLED === "true" && Boolean(env.RESEARCH_QUEUE),
    policy: parseAdvicePolicy(env.ADVICE_POLICY_JSON),
  });
  const paidAdvice = paidAdviceFrom(env, {
    advice: adviceService,
    repository: adviceStore,
    pool: repository.pool,
  });
  return {
    authenticate,
    advice: {
      authenticate,
      service: adviceService,
      ...(paidAdvice ? { paid: paidAdvice } : {}),
      notify: async () => {
        if (!env.RESEARCH_QUEUE) {
          throw new Error("Missing research queue");
        }
        await env.RESEARCH_QUEUE.send({ kind: "advice-wakeup" });
      },
    },
    ...(custody ? { custody } : {}),
    ...(walletAuth ? { walletAuth } : {}),
    growth: createGrowthServices(repository.pool, {
      tokenChainId: chainId,
      ...(env.PERPL_BOARD_NETWORK ? { perplBoardNetwork: env.PERPL_BOARD_NETWORK } : {}),
    }),
    launches: new PostgresLaunchReadModel(repository.pool),
    close: () => repository.close(),
    onboard: (userId) => directory.onboard(userId),
    studio: {
      // Deliberately no issuer: this delivery cannot grant or broadcast a real launch.
      tokens: createTokenLaunchService({
        repository: new PostgresTokenLaunchStore(repository.pool),
        chainId,
        ...(chainId === 143 || chainId === 10143
          ? { referenceEconomics: tokenReferenceEconomics(AUSD[chainId]) }
          : {}),
      }),
      perplMarkets: {
        catalog: (network, signal) =>
          new PerplMarketData().catalog(network, {
            signal,
            guard: async () => signal.throwIfAborted(),
          }),
      },
      accessRequests: new PostgresStudioAccessRequests(repository.pool),
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
      previews: new PostgresPreviewStore(repository.pool),
      wallets: new PostgresCustodyStore(repository.pool),
      walletChainId: chainId,
      balances: chainId === null ? noBalances : ausdBalances(env, chainId),
      ...(custody ? { custody: custody.custody } : {}),
      x: createXOAuthService({
        directory: directory,
        store: new PostgresXOAuthStore(
          repository.pool,
          env.X_TOKEN_ENCRYPTION_KEY ?? "",
          Number(env.X_TOKEN_ENCRYPTION_KEY_VERSION ?? "1"),
        ),
        provider: createXOAuthProvider({
          clientId: env.X_CLIENT_ID,
          clientSecret: env.X_CLIENT_SECRET,
          redirectUri: env.X_REDIRECT_URI,
          enabled:
            env.X_OAUTH_ENABLED === "true" &&
            /^[a-fA-F0-9]{64}$/.test(env.X_TOKEN_ENCRYPTION_KEY ?? "") &&
            /^[1-9]\d*$/.test(env.X_TOKEN_ENCRYPTION_KEY_VERSION ?? ""),
          readsEnabled: env.X_READS_ENABLED === "true",
        }),
        secrets: xSecrets(),
        policy: parseXApiPolicy(env.X_API_POLICY_JSON),
      }),
      transfers: { list: (userId) => listTransfers(repository.pool, userId) },
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
      // The Perpl paper runtime (perpl-paper-runtime-v1 §4): reads here; checks, approvals and
      // closes run in the research worker through RESEARCH_QUEUE.
      perps: {
        enabled: env.PERPL_RUNTIME_ENABLED === "true",
        store: new PostgresPerpsRuntimeStore(repository.pool),
        owner: new PostgresPerpsOwnerStore(repository.pool),
        paper: new PostgresPerpsPaperStore(repository.pool),
        marks: perpsBoardMarks,
        send: async (message) => {
          if (!env.RESEARCH_QUEUE) {
            throw new Error("Missing research queue");
          }
          await env.RESEARCH_QUEUE.send(message);
        },
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
