import { AccessDeniedError } from "../access/domain/errors.js";
import type { Principal } from "../access/domain/principal.js";
import type { Accent } from "../landing/domain/landing.js";
import type { DraftProfile } from "./create.js";
import type { AgentConfig, Scope } from "../research/types.js";

export interface StudioAccess {
  workspaceId: string;
  tenantId: string;
  ownerUserId: string;
  role: string;
  enabled: boolean;
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
  /**
   * Creates the private draft with its wallet (studio-create-simplified-v1 §4.1), in one
   * transaction: locks the workspace; answers the same draft again, without `admit`, when this is
   * the same create retried (same wallet, handle, name, config and profile; WALLET_ASSIGNED under
   * other terms); refuses HANDLE_TAKEN; locks the wallet (WALLET_NOT_FOUND unless it is the
   * caller's agent wallet, WALLET_ASSIGNED when linked, POLICIES_MISSING without approved
   * policies); runs `admit`; then writes the agent (`draft`), its profile, handle, runtime row and
   * product row, and links the wallet with its approved policy ids. A refusal writes nothing.
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
  };
}
