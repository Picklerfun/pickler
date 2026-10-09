import { PilotError } from "../research/types.js";
import type { Principal } from "../access/domain/principal.js";
import type { AdviceJob, AdviceRepository, AdviceSymbol, createAdviceService } from "./index.js";

export const X402_NETWORK = "monad-testnet";
export const AUSD_TESTNET = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const MAX_TIMEOUT_SECONDS = 300;
/**
 * How long past `validBefore` (server clock) a pending payment is kept before its nonce is read to
 * abandon it. It absorbs a server clock ahead of block time and an RPC some blocks behind, either of
 * which could read a nonce as unused while the broadcast transfer is still landing.
 */
export const PENDING_ABANDON_GRACE_SECONDS = 120;

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}
export interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: { signature: string; authorization: Authorization };
}
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  payTo: string;
  maxTimeoutSeconds: 300;
  asset: string;
  extra: { name: "Agora Dollar"; version: "1"; chainId: 10143 };
}
export type PaymentError =
  | "invalid_payment"
  | "invalid_signature"
  | "wrong_amount"
  | "wrong_recipient"
  | "expired"
  | "nonce_used"
  | "insufficient_funds"
  | "payer_not_linked"
  | "settlement_failed";
export interface SaleTerms {
  priceMicro: bigint;
  payTo: string;
  handle: string;
}
export interface AdvicePaymentRecord {
  id: string;
  jobId: string | null;
  status: "pending" | "settled" | "failed" | "refund_owed";
  txHash: string | null;
  payer: string;
  nonce: string;
  /** Unix seconds, decimal string. */
  validBefore: string;
}
export interface AdvicePaymentStore {
  saleTerms(publicAgentId: string): Promise<SaleTerms | null>;
  payerLinked(userId: string, address: string): Promise<boolean>;
  byKey(userId: string, publicAgentId: string, key: string): Promise<AdvicePaymentRecord | null>;
  insertPending(input: {
    userId: string;
    publicAgentId: string;
    key: string;
    authorization: Authorization;
  }): Promise<AdvicePaymentRecord>;
  settled(id: string, txHash: string, blockNumber: bigint): Promise<void>;
  failed(id: string, error: string): Promise<void>;
  attachJob(id: string, jobId: string): Promise<void>;
  refundOwed(id: string, error: string): Promise<void>;
}
export interface AdvicePaymentGateway {
  signatureValid(authorization: Authorization, signature: string): Promise<boolean>;
  nonceUsed(from: string, nonce: string): Promise<boolean>;
  balance(address: string): Promise<bigint>;
  /**
   * Submits `transferWithAuthorization` and waits for the receipt. Throws `SettlementRejected`
   * ONLY when the authorization provably never executed (simulation reverted before broadcast, or
   * a mined receipt with status reverted). Any other throw means the outcome is unknown: the
   * transaction may still mine until `validBefore`.
   */
  settle(
    authorization: Authorization,
    signature: string,
  ): Promise<{ txHash: string; blockNumber: bigint }>;
}

/** The settlement provably never executed; a new attempt for the same key is safe. */
export class SettlementRejected extends Error {
  constructor(message = "Settlement rejected") {
    super(message);
    this.name = "SettlementRejected";
  }
}

export class X402Refusal extends Error {
  constructor(
    public readonly reason: PaymentError,
    public readonly requirements: PaymentRequirements | null,
  ) {
    super(reason);
    this.name = "X402Refusal";
  }
}

export type PaidAdviceResult =
  | { kind: "payment_required"; requirements: PaymentRequirements; error: PaymentError | null }
  | { kind: "accepted"; job: AdviceJob; settlement: string | null };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NONCE = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const UINT = /^\d{1,78}$/;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

export function decodePaymentHeader(header: string): PaymentPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64(header.trim()));
  } catch {
    throw new X402Refusal("invalid_payment", null);
  }
  const envelope = record(parsed);
  const payload = record(envelope?.payload);
  const authorization = record(payload?.authorization);
  if (
    !envelope ||
    !payload ||
    !authorization ||
    envelope.x402Version !== 1 ||
    envelope.scheme !== "exact" ||
    envelope.network !== X402_NETWORK ||
    !matches(payload.signature, SIGNATURE) ||
    !matches(authorization.from, ADDRESS) ||
    !matches(authorization.to, ADDRESS) ||
    !matches(authorization.value, UINT) ||
    !matches(authorization.validAfter, UINT) ||
    !matches(authorization.validBefore, UINT) ||
    !matches(authorization.nonce, NONCE)
  ) {
    throw new X402Refusal("invalid_payment", null);
  }
  return {
    x402Version: 1,
    scheme: "exact",
    network: X402_NETWORK,
    payload: {
      signature: payload.signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce,
      },
    },
  };
}

export function encodeSettlement(input: { transaction: string; payer: string }): string {
  return toBase64(
    JSON.stringify({
      success: true,
      transaction: input.transaction,
      network: X402_NETWORK,
      payer: input.payer,
    }),
  );
}

function staticRefusal(
  authorization: Authorization,
  terms: SaleTerms,
  nowSeconds: bigint,
): PaymentError | null {
  if (authorization.to.toLowerCase() !== terms.payTo.toLowerCase()) {
    return "wrong_recipient";
  }
  if (authorization.value !== terms.priceMicro.toString()) {
    return "wrong_amount";
  }
  const validAfter = BigInt(authorization.validAfter);
  const validBefore = BigInt(authorization.validBefore);
  if (validBefore <= nowSeconds) {
    return "expired";
  }
  if (validBefore - nowSeconds > BigInt(MAX_TIMEOUT_SECONDS)) {
    return "expired";
  }
  if (validAfter > nowSeconds) {
    return "expired";
  }
  return null;
}

export function createPaidAdvice(deps: {
  advice: ReturnType<typeof createAdviceService>;
  repository: AdviceRepository;
  store: AdvicePaymentStore;
  gateway: AdvicePaymentGateway;
  now: () => number;
  resourceBase: string;
}) {
  const requirementsFor = (
    publicAgentId: string,
    symbol: AdviceSymbol,
    terms: SaleTerms,
  ): PaymentRequirements => ({
    scheme: "exact",
    network: X402_NETWORK,
    maxAmountRequired: terms.priceMicro.toString(),
    resource: `${deps.resourceBase}/v1/agent-advice/agents/${publicAgentId}/recommendations`,
    description: `Fresh 24-hour ${symbol} analysis by @${terms.handle}`,
    mimeType: "application/json",
    payTo: terms.payTo,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    asset: AUSD_TESTNET,
    extra: { name: "Agora Dollar", version: "1", chainId: 10143 },
  });
  const enqueue = async (
    principal: Principal,
    publicAgentId: string,
    symbol: AdviceSymbol,
    key: string,
    paymentId: string,
  ): Promise<AdviceJob> => {
    // An enqueue failure leaves the payment settled without a job, so the same key reuses it (D7).
    const job = await deps.advice.request(principal, publicAgentId, symbol, key);
    await deps.store.attachJob(paymentId, job.id);
    return job;
  };
  // A pending payment is abandoned once its authorization expired, plus the grace, without the
  // nonce being used.
  const abandoned = async (record: AdvicePaymentRecord): Promise<boolean> => {
    const abandonAt = Number(record.validBefore) + PENDING_ABANDON_GRACE_SECONDS;
    if (abandonAt > deps.now() / 1000) {
      return false;
    }
    return !(await deps.gateway.nonceUsed(record.payer, record.nonce));
  };
  return {
    async request(
      principal: Principal,
      publicAgentId: string,
      symbol: AdviceSymbol,
      key: string,
      header: string | undefined,
    ): Promise<PaidAdviceResult> {
      if (principal.kind !== "user") {
        throw new PilotError("FORBIDDEN", "User session required");
      }
      const userId = principal.id;
      const replay = await deps.repository.requestReplay(userId, publicAgentId, key);
      if (replay) {
        if (replay.symbol !== symbol) {
          throw new PilotError("CONFLICT", "Idempotency key belongs to another request");
        }
        return { kind: "accepted", job: replay, settlement: null };
      }
      await deps.advice.admit(principal, publicAgentId, symbol);
      const existing = await deps.store.byKey(userId, publicAgentId, key);
      if (existing?.status === "settled" && existing.jobId !== null) {
        const job = await deps.repository.get(existing.jobId);
        return { kind: "accepted", job, settlement: null };
      }
      if (existing?.status === "settled") {
        const job = await enqueue(principal, publicAgentId, symbol, key, existing.id);
        return { kind: "accepted", job, settlement: null };
      }
      const terms = await deps.store.saleTerms(publicAgentId);
      if (!terms) {
        throw new PilotError("NOT_FOUND", "ADVICE_NOT_FOR_SALE");
      }
      const requirements = requirementsFor(publicAgentId, symbol, terms);
      if (existing?.status === "refund_owed") {
        return { kind: "payment_required", requirements, error: "invalid_payment" };
      }
      if (existing?.status === "pending") {
        if (!(await abandoned(existing))) {
          return { kind: "payment_required", requirements, error: "invalid_payment" };
        }
        await deps.store.failed(existing.id, "expired_unsettled");
      }
      if (header === undefined) {
        return { kind: "payment_required", requirements, error: null };
      }
      let payment: PaymentPayload;
      try {
        payment = decodePaymentHeader(header);
      } catch (error) {
        if (error instanceof X402Refusal) {
          return { kind: "payment_required", requirements, error: error.reason };
        }
        throw error;
      }
      const { authorization, signature } = payment.payload;
      const nowSeconds = BigInt(Math.floor(deps.now() / 1000));
      const refusal = staticRefusal(authorization, terms, nowSeconds);
      if (refusal) {
        return { kind: "payment_required", requirements, error: refusal };
      }
      if (!(await deps.store.payerLinked(userId, authorization.from.toLowerCase()))) {
        return { kind: "payment_required", requirements, error: "payer_not_linked" };
      }
      if (!(await deps.gateway.signatureValid(authorization, signature))) {
        return { kind: "payment_required", requirements, error: "invalid_signature" };
      }
      if (await deps.gateway.nonceUsed(authorization.from, authorization.nonce)) {
        return { kind: "payment_required", requirements, error: "nonce_used" };
      }
      if ((await deps.gateway.balance(authorization.from)) < terms.priceMicro) {
        return { kind: "payment_required", requirements, error: "insufficient_funds" };
      }
      const pending = await deps.store.insertPending({
        userId,
        publicAgentId,
        key,
        authorization,
      });
      let receipt: { txHash: string; blockNumber: bigint };
      try {
        receipt = await deps.gateway.settle(authorization, signature);
      } catch (error) {
        // Only a proven rejection frees the key; an unknown outcome stays pending (may still mine).
        if (error instanceof SettlementRejected) {
          await deps.store.failed(pending.id, "settlement_failed");
        }
        return { kind: "payment_required", requirements, error: "settlement_failed" };
      }
      await deps.store.settled(pending.id, receipt.txHash, receipt.blockNumber);
      const job = await enqueue(principal, publicAgentId, symbol, key, pending.id);
      const settlement = encodeSettlement({
        transaction: receipt.txHash,
        payer: authorization.from,
      });
      return { kind: "accepted", job, settlement };
    },
  };
}
