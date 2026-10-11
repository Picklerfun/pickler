/** Durable owner actions. Providers run only between short repository transactions. */
import {
  TokenLaunchError,
  tokenLaunchBlockers,
  type TokenAuthorization,
  type TokenContext,
  type TokenDraft,
  type TokenLaunchRepository,
  type TokenLaunchService,
  type TokenScope,
} from "./token-launch.js";
import type { SignedActivityRequest } from "../signing/domain/turnkey-activity.js";
import type { UnsignedActivity } from "../wallets/ports/custody.js";

export const TOKEN_ACTIONS = [
  "launch",
  "graduate",
  "collect_curve_fees",
  "collect_lp_fees",
  "claim_fees",
  "approve_buy",
  "approve_sell",
  "buy",
  "sell",
] as const;
export type TokenAction = (typeof TOKEN_ACTIONS)[number];
export interface TokenTradeInput {
  /** Positive exact-input amount in the input asset's atomic units. */
  amount: string;
  /** Explicit tolerance, bounded to one percent. */
  slippageBps: number;
}
export interface TokenTradeQuote extends TokenTradeInput {
  side: "buy" | "sell";
  approval: boolean;
  expectedOutput: string;
  minimumOutput: string;
  balance: string;
  allowance: string;
  feeBps: number;
}
export class TokenTradeError extends Error {
  constructor(
    public readonly code:
      | "APPROVAL_REQUIRED"
      | "INSUFFICIENT_TOKEN_BALANCE"
      | "CURVE_CLOSED"
      | "TRADE_TOO_SMALL"
      | "EXCEEDS_CURVE_INVENTORY"
      | "APPROVAL_NOT_REQUIRED",
  ) {
    super(code);
  }
}
export function isTokenTradeAction(action: TokenAction) {
  return ["approve_buy", "approve_sell", "buy", "sell"].includes(action);
}
export function tokenTradeMinimumOutput(output: bigint, slippageBps: number): bigint {
  if (output <= 0n || !Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 100) {
    throw new TokenLaunchError("TOKEN_DRAFT_INVALID");
  }
  return (output * BigInt(10000 - slippageBps) + 9999n) / 10000n;
}
export type TokenOperationStatus =
  | "preparing"
  | "awaiting_signature"
  | "signing"
  | "signed"
  | "submitting"
  | "confirming"
  | "included"
  | "finalized"
  | "failed"
  | "cancelled"
  | "unknown";
export interface TokenPreparedTransaction {
  operationId: string;
  /** Private commitment to the reviewed venue, deployment, economics and gas policy. */
  configurationHash?: string;
  quote?: TokenTradeQuote;
  activity: UnsignedActivity;
  chainId: number;
  sender: string;
  destination: string;
  unsignedTransaction: string;
  transactionNonce: number;
  gas: string;
  maxFeePerGas: string;
  maximumGasCost: string;
  deadline: string;
}
/** This record is private. Never return raw transactions or context snapshots on status reads. */
export interface TokenIntent {
  id: string;
  key: string;
  action: TokenAction;
  asset: "ausd" | "agent";
  trade?: TokenTradeInput;
  version: number;
  draftVersion: number;
  nonce: string;
  deadline: string;
  context: TokenContext;
  draft: TokenDraft | null;
  status: TokenOperationStatus;
  authorization: TokenAuthorization | null;
  prepared: TokenPreparedTransaction | null;
  activityId: string | null;
  rawTransaction: string | null;
  txHash: string | null;
  blockHash: string | null;
  error: string | null;
}
export interface TokenIntentTransaction {
  read(keyOrId: string): Promise<TokenIntent | null>;
  active(): Promise<boolean>;
  reserve(input: Omit<TokenIntent, "id" | "version" | "nonce">): Promise<TokenIntent>;
  update(
    intent: TokenIntent,
    patch: Partial<
      Omit<
        TokenIntent,
        | "id"
        | "key"
        | "action"
        | "asset"
        | "trade"
        | "nonce"
        | "context"
        | "draft"
        | "draftVersion"
        | "deadline"
      >
    >,
  ): Promise<TokenIntent>;
}
export interface TokenOperationDriver {
  /** An independently verified venue configuration, never inferred from an ABI or a legacy probe. */
  ready: boolean;
  checkReadiness?(operationId: string): Promise<void>;
  prepare(scope: TokenScope, intent: TokenIntent): Promise<TokenPreparedTransaction>;
  sign(
    prepared: TokenPreparedTransaction,
    request: SignedActivityRequest,
  ): Promise<{
    activityId: string;
    status: "pending" | "completed" | "rejected";
    rawTransaction?: string;
  }>;
  activity(
    prepared: TokenPreparedTransaction,
    activityId: string,
  ): ReturnType<TokenOperationDriver["sign"]>;
  verify(prepared: TokenPreparedTransaction, raw: string): Promise<string>;
  preflight(prepared: TokenPreparedTransaction): Promise<void>;
  broadcast(raw: string, prepared: TokenPreparedTransaction): Promise<string>;
  receipt(
    hash: string,
    prepared: TokenPreparedTransaction,
  ): Promise<{ status: "included" | "finalized" | "reverted"; blockHash: string } | null>;
}
export function sameTokenContext(a: TokenContext, b: TokenContext): boolean {
  return (
    a.workspaceId === b.workspaceId &&
    a.ownerUserId === b.ownerUserId &&
    a.enabled === b.enabled &&
    a.visibility === b.visibility &&
    a.published === b.published &&
    a.killed === b.killed &&
    a.masterAddress === b.masterAddress &&
    a.accent === b.accent &&
    a.avatarPattern === b.avatarPattern &&
    a.name === b.name &&
    a.handle === b.handle &&
    a.token?.address === b.token?.address &&
    a.token?.chainId === b.token?.chainId
  );
}
export function tokenOperationView(intent: TokenIntent) {
  return {
    id: intent.id,
    action: intent.action,
    version: intent.version,
    status: intent.status,
    activityId: intent.activityId,
    txHash: intent.txHash,
    blockHash: intent.blockHash,
    error: intent.error,
    deadline: intent.deadline,
    quote: intent.prepared?.quote ?? null,
    activity: intent.status === "awaiting_signature" ? (intent.prepared?.activity ?? null) : null,
    transaction: intent.prepared
      ? {
          chainId: intent.prepared.chainId,
          sender: intent.prepared.sender,
          destination: intent.prepared.destination,
          maximumGasCost: intent.prepared.maximumGasCost,
        }
      : null,
  };
}
export function createTokenOperationService(deps: {
  repository: TokenLaunchRepository;
  tokens: TokenLaunchService;
  driver?: TokenOperationDriver;
  chainId: number | null;
}) {
  const ready = () => deps.chainId === 10143 && deps.driver?.ready === true;
  async function transaction<T>(
    scope: TokenScope,
    work: (intents: TokenIntentTransaction, context: TokenContext, now: Date) => Promise<T>,
  ) {
    return deps.repository.transaction(scope, deps.chainId, async (tx) => {
      if (tx.context.ownerUserId !== scope.userId) {
        throw new TokenLaunchError("TOKEN_OWNER_REQUIRED");
      }
      if (!tx.intents) {
        throw new TokenLaunchError("TOKEN_LAUNCH_BLOCKED", ["LAUNCH_UNAVAILABLE"]);
      }
      return work(tx.intents, tx.context, tx.now);
    });
  }
  function admission(context: TokenContext, action: TokenAction) {
    const blockers = tokenLaunchBlockers(context, ready()).filter(
      (b) =>
        action === "launch" ||
        (b !== "TOKEN_ALREADY_LAUNCHED" && b !== "TOKEN_CONFIRMATION_PENDING"),
    );
    if (action !== "launch" && !context.token) {
      blockers.push("AGENT_UNAVAILABLE");
    }
    if (blockers.length) {
      throw new TokenLaunchError("TOKEN_LAUNCH_BLOCKED", blockers);
    }
  }
  async function read(scope: TokenScope, id: string) {
    return transaction(scope, async (intents, _context, now) => {
      const intent = await intents.read(id);
      if (!intent) {
        throw new TokenLaunchError("TOKEN_NOT_FOUND");
      }
      if (
        ["preparing", "awaiting_signature"].includes(intent.status) &&
        !intent.activityId &&
        !intent.txHash &&
        BigInt(intent.deadline) <= BigInt(Math.floor(now.getTime() / 1000))
      ) {
        return intents.update(intent, { status: "failed", error: "AUTHORIZATION_EXPIRED" });
      }
      return intent;
    });
  }
  async function patch(
    scope: TokenScope,
    intent: TokenIntent,
    changes: Parameters<TokenIntentTransaction["update"]>[1],
  ) {
    return transaction(scope, (intents) => intents.update(intent, changes));
  }
  async function retainSigned(scope: TokenScope, intent: TokenIntent, raw: string) {
    const hash = await deps.driver!.verify(intent.prepared!, raw);
    return transaction(scope, async (intents) => {
      // Retain exact signed bytes even when permissions or the grant expired while signing.
      // Sending remains subject to a separate, current admission check.
      return intents.update(intent, {
        status: "signed",
        rawTransaction: raw,
        txHash: hash,
        error: null,
      });
    });
  }
  async function submit(scope: TokenScope, intent: TokenIntent) {
    if (
      intent.status !== "signed" ||
      !intent.prepared ||
      !intent.rawTransaction ||
      !intent.txHash
    ) {
      return tokenOperationView(intent);
    }
    // Repeat all chain checks after the passkey delay, before reserving the only send attempt.
    await deps.driver!.preflight(intent.prepared);
    const claimed = await transaction(scope, async (intents, context, now) => {
      admission(context, intent.action);
      if (
        !sameTokenContext(context, intent.context) ||
        BigInt(intent.deadline) <= BigInt(Math.floor(now.getTime() / 1000))
      ) {
        throw new TokenLaunchError("TOKEN_AUTHORIZATION_EXPIRED");
      }
      return intents.update(intent, { status: "submitting", error: null });
    });
    try {
      const hash = await deps.driver!.broadcast(claimed.rawTransaction!, claimed.prepared!);
      if (hash !== claimed.txHash) {
        throw new Error("TRANSACTION_HASH_MISMATCH");
      }
      return tokenOperationView(await patch(scope, claimed, { status: "confirming" }));
    } catch {
      // Fence to our own send claim. Concurrent canonical progress must never be downgraded.
      return transaction(scope, async (intents) => {
        const latest = await intents.read(claimed.id);
        if (!latest) {
          throw new TokenLaunchError("TOKEN_NOT_FOUND");
        }
        if (latest.version !== claimed.version || latest.status !== "submitting") {
          return tokenOperationView(latest);
        }
        return tokenOperationView(
          await intents.update(latest, { status: "unknown", error: "RECONCILIATION_REQUIRED" }),
        );
      });
    }
  }
  return {
    async prepare(
      scope: TokenScope,
      input: {
        action: TokenAction;
        expectedVersion: number;
        asset?: "ausd" | "agent";
        trade?: TokenTradeInput;
      },
      key: string,
    ) {
      if (!TOKEN_ACTIONS.includes(input.action) || !/^[A-Za-z0-9_-]{16,120}$/.test(key)) {
        throw new TokenLaunchError("TOKEN_DRAFT_INVALID");
      }
      if (isTokenTradeAction(input.action)) {
        if (
          !input.trade ||
          !/^[1-9][0-9]{0,77}$/.test(input.trade.amount) ||
          BigInt(input.trade.amount) >= 2n ** 256n ||
          !Number.isInteger(input.trade.slippageBps) ||
          input.trade.slippageBps < 1 ||
          input.trade.slippageBps > 100 ||
          input.asset !== undefined
        ) {
          throw new TokenLaunchError("TOKEN_DRAFT_INVALID");
        }
      } else if (input.trade) {
        throw new TokenLaunchError("TOKEN_DRAFT_INVALID");
      }
      if (input.action === "launch") {
        if (!ready()) {
          throw new TokenLaunchError("TOKEN_LAUNCH_BLOCKED", ["LAUNCH_UNAVAILABLE"]);
        }
        await deps.tokens.authorize(scope, input.expectedVersion, key);
      }
      const intent = await transaction(scope, async (intents, context, now) => {
        admission(context, input.action);
        const previous = await intents.read(key);
        if (previous) {
          if (
            previous.action !== input.action ||
            previous.asset !== (input.asset ?? "ausd") ||
            previous.draftVersion !== input.expectedVersion ||
            previous.trade?.amount !== input.trade?.amount ||
            previous.trade?.slippageBps !== input.trade?.slippageBps
          ) {
            throw new TokenLaunchError("TOKEN_IDEMPOTENCY_CONFLICT");
          }
          return previous;
        }
        if (await intents.active()) {
          throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
        }
        return intents.reserve({
          key,
          action: input.action,
          asset: input.asset ?? "ausd",
          ...(input.trade ? { trade: { ...input.trade } } : {}),
          draftVersion: input.expectedVersion,
          deadline: String(Math.floor(now.getTime() / 1000) + 300),
          context,
          draft: null,
          status: "preparing",
          authorization: null,
          prepared: null,
          activityId: null,
          rawTransaction: null,
          txHash: null,
          blockHash: null,
          error: null,
        });
      });
      if (intent.prepared) {
        return {
          operation: tokenOperationView(intent),
          activity: intent.status === "awaiting_signature" ? intent.prepared.activity : null,
        };
      }
      if (intent.error === "PREPARATION_IN_PROGRESS" || intent.status !== "preparing") {
        throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
      }
      // A concurrent preparation cannot retry external work for a claimed intent.
      const claimed = await patch(scope, intent, {
        status: "preparing",
        error: "PREPARATION_IN_PROGRESS",
      });
      try {
        const prepared = await deps.driver!.prepare(scope, claimed);
        const final = await transaction(scope, async (intents, context, now) => {
          admission(context, claimed.action);
          if (
            !sameTokenContext(claimed.context, context) ||
            prepared.chainId !== 10143 ||
            prepared.sender.toLowerCase() !== context.masterAddress?.toLowerCase() ||
            prepared.operationId !== claimed.id ||
            prepared.deadline !== claimed.deadline ||
            BigInt(claimed.deadline) <= BigInt(Math.floor(now.getTime() / 1000))
          ) {
            throw new TokenLaunchError("TOKEN_LAUNCH_BLOCKED", ["LAUNCH_UNAVAILABLE"]);
          }
          return intents.update(claimed, { prepared, status: "awaiting_signature", error: null });
        });
        return { operation: tokenOperationView(final), activity: prepared.activity };
      } catch (error) {
        const failed = await patch(scope, claimed, {
          status: "failed",
          error: error instanceof TokenTradeError ? error.code : "PREPARATION_FAILED",
        });
        if (error instanceof TokenTradeError) {
          return { operation: tokenOperationView(failed), activity: null };
        }
        throw new TokenLaunchError("TOKEN_LAUNCH_BLOCKED", ["LAUNCH_UNAVAILABLE"]);
      }
    },
    async confirm(
      scope: TokenScope,
      id: string,
      expectedVersion: number,
      signed?: SignedActivityRequest,
    ) {
      const current = await transaction(scope, async (intents, context, now) => {
        const current = await intents.read(id);
        if (!current) {
          throw new TokenLaunchError("TOKEN_NOT_FOUND");
        }
        if (current.version !== expectedVersion) {
          throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
        }
        if (!["awaiting_signature", "signed"].includes(current.status) || !current.prepared) {
          return current;
        }
        admission(context, current.action);
        if (current.status === "signed") {
          return current;
        }
        if (
          !sameTokenContext(context, current.context) ||
          BigInt(current.deadline) <= BigInt(Math.floor(now.getTime() / 1000))
        ) {
          throw new TokenLaunchError("TOKEN_AUTHORIZATION_EXPIRED");
        }
        if (
          !signed ||
          signed.body !== current.prepared.activity.body ||
          signed.url !== current.prepared.activity.url
        ) {
          throw new TokenLaunchError("TOKEN_DRAFT_INVALID");
        }
        return current;
      });
      if (current.status === "signed") {
        return submit(scope, current);
      }
      if (current.status !== "awaiting_signature" || !current.prepared) {
        return tokenOperationView(current);
      }
      // No signing claim exists during preflight. A refused or interrupted check is provably unsent.
      try {
        await deps.driver!.preflight(current.prepared);
      } catch {
        return transaction(scope, async (intents) => {
          const latest = await intents.read(id);
          if (!latest) {
            throw new TokenLaunchError("TOKEN_NOT_FOUND");
          }
          if (latest.version !== current.version || latest.status !== "awaiting_signature") {
            return tokenOperationView(latest);
          }
          return tokenOperationView(
            await intents.update(latest, { status: "failed", error: "PREFLIGHT_REJECTED" }),
          );
        });
      }
      const intent = await transaction(scope, async (intents, context, now) => {
        admission(context, current.action);
        if (
          !sameTokenContext(context, current.context) ||
          BigInt(current.deadline) <= BigInt(Math.floor(now.getTime() / 1000))
        ) {
          throw new TokenLaunchError("TOKEN_AUTHORIZATION_EXPIRED");
        }
        return intents.update(current, { status: "signing" });
      });
      try {
        const result = await deps.driver!.sign(intent.prepared!, signed!);
        const recorded = await patch(scope, intent, {
          activityId: result.activityId,
          status: result.status === "rejected" ? "failed" : "unknown",
          error: result.status === "rejected" ? "SIGNATURE_REJECTED" : null,
        });
        if (result.status !== "completed" || !result.rawTransaction) {
          return tokenOperationView(recorded);
        }
        const retained = await retainSigned(scope, recorded, result.rawTransaction);
        return submit(scope, retained);
      } catch {
        return transaction(scope, async (intents) => {
          const latest = await intents.read(id);
          if (!latest) {
            throw new TokenLaunchError("TOKEN_NOT_FOUND");
          }
          if (latest.status !== "signing" || latest.version !== intent.version) {
            return tokenOperationView(latest);
          }
          return tokenOperationView(
            await intents.update(latest, { status: "unknown", error: "RECONCILIATION_REQUIRED" }),
          );
        });
      }
    },
    async status(scope: TokenScope, id: string) {
      let intent = await read(scope, id);
      if (
        !ready() ||
        !intent.prepared ||
        ["finalized", "failed", "cancelled"].includes(intent.status)
      ) {
        return tokenOperationView(intent);
      }
      if (intent.status === "unknown" && intent.activityId && !intent.rawTransaction) {
        const result = await deps.driver!.activity(intent.prepared, intent.activityId);
        if (result.status === "rejected") {
          intent = await patch(scope, intent, { status: "failed", error: "SIGNATURE_REJECTED" });
        } else if (result.status === "completed" && result.rawTransaction) {
          // Recovery retains the exact signed bytes but never automatically sends them.
          intent = await retainSigned(scope, intent, result.rawTransaction);
        }
      }
      if (intent.txHash) {
        const receipt = await deps.driver!.receipt(intent.txHash, intent.prepared!);
        if (receipt) {
          intent = await patch(scope, intent, {
            status: receipt.status === "reverted" ? "failed" : receipt.status,
            blockHash: receipt.blockHash,
            error: receipt.status === "reverted" ? "TRANSACTION_REVERTED" : null,
          });
        } else if (intent.status === "included") {
          intent = await patch(scope, intent, {
            status: "confirming",
            blockHash: null,
            error: "REORG_PENDING",
          });
        }
      }
      return tokenOperationView(intent);
    },
    async cancel(scope: TokenScope, id: string, expectedVersion: number) {
      return transaction(scope, async (intents) => {
        const intent = await intents.read(id);
        if (!intent) {
          throw new TokenLaunchError("TOKEN_NOT_FOUND");
        }
        if (
          intent.version !== expectedVersion ||
          !["preparing", "awaiting_signature", "failed"].includes(intent.status) ||
          intent.activityId ||
          intent.txHash
        ) {
          throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
        }
        return tokenOperationView(
          await intents.update(intent, { status: "cancelled", error: null }),
        );
      });
    },
  };
}
export type TokenOperationService = ReturnType<typeof createTokenOperationService>;
