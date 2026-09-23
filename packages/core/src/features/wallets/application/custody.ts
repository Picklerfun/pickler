// Ported from Relayer apps/api/src/kits/signing/passkeys/passkey.service.ts (commit bb6bb1226e92).
// Changed: the challenge store is a port over Postgres rather than Redis, and the caller is a
// Supabase user rather than an integrator.

import type { ChallengeOptions } from "../domain/passkey.js";
import type {
  AddPasskeyActivityBuilder,
  ChallengeStore,
  CustodyRepository,
  SubOrganizationCreator,
} from "../ports/custody.js";
import type { SignedActivityForwarder } from "../../signing/ports/signing.js";

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
  };
}
