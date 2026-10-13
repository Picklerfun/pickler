// LOCAL TEST TOOL — never deploy. A stand-in for the product API that lets the iOS app on the
// simulator pay a Studio agent's advice with x402. Identity and the database are fakes kept in
// memory. The payment is REAL: core's createPaidAdvice and infrastructure's AUSD gateway settle
// through the deployed PicklerAdviceSplitter on Monad testnet. The analysis is REAL too: the
// production advice runner over public Perpl testnet data and the chat model in
// .local-x402/model.env (scripts/advice/local-analysis.ts). Read scripts/advice/README.md.
//
// Run from the repository root: node --import tsx scripts/advice/local-x402-server.ts

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createPublicClient, defineChain, formatEther, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { generateSiweNonce } from "viem/siwe";
import { z } from "zod";
import * as dto from "@pickler/api-schema";
import {
  DEFAULT_CONFIG,
  PilotError,
  adviceShares,
  buildUserPrincipal,
  createAdviceService,
  createPaidAdvice,
  type AdviceAgent,
  type AdviceJob,
  type AdvicePaymentRecord,
  type AdvicePaymentStore,
  type AdvicePolicy,
  type AdviceRepository,
} from "@pickler/core";
import {
  buildSiweMessage,
  createAusdAuthorizationGateway,
  createSignatureVerifier,
  parseSiweMessage,
} from "@pickler/infrastructure";
import {
  createLocalAdviceModels,
  createLocalAnalysis,
  parseModelEnv,
  readPerplEvidence,
} from "./local-analysis.ts";

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

const HOST = "127.0.0.1";
const PORT = Number(process.env.LOCAL_X402_PORT ?? 8899);
const BASE = "/v1";
const RPC_URL = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const CHAIN_ID = 10143;
const SPLITTER = "0x570A291Ac86d2F002Bc62E7d12ba43B7F4554d2a";
const TREASURY = "0xE84B9045c4735241A71e5c6976695e59A5A7758c";
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const SIWE_DOMAIN = "pickler.fun";
const SIGN_IN_STATEMENT = "Sign in to Pickler";
const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 60 * 60_000;
const BODY_LIMIT = 8192;
const PRICE_MICRO = 1_500_000n;
const AGENT_ID = "6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607";
const AGENT_HANDLE = "perpsanalyst";
const AGENT_NAME = "Pickler Perps Analyst";
const AGENT_SLUG = "pickler-perps-analyst";
const PROFILE_HANDLE = "localbuyer";

// Run from the repository root (the files are resolved against the working directory).
const ENV_FILE = process.env.LOCAL_X402_ENV ?? resolve(process.cwd(), ".local-x402/env");
const MODEL_ENV_FILE =
  process.env.LOCAL_X402_MODEL_ENV ?? resolve(process.cwd(), ".local-x402/model.env");

function readEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    values[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return values;
}

// The model goes first: without it there is no analysis to sell, and nothing else is read.
if (!existsSync(MODEL_ENV_FILE)) {
  console.error(
    `REFUSING TO START: ${MODEL_ENV_FILE} does not exist. Create it (mode 600) with MODEL_BASE_URL, MODEL_ID and MODEL_API_KEY of an OpenAI-compatible chat model; there is no canned analysis.`,
  );
  process.exit(1);
}
let modelSettings: ReturnType<typeof parseModelEnv>;
try {
  modelSettings = parseModelEnv(readEnvFile(MODEL_ENV_FILE), MODEL_ENV_FILE);
} catch (error) {
  console.error("REFUSING TO START:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const env = readEnvFile(ENV_FILE);
const relayerKey = env.RELAYER_PRIVATE_KEY ?? "";
const agentWallet = env.AGENT_WALLET ?? "";
if (!/^0x[0-9a-fA-F]{64}$/.test(relayerKey)) {
  throw new Error(`RELAYER_PRIVATE_KEY in ${ENV_FILE} is missing or not a 32-byte hex key`);
}
if (!isAddress(agentWallet)) {
  throw new Error(`AGENT_WALLET in ${ENV_FILE} is missing or not an address`);
}
const relayerAddress = privateKeyToAccount(relayerKey as `0x${string}`).address;
if (env.RELAYER_ADDRESS && env.RELAYER_ADDRESS.toLowerCase() !== relayerAddress.toLowerCase()) {
  throw new Error("RELAYER_ADDRESS does not match the address of RELAYER_PRIVATE_KEY");
}

// ---------------------------------------------------------------------------------------------
// Identity: SIWE nonce/verify, opaque bearer tokens, a fixed profile
// ---------------------------------------------------------------------------------------------

interface Session {
  userId: string;
  address: string;
  expiresAt: number;
}
const nonces = new Map<string, { address: string; expiresAt: number }>();
const sessions = new Map<string, Session>();
const users = new Map<string, string>();
const signatureVerifier = createSignatureVerifier();

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * An opaque token shaped like a JWT only so the app can read `exp` (it never reuses a token whose
 * expiry it cannot read). The server never decodes it: it is a key into `sessions`.
 */
function issueToken(session: Session): string {
  const header = base64url({ alg: "none", typ: "JWT" });
  const payload = base64url({
    sub: session.userId,
    exp: Math.floor(session.expiresAt / 1000),
    local: true,
  });
  const token = `${header}.${payload}.${randomBytes(24).toString("base64url")}`;
  sessions.set(token, session);
  return token;
}

function sessionOf(req: IncomingMessage): Session | null {
  const [scheme, value] = (req.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !value) {
    return null;
  }
  const session = sessions.get(value);
  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }
  return session;
}

// ---------------------------------------------------------------------------------------------
// Advice: in-memory repository and payment store around core's real services
// ---------------------------------------------------------------------------------------------

const policy: AdvicePolicy = {
  version: 1,
  jevModel: "jev-1.13.0",
  deepseekModel: "local-test",
  inputRates: { jev: "0", deepseek: "0" },
  outputRates: { jev: "0", deepseek: "0" },
  webSearchUsd: "0",
  requestLimitUsd: "0",
  dailyLimitUsd: "0",
  pricingVerifiedAt: "2026-10-12T00:00:00Z",
  pricingSources: ["https://localhost/local-test"],
};
const agent: AdviceAgent = {
  publicId: AGENT_ID,
  tenantId: "local-tenant",
  agentId: "local-runtime",
  version: 1,
  config: {
    ...DEFAULT_CONFIG,
    tools: ["getPerpSnapshot", "getPerpOrderBook", "getPerpCandles"],
    plugins: { version: 1, enabled: ["perpl"] },
    perpl: { version: 1, network: "testnet", markets: ["BTC", "ETH"] },
  } as unknown as AdviceAgent["config"],
  published: true,
  enabled: true,
};
const agentCreatedAt = new Date().toISOString();
const jobs = new Map<string, AdviceJob>();
const jobsByKey = new Map<string, string>();
const keyOf = (userId: string, publicId: string, key: string) => `${userId}|${publicId}|${key}`;

const analyze = createLocalAnalysis({
  resolve: (publicId) => repository.resolve(publicId),
  data: readPerplEvidence,
  models: createLocalAdviceModels(modelSettings),
  now: () => Date.now(),
  log: (line) => console.log(line),
});

const repository: AdviceRepository = {
  async resolve(publicId) {
    if (publicId !== AGENT_ID) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    return agent;
  },
  async enqueue(userId, publicId, symbol, key) {
    const existing = jobsByKey.get(keyOf(userId, publicId, key));
    if (existing) {
      const job = jobs.get(existing)!;
      if (job.symbol !== symbol) {
        throw new PilotError("CONFLICT", "Idempotency key belongs to another request");
      }
      return job;
    }
    const job: AdviceJob = {
      id: randomUUID(),
      publicAgentId: publicId,
      userId,
      tenantId: agent.tenantId,
      agentId: agent.agentId,
      symbol,
      status: "queued",
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      configVersion: agent.version,
      config: agent.config,
      policy,
      result: null,
      error: null,
    };
    jobs.set(job.id, job);
    jobsByKey.set(keyOf(userId, publicId, key), job.id);
    console.log(`  job ${job.id} queued (${symbol})`);
    // After the reply: the analysis runs in the background and the app polls the job.
    setImmediate(() => {
      void analyze(job);
    });
    return job;
  },
  async get(id) {
    const job = jobs.get(id);
    if (!job) {
      throw new PilotError("NOT_FOUND", "Analysis not found");
    }
    return job;
  },
  async requestReplay(userId, publicId, key) {
    const id = jobsByKey.get(keyOf(userId, publicId, key));
    return id ? jobs.get(id)! : null;
  },
  async history(publicId, symbol) {
    const items = [...jobs.values()]
      .filter((job) => job.publicAgentId === publicId && job.status === "completed")
      .filter((job) => symbol === undefined || job.symbol === symbol)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 20);
    return { items, nextCursor: null };
  },
};

interface PaymentRow extends AdvicePaymentRecord {
  userId: string;
  publicAgentId: string;
  key: string;
}
const payments = new Map<string, PaymentRow>();
const IN_PROGRESS = "An advice payment for this request is already in progress";
const publicRecord = ({ id, jobId, status, txHash, payer, nonce, validBefore }: PaymentRow) => ({
  id,
  jobId,
  status,
  txHash,
  payer,
  nonce,
  validBefore,
});

/** PostgresAdvicePayments' semantics in memory: status-guarded writes, upsert over failed only. */
const store: AdvicePaymentStore = {
  async saleTerms(publicAgentId) {
    if (publicAgentId !== AGENT_ID) {
      return null;
    }
    return { priceMicro: PRICE_MICRO, payee: agentWallet, handle: AGENT_HANDLE };
  },
  async payerLinked(userId, address) {
    const linked = [...sessions.values()].some(
      (session) =>
        session.userId === userId && session.address.toLowerCase() === address.toLowerCase(),
    );
    return linked || users.get(address.toLowerCase()) === userId;
  },
  async byKey(userId, publicAgentId, key) {
    const row = [...payments.values()].find(
      (it) => it.userId === userId && it.publicAgentId === publicAgentId && it.key === key,
    );
    return row ? publicRecord(row) : null;
  },
  async insertPending({ userId, publicAgentId, key, authorization }) {
    const existing = [...payments.values()].find(
      (it) => it.userId === userId && it.publicAgentId === publicAgentId && it.key === key,
    );
    if (existing && existing.status !== "failed") {
      throw new PilotError("CONFLICT", IN_PROGRESS);
    }
    const nonceTaken = [...payments.values()].some(
      (it) =>
        it !== existing &&
        it.status !== "failed" &&
        it.payer === authorization.from.toLowerCase() &&
        it.nonce === authorization.nonce.toLowerCase(),
    );
    if (nonceTaken) {
      throw new PilotError("CONFLICT", IN_PROGRESS);
    }
    if (existing) {
      payments.delete(existing.id);
    }
    const row: PaymentRow = {
      id: randomUUID(),
      jobId: null,
      status: "pending",
      txHash: null,
      payer: authorization.from.toLowerCase(),
      nonce: authorization.nonce.toLowerCase(),
      validBefore: authorization.validBefore,
      userId,
      publicAgentId,
      key,
    };
    payments.set(row.id, row);
    return publicRecord(row);
  },
  async settled(id, txHash) {
    const row = payments.get(id);
    if (row?.status === "pending") {
      row.status = "settled";
      row.txHash = txHash;
    }
  },
  async failed(id, error) {
    const row = payments.get(id);
    if (row?.status === "pending") {
      row.status = "failed";
      console.log(`  payment ${id} failed: ${error}`);
    }
  },
  async refundOwed(id, error) {
    const row = payments.get(id);
    if (row?.status === "settled") {
      row.status = "refund_owed";
      console.log(`  payment ${id} refund owed: ${error}`);
    }
  },
  async attachJob(id, jobId) {
    const row = payments.get(id);
    if (row?.status === "settled" && row.jobId === null) {
      row.jobId = jobId;
    }
  },
};

const realGateway = createAusdAuthorizationGateway({
  rpcUrl: RPC_URL,
  relayerPrivateKey: relayerKey as `0x${string}`,
  splitter: SPLITTER,
  treasury: TREASURY,
  asset: AUSD,
  chainId: CHAIN_ID,
});
/** The real gateway, with the settlement logged: hash and shares, never the signature. */
const gateway: typeof realGateway = {
  ...realGateway,
  async settle(authorization, signature, payee) {
    console.log(
      `  SETTLING ${authorization.value} micro-AUSD from ${authorization.from} via splitter (payee ${payee})`,
    );
    const receipt = await realGateway.settle(authorization, signature, payee);
    console.log(
      `  SETTLED tx ${receipt.txHash} block ${receipt.blockNumber} creator ${receipt.creatorAmount} protocol ${receipt.protocolAmount} micro-AUSD`,
    );
    return receipt;
  },
};

const advice = createAdviceService(repository, { enabled: true, policy });
const paid = createPaidAdvice({
  advice,
  repository,
  store,
  gateway,
  now: () => Date.now(),
  resourceBase: `http://localhost:${PORT}`,
  splitter: SPLITTER,
  reportUnrecordedSettlement(settlement) {
    console.error(
      `  UNRECORDED SETTLEMENT ${settlement.reason} payment ${settlement.paymentId} payer ${settlement.payer} nonce ${settlement.nonce} tx ${settlement.txHash ?? "unknown"}`,
    );
  },
});

function publicJob(job: AdviceJob) {
  let error: "ANALYSIS_FAILED" | "ANALYSIS_EXPIRED" | "ANALYSIS_INTERRUPTED" | null = null;
  if (job.status === "failed") {
    error = "ANALYSIS_FAILED";
  }
  return dto.adviceRecommendationSchema.parse({
    id: job.id,
    agentId: job.publicAgentId,
    symbol: job.symbol,
    status: job.status,
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: job.startedAt === null ? null : new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt === null ? null : new Date(job.finishedAt).toISOString(),
    result: job.result,
    error,
  });
}

const agentSummary = () =>
  dto.agentSummarySchema.parse({
    id: AGENT_ID,
    advicePrice: { amount: "1.5", asset: "AUSD", decimals: 6 },
    slug: AGENT_SLUG,
    name: AGENT_NAME,
    handle: AGENT_HANDLE,
    ticker: null,
    beat: "BTC and ETH perps, 24-hour view",
    accent: "lime",
    venue: "perps",
    createdAt: agentCreatedAt,
    resolved: 0,
    hitRate: null,
    net: 0,
    token: null,
  });

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const envelope = (data: unknown, path: string, message = "Success", statusCode = 200) => ({
  success: true,
  message,
  data,
  statusCode,
  timestamp: new Date().toISOString(),
  path,
});

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) {
      throw new HttpError(413, "Request exceeds its limit", "INVALID_INPUT");
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function requireSession(req: IncomingMessage): Session {
  const session = sessionOf(req);
  if (!session) {
    throw new HttpError(401, "Missing or invalid bearer token");
  }
  return session;
}

const ADVICE_STATUSES: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  MARKET_NOT_ALLOWED: 400,
  CONFLICT: 409,
  ADVICE_BUSY: 429,
  ADVICE_UNAVAILABLE: 503,
  ADVICE_COST_UNKNOWN: 503,
  ADVICE_BUDGET_EXCEEDED: 429,
};

/** The advice route's onError: PilotErrors to their statuses, schema failures to 400. */
function adviceError(error: unknown): never {
  if (error instanceof PilotError) {
    if (error.code === "NOT_FOUND" && error.message === "ADVICE_NOT_FOR_SALE") {
      throw new HttpError(404, "Agent analyses are not for sale", "ADVICE_NOT_FOR_SALE");
    }
    const status = ADVICE_STATUSES[error.code];
    throw new HttpError(
      status ?? 500,
      "Analysis request could not be processed",
      status ? error.code : "ANALYSIS_FAILED",
    );
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    throw new HttpError(400, "Invalid analysis request", "INVALID_INPUT");
  }
  throw error;
}

async function nonce(req: IncomingMessage, path: string): Promise<Reply> {
  const body = (await readJson(req)) as { address?: unknown; chain_id?: unknown } | null;
  if (typeof body?.address !== "string" || typeof body.chain_id !== "number") {
    throw new HttpError(400, "An address and a chain id are required to build the message");
  }
  if (!isAddress(body.address)) {
    throw new HttpError(400, "That is not an address", "invalid_address");
  }
  if (body.chain_id !== CHAIN_ID) {
    throw new HttpError(400, "This local server only signs in on Monad testnet", "invalid_chain");
  }
  const value = generateSiweNonce();
  nonces.set(value, { address: body.address.toLowerCase(), expiresAt: Date.now() + NONCE_TTL_MS });
  const message = buildSiweMessage({
    domain: SIWE_DOMAIN,
    address: getAddress(body.address),
    statement: SIGN_IN_STATEMENT,
    uri: `https://${SIWE_DOMAIN}`,
    chainId: CHAIN_ID,
    nonce: value,
    issuedAt: new Date(),
  });
  return { status: 200, body: envelope({ message, nonce: value }, path) };
}

async function verify(req: IncomingMessage, path: string): Promise<Reply> {
  const body = (await readJson(req)) as { raw?: unknown; signature?: unknown } | null;
  if (typeof body?.raw !== "string" || typeof body.signature !== "string") {
    throw new HttpError(400, "The exact string signed and its signature are both required");
  }
  let signed: ReturnType<typeof parseSiweMessage>;
  try {
    signed = parseSiweMessage(body.raw);
  } catch {
    throw new HttpError(400, "That is not a Pickler sign-in message", "invalid_message");
  }
  const issued = nonces.get(signed.nonce);
  nonces.delete(signed.nonce);
  if (
    !issued ||
    issued.expiresAt <= Date.now() ||
    issued.address !== signed.address.toLowerCase()
  ) {
    throw new HttpError(400, "That sign-in nonce is unknown or expired", "nonce_invalid");
  }
  if (signed.domain !== SIWE_DOMAIN) {
    throw new HttpError(400, "That signature was for a different site", "wrong_domain");
  }
  if (signed.statement !== SIGN_IN_STATEMENT || signed.chainReference !== CHAIN_ID) {
    throw new HttpError(400, "That signature was for something else", "wrong_purpose");
  }
  const valid = await signatureVerifier.verify({
    message: body.raw,
    signature: body.signature,
    address: signed.address,
  } as Parameters<typeof signatureVerifier.verify>[0]);
  if (!valid) {
    throw new HttpError(401, "That signature does not match the address");
  }
  const address = signed.address.toLowerCase();
  const userId = users.get(address) ?? randomUUID();
  users.set(address, userId);
  const accessToken = issueToken({ userId, address, expiresAt: Date.now() + SESSION_TTL_MS });
  console.log(`  signed in ${address} as ${userId}`);
  return {
    status: 200,
    body: envelope(
      { userId, session: { accessToken, refreshToken: randomBytes(24).toString("base64url") } },
      path,
      "Signed in",
    ),
  };
}

function profile(session: Session) {
  return {
    user_id: session.userId,
    display_name: PROFILE_HANDLE,
    handle: PROFILE_HANDLE,
    created_at: agentCreatedAt,
  };
}

async function adviceRequest(req: IncomingMessage, path: string, agentId: string): Promise<Reply> {
  const session = requireSession(req);
  try {
    const id = z.string().uuid().parse(agentId);
    const body = dto.adviceRequestSchema.parse(await readJson(req));
    const headerKey = req.headers["idempotency-key"];
    const key = dto.idempotencyKeySchema.parse(Array.isArray(headerKey) ? headerKey[0] : headerKey);
    const payment = req.headers["x-payment"];
    const principal = buildUserPrincipal({ user: { id: session.userId } });
    const result = await paid.request(
      principal,
      id,
      body.symbol,
      key,
      Array.isArray(payment) ? payment[0] : payment,
    );
    if (result.kind === "payment_required") {
      const refusal = dto.paymentRequiredSchema.parse({
        x402Version: 1,
        error: result.error ?? "X-PAYMENT header is required",
        accepts: [result.requirements],
      });
      console.log(`  402 ${refusal.error}`);
      return { status: 402, body: refusal };
    }
    const accepted = dto.adviceAcceptedSchema.parse({
      id: result.job.id,
      status: result.job.status,
      statusUrl: `/v1/agent-advice/recommendations/${result.job.id}`,
    });
    const headers: Record<string, string> = {};
    if (result.settlement) {
      headers["X-PAYMENT-RESPONSE"] = result.settlement;
      const shares = adviceShares(PRICE_MICRO);
      console.log(
        `  accepted with settlement (shares creator ${shares.creator} / protocol ${shares.protocol})`,
      );
    } else {
      console.log("  accepted (replay, no charge)");
    }
    return { status: 202, body: envelope(accepted, path, "Analysis accepted", 202), headers };
  } catch (error) {
    adviceError(error);
  }
}

async function route(req: IncomingMessage, url: URL): Promise<Reply> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  if (!path.startsWith(`${BASE}/`) && path !== BASE) {
    throw new HttpError(404, "Route not found");
  }
  const rest = path.slice(BASE.length);
  let match: RegExpExecArray | null;

  if (method === "GET" && rest === "/health") {
    return { status: 200, body: envelope({ status: "ok" }, path) };
  }
  if (method === "POST" && rest === "/auth/wallet/nonce") {
    return nonce(req, path);
  }
  if (method === "POST" && rest === "/auth/wallet/verify") {
    return verify(req, path);
  }
  if (method === "GET" && rest === "/profile") {
    return { status: 200, body: envelope(profile(requireSession(req)), path, "Profile retrieved") };
  }
  if (method === "POST" && rest === "/profile") {
    // The account already has its fixed username, as if claimed before.
    requireSession(req);
    throw new HttpError(409, "This account already has a username", "profile_exists");
  }
  if (method === "GET" && (match = /^\/handles\/([^/]+)\/availability$/.exec(rest))) {
    const handle = decodeURIComponent(match[1]!);
    return {
      status: 200,
      body: envelope({ handle, available: handle !== PROFILE_HANDLE, reason: null }, path),
    };
  }
  if (method === "GET" && rest === "/marketplace/agents") {
    return { status: 200, body: [agentSummary()] };
  }
  if (
    method === "POST" &&
    (match = /^\/agent-advice\/agents\/([^/]+)\/recommendations$/.exec(rest))
  ) {
    return adviceRequest(req, path, match[1]!);
  }
  if (method === "GET" && (match = /^\/agent-advice\/recommendations\/([^/]+)$/.exec(rest))) {
    const session = requireSession(req);
    try {
      const id = z.string().uuid().parse(match[1]);
      const principal = buildUserPrincipal({ user: { id: session.userId } });
      return { status: 200, body: envelope(publicJob(await advice.get(principal, id)), path) };
    } catch (error) {
      adviceError(error);
    }
  }
  if (
    method === "GET" &&
    (match = /^\/agent-advice\/agents\/([^/]+)\/recommendations$/.exec(rest))
  ) {
    const session = requireSession(req);
    try {
      const id = z.string().uuid().parse(match[1]);
      const symbol = dto.adviceSymbolSchema
        .optional()
        .parse(url.searchParams.get("symbol") ?? undefined);
      const principal = buildUserPrincipal({ user: { id: session.userId } });
      const page = await advice.history(principal, id, symbol);
      const history = dto.adviceHistorySchema.parse({
        items: page.items.map(publicJob),
        nextCursor: page.nextCursor,
      });
      return { status: 200, body: envelope(history, path) };
    } catch (error) {
      adviceError(error);
    }
  }
  throw new HttpError(404, "Route not found");
}

function send(res: ServerResponse, reply: Reply) {
  res.writeHead(reply.status, {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    ...reply.headers,
  });
  res.end(JSON.stringify(reply.body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const started = Date.now();
  route(req, url)
    .catch((error: unknown): Reply => {
      if (error instanceof HttpError) {
        return {
          status: error.status,
          body: {
            success: false,
            message: error.message,
            statusCode: error.status,
            timestamp: new Date().toISOString(),
            path: url.pathname,
            ...(error.code ? { error: error.code } : {}),
          },
        };
      }
      console.error("  unexpected error:", error instanceof Error ? error.message : String(error));
      return {
        status: 500,
        body: { success: false, message: "Internal error", statusCode: 500, path: url.pathname },
      };
    })
    .then((reply) => {
      send(res, reply);
      const paidHeader = req.headers["x-payment"] ? " [X-PAYMENT]" : "";
      console.log(
        `${req.method} ${url.pathname}${paidHeader} -> ${reply.status} (${Date.now() - started} ms)`,
      );
    });
});

// ---------------------------------------------------------------------------------------------
// Start-up checks against the chain
// ---------------------------------------------------------------------------------------------

async function preflight() {
  const chain = defineChain({
    id: CHAIN_ID,
    name: "Monad Testnet",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const client = createPublicClient({ chain, transport: http(RPC_URL) });
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) {
    throw new Error(`RPC ${RPC_URL} is chain ${chainId}, not ${CHAIN_ID}`);
  }
  const treasury = await realGateway.splitterTreasury();
  const asset = await realGateway.splitterAsset();
  if (treasury.toLowerCase() !== TREASURY.toLowerCase()) {
    throw new Error(`splitter.treasury() is ${treasury}, expected ${TREASURY}`);
  }
  if (asset.toLowerCase() !== AUSD.toLowerCase()) {
    throw new Error(`splitter.asset() is ${asset}, expected ${AUSD}`);
  }
  const balance = await client.getBalance({ address: relayerAddress });
  console.log("LOCAL x402 TEST SERVER — real AUSD moves on Monad testnet. Never deploy this.");
  console.log(`  chain        ${chainId}`);
  console.log(`  splitter     ${SPLITTER} (treasury and asset verified)`);
  console.log(`  treasury     ${treasury}`);
  console.log(`  asset        ${asset}`);
  console.log(`  agent wallet ${agentWallet} (payee)`);
  console.log(`  relayer      ${relayerAddress}  ${formatEther(balance)} MON`);
  console.log(
    `  model        ${modelSettings.model} at ${new URL(modelSettings.baseUrl).host} (response_format ${modelSettings.responseFormat})`,
  );
  if (balance === 0n) {
    console.warn("  WARNING: the relayer has no MON; settlements will fail.");
  }
}

// The root package is CommonJS, so tsx refuses top-level await: start inside a promise chain.
preflight()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`  listening    http://${HOST}:${PORT}${BASE}  (agent ${AGENT_ID})`);
    });
  })
  .catch((error: unknown) => {
    console.error("REFUSING TO START:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
