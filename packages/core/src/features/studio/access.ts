import { AccessDeniedError } from "../access/domain/errors.js";
import type { Principal } from "../access/domain/principal.js";
import type { Accent } from "../landing/domain/landing.js";
import type { DraftProfile } from "./create.js";
import type { PublishBlocker } from "./publish.js";
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

/**
 * Go Public's check (D8), run by `publish` with the agent's state as it stood just before: whether
 * it is killed and its linked agent wallet's address (null when none). It may read the chain, so it
 * runs outside any transaction. It answers the blockers, empty to publish, or throws to refuse.
 */
export type PublishCheck = (state: {
  killed: boolean;
  walletAddress: string | null;
}) => Promise<PublishBlocker[]>;

/** One line of an agent's Overview activity (D18). */
export interface AgentActivityEvent {
  kind: "created" | "wallet" | "transfer";
  text: string;
  at: Date;
}

/** One master ↔ agent move in the person's ledger (D17). `amount` is in token units, e.g. "10.5". */
export interface TransferLedgerEntry {
  direction: "to_agent" | "to_master";
  token: "AUSD" | "MON";
  amount: string;
  agentName: string | null;
  txHash: string;
  at: Date;
}

/** One saved setup of an agent (studio-live-v1 L10): its config version and what the save changed. */
export interface SetupVersion {
  version: number;
  summary: string;
  at: Date;
}

export interface StudioDirectory {
  /**
   * Creates the workspace and the access row. With the account's email, an application invited
   * under it is claimed and access enabled at once (docs/specs/landing-trade-v1.md §7, R5).
   */
  onboard(userId: string, email?: string | undefined): Promise<void>;
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
   * The person's agents, oldest first, with the accent and avatar pattern (0–5) their profile
   * holds ("lime" and 0 without one), whether each is a private draft, whether the marketplace shows it and since
   * when (studio-draft-dashboard-v1 D7), and its verified X handle (D6), null until verified.
   */
  list(access: StudioAccess): Promise<
    {
      id: string;
      name: string;
      handle: string;
      accent: Accent;
      avatarPattern: number;
      draft: boolean;
      visibility: "private" | "public";
      publishedAt: Date | null;
      xHandle: string | null;
      scope: Scope;
    }[]
  >;
  /**
   * Makes the agent public (D8). Already public: answers its state without calling `check`.
   * Otherwise reads killed and the linked wallet with no lock held, awaits `check` (which may read
   * the chain), then in a short transaction locks the agent row, re-reads both and publishes only
   * when they are unchanged: `visibility` public, `published_at` now, a draft's status active. If
   * they changed in between, the whole check runs once more; a second change is PilotError
   * PUBLISH_CONFLICT. Blockers from `check` throw `PublishBlockedError`. NOT_FOUND for an agent
   * outside this workspace.
   */
  publish(
    access: StudioAccess,
    productAgentId: string,
    check: PublishCheck,
  ): Promise<{ visibility: "public"; publishedAt: Date }>;
  /**
   * Name, avatar and the profile's voice name (D14); omitted fields stay. The database bounds them
   * (name 1–40, pattern 0–5, a palette accent); a violation is PilotError INVALID_INPUT.
   */
  updateIdentity(
    access: StudioAccess,
    productAgentId: string,
    identity: { name?: string; accent?: Accent; avatarPattern?: number; voice?: string },
  ): Promise<void>;
  /** The agent's Overview activity (D18): created, its wallet, each transfer; newest first, ≤ 50. */
  activity(access: StudioAccess, productAgentId: string): Promise<AgentActivityEvent[]>;
  /**
   * The agent's recorded setup versions (L10), newest first, at most 20. Only what was recorded: a
   * version saved before the record existed has no row. NOT_FOUND for an agent outside this
   * workspace.
   */
  versions(access: StudioAccess, productAgentId: string): Promise<SetupVersion[]>;
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
