// The unsigned bodies of an agent's wallet ceremony (docs/specs/studio-create-and-fund-v1.md §4.1).
// Each is stamped by the person's passkey in the browser and forwarded unchanged by the signing
// routes; nothing here is signed by Pickler, whose parent key is not a voter inside a
// sub-organization.
//
// Every request is typed against @turnkey/http's generated definitions, and its `type` comes from
// core's AGENT_WALLET_ACTIVITY_TYPES: the SDK pins each endpoint's version as a single literal,
// so a core constant that drifted from what the endpoint accepts stops compiling here rather than
// failing at the forwarder after the person has already touched their passkey.

import {
  AGENT_WALLET_ACTIVITY_TYPES,
  type AgentWalletActivityBuilders,
  type UnsignedActivity,
} from "@pickler/core";
import type { TurnkeyApiTypes } from "@turnkey/http";
import { MONAD_ACCOUNT } from "./turnkey-sub-organization.js";
import { TURNKEY_API_BASE_URL } from "./turnkey-transport.js";

/** The delegated user's name inside the person's sub-organization, as their dashboard shows it. */
export const DELEGATED_USER_NAME = "Pickler";
export const DELEGATED_API_KEY_NAME = "pickler-delegated";

export function createActivityBuilders(
  config: { baseUrl?: string; now?: () => number } = {},
): AgentWalletActivityBuilders {
  const baseUrl = config.baseUrl ?? TURNKEY_API_BASE_URL;
  const now = config.now ?? Date.now;

  function unsigned(path: string, organizationId: string, request: unknown, timestampMs: string) {
    return {
      url: `${baseUrl}/public/v1/submit/${path}`,
      body: JSON.stringify(request),
      timestampMs,
      organizationId,
    } satisfies UnsignedActivity;
  }

  return {
    createDelegatedUser(input) {
      const timestampMs = String(now());
      // Non-root by construction: create_users adds to `users`, never to the root quorum, so
      // there is no moment at which Pickler's key could act as the person. No email, phone or
      // authenticator either: the API key is its only way in.
      const request: TurnkeyApiTypes["v1CreateUsersRequest"] = {
        type: AGENT_WALLET_ACTIVITY_TYPES.createDelegatedUser,
        timestampMs,
        organizationId: input.subOrganizationId,
        parameters: {
          users: [
            {
              userName: DELEGATED_USER_NAME,
              apiKeys: [
                {
                  apiKeyName: DELEGATED_API_KEY_NAME,
                  publicKey: input.publicKey,
                  curveType: "API_KEY_CURVE_P256",
                },
              ],
              authenticators: [],
              oauthProviders: [],
              userTags: [],
            },
          ],
        },
      };
      return unsigned("create_users", input.subOrganizationId, request, timestampMs);
    },

    createAgentWallet(input) {
      const timestampMs = String(now());
      const request: TurnkeyApiTypes["v1CreateWalletRequest"] = {
        type: AGENT_WALLET_ACTIVITY_TYPES.createAgentWallet,
        timestampMs,
        organizationId: input.subOrganizationId,
        parameters: { walletName: input.handle, accounts: [MONAD_ACCOUNT] },
      };
      return unsigned("create_wallet", input.subOrganizationId, request, timestampMs);
    },

    createPolicies(input) {
      const timestampMs = String(now());
      const request: TurnkeyApiTypes["v1CreatePoliciesRequest"] = {
        type: AGENT_WALLET_ACTIVITY_TYPES.createPolicies,
        timestampMs,
        organizationId: input.subOrganizationId,
        parameters: {
          policies: input.policies.map((policy) => ({
            policyName: policy.policyName,
            effect: policy.effect,
            condition: policy.condition,
            ...(policy.consensus ? { consensus: policy.consensus } : {}),
            notes: policy.notes,
          })),
        },
      };
      return unsigned("create_policies", input.subOrganizationId, request, timestampMs);
    },

    signTransaction(input) {
      const timestampMs = String(now());
      const request: TurnkeyApiTypes["v1SignTransactionRequest"] = {
        type: AGENT_WALLET_ACTIVITY_TYPES.signTransaction,
        timestampMs,
        organizationId: input.subOrganizationId,
        parameters: {
          signWith: input.signWith,
          unsignedTransaction: input.unsignedTransaction,
          type: "TRANSACTION_TYPE_ETHEREUM",
        },
      };
      return unsigned("sign_transaction", input.subOrganizationId, request, timestampMs);
    },
  };
}
