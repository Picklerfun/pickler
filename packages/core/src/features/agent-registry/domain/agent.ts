// Ported from Relayer apps/api/src/kits/agent/entities/Agent.ts (commit bb6bb1226e92).
//
// What is shared with Relayer is the shape, not the storage. Pickler has its own database and
// Relayer's project is left intact and no longer developed (extraction plan, rule 4), so
// `agents.agents` is Pickler's own redesigned table; the fields below keep Relayer's names and
// formats only so the ported logic reads the same.
//
// This is the read model, without the secret columns. The custody fields have no columns in the
// migrated table yet, and the adapter reads them as null until the `wallets` schema exists.

export const AGENT_STATUSES = [
  "active",
  "suspended",
  "draining",
  "killed",
  "paused",
  "pending_policies",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Safe view of an `agent.agents` row (Relayer's `stripSecrets`). */
export interface RegisteredAgent {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  walletId: string | null;
  walletAddress: string | null;
  chainId: number | null;
  /** BIGINT from Postgres, kept as a decimal string. */
  thresholdUsd: string;
  killedAt: Date | null;
  turnkeyUserId: string | null;
  turnkeyAgentUserId: string | null;
  turnkeyPolicyId: string | null;
  activePolicyId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

/** Internal record used only for HMAC authentication. Never serialize it. */
export interface AgentCredentialRecord {
  id: string;
  workspaceId: string;
  walletId: string | null;
  status: AgentStatus | string;
  encryptedAgentSecret: string | null;
}

export class AgentNotFoundError extends Error {
  constructor() {
    super("Agent not found");
    this.name = "AgentNotFoundError";
  }
}
