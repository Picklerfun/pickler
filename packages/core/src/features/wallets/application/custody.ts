// Ported from Relayer apps/api/src/kits/signing/passkeys/passkey.service.ts (commit bb6bb1226e92).
// Changed: the challenge store is a port over Postgres rather than Redis, and the caller is a
// Supabase user rather than an integrator.

import {
  ADD_PASSKEY_ACTIVITY_TYPE,
  AGENT_WALLET_ACTIVITY_TYPES,
  AgentWalletNotFoundError,
  ChallengeNotUsableError,
  DelegatedKeyNotConfiguredError,
  DelegatedUserExistsError,
  DelegatedUserMissingError,
  MONAD_ACCOUNT_PATH,
  NoCustodyAccountError,
  deviceTypeFromTransports,
} from "../domain/passkey.js";
import { agentWalletPolicies, delegatedSelfDeletePolicy } from "../domain/agent-wallet-policies.js";
import type { ChallengeOptions, DisplayIdentity, PasskeyAttestation } from "../domain/passkey.js";
import type {
  AddPasskeyActivityBuilder,
  AgentWallet,
  AgentWalletActivityBuilders,
  AgentWalletRepository,
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  SubOrganizationCreator,
  UnsignedActivity,
} from "../ports/custody.js";
import type { SignedActivityForwarder } from "../../signing/ports/signing.js";
import {
  COMPLETED_ACTIVITY_STATUS,
  InvalidSignedActivityError,
  isTerminalActivity,
  SignedActivityRejectedError,
  SigningServiceUnavailableError,
} from "../../signing/domain/turnkey-activity.js";
import type {
  SignedActivityRequest,
  TurnkeyActivity,
} from "../../signing/domain/turnkey-activity.js";

const CHALLENGE_TTL_MS = 300_000;

/**
 * The activity's result under `key`, or a failure that says why there is none. Unlike
 * add-passkey, every step of the agent ceremony has something to record from its result, so a
 * status short of completed is an error rather than a response: a failed or rejected activity is
 * Turnkey's refusal (400), and one still pending after the forwarder's polling is a service that
 * did not finish in time (502) — the person retries and the orphan path picks the wallet up.
 */
function completedResult(activity: TurnkeyActivity, key: string): Record<string, unknown> {
  if (activity.status !== COMPLETED_ACTIVITY_STATUS) {
    if (isTerminalActivity(activity.status)) {
      throw new SignedActivityRejectedError(
        activity.failure?.message ?? `The activity did not complete (${activity.status})`,
      );
    }
    throw new SigningServiceUnavailableError(`Activity ${activity.id} is still ${activity.status}`);
  }
  const result = activity.result?.[key];
  if (!result) {
    throw new SigningServiceUnavailableError(`Completed activity carried no ${key}`);
  }
  return result;
}

/** Structural equality over parsed JSON: key order does not matter, everything else does. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((entry, index) => sameJson(entry, b[index]))
    );
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
    );
  }
  return a === b;
}

function withoutTimestamp(body: string): unknown {
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  const rest: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  delete rest["timestampMs"];
  return rest;
}

/**
 * Refuses a stamped request that is not the one Pickler would have prepared. Confirm is
 * stateless, so the expectation is rebuilt from the same inputs through the same builder and the
 * two bodies compared whole — type, organization and parameters — with only `timestampMs` left
 * out, since it is the one field that legitimately differs between the two builds.
 *
 * Without this, a person's browser could stamp different parameters (another public key, a second
 * user, an extra ALLOW) and Pickler would record the ids it got back as the ones it prepared.
 */
function assertStampedAsPrepared(signed: SignedActivityRequest, expected: UnsignedActivity) {
  let stamped: unknown;
  try {
    stamped = withoutTimestamp(signed.body);
  } catch {
    throw new InvalidSignedActivityError("Signed body is not valid JSON");
  }
  if (signed.url !== expected.url || !sameJson(stamped, withoutTimestamp(expected.body))) {
    throw new InvalidSignedActivityError("The signed activity is not the one Pickler prepared");
  }
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry)) {
    return [];
  }
  return value as string[];
}

export interface CustodyServiceDeps {
  challenges: ChallengeStore;
  repository: CustodyRepository;
  turnkey: SubOrganizationCreator;
  activities: AddPasskeyActivityBuilder;
  forwarder: SignedActivityForwarder;
  /** The agent wallet ceremony: unsigned bodies and where their results are recorded. */
  agentActivities: AgentWalletActivityBuilders;
  agentWallets: AgentWalletRepository;
  /**
   * Pickler's delegated API public key (compressed P-256 hex), or null where it is not
   * configured — then no delegated user can be created and the ceremony stops at its first step.
   */
  delegatedPublicKey: string | null;
  /** Contracts the delegated user may sign to; core's VENUE_CONTRACTS, empty until trading. */
  venueContracts: readonly string[];
  rpId: string;
  appName: string;
  now: () => Date;
  randomId: () => string;
  /**
   * Called when a registration mints a sub-organization that ends up belonging to nobody, so the
   * caller can log it for out-of-band reconciliation. This package has no side channels, which is
   * why the id has to leave through a dependency rather than a log line here; without it the only
   * record of a real Turnkey organisation Pickler owns and cannot reach was a comment promising
   * that somebody else would deal with it. Synchronous and `void`: a rejected promise from a log
   * sink would surface as an unhandled rejection, and no failure here may change the outcome of
   * the registration it is reporting on.
   */
  reportOrphan?(orphan: { userId: string; subOrganizationId: string }): void;
}

export function createCustodyService(deps: CustodyServiceDeps) {
  /** Reporting an orphan must never turn a recovered registration into a failed one. */
  function reportOrphan(userId: string, subOrganizationId: string) {
    try {
      deps.reportOrphan?.({ userId, subOrganizationId });
    } catch {
      // A broken log sink is not worth a 500 to the person who just registered.
    }
  }

  /**
   * Best-effort. A lookup failure must never stop a person registering, so it degrades to
   * no exclusions rather than propagating. Relayer learned this the same way.
   */
  async function excludeCredentials(userId: string) {
    try {
      const existing = await deps.repository.listCredentials(userId);
      if (!existing.length) {
        return undefined;
      }
      return existing.map((c) => ({
        id: c.credentialId,
        type: "public-key" as const,
        ...(c.transports.length ? { transports: c.transports } : {}),
      }));
    } catch {
      // Swallows a bug in the adapter as readily as a transient outage; registering is worth more.
      return undefined;
    }
  }

  function delegatedUserActivity(subOrganizationId: string, publicKey: string) {
    return deps.agentActivities.createDelegatedUser({ subOrganizationId, publicKey });
  }

  /** The create_policies body for a wallet, built the same way for prepare and for confirm. */
  async function policiesActivity(userId: string, subOrganizationId: string, walletId: string) {
    const delegatedUserId = await deps.agentWallets.delegatedUserId(userId);
    if (!delegatedUserId) {
      throw new DelegatedUserMissingError();
    }
    if (!(await deps.agentWallets.findOwnedAgentWallet(userId, walletId))) {
      throw new AgentWalletNotFoundError();
    }
    const policies = agentWalletPolicies({
      delegatedUserId,
      walletId,
      venueContracts: deps.venueContracts,
    });
    if (!(await deps.agentWallets.hasLinkedAgentWallet(userId))) {
      policies.push(delegatedSelfDeletePolicy(delegatedUserId));
    }
    return deps.agentActivities.createPolicies({ subOrganizationId, policies });
  }

  return {
    async issueChallenge(userId: string, identity: DisplayIdentity): Promise<ChallengeOptions> {
      const challenge = deps.randomId();
      await deps.challenges.put(challenge, {
        userId,
        expiresAt: new Date(deps.now().getTime() + CHALLENGE_TTL_MS),
      });
      const exclude = await excludeCredentials(userId);
      return {
        challenge,
        rp: { id: deps.rpId, name: deps.appName },
        // The WebAuthn user handle, a separate opaque value from the challenge above.
        user: { id: deps.randomId(), name: identity.name, displayName: identity.displayName },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        timeout: CHALLENGE_TTL_MS,
        attestation: "none",
        ...(exclude ? { excludeCredentials: exclude } : {}),
      };
    },

    /**
     * Idempotent by design. Relayer's version minted a second sub-organization on every retry
     * from a stale tab, which broke the single-row lookup and returned the person to the passkey
     * screen for ever. The pre-check handles the ordinary retry; `created: false` handles the
     * concurrent submit that races past it.
     */
    async register(
      userId: string,
      input: {
        identity: DisplayIdentity;
        label: string;
        challenge: string;
        attestation: PasskeyAttestation;
      },
    ): Promise<CustodyAccount> {
      const existing = await deps.repository.findByUserId(userId);
      if (existing) {
        return existing;
      }

      // A challenge is spent by the act of looking at it: consume deletes as it reads, and
      // ownership is judged on the record below. A claim that turns out to belong to someone else
      // is deliberately NOT put back. Restoring it would leave a challenge that survives probing
      // and open a window in which the same one is claimed twice.
      const claimed = await deps.challenges.consume(input.challenge);
      if (!claimed || claimed.userId !== userId || claimed.expiresAt <= deps.now()) {
        throw new ChallengeNotUsableError();
      }

      const created = await deps.turnkey.create({
        ownerLabel: input.identity.name,
        discriminator: userId.slice(0, 8),
        label: input.label,
        challenge: input.challenge,
        attestation: input.attestation,
      });

      const saved = await deps.repository.saveRegistration({
        userId,
        subOrganizationId: created.subOrganizationId,
        masterWalletId: created.walletId,
        rootUserId: created.rootUserId,
        walletId: created.walletId,
        address: created.address,
        credentialId: input.attestation.credentialId,
        label: input.label,
        transports: input.attestation.transports,
        deviceType: deviceTypeFromTransports(input.attestation.transports),
      });

      if (saved.created) {
        return {
          userId,
          subOrganizationId: created.subOrganizationId,
          masterWalletId: created.walletId,
          rootUserId: created.rootUserId,
          address: created.address,
        };
      }

      // Lost the race. The winner's sub-organization is the real one; ours is an orphan in
      // Turnkey, reported here for out-of-band reconciliation. Both exits report it: the throw
      // below carries the id in its message, but that message is replaced with "Internal server
      // error" outside local development, so on the rarer path it would otherwise be lost.
      reportOrphan(userId, created.subOrganizationId);
      const winner = await deps.repository.findByUserId(userId);
      if (!winner) {
        throw new Error(
          `Registration conflicted but no account is readable for ${userId}; orphan sub-org ${created.subOrganizationId}`,
        );
      }
      return winner;
    },

    /**
     * The new device creates its own credential first; this builds the CREATE_AUTHENTICATORS
     * activity that adds it, which an existing passkey then stamps. Relayer numbers the same
     * two steps "create" and "verify" in its add-passkey modal.
     */
    async prepareAddPasskey(
      userId: string,
      input: { label: string; challenge: string; attestation: PasskeyAttestation },
    ): Promise<UnsignedActivity> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const claimed = await deps.challenges.consume(input.challenge);
      if (!claimed || claimed.userId !== userId || claimed.expiresAt <= deps.now()) {
        throw new ChallengeNotUsableError();
      }
      return deps.activities.build({
        subOrganizationId: account.subOrganizationId,
        rootUserId: account.rootUserId,
        label: input.label,
        challenge: input.challenge,
        attestation: input.attestation,
      });
    },

    async confirmAddPasskey(
      userId: string,
      input: {
        label: string;
        credentialId: string;
        transports: string[];
        signed: SignedActivityRequest;
      },
    ) {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const activity = await deps.forwarder.forward(input.signed, {
        organizationId: account.subOrganizationId,
        allowedActivityTypes: [ADD_PASSKEY_ACTIVITY_TYPE],
      });
      if (activity.status === COMPLETED_ACTIVITY_STATUS) {
        await deps.repository.addPasskey({
          userId,
          credentialId: input.credentialId,
          label: input.label,
          transports: input.transports,
          deviceType: deviceTypeFromTransports(input.transports),
        });
      }
      return activity;
    },

    /** What the browser needs to know to decide which steps of the ceremony to run. */
    async agentWalletState(userId: string) {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        return { hasSubOrganization: false, hasDelegatedUser: false };
      }
      const delegated = await deps.agentWallets.delegatedUserId(userId);
      return { hasSubOrganization: true, hasDelegatedUser: delegated !== null };
    },

    /** Step one, once per sub-organization: Pickler's non-root user, created by the person. */
    async prepareDelegatedUser(userId: string): Promise<UnsignedActivity> {
      if (!deps.delegatedPublicKey) {
        throw new DelegatedKeyNotConfiguredError();
      }
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      if ((await deps.agentWallets.delegatedUserId(userId)) !== null) {
        throw new DelegatedUserExistsError();
      }
      return delegatedUserActivity(account.subOrganizationId, deps.delegatedPublicKey);
    },

    async confirmDelegatedUser(
      userId: string,
      signed: SignedActivityRequest,
    ): Promise<{ delegatedUserId: string }> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      if (!deps.delegatedPublicKey) {
        throw new DelegatedKeyNotConfiguredError();
      }
      assertStampedAsPrepared(
        signed,
        delegatedUserActivity(account.subOrganizationId, deps.delegatedPublicKey),
      );
      const activity = await deps.forwarder.forward(signed, {
        organizationId: account.subOrganizationId,
        allowedActivityTypes: [AGENT_WALLET_ACTIVITY_TYPES.createDelegatedUser],
      });
      const [delegatedUserId, ...extra] = strings(
        completedResult(activity, "createUsersResult").userIds,
      );
      if (!delegatedUserId || extra.length > 0) {
        throw new SigningServiceUnavailableError("Expected exactly one user from create_users");
      }
      await deps.agentWallets.saveDelegatedUser(userId, delegatedUserId);
      return { delegatedUserId };
    },

    /**
     * Step two. A wallet already minted under this handle and never linked is the retry of a
     * creation that failed before its link: it is returned as it is, so a second attempt never
     * leaves a second wallet in the person's sub-organization.
     */
    async prepareAgentWallet(
      userId: string,
      handle: string,
    ): Promise<{ existing: AgentWallet } | { unsigned: UnsignedActivity }> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      const orphan = await deps.agentWallets.findOrphanWallet(userId, handle);
      if (orphan) {
        return { existing: orphan };
      }
      return {
        unsigned: deps.agentActivities.createAgentWallet({
          subOrganizationId: account.subOrganizationId,
          handle,
        }),
      };
    },

    async confirmAgentWallet(
      userId: string,
      handle: string,
      signed: SignedActivityRequest,
    ): Promise<AgentWallet> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      assertStampedAsPrepared(
        signed,
        deps.agentActivities.createAgentWallet({
          subOrganizationId: account.subOrganizationId,
          handle,
        }),
      );
      const activity = await deps.forwarder.forward(signed, {
        organizationId: account.subOrganizationId,
        allowedActivityTypes: [AGENT_WALLET_ACTIVITY_TYPES.createAgentWallet],
      });
      const result = completedResult(activity, "createWalletResult");
      const walletId = typeof result.walletId === "string" ? result.walletId : "";
      const [address] = strings(result.addresses);
      if (!walletId || !address) {
        throw new SigningServiceUnavailableError("Agent wallet was not returned");
      }
      await deps.agentWallets.saveWallet({
        userId,
        walletId,
        subOrganizationId: account.subOrganizationId,
        kind: "agent",
        name: handle,
        address,
        path: MONAD_ACCOUNT_PATH,
      });
      return { walletId, address };
    },

    /**
     * Step three: the wallet's rules. For the person's first agent — no wallet of theirs linked
     * to any agent yet, decided here and never by the caller — the delegated user's self-delete
     * policy rides along; it belongs to the sub-organization and is written once.
     */
    async preparePolicies(userId: string, walletId: string): Promise<UnsignedActivity> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      return policiesActivity(userId, account.subOrganizationId, walletId);
    },

    /**
     * Returns the ids the link records. Fewer than two means the wallet's DENY rules did not all
     * land, and a wallet without them is not one an agent may have.
     */
    async confirmPolicies(
      userId: string,
      walletId: string,
      signed: SignedActivityRequest,
    ): Promise<{ policyIds: string[] }> {
      const account = await deps.repository.findByUserId(userId);
      if (!account) {
        throw new NoCustodyAccountError();
      }
      assertStampedAsPrepared(
        signed,
        await policiesActivity(userId, account.subOrganizationId, walletId),
      );
      const activity = await deps.forwarder.forward(signed, {
        organizationId: account.subOrganizationId,
        allowedActivityTypes: [AGENT_WALLET_ACTIVITY_TYPES.createPolicies],
      });
      const policyIds = strings(completedResult(activity, "createPoliciesResult").policyIds);
      if (policyIds.length < 2) {
        throw new SigningServiceUnavailableError("Expected at least two policies to be created");
      }
      return { policyIds };
    },

    getAccount: (userId: string) => deps.repository.findByUserId(userId),

    /**
     * Every passkey on the account, oldest first.
     *
     * Deliberately not wrapped. `excludeCredentials` above catches, because a lookup failure must
     * never stop somebody registering; this one must do the opposite, because its caller is
     * deciding whether to tell a person they can still reach their money after losing a device.
     * A catch here would return an empty list for an unreachable database, and the screen would
     * read that as "no passkeys" — the same silent degradation, moved one layer up.
     */
    listPasskeys: (userId: string) => deps.repository.listPasskeys(userId),
  };
}
