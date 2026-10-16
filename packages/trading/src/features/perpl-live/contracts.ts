import type {
  PerplLiveOperationName,
  PerplLiveOperationInput,
  PerplLiveOperationResult,
} from "./operations.js";
import type { SignedActivityRequest, UnsignedActivity } from "@pickler/core";

export interface PerplLiveScope {
  userId: string;
  productAgentId: string;
}
export interface PerplLiveAuthority {
  scope: PerplLiveScope;
  tenantId: string;
  agentId: string;
  address: string;
  custodyAddress?: string;
  organizationId: string;
  configVersion: number;
  enabled: boolean;
  paused: boolean;
  killed: boolean;
  network: string;
  markets: readonly string[];
  perCallMicros: string;
  perDayMicros: string;
}
export interface PerplLiveSettings {
  symbol: string;
  marginMicros: string;
  leverage: number;
  cycles: number;
  holdSeconds: number;
}
export interface PerplLiveMarket {
  id: number;
  symbol: string;
  mark: number;
  priceDecimals: number;
  sizeDecimals: number;
  maxLeverage: number;
  maxSlippageBps: number;
  ttlBlocks: number;
  takerFeeMicros: number;
}
export interface PerplLivePosition {
  requestId: number;
  id: number;
  marketId: number;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  collateralMicros: string;
  leverage: number;
  feeMicros: string;
  realizedPnlMicros: string | null;
  fundingMicros: string | null;
  exitPrice: number | null;
  closed: boolean;
}
export interface PerplLiveOrderEvidence {
  originalSize: number;
  leverage: number;
  requestId: number;
  accountId: number;
  marketId: number;
  orderId: number;
  type: number;
  status: "pending" | "filled" | "partial" | "rejected" | "cancelled" | "expired";
  filledSize: number;
  fillPrice: number;
  feeMicros: string;
  txHashes: string[];
}
export interface PerplLiveSnapshot {
  instanceId: number;
  lockedMicros: string;
  unmanagedOrders: boolean;
  accountId: number;
  forwarding: boolean;
  frozen: boolean;
  balanceMicros: string;
  lastRequestId: number;
  head: number;
  at: number;
  markets: PerplLiveMarket[];
  positions: PerplLivePosition[];
  orders: PerplLiveOrderEvidence[];
}
export interface PerplLiveOrderSpec {
  rq: number;
  mkt: number;
  acc: number;
  t: 1 | 2 | 3 | 4;
  p: 0;
  s: number;
  fl: 4;
  ms: number;
  lv: number;
  lb: number;
}
export interface PerplLiveOrder {
  market: PerplLiveMarket;
  id: string;
  sessionId: string;
  request: PerplLiveOrderSpec;
  status:
    | "prepared"
    | "dispatching"
    | "unknown"
    | "accepted"
    | "filled"
    | "partial"
    | "rejected"
    | "cancelled"
    | "expired";
  createdAt: number;
  submittedAt: number | null;
  evidence: PerplLiveOrderEvidence | null;
  verifiedTxHashes: string[];
  error: string | null;
}
export interface PerplLiveSession {
  /** Positions observed before the first opening; never managed by this session. */
  preservedPositions?: { id: number; marketId: number }[];
  retryExitOrderId?: string;
  id: string;
  key: string;
  settings: PerplLiveSettings;
  configVersion: number;
  status: "active" | "paused" | "stopping" | "stopped" | "completed" | "frozen";
  completedCycles: number;
  openedAt: number | null;
  createdAt: number;
  error: string | null;
  /** Internal attribution, never a model-generated explanation. */
  signalSource: "controlled-sequence-v1";
}
export interface PerplLiveSetup {
  id: string;
  key: string;
  kind: "approve" | "create_account" | "deposit" | "forwarding" | "enroll";
  status:
    | "preparing"
    | "awaiting_signature"
    | "signing"
    | "unknown"
    | "submitted"
    | "confirmed"
    | "failed";
  amountMicros: string;
  createdAt: number;
  activity: UnsignedActivity | null;
  privatePreparation: unknown;
  activityId: string | null;
  txHash: string | null;
  error: string | null;
}
export interface PerplLiveFacts {
  hasHistory: boolean;
  orderMargins: Record<string, string>;
  fundingDayMicros: string;
  entryDayMicros: string;
  noncancelledEntryDayMicros: string;
  unresolvedOrders: boolean;
  pendingSetup: boolean;
  session: {
    id: string;
    orderCount: number;
    remaining: number;
    openingLeverage: number | null;
    openingRequestId: number;
    filledRequestIds: number[];
  } | null;
}
export interface PerplLiveDocument {
  /** Invocation-only server aggregates; never persisted in the compact account. */
  facts?: PerplLiveFacts;
  connection?: { kind: "key_wallet"; custodyAddress: string };
  productAgentId: string;
  version: 1;
  address: string;
  accountId: number | null;
  publicKey: string | null;
  encryptedKey: string | null;
  encryptedToken: string | null;
  keyExpiresAt: number | null;
  nextRequestId: number;
  setup: PerplLiveSetup[];
  sessions: PerplLiveSession[];
  orders: PerplLiveOrder[];
  snapshot: PerplLiveSnapshot | null;
  lease: { owner: string; expiresAt: number } | null;
}
export type PerplLiveOperationRepository = {
  [K in PerplLiveOperationName]: (
    scope: PerplLiveScope,
    input: PerplLiveOperationInput<K>,
  ) => Promise<PerplLiveOperationResult<K>>;
};
export type PerplLiveRepository = PerplLiveOperationRepository & {
  read(
    scope: PerplLiveScope,
  ): Promise<{ authority: PerplLiveAuthority; document: PerplLiveDocument | null }>;
  due(limit: number): Promise<PerplLiveScope[]>;
  verifiedTransactions(scope: PerplLiveScope, requestIds: number[]): Promise<string[]>;
  requestMembership(
    scope: PerplLiveScope,
    requestIds: number[],
  ): Promise<{ requestId: number; orderType: number; sessionId: string }[]>;
  history(
    scope: PerplLiveScope,
    kind: "orders" | "setup" | "sessions",
    before?: string,
  ): Promise<{
    items: (PerplLiveOrder | PerplLiveSetup | PerplLiveSession)[];
    nextCursor: string | null;
  }>;
  reserveWakeups(
    owner: string,
  ): Promise<{ scope: PerplLiveScope; generation: number; dueAt: number }[]>;
  claimWakeup(scope: PerplLiveScope, owner: string, generation: number): Promise<boolean>;
  acknowledgeWakeup(scope: PerplLiveScope, owner: string, generation: number): Promise<void>;
};
export interface PerplLiveExistingKey {
  useKeyWallet?: boolean;
  apiKey: string;
  privateKeyHex: string;
}
export interface PerplLiveDriver {
  connectExistingKey?(
    authority: PerplLiveAuthority,
    document: PerplLiveDocument,
    input: PerplLiveExistingKey,
    validUntil: number,
  ): Promise<{
    address?: string;
    accountId: number;
    publicKey: string;
    encryptedKey: string;
    encryptedToken: string;
    snapshot: PerplLiveSnapshot;
  }>;
  requirements?(): Promise<{
    minimumAccountMicros: string;
    minimumDepositMicros: string;
    maximumCollateralMicros: string;
  }>;
  prepareSetup(
    authority: PerplLiveAuthority,
    document: PerplLiveDocument,
    amountMicros: string,
  ): Promise<{
    kind: PerplLiveSetup["kind"];
    activity: UnsignedActivity;
    privatePreparation: unknown;
    key?: { publicKey: string; encryptedKey: string; expiresAt: number };
  }>;
  confirmSetup(
    authority: PerplLiveAuthority,
    document: PerplLiveDocument,
    setup: PerplLiveSetup,
    signed: SignedActivityRequest,
    guard: () => Promise<void>,
    progress: (change: {
      activityId?: string;
      txHash?: string;
      privatePreparation?: unknown;
    }) => Promise<void>,
  ): Promise<{
    activityId: string;
    status: "pending" | "submitted" | "confirmed";
    txHash?: string;
    accountId?: number;
    encryptedToken?: string;
  }>;
  reconcileSetup(
    authority: PerplLiveAuthority,
    document: PerplLiveDocument,
    setup: PerplLiveSetup,
    guard: () => Promise<void>,
    progress: (change: { txHash?: string; privatePreparation?: unknown }) => Promise<void>,
  ): Promise<{
    confirmed: boolean;
    failed?: boolean;
    txHash?: string;
    accountId?: number;
    encryptedToken?: string;
  }>;
  snapshot(authority: PerplLiveAuthority, document: PerplLiveDocument): Promise<PerplLiveSnapshot>;
  executionHead?(document: PerplLiveDocument): Promise<number>;
  submit(
    document: PerplLiveDocument,
    request: PerplLiveOrderSpec,
    guard: () => Promise<void>,
  ): Promise<"accepted" | "rejected">;
  verifyTransaction(hash: string): Promise<boolean>;
}
