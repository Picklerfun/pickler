// Types of the paid agent advice (docs/specs/agent-advice-x402-v1.md §3.2, fee split §4). Copies of
// the wire in @pickler/api-schema, written by hand: importing the package would move the app's tree.

export type Hex = `0x${string}`;

/** A Studio agent that sells analyses: a marketplace row with a price, perps or both venues. */
export type StudioAgent = {
  id: string; name: string; handle: string; accent: string; venue: "perps" | "both";
  /** `micro` is the price in micro-AUSD; `text` is the server's decimal amount, e.g. "1.5". */
  price: { micro: bigint; text: string };
};

export type AdviceSymbol = "BTC" | "ETH";
export type AdviceStatus = "queued" | "running" | "completed" | "failed";
export type AdviceJobError = "ANALYSIS_FAILED" | "ANALYSIS_INTERRUPTED" | "ANALYSIS_EXPIRED";

export type AdviceSource = { id: string; name: string; url: string; observedAt: string };

export type AdviceResult = {
  version: 1; symbol: AdviceSymbol; network: "mainnet" | "testnet"; horizonHours: 24;
  orientation: "long" | "short" | "wait"; summary: string;
  reasons: string[]; risks: string[]; limitations: string[]; sources: AdviceSource[];
  /** ISO UTC, as the server sends them. */
  generatedAt: string; dataAsOf: string;
};

export type Recommendation = {
  id: string; agentId: string; symbol: AdviceSymbol; status: AdviceStatus;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  result: AdviceResult | null; error: AdviceJobError | null;
};

export type AdviceAccepted = { id: string; status: AdviceStatus; statusUrl: string };
export type AdviceHistory = { items: Recommendation[]; nextCursor: string | null };

/** The refusals a 402 may carry. "X-PAYMENT header is required" is not one: it parses as `null`. */
export type PaymentError =
  | "invalid_payment" | "invalid_signature" | "wrong_amount" | "wrong_recipient" | "expired"
  | "nonce_used" | "insufficient_funds" | "payer_not_linked" | "settlement_failed";

/**
 * The 402's `accepts[0]`, as received. `checkTerms` compares every field with the app's own
 * constants before anything is signed; nothing here is trusted until it says "ok".
 */
export type Terms = {
  payTo: Hex; payee: Hex; value: bigint; maxTimeoutSeconds: number; resource: string;
  x402Version: number; scheme: string; network: string; asset: string;
  name: string; version: string; chainId: number; primaryType: string;
  creatorBps: number; protocolBps: number; nonceDerivation: string;
};

/** The EIP-3009 `ReceiveWithAuthorization` the buyer signs, plus the unsigned `salt`. */
export type Authorization = {
  from: Hex; to: Hex; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; salt: Hex;
};

export type PollState =
  | { kind: "waiting"; since: number }
  | { kind: "done"; recommendation: Recommendation }
  | { kind: "failed"; error: AdviceJobError }
  | { kind: "timeout" };

/** One poll's outcome: the job as read, or a fetch that failed (network, 5xx, bad body). */
export type PollResponse = { ok: true; recommendation: Recommendation } | { ok: false };
