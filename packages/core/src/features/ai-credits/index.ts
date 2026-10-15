/** Purchased credits are service units, never USD, AUSD or provider tokens. */
export const AI_CREDIT_SCALE = 1_000_000n;
export const AI_CREDIT_MAX = 10n ** 30n - 1n;
export class AiCreditError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AiCreditError";
  }
}
export function creditUnits(value: string): bigint {
  if (!/^(0|[1-9]\d{0,29})$/.test(value)) {
    throw new AiCreditError("INVALID_CREDITS", "Expected canonical integer credit units");
  }
  return BigInt(value);
}
export interface AiCreditRate {
  provider: string;
  model: string;
  inputUnitsPerMillion: string;
  outputUnitsPerMillion: string;
}
export interface AiCreditPricing {
  id: string;
  version: string;
  reviewedAt: string;
  rates: readonly AiCreditRate[];
}
export function validateCreditPricing(pricing: AiCreditPricing): void {
  if (!pricing.version.trim() || !Number.isFinite(Date.parse(pricing.reviewedAt))) {
    throw new AiCreditError("INVALID_PRICING", "Reviewed versioned pricing required");
  }
  const keys = new Set<string>();
  for (const rate of pricing.rates) {
    const key = JSON.stringify([rate.provider, rate.model]);
    if (!rate.provider.trim() || !rate.model.trim() || keys.has(key)) {
      throw new AiCreditError("INVALID_PRICING", "Each provider/model must be unique");
    }
    keys.add(key);
    creditUnits(rate.inputUnitsPerMillion);
    creditUnits(rate.outputUnitsPerMillion);
  }
}
/** Round up once per call, consistently for reservation and settlement. */
export function priceCreditTokens(rate: AiCreditRate, input: number, output: number): string {
  if (![input, output].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new AiCreditError("INVALID_USAGE", "Expected exact nonnegative token counts");
  }
  const result =
    (BigInt(input) * creditUnits(rate.inputUnitsPerMillion) +
      BigInt(output) * creditUnits(rate.outputUnitsPerMillion) +
      999_999n) /
    1_000_000n;
  if (result > AI_CREDIT_MAX) {
    throw new AiCreditError("INVALID_CREDITS", "Credit amount exceeds storage precision");
  }
  return result.toString();
}
export interface AiCreditAccount {
  id: string;
  userId: string;
  balanceUnits: string;
  reservedUnits: string;
  availableUnits: string;
  status: "active" | "blocked";
  version: number;
}
export interface AiCreditPurchaseInput {
  userId: string;
  requestKey: string;
  creditUnits: string;
  paymentAmount: string;
  paymentUnit: string;
  paymentScale: number;
  paymentMethod: string;
  quoteVersion: string;
  expiresAt: string;
}
export type AiCreditPurchaseStatus =
  "pending" | "confirmed" | "failed" | "expired" | "review_required";
export interface AiCreditPurchase extends AiCreditPurchaseInput {
  id: string;
  accountId: string;
  status: AiCreditPurchaseStatus;
}
/** Produced by a trusted payment verifier, never accepted from public JSON. */
export interface AiCreditVerifiedPayment {
  purchaseId: string;
  provider: string;
  eventId: string;
  paymentId: string;
  amount: string;
  unit: string;
  scale: number;
  recipient: string;
  expectedRecipient: string;
  evidenceSha256: string;
  settledAt: string;
  valid: boolean;
}
export interface AiCreditPaymentVerifier {
  verify(reference: string): Promise<AiCreditVerifiedPayment>;
}
export interface AiCreditCheckScope {
  checkId: string;
  tenantId: string;
  agentId: string;
  configVersion: number;
  leaseOwner: string;
}
export interface AiCreditOperation {
  id: string;
  accountId: string;
  checkId: string;
  maximumUnits: string;
  chargedUnits: string;
  status: "active" | "settled" | "released";
}
export interface AiCreditLedgerEntry {
  id: string;
  cursor: string;
  kind: "purchase" | "reserve" | "settle" | "release" | "adjustment";
  balanceDeltaUnits: string;
  reservedDeltaUnits: string;
  createdAt: string;
  operationId: string | null;
  purchaseId: string | null;
}
export interface AiCreditRepository {
  account(userId: string): Promise<AiCreditAccount>;
  addPricing(pricing: AiCreditPricing): Promise<void>;
  createPurchase(input: AiCreditPurchaseInput): Promise<AiCreditPurchase>;
  recordVerifiedPayment(payment: AiCreditVerifiedPayment): Promise<AiCreditPurchase>;
  purchase(userId: string, id: string): Promise<AiCreditPurchase>;
  reserveCheck(scope: AiCreditCheckScope, pricingId: string): Promise<AiCreditOperation>;
  recordCallStart(scope: AiCreditCheckScope, key: string): Promise<void>;
  settleCheck(checkId: string): Promise<AiCreditOperation>;
  recoverCheck(checkId: string): Promise<AiCreditOperation>;
  setAgentLimit(
    userId: string,
    productAgentId: string,
    dailyUnits: string | null,
    expectedVersion: number,
  ): Promise<number>;
  adjust(input: {
    userId: string;
    key: string;
    balanceDeltaUnits: string;
    reason: string;
    purchaseId?: string;
  }): Promise<AiCreditAccount>;
  history(userId: string, before?: string, limit?: number): Promise<AiCreditLedgerEntry[]>;
}
/** Payment credentials and proof verification belong in infrastructure. */
export function createAiCreditPaymentService(
  repository: AiCreditRepository,
  verifier: AiCreditPaymentVerifier,
) {
  return {
    confirm: async (reference: string) =>
      repository.recordVerifiedPayment(await verifier.verify(reference)),
  };
}
