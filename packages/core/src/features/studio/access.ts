import { AccessDeniedError } from "../access/domain/errors.js";
import type { Principal } from "../access/domain/principal.js";
import type { AgentProfileInput } from "../agents/domain/agents.js";
import { assertConfig, type AgentConfig, type Scope } from "../research/types.js";

export interface StudioAccess {
  workspaceId: string;
  tenantId: string;
  ownerUserId: string;
  role: string;
  enabled: boolean;
}
/**
 * The wallet an agent is created with, named by id only. The policy ids it links are read
 * server-side from what the wallet's owner already had `confirmPolicies` record — never from the
 * caller — so a request can only ever link the rules that were actually approved.
 */
export interface AgentWalletLink {
  walletId: string;
}

export interface StudioDirectory {
  onboard(userId: string): Promise<void>;
  access(userId: string, workspaceId: string | null): Promise<StudioAccess | null>;
  createAgent(
    access: StudioAccess,
    userId: string,
    input: {
      name: string;
      handle: string;
      config: AgentConfig;
      key: string;
      profile: AgentProfileInput;
      wallet: AgentWalletLink;
    },
  ): Promise<Scope>;
  agentScope(access: StudioAccess, productAgentId: string): Promise<Scope>;
  /**
   * The agent an earlier create with this idempotency key made, or null for a new key. Read-only:
   * a retry replays through `createAgent`, which still refuses different terms under the same key.
   */
  createdWithKey(access: StudioAccess, key: string): Promise<Scope | null>;
  runs(scope: Scope, before: number | null): Promise<string[]>;
  list(access: StudioAccess): Promise<{ id: string; name: string; handle: string; scope: Scope }[]>;
}

export function createStudioAccess(directory: StudioDirectory) {
  return {
    async authorize(principal: Principal, write = false): Promise<StudioAccess> {
      if (principal.kind !== "user") {
        throw new AccessDeniedError("User session required");
      }
      const access = await directory.access(principal.id, principal.tenantId);
      if (!access || !["admin", "manager", "developer", "auditor"].includes(access.role)) {
        throw new AccessDeniedError("Workspace access required");
      }
      if (write && (!access.enabled || access.ownerUserId !== principal.id)) {
        throw new AccessDeniedError("Research requires an enabled workspace owner");
      }
      return access;
    },
    async create(
      principal: Principal,
      input: {
        name: string;
        handle: string;
        config: AgentConfig;
        key: string;
        profile: AgentProfileInput;
        wallet: AgentWalletLink;
      },
    ) {
      const access = await this.authorize(principal, true);
      assertConfig(input.config);
      if (!input.config.marketScope) {
        throw new AccessDeniedError("A category and subcategory selection is required");
      }
      return directory.createAgent(access, principal.id, input);
    },
  };
}
