/** Agent-token intent and admission. Chain existence is always a confirmed projection. */
import {
  sameTokenContext,
  tokenOperationView,
  type TokenIntent,
  type TokenIntentTransaction,
} from "./token-operations.js";
import type { TokenReferenceEconomics } from "./domain/token-economics.js";
import type { Accent } from "../landing/domain/landing.js";
/** Fixed initial supply in 18-decimal token units; no later issuance is permitted. */
export const AGENT_TOKEN_TOTAL_SUPPLY = "21000000000000000000000000";
export interface AgentToken {
  name: string;
  ticker: string;
  address: string;
  chainId: 143 | 10143;
  imageUri: string | null;
  avatar: { accent: Accent; pattern: number };
}
export interface TokenScope {
  userId: string;
  workspaceId: string;
  agentId: string;
}
export interface TokenContext {
  workspaceId?: string;
  ownerUserId: string;
  enabled: boolean;
  visibility: "private" | "public";
  published: boolean;
  killed: boolean;
  name: string;
  handle: string;
  accent: string;
  avatarPattern: number;
  masterAddress: string | null;
  token: AgentToken | null;
  confirmationPending: boolean;
  venue?: {
    status: "curve" | "kuru";
    readyToGraduate?: boolean;
    market: string | null;
    vault: string | null;
    accountId: string | null;
    positions: string[];
    liquidityLocked: boolean;
  };
  fees?: { ausd: string; agent: string; block: number; scope: "master_wallet" } | null;
}
export interface TokenDraft {
  id: string;
  version: number;
  name: string;
  ticker: string;
  status: "draft" | "prepared";
}
export interface TokenPreset {
  id: number;
  version: number;
  configHash: string;
  quoteAddress: string;
  totalSupply: string;
  saleAllocation: string;
  lpAllocation: string;
  buyFeeBps: number;
  sellFeeBps: number;
  launchFee: string;
  protocolShareBps: number;
  lpCreatorShareBps: number;
}
export interface TokenLaunchParams {
  agentKey: string;
  creator: string;
  creatorFeeRecipient: string;
  name: string;
  symbol: string;
  metadataURI: string;
  metadataHash: string;
  presetId: number;
  presetVersion: number;
  expectedConfigHash: string;
  nonce: string;
  deadline: string;
}
export interface TokenAuthorization {
  imageUri?: string;
  avatar?: { accent: TokenContext["accent"]; pattern: number };
  chainId: number;
  factory: string;
  params: TokenLaunchParams;
  grantNonce: string;
  grantDeadline: string;
  signature: string;
  draftVersion: number;
}
export interface TokenTransaction {
  context: TokenContext;
  now: Date;
  intents?: TokenIntentTransaction;
  latestOperation?(): Promise<TokenIntent | null>;
  draft(): Promise<TokenDraft | null>;
  saveDraft(input: { expectedVersion: number; name: string; ticker: string }): Promise<TokenDraft>;
  activeAuthorization(): Promise<boolean>;
  authorization(key: string): Promise<TokenAuthorization | null>;
  recordAuthorization(
    key: string,
    draft: TokenDraft,
    authorization: TokenAuthorization,
  ): Promise<void>;
}
export interface TokenLaunchRepository {
  transaction<T>(
    scope: TokenScope,
    chainId: number | null,
    work: (tx: TokenTransaction) => Promise<T>,
  ): Promise<T>;
}
/** Backend-only platform permission; never a creator or funds signer. */
export interface TokenGrantIssuer {
  allowedScope?(scope: TokenScope): boolean;
  readonly factory: string;
  readonly preset: TokenPreset;
  issue(input: {
    scope: TokenScope;
    context: TokenContext;
    draft: TokenDraft;
    chainId: number;
    deadline: string;
    nonce: string;
    operationId: string;
  }): Promise<Omit<TokenAuthorization, "draftVersion">>;
}
export const TOKEN_LAUNCH_BLOCKERS = [
  "GO_PUBLIC_FIRST",
  "CREATOR_ACCESS_REQUIRED",
  "MASTER_WALLET_REQUIRED",
  "AGENT_UNAVAILABLE",
  "TOKEN_ALREADY_LAUNCHED",
  "TOKEN_CONFIRMATION_PENDING",
  "LAUNCH_UNAVAILABLE",
] as const;
export type TokenLaunchBlocker = (typeof TOKEN_LAUNCH_BLOCKERS)[number];
export class TokenLaunchError extends Error {
  constructor(
    public readonly code:
      | "TOKEN_NOT_FOUND"
      | "TOKEN_OWNER_REQUIRED"
      | "TOKEN_DRAFT_CONFLICT"
      | "TOKEN_DRAFT_INVALID"
      | "TOKEN_AUTHORIZATION_EXPIRED"
      | "TOKEN_LAUNCH_BLOCKED"
      | "TOKEN_IDEMPOTENCY_CONFLICT",
    public readonly blockers: TokenLaunchBlocker[] = [],
  ) {
    super(code);
  }
}
export function tokenLaunchBlockers(
  context: TokenContext,
  available: boolean,
): TokenLaunchBlocker[] {
  const result: TokenLaunchBlocker[] = [];
  if (context.killed) {
    result.push("AGENT_UNAVAILABLE");
  }
  if (!context.enabled) {
    result.push("CREATOR_ACCESS_REQUIRED");
  }
  if (context.visibility !== "public" || !context.published) {
    result.push("GO_PUBLIC_FIRST");
  }
  if (context.masterAddress === null) {
    result.push("MASTER_WALLET_REQUIRED");
  }
  if (context.token !== null) {
    result.push("TOKEN_ALREADY_LAUNCHED");
  }
  if (context.confirmationPending) {
    result.push("TOKEN_CONFIRMATION_PENDING");
  }
  if (!available) {
    result.push("LAUNCH_UNAVAILABLE");
  }
  return result;
}
export function createTokenLaunchService(deps: {
  repository: TokenLaunchRepository;
  chainId: number | null;
  issuer?: TokenGrantIssuer;
  referenceEconomics?: TokenReferenceEconomics;
}) {
  function available(scope: TokenScope) {
    if (deps.issuer?.allowedScope && !deps.issuer.allowedScope(scope)) {
      return false;
    }
    const preset = deps.issuer?.preset;
    if (deps.chainId === null || !preset || preset.totalSupply !== AGENT_TOKEN_TOTAL_SUPPLY) {
      return false;
    }
    if (
      ![preset.saleAllocation, preset.lpAllocation].every((units) =>
        /^(0|[1-9][0-9]*)$/.test(units),
      )
    ) {
      return false;
    }
    return (
      BigInt(preset.saleAllocation) + BigInt(preset.lpAllocation) ===
      BigInt(AGENT_TOKEN_TOTAL_SUPPLY)
    );
  }
  function owner(scope: TokenScope, tx: TokenTransaction) {
    if (tx.context.ownerUserId !== scope.userId) {
      throw new TokenLaunchError("TOKEN_OWNER_REQUIRED");
    }
  }
  return {
    state(scope: TokenScope) {
      return deps.repository.transaction(scope, deps.chainId, async (tx) => {
        owner(scope, tx);
        return {
          chainId: deps.chainId,
          available: available(scope),
          operation: tx.latestOperation
            ? await tx.latestOperation().then((i) => (i ? tokenOperationView(i) : null))
            : null,
          venue: tx.context.venue ?? null,
          fees: tx.context.fees ?? null,
          blockers: tokenLaunchBlockers(tx.context, available(scope)),
          masterAddress: tx.context.masterAddress,
          draft: await tx.draft(),
          token: tx.context.token,
          confirmation: tx.context.token
            ? ("confirmed" as const)
            : tx.context.confirmationPending
              ? ("pending" as const)
              : ("absent" as const),
          preset: deps.issuer?.preset ?? null,
          economics:
            deps.chainId === null || !deps.referenceEconomics
              ? null
              : { ...deps.referenceEconomics },
        };
      });
    },
    saveDraft(scope: TokenScope, input: { expectedVersion: number; name: string; ticker: string }) {
      const name = input.name.trim();
      const ticker = input.ticker.replace(/^\$/, "").toUpperCase();
      if (
        !name ||
        name.length > 40 ||
        !/^[A-Z][A-Z0-9]{1,5}$/.test(ticker) ||
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 0
      ) {
        throw new TokenLaunchError("TOKEN_DRAFT_INVALID");
      }
      return deps.repository.transaction(scope, deps.chainId, async (tx) => {
        owner(scope, tx);
        const blockers = tokenLaunchBlockers(tx.context, true).filter(
          (b) => b !== "GO_PUBLIC_FIRST",
        );
        if (deps.chainId === null) {
          blockers.push("LAUNCH_UNAVAILABLE");
        }
        if (blockers.length) {
          throw new TokenLaunchError("TOKEN_LAUNCH_BLOCKED", blockers);
        }
        return tx.saveDraft({ ...input, name, ticker });
      });
    },
    authorize(scope: TokenScope, expectedVersion: number, key: string) {
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 1 ||
        !/^[A-Za-z0-9_-]{16,120}$/.test(key)
      ) {
        throw new TokenLaunchError("TOKEN_DRAFT_INVALID");
      }
      return (async () => {
        const reserved = await deps.repository.transaction(scope, deps.chainId, async (tx) => {
          owner(scope, tx);
          const blockers = tokenLaunchBlockers(tx.context, available(scope));
          if (blockers.length || !tx.intents) {
            throw new TokenLaunchError(
              "TOKEN_LAUNCH_BLOCKED",
              blockers.length ? blockers : ["LAUNCH_UNAVAILABLE"],
            );
          }
          const draft = await tx.draft();
          if (!draft || draft.version !== expectedVersion) {
            throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
          }
          const previous = await tx.authorization(key);
          if (previous) {
            if (previous.draftVersion !== expectedVersion) {
              throw new TokenLaunchError("TOKEN_IDEMPOTENCY_CONFLICT");
            }
            if (BigInt(previous.grantDeadline) <= BigInt(Math.floor(tx.now.getTime() / 1000))) {
              throw new TokenLaunchError("TOKEN_AUTHORIZATION_EXPIRED");
            }
            return { previous };
          }
          // Never repeat an uncertain metadata/signing attempt under the same key.
          if (
            (await tx.intents.read(key)) ||
            (await tx.activeAuthorization()) ||
            (await tx.intents.active())
          ) {
            throw new TokenLaunchError("TOKEN_DRAFT_CONFLICT");
          }
          const intent = await tx.intents.reserve({
            key,
            action: "launch",
            asset: "ausd",
            draftVersion: draft.version,
            context: tx.context,
            draft,
            deadline: String(Math.floor(tx.now.getTime() / 1000) + 300),
            status: "preparing",
            authorization: null,
            prepared: null,
            activityId: null,
            rawTransaction: null,
            txHash: null,
            blockHash: null,
            error: null,
          });
          return { intent };
        });
        if (reserved.previous) {
          return reserved.previous;
        }
        const intent = reserved.intent!;
        const result = await deps.issuer!.issue({
          scope,
          context: intent.context,
          draft: intent.draft!,
          chainId: deps.chainId!,
          deadline: intent.deadline,
          nonce: intent.nonce,
          operationId: intent.id,
        });
        return deps.repository.transaction(scope, deps.chainId, async (tx) => {
          owner(scope, tx);
          const p = result.params;
          const blockers = tokenLaunchBlockers(tx.context, available(scope));
          const draft = await tx.draft();
          if (
            blockers.length ||
            !draft ||
            draft.version !== intent.draftVersion ||
            !sameTokenContext(tx.context, intent.context) ||
            result.chainId !== deps.chainId ||
            result.factory !== deps.issuer!.factory ||
            result.grantDeadline !== intent.deadline ||
            p.deadline !== intent.deadline ||
            result.grantNonce !== intent.nonce ||
            p.nonce !== intent.nonce ||
            p.creator.toLowerCase() !== tx.context.masterAddress!.toLowerCase() ||
            p.creatorFeeRecipient.toLowerCase() !== p.creator.toLowerCase() ||
            p.name !== draft.name ||
            p.symbol !== draft.ticker ||
            p.presetId !== deps.issuer!.preset.id ||
            p.presetVersion !== deps.issuer!.preset.version ||
            p.expectedConfigHash !== deps.issuer!.preset.configHash ||
            BigInt(intent.deadline) <= BigInt(Math.floor(tx.now.getTime() / 1000))
          ) {
            throw new TokenLaunchError("TOKEN_LAUNCH_BLOCKED", ["LAUNCH_UNAVAILABLE"]);
          }
          const authorization = { ...result, draftVersion: draft.version };
          await tx.recordAuthorization(key, draft, authorization);
          await tx.intents!.update(intent, { authorization });
          return authorization;
        });
      })();
    },
  };
}
export type TokenLaunchService = ReturnType<typeof createTokenLaunchService>;
