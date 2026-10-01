import { AccessDeniedError } from "../access/domain/errors.js";
import type { Principal } from "../access/domain/principal.js";
import type { AgentProfileInput } from "../agents/domain/agents.js";
import type { Accent } from "../landing/domain/landing.js";
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
   * Creates the private draft from an adopted preview run (studio-brief-v1 §6), in one transaction:
   * the agent with `status = 'draft'` and no wallet, its runtime row with the run's config snapshot,
   * the preview copied in as its first run, and the preview marked adopted. Refuses with
   * PREVIEW_UNUSABLE, RUN_STALE or HANDLE_TAKEN, in that order, then runs `admit`; a refusal writes
   * nothing. A retry of a create that committed (same caller, brief and handle) answers the same
   * draft again and never reaches `admit`; under a different name it is CONFLICT.
   */
  createDraft(
    access: StudioAccess,
    userId: string,
    input: { name: string; handle: string; previewRunId: string; fingerprint: string },
    now: number,
    admit?: CreateAdmission,
  ): Promise<{ productId: string; scope: Scope }>;
  agentScope(access: StudioAccess, productAgentId: string): Promise<Scope>;
  runs(scope: Scope, before: number | null): Promise<string[]>;
  /**
   * The person's agents, oldest first, with the accent their profile was created with ("lime"
   * without one), and whether each is a private draft (no wallet yet, so the funding lock skips it).
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
