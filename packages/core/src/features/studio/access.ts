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
    },
  ): Promise<Scope>;
  agentScope(access: StudioAccess, productAgentId: string): Promise<Scope>;
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
