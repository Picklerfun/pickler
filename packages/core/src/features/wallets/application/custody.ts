// Ported from Relayer apps/api/src/kits/signing/passkeys/passkey.service.ts (commit bb6bb1226e92).
// Changed: the challenge store is a port over Postgres rather than Redis, and the caller is a
// Supabase user rather than an integrator.

import {
  ADD_PASSKEY_ACTIVITY_TYPE,
  ChallengeNotUsableError,
  NoCustodyAccountError,
  deviceTypeFromTransports,
} from "../domain/passkey.js";
import type { ChallengeOptions, PasskeyAttestation } from "../domain/passkey.js";
import type {
  AddPasskeyActivityBuilder,
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  SubOrganizationCreator,
  UnsignedActivity,
} from "../ports/custody.js";
import type { SignedActivityForwarder } from "../../signing/ports/signing.js";
import { COMPLETED_ACTIVITY_STATUS } from "../../signing/domain/turnkey-activity.js";
import type { SignedActivityRequest } from "../../signing/domain/turnkey-activity.js";

const CHALLENGE_TTL_MS = 300_000;

export interface CustodyServiceDeps {
  challenges: ChallengeStore;
  repository: CustodyRepository;
  turnkey: SubOrganizationCreator;
  activities: AddPasskeyActivityBuilder;
  forwarder: SignedActivityForwarder;
  rpId: string;
  appName: string;
  now: () => Date;
  randomId: () => string;
}

export function createCustodyService(deps: CustodyServiceDeps) {
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

  return {
    async issueChallenge(userId: string, email: string): Promise<ChallengeOptions> {
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
        user: { id: deps.randomId(), name: email, displayName: email },
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
        email: string;
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
        ownerEmail: input.email,
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
      // Turnkey and is logged by the caller for out-of-band reconciliation.
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

    getAccount: (userId: string) => deps.repository.findByUserId(userId),
  };
}
