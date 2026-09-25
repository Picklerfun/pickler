import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentWalletPolicies,
  DELEGATED_CREDENTIAL_ACTIVITY_TYPES,
  delegatedSelfDeletePolicy,
} from "@pickler/core";
import type { TurnkeyApiTypes } from "@turnkey/http";
import { createActivityBuilders, MONAD_ACCOUNT } from "../src/index.js";

// Compile-time guards: core reads each confirm's result by these keys and fields as plain
// strings, because it cannot see the SDK. If Turnkey renamed one, these lines stop compiling.
const _resultKeys: (keyof TurnkeyApiTypes["v1Result"])[] = [
  "createUsersResult",
  "createWalletResult",
  "createPoliciesResult",
];
void _resultKeys;
const _fields: [
  TurnkeyApiTypes["v1CreateUsersResult"]["userIds"],
  TurnkeyApiTypes["v1CreateWalletResult"]["walletId"],
  TurnkeyApiTypes["v1CreateWalletResult"]["addresses"],
  TurnkeyApiTypes["v1CreatePoliciesResult"]["policyIds"],
] = [[], "", [], []];
void _fields;

// Every activity type the delegated user's credential DENY names is one Turnkey defines: a
// misspelt or retired literal would compile in core and silently deny nothing.
const _credentialTypesAreSdkTypes: readonly TurnkeyApiTypes["v1ActivityType"][] =
  DELEGATED_CREDENTIAL_ACTIVITY_TYPES;
void _credentialTypesAreSdkTypes;

const builders = createActivityBuilders({
  baseUrl: "https://tk.test",
  now: () => 1_758_800_000_000,
});

interface Body {
  type: string;
  organizationId: string;
  timestampMs: string;
  parameters: Record<string, unknown> & { policies?: Record<string, unknown>[] };
}

function parsed(body: string) {
  return JSON.parse(body) as Body;
}

test("the delegated user is one non-root user whose only credential is Pickler's P-256 key", () => {
  const unsigned = builders.createDelegatedUser({ subOrganizationId: "sub-1", publicKey: "02ab" });
  const body = parsed(unsigned.body);

  assert.equal(unsigned.url, "https://tk.test/public/v1/submit/create_users");
  assert.equal(unsigned.organizationId, "sub-1");
  assert.equal(unsigned.timestampMs, "1758800000000");
  assert.equal(body.type, "ACTIVITY_TYPE_CREATE_USERS_V4");
  assert.equal(body.organizationId, "sub-1");
  assert.equal(body.timestampMs, unsigned.timestampMs);
  assert.deepEqual(body.parameters, {
    users: [
      {
        userName: "Pickler",
        apiKeys: [
          { apiKeyName: "pickler-delegated", publicKey: "02ab", curveType: "API_KEY_CURVE_P256" },
        ],
        authenticators: [],
        oauthProviders: [],
        userTags: [],
      },
    ],
  });
});

test("the agent wallet is named after the handle and has the one Monad account", () => {
  const unsigned = builders.createAgentWallet({ subOrganizationId: "sub-1", handle: "halftime" });
  const body = parsed(unsigned.body);

  assert.equal(unsigned.url, "https://tk.test/public/v1/submit/create_wallet");
  assert.equal(body.type, "ACTIVITY_TYPE_CREATE_WALLET");
  assert.equal(body.organizationId, "sub-1");
  assert.deepEqual(body.parameters, { walletName: "halftime", accounts: [MONAD_ACCOUNT] });
});

test("policies are sent as core wrote them, with no consensus where core gave none", () => {
  const policies = [
    ...agentWalletPolicies({ delegatedUserId: "da", walletId: "w1", venueContracts: ["0xab"] }),
    delegatedSelfDeletePolicy("da"),
  ];

  const unsigned = builders.createPolicies({ subOrganizationId: "sub-1", policies });
  const body = parsed(unsigned.body);

  assert.equal(unsigned.url, "https://tk.test/public/v1/submit/create_policies");
  assert.equal(body.type, "ACTIVITY_TYPE_CREATE_POLICIES");
  assert.equal(body.organizationId, "sub-1");
  assert.deepEqual(body.parameters.policies, JSON.parse(JSON.stringify(policies)));
  assert.equal("consensus" in (body.parameters.policies?.[1] ?? {}), false);
});

test("a transaction is signed as Ethereum by the named account", () => {
  const unsigned = builders.signTransaction({
    subOrganizationId: "sub-1",
    signWith: "0x1111111111111111111111111111111111111111",
    unsignedTransaction: "02ef",
  });
  const body = parsed(unsigned.body);

  assert.equal(unsigned.url, "https://tk.test/public/v1/submit/sign_transaction");
  assert.equal(body.type, "ACTIVITY_TYPE_SIGN_TRANSACTION_V2");
  assert.equal(body.organizationId, "sub-1");
  assert.deepEqual(body.parameters, {
    signWith: "0x1111111111111111111111111111111111111111",
    unsignedTransaction: "02ef",
    type: "TRANSACTION_TYPE_ETHEREUM",
  });
});

test("a builder given a timestamp rebuilds the prepared body byte for byte", () => {
  const prepared = builders.createAgentWallet({ subOrganizationId: "sub-1", handle: "halftime" });
  const later = createActivityBuilders({ baseUrl: "https://tk.test", now: () => 1 });

  const rebuilt = later.createAgentWallet({
    subOrganizationId: "sub-1",
    handle: "halftime",
    timestampMs: prepared.timestampMs,
  });

  assert.equal(rebuilt.body, prepared.body);
  assert.equal(rebuilt.url, prepared.url);
  assert.equal(rebuilt.timestampMs, prepared.timestampMs);
});
