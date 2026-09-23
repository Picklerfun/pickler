import { test } from "node:test";
import assert from "node:assert/strict";
import { SigningServiceUnavailableError } from "@pickler/core";
import {
  createAddPasskeyActivityBuilder,
  createSubOrganizationCreator,
  MONAD_ACCOUNT,
} from "../src/index.js";

// A throwaway P-256 pair, generated for this test only. It grants nothing: no Turnkey
// organisation has ever seen it.
const API_PRIVATE_KEY = "8ed65e1a5df0575403b95a980aff3876e184880fefea3c93ca6cd7285f878efe";
const API_PUBLIC_KEY = "036cf295a1e7c92d196e7e3def64b7532b23205b4651621fcd2ed7332487807c74";

const ATTESTATION = {
  credentialId: "cred-1",
  clientDataJson: "client-data",
  attestationObject: "attestation-object",
  transports: ["internal"],
};

const INPUT = {
  ownerEmail: "ada@example.com",
  discriminator: "u_7f3a",
  label: "MacBook",
  challenge: "chal-1",
  attestation: ATTESTATION,
};

interface Recorded {
  url: string;
  init: RequestInit;
  body: unknown;
}

/** A fetch that records what it was handed, so assertions read the request rather than the fake. */
function recordingFetch(payload: unknown, status = 200) {
  const calls: Recorded[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) as unknown });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, doFetch };
}

const creator = (doFetch: typeof fetch) =>
  createSubOrganizationCreator({
    apiPublicKey: API_PUBLIC_KEY,
    apiPrivateKey: API_PRIVATE_KEY,
    parentOrganizationId: "parent-org-1",
    fetch: doFetch,
  });

const envelope = (result: unknown) => ({ activity: { id: "act-1", result } });

const fullResult = {
  createSubOrganizationResultV8: {
    subOrganizationId: "sub-1",
    rootUserIds: ["usr-1"],
    wallet: { walletId: "wal-1", addresses: ["0xabc"] },
  },
};

test("creates a sub-organization whose only root credential is the user's passkey", async () => {
  const { calls, doFetch } = recordingFetch(envelope(fullResult));

  const account = await creator(doFetch).create(INPUT);

  assert.deepEqual(account, {
    subOrganizationId: "sub-1",
    walletId: "wal-1",
    address: "0xabc",
    rootUserId: "usr-1",
  });

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call!.url, "https://api.turnkey.com/public/v1/submit/create_sub_organization");

  // The whole body, so a field that quietly changes shape fails here rather than in production.
  const body = call!.body as { timestampMs: string };
  assert.match(body.timestampMs, /^\d+$/);
  assert.deepEqual(call!.body, {
    type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8",
    timestampMs: body.timestampMs,
    organizationId: "parent-org-1",
    parameters: {
      subOrganizationName: "ada@example.com · u_7f3a",
      rootQuorumThreshold: 1,
      rootUsers: [
        {
          userName: "ada@example.com",
          apiKeys: [],
          oauthProviders: [],
          authenticators: [
            {
              authenticatorName: "MacBook",
              challenge: "chal-1",
              attestation: {
                credentialId: "cred-1",
                clientDataJson: "client-data",
                attestationObject: "attestation-object",
                // Mapped through toTurnkeyTransports: "internal" is not what Turnkey accepts.
                transports: ["AUTHENTICATOR_TRANSPORT_INTERNAL"],
              },
            },
          ],
        },
      ],
      wallet: {
        walletName: "Master Wallet",
        accounts: [
          {
            curve: "CURVE_SECP256K1",
            pathFormat: "PATH_FORMAT_BIP32",
            path: "m/44'/60'/0'/0/0",
            addressFormat: "ADDRESS_FORMAT_ETHEREUM",
          },
        ],
      },
    },
  });
});

test("puts no Pickler credential inside the sub-organization", async () => {
  const { calls, doFetch } = recordingFetch(envelope(fullResult));

  await creator(doFetch).create(INPUT);

  const parameters = (calls[0]!.body as { parameters: Record<string, unknown> }).parameters;
  assert.equal(parameters.rootQuorumThreshold, 1);
  const rootUsers = parameters.rootUsers as { apiKeys: unknown[]; authenticators: unknown[] }[];
  assert.equal(rootUsers.length, 1, "a second root user would be a second way in");
  assert.deepEqual(rootUsers[0]!.apiKeys, []);
  assert.equal(rootUsers[0]!.authenticators.length, 1);

  // The strongest form of the invariant: our key material must appear nowhere in the request
  // body at all, whatever field someone later adds.
  const raw = String(calls[0]!.init.body);
  assert.ok(!raw.includes(API_PUBLIC_KEY), "the parent public key is in the sub-organization body");
  assert.ok(!raw.includes(API_PRIVATE_KEY), "the parent private key is in the request body");
});

test("names the sub-organization after its owner so the Turnkey dashboard is scannable", async () => {
  const { calls, doFetch } = recordingFetch(envelope(fullResult));

  await creator(doFetch).create(INPUT);

  const { subOrganizationName } = (
    calls[0]!.body as { parameters: { subOrganizationName: string } }
  ).parameters;
  assert.ok(subOrganizationName.includes("ada@example.com"), subOrganizationName);
  assert.ok(subOrganizationName.includes("u_7f3a"), subOrganizationName);
});

test("falls back to a name when the caller supplies an empty label", async () => {
  const { calls, doFetch } = recordingFetch(envelope(fullResult));

  await creator(doFetch).create({ ...INPUT, label: "" });

  const parameters = (
    calls[0]!.body as { parameters: { rootUsers: { authenticators: unknown[] }[] } }
  ).parameters;
  const [authenticator] = parameters.rootUsers[0]!.authenticators as {
    authenticatorName: string;
  }[];
  // Turnkey rejects an empty authenticatorName, so an unnamed device must still get a name.
  assert.equal(authenticator!.authenticatorName, "Default Passkey");
});

test("a response without a wallet is an error, not a half-made account", async () => {
  const { doFetch } = recordingFetch(
    envelope({
      createSubOrganizationResultV8: { subOrganizationId: "sub-1", rootUserIds: ["usr-1"] },
    }),
  );

  await assert.rejects(creator(doFetch).create(INPUT), (error: Error) => {
    assert.ok(error instanceof SigningServiceUnavailableError, error.name);
    assert.match(error.message, /wallet/i);
    return true;
  });
});

test("a wallet without an address is an error", async () => {
  const { doFetch } = recordingFetch(
    envelope({
      createSubOrganizationResultV8: {
        subOrganizationId: "sub-1",
        rootUserIds: ["usr-1"],
        wallet: { walletId: "wal-1", addresses: [] },
      },
    }),
  );

  await assert.rejects(creator(doFetch).create(INPUT), (error: Error) => {
    assert.match(error.message, /wallet/i);
    return true;
  });
});

test("a response without a root user is an error", async () => {
  const { doFetch } = recordingFetch(
    envelope({
      createSubOrganizationResultV8: {
        subOrganizationId: "sub-1",
        wallet: { walletId: "wal-1", addresses: ["0xabc"] },
      },
    }),
  );

  await assert.rejects(creator(doFetch).create(INPUT), (error: Error) => {
    assert.ok(error instanceof SigningServiceUnavailableError, error.name);
    assert.match(error.message, /root user/i);
    return true;
  });
});

test("a response without a sub-organization id is an error", async () => {
  const { doFetch } = recordingFetch(envelope({ createSubOrganizationResultV8: {} }));

  await assert.rejects(creator(doFetch).create(INPUT), (error: Error) => {
    assert.match(error.message, /sub-organization/i);
    return true;
  });
});

// The result key follows the version of the request we send. Reading a version we never
// requested would be reading a key that can never arrive.
test("a result under a version we do not send is not read", async () => {
  const { doFetch } = recordingFetch(
    envelope({
      createSubOrganizationResultV7: {
        subOrganizationId: "sub-1",
        rootUserIds: ["usr-1"],
        wallet: { walletId: "wal-1", addresses: ["0xabc"] },
      },
    }),
  );

  await assert.rejects(creator(doFetch).create(INPUT), SigningServiceUnavailableError);
});

test("the Monad account is the one EVM account every Master Wallet gets", () => {
  assert.deepEqual(MONAD_ACCOUNT, {
    curve: "CURVE_SECP256K1",
    pathFormat: "PATH_FORMAT_BIP32",
    path: "m/44'/60'/0'/0/0",
    addressFormat: "ADDRESS_FORMAT_ETHEREUM",
  });
});

test("builds an unsigned add-passkey activity the browser can stamp", () => {
  const before = Date.now();
  const activity = createAddPasskeyActivityBuilder().build({
    subOrganizationId: "sub-1",
    rootUserId: "usr-1",
    label: "iPhone",
    challenge: "chal-2",
    attestation: { ...ATTESTATION, transports: ["hybrid", "internal"] },
  });

  assert.equal(activity.url, "https://api.turnkey.com/public/v1/submit/create_authenticators");
  assert.equal(activity.organizationId, "sub-1");
  const timestampMs = Number(activity.timestampMs);
  assert.ok(timestampMs >= before && timestampMs <= Date.now(), activity.timestampMs);

  assert.deepEqual(JSON.parse(activity.body), {
    type: "ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2",
    timestampMs: activity.timestampMs,
    organizationId: "sub-1",
    parameters: {
      userId: "usr-1",
      authenticators: [
        {
          authenticatorName: "iPhone",
          challenge: "chal-2",
          attestation: {
            credentialId: "cred-1",
            clientDataJson: "client-data",
            attestationObject: "attestation-object",
            transports: ["AUTHENTICATOR_TRANSPORT_HYBRID", "AUTHENTICATOR_TRANSPORT_INTERNAL"],
          },
        },
      ],
    },
  });
});

test("the add-passkey activity is not stamped here, because the parent key is not a voter", () => {
  // No stamp, no network: the builder is synchronous and takes no fetch. The browser's existing
  // passkey signs this body; a server signature would be worthless inside the sub-organization.
  const activity = createAddPasskeyActivityBuilder().build({
    subOrganizationId: "sub-1",
    rootUserId: "usr-1",
    label: "iPhone",
    challenge: "chal-2",
    attestation: ATTESTATION,
  });

  assert.deepEqual(Object.keys(activity).sort(), ["body", "organizationId", "timestampMs", "url"]);
  assert.ok(!activity.body.includes(API_PUBLIC_KEY));
});

test("the add-passkey activity honours a custom base URL", () => {
  const activity = createAddPasskeyActivityBuilder({ baseUrl: "https://api.test.example" }).build({
    subOrganizationId: "sub-1",
    rootUserId: "usr-1",
    label: "iPhone",
    challenge: "chal-2",
    attestation: ATTESTATION,
  });

  assert.equal(activity.url, "https://api.test.example/public/v1/submit/create_authenticators");
});
