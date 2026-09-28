// Ported from Relayer apps/api/src/kits/signing/passkeys/passkey.service.ts#register
// (commit bb6bb1226e92). Changed: one Monad (EVM) account instead of Ethereum plus Solana,
// because report 02 puts Solana out of scope; and the request is sent with our own fetch,
// because @turnkey/http cannot send on Workers.
//
// Both request bodies are typed against @turnkey/http's generated definitions on purpose. The
// activity version is baked into those types, so bumping the SDK past a version fails the build
// here instead of failing against the live API — which is how the V7-to-V8 rename would have
// been caught.

import {
  ADD_PASSKEY_ACTIVITY_TYPE,
  MONAD_ACCOUNT_PATH,
  SigningServiceUnavailableError,
  toTurnkeyTransports,
  type PasskeyAttestation,
  type SubOrganizationCreator,
  type UnsignedActivity,
} from "@pickler/core";
import type { TurnkeyApiTypes } from "@turnkey/http";
import {
  createTurnkeyStampingClient,
  sendStampedRequest,
  TURNKEY_API_BASE_URL,
} from "./turnkey-transport.js";

/**
 * The single account every Pickler wallet gets, master or agent. Monad is EVM, so the Ethereum
 * format applies; the path is core's, so the store records the one Turnkey derived.
 */
export const MONAD_ACCOUNT: TurnkeyApiTypes["v1WalletAccountParams"] = {
  curve: "CURVE_SECP256K1",
  pathFormat: "PATH_FORMAT_BIP32",
  path: MONAD_ACCOUNT_PATH,
  addressFormat: "ADDRESS_FORMAT_ETHEREUM",
};

export interface SubOrganizationCreatorConfig {
  apiPublicKey: string;
  apiPrivateKey: string;
  parentOrganizationId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The result envelope comes from the SDK rather than being described here, so the version key
 * read below is checked against it. Spelling the shape out by hand would have left the read
 * unpinned: a renamed key would be `undefined`, then "Sub-organization was created without an
 * id" — a message that sends the reader to Turnkey while a real sub-organization sits orphaned
 * there. Pinning turns that into a build error next to the request literal it must agree with.
 */
export interface CreateSubOrgResponse {
  activity?: { result?: TurnkeyApiTypes["v1Result"] };
}

export function createSubOrganizationCreator(
  config: SubOrganizationCreatorConfig,
): SubOrganizationCreator {
  const client = createTurnkeyStampingClient(config);
  return {
    async create(input) {
      // A display label plus an id fragment, so the Turnkey dashboard is scannable by a human.
      // Both are immutable, unlike a workspace name. It is deliberately not an email: a wallet
      // account's auth identifier is synthetic and derived from the wallet, and sending that here
      // would hand a third party an address in a field that reads as contact detail.
      //
      // The root user gets the passkey and nothing else: `apiKeys: []` is what keeps Pickler
      // out of the organisation it is creating. No userEmail either, so the parent key cannot
      // reach in later via email auth or email recovery.
      const signed = await client.stampCreateSubOrganization({
        type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8",
        timestampMs: String(Date.now()),
        organizationId: config.parentOrganizationId,
        parameters: {
          subOrganizationName: `${input.ownerLabel} · ${input.discriminator}`,
          rootQuorumThreshold: 1,
          rootUsers: [
            {
              userName: input.ownerLabel,
              apiKeys: [],
              oauthProviders: [],
              authenticators: [
                {
                  authenticatorName: input.label || "Default Passkey",
                  challenge: input.challenge,
                  attestation: {
                    credentialId: input.attestation.credentialId,
                    clientDataJson: input.attestation.clientDataJson,
                    attestationObject: input.attestation.attestationObject,
                    transports: toTurnkeyTransports(
                      input.attestation.transports,
                    ) as TurnkeyApiTypes["v1AuthenticatorTransport"][],
                  },
                },
              ],
            },
          ],
          wallet: { walletName: "Master Wallet", accounts: [MONAD_ACCOUNT] },
        },
      });

      const response = await sendStampedRequest<CreateSubOrgResponse>(signed, config);
      // Turnkey keys the result by the version of the request it received, so this reads V8 and
      // only V8. Accepting an older key would be reading for a reply that cannot arrive.
      const result = response.activity?.result?.createSubOrganizationResultV8;
      const subOrganizationId = result?.subOrganizationId;
      const walletId = result?.wallet?.walletId;
      const address = result?.wallet?.addresses?.[0];
      const rootUserId = result?.rootUserIds?.[0];

      if (!subOrganizationId) {
        throw new SigningServiceUnavailableError("Sub-organization was created without an id");
      }
      if (!walletId || !address) {
        throw new SigningServiceUnavailableError("Master wallet was not returned");
      }
      if (!rootUserId) {
        throw new SigningServiceUnavailableError("Root user was not returned");
      }
      return { subOrganizationId, walletId, address, rootUserId };
    },
  };
}

/**
 * Builds the unsigned CREATE_AUTHENTICATORS body the browser stamps with an existing passkey.
 * Not stamped here: the parent key is not a voter inside a sub-organization.
 */
export function createAddPasskeyActivityBuilder(config: { baseUrl?: string } = {}) {
  const baseUrl = config.baseUrl ?? TURNKEY_API_BASE_URL;
  return {
    build(input: {
      subOrganizationId: string;
      rootUserId: string;
      label: string;
      challenge: string;
      attestation: PasskeyAttestation;
    }): UnsignedActivity {
      const timestampMs = String(Date.now());
      const request: TurnkeyApiTypes["v1CreateAuthenticatorsRequest"] = {
        type: ADD_PASSKEY_ACTIVITY_TYPE,
        timestampMs,
        organizationId: input.subOrganizationId,
        parameters: {
          userId: input.rootUserId,
          authenticators: [
            {
              authenticatorName: input.label,
              challenge: input.challenge,
              attestation: {
                credentialId: input.attestation.credentialId,
                clientDataJson: input.attestation.clientDataJson,
                attestationObject: input.attestation.attestationObject,
                transports: toTurnkeyTransports(
                  input.attestation.transports,
                ) as TurnkeyApiTypes["v1AuthenticatorTransport"][],
              },
            },
          ],
        },
      };
      return {
        url: `${baseUrl}/public/v1/submit/create_authenticators`,
        body: JSON.stringify(request),
        timestampMs,
        organizationId: input.subOrganizationId,
      };
    },
  };
}
