import { AccessDeniedError } from "../access/domain/errors.js";
import type { Principal } from "../access/domain/principal.js";
import { assertConfig, type AgentConfig, type Scope } from "../research/types.js";

export interface ConsoleAccess {
  workspaceId: string;
  tenantId: string;
  ownerUserId: string;
  role: string;
  enabled: boolean;
}
export interface ConsoleDirectory {
  onboard(userId: string): Promise<void>;
  access(userId: string, workspaceId: string | null): Promise<ConsoleAccess | null>;
  createAgent(
    access: ConsoleAccess,
    userId: string,
    input: { name: string; handle: string; config: AgentConfig; key: string },
  ): Promise<Scope>;
  agentScope(access: ConsoleAccess, productAgentId: string): Promise<Scope>;
  runs(scope: Scope, before: number | null): Promise<string[]>;
  list(
    access: ConsoleAccess,
  ): Promise<{ id: string; name: string; handle: string; scope: Scope }[]>;
}

export function createConsoleAccess(directory: ConsoleDirectory) {
  return {
    async authorize(principal: Principal, write = false): Promise<ConsoleAccess> {
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
      input: { name: string; handle: string; config: AgentConfig; key: string },
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
