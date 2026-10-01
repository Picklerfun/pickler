import { AccessDeniedError } from "../access/domain/errors.js";
import type { Principal } from "../access/domain/principal.js";
import type { AgentProfileInput } from "../agents/domain/agents.js";
import type { Accent } from "../landing/domain/landing.js";
import type { DraftProfile } from "./create.js";
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

/**
 * The "+ New agent" lock (funding, and the draft limit for a draft), run by a create inside its transaction after the workspace row
 * is locked, so two creates in one workspace serialize and the second sees the first. It throws to
 * refuse; the create then writes nothing.
 */
export type CreateAdmission = () => Promise<void>;

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
    admit?: CreateAdmission,
  ): Promise<Scope>;
  /**
   * Creates the private draft with its wallet (studio-create-simplified-v1 §4.1), in one
   * transaction: locks the workspace; answers the same draft again, without `admit`, when this is
   * the same create retried (same wallet, handle and name; WALLET_ASSIGNED under other terms);
   * refuses HANDLE_TAKEN; locks the wallet (WALLET_NOT_FOUND unless it is the caller's agent wallet,
   * WALLET_ASSIGNED when linked, POLICIES_MISSING without approved policies); runs `admit`; then
   * writes the agent (`draft`), its profile, handle, runtime row and product row, and links the
   * wallet with its approved policy ids. A refusal writes nothing.
   */
  createDraft(
    access: StudioAccess,
    userId: string,
    input: {
      name: string;
      handle: string;
      config: AgentConfig;
      profile: DraftProfile;
      walletId: string;
    },
    admit?: CreateAdmission,
  ): Promise<{ productId: string; scope: Scope }>;
  agentScope(access: StudioAccess, productAgentId: string): Promise<Scope>;
  runs(scope: Scope, before: number | null): Promise<string[]>;
  /**
   * The person's agents, oldest first, with the accent their profile was created with ("lime"
   * without one), and whether each is a private draft.
   */
  list(
    access: StudioAccess,
  ): Promise<
    { id: string; name: string; handle: string; accent: Accent; draft: boolean; scope: Scope }[]
  >;
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
      admit?: CreateAdmission,
    ) {
      const access = await this.authorize(principal, true);
      assertConfig(input.config);
      if (!input.config.marketScope) {
        throw new AccessDeniedError("A category and subcategory selection is required");
      }
      return directory.createAgent(access, principal.id, input, admit);
    },
  };
}
