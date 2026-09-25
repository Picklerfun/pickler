import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADD_PASSKEY_ACTIVITY_TYPE,
  AuthenticationRequiredError,
  buildApiKeyPrincipal,
  buildUserPrincipal,
  createCustodyService,
  SignedActivityRejectedError,
  SigningServiceUnavailableError,
  type AddPasskeyActivityBuilder,
  type AgentWalletActivityBuilders,
  type AgentWalletRepository,
  type TurnkeyActivity,
  type ChallengeStore,
  type CustodyAccount,
  type CustodyRepository,
  type SignedActivityForwarder,
  type StoredChallenge,
  type SubOrganizationCreator,
  createProfileService,
} from "@pickler/core";
import { createApp } from "../src/app.js";

const NOW = new Date("2026-09-22T12:00:00Z");
const ANA = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const EMAIL = "ana@pickler.fun";

/** base64url, as `navigator.credentials.create()` is encoded for the wire. */
const ATTESTATION = {
  credentialId: "Y3JlZGVudGlhbC0x",
  clientDataJson: "Y2xpZW50LWRhdGE",
  attestationObject: "YXR0ZXN0YXRpb24",
  transports: ["internal"],
};

const SIGNED = {
  url: "https://api.turnkey.com/public/v1/submit/create_authenticators",
  body: '{"type":"ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2"}',
  stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "c3RhbXA" },
};

const env = { APP_ENV: "production", ALLOWED_ORIGINS: "https://pickler.fun" } as never;

/**
 * Every collaborator records what it was handed rather than only what it answered. A fake that
 * returns the same constants whatever it is given lets a route pass the wrong person's
 * sub-organization for ever while the assertions stay green.
 */
function harness(
  principal: unknown = buildUserPrincipal({ user: { id: ANA, email: EMAIL } }),
  /** Set when the test needs an authenticate that ignores `userOnly`, as a broken one would. */
  honourUserOnly = true,
) {
  const stored = new Map<string, StoredChallenge>();
  const challenges: ChallengeStore = {
    async put(challenge, record) {
      stored.set(challenge, record);
    },
    async consume(challenge) {
      const found = stored.get(challenge) ?? null;
      stored.delete(challenge);
      return found;
    },
  };

  const row: { account: CustodyAccount | null } = { account: null };
  const passkeys: Parameters<CustodyRepository["addPasskey"]>[0][] = [];
  /** Lets a test make the passkey read fail without touching any other repository method.
   *  Named apart from the balance `reads` below, which is a different collaborator's record. */
  const passkeyRead: { fail: Error | null } = { fail: null };
  const repository: CustodyRepository = {
    async findByUserId(userId) {
      return row.account?.userId === userId ? row.account : null;
    },
    async listCredentials() {
      return [];
    },
    async listPasskeys(userId) {
      // Scoped by user, unlike listCredentials above, because the route's whole job is to answer
      // for the caller and a fake that ignores the argument cannot catch it answering for someone
      // else. `passkeyRead.fail` turns this into an unreachable database.
      if (passkeyRead.fail) {
        throw passkeyRead.fail;
      }
      return passkeys
        .filter((passkey) => passkey.userId === userId)
        .map((passkey, index) => ({
          id: `passkey-${index}`,
          credentialId: passkey.credentialId,
          label: passkey.label,
          transports: passkey.transports,
          deviceType: passkey.deviceType,
          createdAt: new Date(NOW.getTime() + index * 1000),
          lastUsedAt: index === 0 ? new Date(NOW.getTime() + 60_000) : null,
        }));
    },
    async saveRegistration(input) {
      if (row.account) {
        return { created: false };
      }
      row.account = {
        userId: input.userId,
        subOrganizationId: input.subOrganizationId,
        masterWalletId: input.masterWalletId,
        rootUserId: input.rootUserId,
        address: input.address,
      };
      return { created: true };
    },
    async addPasskey(input) {
      passkeys.push(input);
    },
  };

  const creations: Parameters<SubOrganizationCreator["create"]>[0][] = [];
  const turnkey: SubOrganizationCreator = {
    async create(input) {
      creations.push(input);
      return {
        subOrganizationId: "sub-1",
        walletId: "wal-1",
        address: ADDRESS,
        rootUserId: "usr-1",
      };
    },
  };

  const builds: Parameters<AddPasskeyActivityBuilder["build"]>[0][] = [];
  const activities: AddPasskeyActivityBuilder = {
    build(input) {
      builds.push(input);
      return {
        url: "https://api.turnkey.com/public/v1/submit/create_authenticators",
        body: '{"type":"ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2"}',
        timestampMs: "1758542400000",
        organizationId: input.subOrganizationId,
      };
    },
  };

  const forwards: { request: unknown; expectations: unknown }[] = [];
  /** Set by a ceremony test to the activity the next forward answers with. */
  const nextActivity: { value: TurnkeyActivity | null } = { value: null };
  const forwarder: SignedActivityForwarder = {
    async forward(request, expectations) {
      forwards.push({ request, expectations });
      if (nextActivity.value) {
        return nextActivity.value;
      }
      return {
        id: "act-1",
        fingerprint: "fingerprint-1",
        status: "ACTIVITY_STATUS_COMPLETED",
        // A real activity carries more than the handler may pass on; the response assertions
        // below exist because this is where a sub-organization id would escape.
        organizationId: "sub-1",
        result: { createAuthenticatorsResult: { authenticatorIds: ["auth-1"] } },
      };
    },
  };

  // The agent wallet ceremony's collaborators: a store of what was saved and a builder that
  // records the sub-organization it was asked to target.
  const ceremony = {
    delegated: null as string | null,
    wallets: [] as Parameters<AgentWalletRepository["saveWallet"]>[0][],
    builds: [] as { kind: string; input: unknown }[],
  };
  const agentWallets: AgentWalletRepository = {
    async saveDelegatedUser(_userId, id) {
      ceremony.delegated = id;
    },
    async delegatedUserId() {
      return ceremony.delegated;
    },
    async saveWallet(input) {
      ceremony.wallets.push(input);
    },
    async findOrphanWallet(userId, name) {
      const found = ceremony.wallets.find((w) => w.userId === userId && w.name === name);
      return found ? { walletId: found.walletId, address: found.address } : null;
    },
    async findOwnedAgentWallet(userId, walletId) {
      const found = ceremony.wallets.find((w) => w.userId === userId && w.walletId === walletId);
      return found ? { walletId: found.walletId, address: found.address } : null;
    },
    async findAgentWallet() {
      return null;
    },
    async saveDeposit() {},
  };
  const unsignedFor = (kind: string, input: { subOrganizationId: string }) => {
    ceremony.builds.push({ kind, input });
    return {
      url: `https://api.turnkey.com/public/v1/submit/${kind}`,
      body: `{"kind":"${kind}"}`,
      timestampMs: "1758542400000",
      organizationId: input.subOrganizationId,
    };
  };
  const agentActivities: AgentWalletActivityBuilders = {
    createDelegatedUser: (input) => unsignedFor("create_users", input),
    createAgentWallet: (input) => unsignedFor("create_wallet", input),
    createPolicies: (input) => unsignedFor("create_policies", input),
    signTransaction: (input) => unsignedFor("sign_transaction", input),
  };
  const delegatedKey: { value: string | null } = { value: "02delegated" };

  const reads: string[] = [];
  const balances = {
    async read(address: string) {
      reads.push(address);
      return {
        native: { symbol: "MON", decimals: 18, raw: "1000000000000000000" },
        token: { symbol: "AUSD", decimals: 6, raw: null },
      };
    },
  };

  const orphans: { userId: string; subOrganizationId: string; requestId: string }[] = [];
  const requestIds: string[] = [];
  let seed = 0;
  const custody = (requestId: string) => {
    requestIds.push(requestId);
    return createCustodyService({
      challenges,
      repository,
      turnkey,
      activities,
      forwarder,
      agentActivities,
      agentWallets,
      delegatedPublicKey: delegatedKey.value,
      venueContracts: [],
      rpId: "pickler.fun",
      appName: "Pickler",
      now: () => NOW,
      randomId: () => `r${(seed += 1)}`,
      // Exactly how container.ts wires it: the report carries the request that caused it.
      reportOrphan: (orphan) => orphans.push({ ...orphan, requestId }),
    });
  };

  const authOptions: unknown[] = [];
  const authenticate = async (_credentials: unknown, options?: { userOnly?: boolean }) => {
    authOptions.push(options);
    if (!principal) {
      throw new AuthenticationRequiredError();
    }
    if (honourUserOnly && options?.userOnly && (principal as { kind: string }).kind !== "user") {
      throw new AuthenticationRequiredError("Bearer JWT required");
    }
    return { principal: principal as never, workspace: null };
  };

  // A real profile service over a fake repository: the passkey's display name comes from here,
  // and never from the principal's email.
  const profileRow: {
    value: { userId: string; displayName: string; handle: string; createdAt: Date } | null;
  } = { value: { userId: ANA, displayName: "Ana Robles", handle: "anarobles", createdAt: NOW } };
  const profiles = createProfileService({
    findByUserId: async (userId) => (profileRow.value?.userId === userId ? profileRow.value : null),
    isHandleTaken: async () => false,
    create: async () => {
      throw new Error("unused");
    },
  });

  const app = createApp({
    authenticate,
    authenticateAgent: async () => {
      throw new Error("unused");
    },
    findWorkspace: async () => null,
    agentQueries: {} as never,
    budgets: {} as never,
    profiles: {} as never,
    custody: { authenticate, custody, balances, profiles },
  });

  return {
    app,
    profileRow,
    stored,
    row,
    passkeys,
    creations,
    builds,
    forwards,
    reads,
    passkeyRead,
    orphans,
    requestIds,
    authOptions,
    repository,
    forwarder,
    ceremony,
    nextActivity,
    delegatedKey,
  };
}

type Harness = ReturnType<typeof harness>;
type Envelope = Record<string, unknown> & { data?: Record<string, unknown> };

const post = (h: Harness, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  h.app.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );

const json = async (res: Response) => (await res.json()) as Envelope;
const data = async (res: Response) => (await json(res)).data as Record<string, unknown>;

/** Issues a challenge through the route, so the stored record is the one a browser would hold. */
async function challengeFor(h: Harness) {
  const issued = await data(await post(h, "/v1/signing/passkeys/challenge"));
  return issued["challenge"] as string;
}

async function registered(h: Harness) {
  const res = await post(h, "/v1/signing/passkeys/register", {
    label: "Touch ID on This Mac",
    challenge: await challengeFor(h),
    attestation: ATTESTATION,
  });
  assert.equal(res.status, 200, await res.text());
  return res;
}

test("a challenge is issued to the caller the token names, not to whoever the body names", async () => {
  const h = harness();

  const res = await post(h, "/v1/signing/passkeys/challenge", {
    email: "attacker@evil.example",
    user_id: OTRA,
  });

  assert.equal(res.status, 200);
  const body = await data(res);
  assert.equal(body["challenge"], "r1");
  assert.deepEqual(body["rp"], { id: "pickler.fun", name: "Pickler" });
  assert.deepEqual(body["user"], { id: "r2", name: "anarobles", displayName: "Ana Robles" });
  // The record is what a later register is judged against: if the body could name the owner,
  // one person could mint a challenge another person's session would happily spend.
  assert.deepEqual(h.stored.get("r1"), {
    userId: ANA,
    expiresAt: new Date(NOW.getTime() + 300_000),
  });
});

test("registering answers with the wallet and never with the root user id", async () => {
  const h = harness();
  const challenge = await challengeFor(h);

  const res = await post(h, "/v1/signing/passkeys/register", {
    label: "Touch ID on This Mac",
    challenge,
    attestation: ATTESTATION,
    // Ignored: the sub-organization is named after the account the token proves, not the body.
    email: "attacker@evil.example",
  });

  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.deepEqual(JSON.parse(raw).data, {
    sub_organization_id: "sub-1",
    master_wallet_id: "wal-1",
    address: ADDRESS,
  });
  assert.equal(raw.includes("usr-1"), false, "the root user id is not the browser's business");
  assert.deepEqual(h.creations, [
    {
      ownerLabel: "anarobles",
      discriminator: ANA.slice(0, 8),
      label: "Touch ID on This Mac",
      challenge,
      attestation: ATTESTATION,
    },
  ]);
});

test("registering twice answers the same account and mints one sub-organization", async () => {
  const h = harness();
  await registered(h);

  const second = await post(h, "/v1/signing/passkeys/register", {
    label: "Touch ID on This Mac",
    challenge: await challengeFor(h),
    attestation: ATTESTATION,
  });

  assert.equal(second.status, 200);
  assert.equal((await data(second))["sub_organization_id"], "sub-1");
  assert.equal(h.creations.length, 1, "a retry from a stale tab must not mint a second org");
});

test("a malformed body is a 400 that never reaches Turnkey and never spends the challenge", async () => {
  const bad: [string, unknown][] = [
    ["no body at all", undefined],
    ["a bare string", "register me"],
    ["no label", { attestation: ATTESTATION }],
    ["an empty label", { label: "", attestation: ATTESTATION }],
    ["a label longer than Turnkey accepts", { label: "x".repeat(129), attestation: ATTESTATION }],
    ["no attestation", { label: "Touch ID" }],
    ["an attestation that is a string", { label: "Touch ID", attestation: "YXR0" }],
    [
      "a missing attestation field",
      { label: "Touch ID", attestation: { ...ATTESTATION, clientDataJson: undefined } },
    ],
    [
      "an attestation field that is not a string",
      { label: "Touch ID", attestation: { ...ATTESTATION, attestationObject: 7 } },
    ],
    [
      "standard base64 where base64url is required",
      { label: "Touch ID", attestation: { ...ATTESTATION, credentialId: "a+b/c=" } },
    ],
    [
      "an attestation object past any plausible size",
      { label: "Touch ID", attestation: { ...ATTESTATION, attestationObject: "A".repeat(8193) } },
    ],
    [
      "transports that are not an array",
      { label: "Touch ID", attestation: { ...ATTESTATION, transports: "internal" } },
    ],
    [
      "a transport Turnkey has no name for",
      { label: "Touch ID", attestation: { ...ATTESTATION, transports: ["smart-card"] } },
    ],
    [
      "a transport that is not a string",
      { label: "Touch ID", attestation: { ...ATTESTATION, transports: [7] } },
    ],
    [
      "a challenge that is not a string",
      { label: "Touch ID", attestation: ATTESTATION, challenge: 7 },
    ],
    [
      "a challenge that is not base64url",
      { label: "Touch ID", attestation: ATTESTATION, challenge: "../../etc/passwd" },
    ],
  ];

  for (const [what, body] of bad) {
    const h = harness();
    const challenge = await challengeFor(h);
    const res = await post(h, "/v1/signing/passkeys/register", {
      challenge,
      ...(body as object),
    });

    assert.equal(res.status, 400, `${what} should be refused: ${await res.text()}`);
    assert.deepEqual(h.creations, [], `${what} must never reach Turnkey`);
    assert.equal(
      h.stored.has(challenge),
      true,
      `${what} must not spend the challenge, or a typo costs the person their ceremony`,
    );
  }
});

test("the three ways a challenge can be unusable are one response", async () => {
  const h = harness();
  h.stored.set("chal-someone-else", {
    userId: OTRA,
    expiresAt: new Date(NOW.getTime() + 300_000),
  });
  h.stored.set("chal-expired", { userId: ANA, expiresAt: new Date(NOW.getTime() - 1) });

  const answers = [];
  for (const challenge of ["chal-never-issued", "chal-someone-else", "chal-expired"]) {
    const res = await post(h, "/v1/signing/passkeys/register", {
      label: "Touch ID",
      challenge,
      attestation: ATTESTATION,
    });
    const body = await json(res);
    // The envelope's clock and trace id differ per request by design; everything a caller could
    // read a cause out of must not.
    delete body["timestamp"];
    delete body["traceId"];
    answers.push({ status: res.status, body });
  }

  assert.equal(answers[0]!.status, 400);
  // Compared to each other rather than to a literal: rewording the message must not make three
  // responses into two, and must not quietly make this test pass by agreeing with a stale copy.
  assert.deepEqual(answers[1], answers[0]);
  assert.deepEqual(answers[2], answers[0]);
  assert.equal(answers[0]!.body["error"], "challenge_expired");
  assert.deepEqual(h.creations, [], "no unusable challenge may reach Turnkey");
});

test("adding a device before there is a wallet is 409 at both steps", async () => {
  const h = harness();

  const prepare = await post(h, "/v1/signing/passkeys/add/prepare", {
    label: "Phone",
    challenge: await challengeFor(h),
    attestation: ATTESTATION,
  });
  const confirm = await post(h, "/v1/signing/passkeys/add/confirm", {
    label: "Phone",
    credential_id: ATTESTATION.credentialId,
    transports: ["hybrid"],
    signed: SIGNED,
  });

  assert.equal(prepare.status, 409);
  assert.equal((await json(prepare))["error"], "no_custody_account");
  assert.equal(confirm.status, 409);
  assert.deepEqual(h.builds, []);
  assert.deepEqual(h.forwards, []);
});

test("preparing hands the phone an activity naming this person's sub-organization", async () => {
  const h = harness();
  await registered(h);
  const challenge = await challengeFor(h);

  const res = await post(h, "/v1/signing/passkeys/add/prepare", {
    label: "Ana's Phone",
    challenge,
    attestation: { ...ATTESTATION, credentialId: "Y3JlZC0y", transports: ["hybrid"] },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await data(res), {
    url: "https://api.turnkey.com/public/v1/submit/create_authenticators",
    body: '{"type":"ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2"}',
    timestampMs: "1758542400000",
    organizationId: "sub-1",
  });
  // What the builder was handed matters more than what it answered: an activity built against
  // somebody else's sub-organization adds this phone to their wallet.
  assert.deepEqual(h.builds, [
    {
      subOrganizationId: "sub-1",
      rootUserId: "usr-1",
      label: "Ana's Phone",
      challenge,
      attestation: { ...ATTESTATION, credentialId: "Y3JlZC0y", transports: ["hybrid"] },
    },
  ]);
});

test("confirming forwards the stamp and answers with the activity alone", async () => {
  const h = harness();
  await registered(h);

  const res = await post(h, "/v1/signing/passkeys/add/confirm", {
    label: "Ana's Phone",
    credential_id: "Y3JlZC0y",
    transports: ["hybrid"],
    signed: SIGNED,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await data(res), { activity_id: "act-1", status: "ACTIVITY_STATUS_COMPLETED" });
  assert.deepEqual(h.forwards, [
    {
      request: SIGNED,
      expectations: {
        organizationId: "sub-1",
        allowedActivityTypes: [ADD_PASSKEY_ACTIVITY_TYPE],
      },
    },
  ]);
  assert.deepEqual(h.passkeys, [
    {
      userId: ANA,
      credentialId: "Y3JlZC0y",
      label: "Ana's Phone",
      transports: ["hybrid"],
      deviceType: "cross_device",
    },
  ]);
});

test("a malformed stamp is a 400 that never reaches the forwarder", async () => {
  const bad: [string, unknown][] = [
    ["no signed request", {}],
    ["a signed request that is a string", { signed: "stamped" }],
    ["no stamp", { signed: { url: SIGNED.url, body: SIGNED.body } }],
    [
      "a stamp header that is not a string",
      { signed: { ...SIGNED, stamp: { ...SIGNED.stamp, stampHeaderValue: 7 } } },
    ],
    ["a url that is not a string", { signed: { ...SIGNED, url: 7 } }],
    ["transports Turnkey has no name for", { signed: SIGNED, transports: ["cable"] }],
    ["a credential id that is not base64url", { signed: SIGNED, credential_id: "not base64!" }],
  ];

  for (const [what, body] of bad) {
    const h = harness();
    await registered(h);
    const res = await post(h, "/v1/signing/passkeys/add/confirm", {
      label: "Phone",
      credential_id: "Y3JlZC0y",
      transports: ["hybrid"],
      ...(body as object),
    });

    assert.equal(res.status, 400, `${what} should be refused: ${await res.text()}`);
    assert.deepEqual(h.forwards, [], `${what} must never reach Turnkey`);
    assert.deepEqual(h.passkeys, [], `${what} must not record a credential`);
  }
});

test("Turnkey's refusal reaches the browser; Turnkey's internals do not", async () => {
  const rejected = harness();
  await registered(rejected);
  rejected.forwarder.forward = async () => {
    throw new SignedActivityRejectedError("Passkey signature is invalid");
  };

  const refusal = await post(rejected, "/v1/signing/passkeys/add/confirm", {
    label: "Phone",
    credential_id: "Y3JlZC0y",
    transports: ["hybrid"],
    signed: SIGNED,
  });

  assert.equal(refusal.status, 400);
  assert.equal((await json(refusal))["message"], "Passkey signature is invalid");

  const down = harness();
  await registered(down);
  down.forwarder.forward = async () => {
    throw new SigningServiceUnavailableError("Signing service error: shard 7 over quota");
  };

  const outage = await post(down, "/v1/signing/passkeys/add/confirm", {
    label: "Phone",
    credential_id: "Y3JlZC0y",
    transports: ["hybrid"],
    signed: SIGNED,
  });

  assert.equal(outage.status, 502);
  assert.equal(
    (await outage.text()).includes("shard 7"),
    false,
    "an upstream's internal detail is not ours to publish",
  );
});

test("the wallet is 404 before registration and carries the balances after", async () => {
  const h = harness();

  const before = await h.app.request("/v1/signing/wallets/me", {}, env);
  assert.equal(before.status, 404);

  await registered(h);
  const after = await h.app.request("/v1/signing/wallets/me", {}, env);

  assert.equal(after.status, 200);
  assert.deepEqual(await data(after), {
    address: ADDRESS,
    balances: {
      native: { symbol: "MON", decimals: 18, raw: "1000000000000000000" },
      token: { symbol: "AUSD", decimals: 6, raw: null },
    },
  });
  // The address read is the one on the account, not one the caller could name.
  assert.deepEqual(h.reads, [ADDRESS]);
});

test("the passkey list is the caller's own, oldest first, with nulls kept", async () => {
  const h = harness();
  // Pushed rather than registered: this fake's saveRegistration does not mirror the passkeys row
  // the port says the transaction writes, and teaching it to would change what `h.passkeys` means
  // for every other assertion in this file that reads it.
  h.passkeys.push({
    userId: ANA,
    credentialId: "credential-1",
    label: "MacBook",
    transports: ["internal"],
    deviceType: "multiDevice",
  });
  h.passkeys.push({
    userId: ANA,
    credentialId: "credential-2",
    label: "iPhone",
    transports: ["hybrid"],
    deviceType: null,
  });
  // A stranger's passkey in the same store. Without this the route could ignore the user id
  // entirely and every assertion below would still pass.
  h.passkeys.push({
    userId: OTRA,
    credentialId: "credential-stranger",
    label: "Someone else's laptop",
    transports: ["internal"],
    deviceType: "singleDevice",
  });

  const res = await h.app.request("/v1/signing/passkeys", {}, env);
  assert.equal(res.status, 200);
  const listed = (await json(res)).data as unknown as Record<string, unknown>[];

  assert.deepEqual(
    listed.map((row) => row["label"]),
    ["MacBook", "iPhone"],
  );
  // `last_used_at` is null on the device that has never signed, and a date on the one that has.
  // A response that filled the null with the creation date would lose the only thing the column
  // can say, and it would look entirely reasonable.
  assert.equal(listed[0]?.["last_used_at"], new Date(NOW.getTime() + 60_000).toISOString());
  assert.equal(listed[1]?.["last_used_at"], null);
  assert.equal(listed[0]?.["device_type"], "multiDevice");
  // Null out, not "unknown" and not omitted: the column is nullable and the screen reads it.
  assert.equal(listed[1]?.["device_type"], null);
  assert.deepEqual(listed[1]?.["transports"], ["hybrid"]);
});

test("a passkey read that fails is a failure, never an empty list", async () => {
  // The reason `listPasskeys` is a second port method rather than a widened `listCredentials`.
  // That one degrades a lookup failure to `undefined` on purpose, because a failure there must not
  // stop somebody registering. Here the opposite is required: the screen behind this route tells
  // a person whether they can still reach their funds, and an empty list reads as "no passkeys".
  // If this ever goes green at 200 with [], the two contracts have collapsed back into one.
  const h = harness();
  h.passkeys.push({
    userId: ANA,
    credentialId: "credential-1",
    label: "MacBook",
    transports: ["internal"],
    deviceType: "multiDevice",
  });
  h.passkeyRead.fail = new Error("connection terminated unexpectedly");

  const res = await h.app.request("/v1/signing/passkeys", {}, env);

  assert.equal(res.status, 500);
  const body = await json(res);
  assert.equal(body["success"], false);
  assert.equal(body["data"], undefined);
});

test("an account with no passkeys answers with an empty list, not a 404", async () => {
  // The other half of the pair above: empty must still be reachable, or the test before this one
  // would pass against a route that failed on everything.
  const h = harness();
  const res = await h.app.request("/v1/signing/passkeys", {}, env);

  assert.equal(res.status, 200);
  assert.deepEqual((await json(res)).data, []);
});

test("API keys and anonymous callers never reach custody", async () => {
  const routes: [string, string][] = [
    ["POST", "/v1/signing/passkeys/challenge"],
    ["POST", "/v1/signing/passkeys/register"],
    ["POST", "/v1/signing/passkeys/add/prepare"],
    ["POST", "/v1/signing/passkeys/add/confirm"],
    ["GET", "/v1/signing/passkeys"],
    ["GET", "/v1/signing/wallets/me"],
  ];
  const callers = [buildApiKeyPrincipal({ id: "k1", scopes: ["read:agents"] }, "w1"), null];

  for (const caller of callers) {
    for (const [method, path] of routes) {
      const h = harness(caller);
      const res = await h.app.request(path, { method, body: method === "POST" ? "{}" : null }, env);

      assert.equal(res.status, 401, `${method} ${path} must refuse this caller`);
      assert.deepEqual(h.requestIds, [], `${method} ${path} must not build a custody service`);
      assert.deepEqual(h.creations, []);
      // What authenticate was asked for, not only what it answered: `userOnly` is what stops an
      // API key on the way in, and a route that dropped it would still be refused further down
      // by the principal check — with the key looked up in the database on the way past.
      assert.deepEqual(
        h.authOptions,
        [{ userOnly: true }],
        `${method} ${path} must refuse API keys before looking one up`,
      );
    }
  }
});

test("a principal that is not a person is refused even by an authenticate that let it in", async () => {
  // `userOnly` is core's check, and it is the one that runs in production. This says the routes
  // do not depend on it alone: custody is worth refusing anything that is not a signed-in person
  // at the door too.
  const h = harness(buildApiKeyPrincipal({ id: "k1", scopes: ["read:agents"] }, "w1"), false);

  const res = await post(h, "/v1/signing/passkeys/challenge");

  assert.equal(res.status, 401);
  assert.deepEqual(h.requestIds, []);
});

/**
 * A token with no email used to be a 400 `email_required`, which meant a wallet-only account could
 * not open a wallet at all. The passkey's label no longer comes from the email, so there is nothing
 * left to require: the profile supplies the name and the ceremony proceeds.
 */
test("a token with no email address can open a wallet, labelled from the profile", async () => {
  const h = harness(buildUserPrincipal({ user: { id: ANA } }));

  const res = await post(h, "/v1/signing/passkeys/challenge");

  assert.equal(res.status, 200);
  const options = (await json(res))["data"] as { user: { name: string; displayName: string } };
  assert.deepEqual(options.user, { id: "r2", name: "anarobles", displayName: "Ana Robles" });
});

/**
 * The rule the whole change exists for. A wallet account's auth email is synthetic and derived from
 * the wallet, and WebAuthn's `user.name` is stored in the authenticator and synced to a password
 * manager — so if the email ever reached this field, the address would be in someone's keychain
 * permanently. Asserts the absence directly rather than trusting the positive assertion above.
 */
test("the passkey is never labelled with the caller's auth email", async () => {
  const synthetic =
    "eip155-2e911ddf15b7bd5963df3f09e9f34c2f580d701a2647bbca89cdb91e0941c59d@wallet.pickler.fun";

  // Both branches: the profile supplies the name, and the fallback when there is no profile.
  // Covering only the first would leave the fallback free to reach for the email.
  for (const profile of [true, false]) {
    const h = harness(buildUserPrincipal({ user: { id: ANA, email: synthetic } }));
    if (!profile) {
      h.profileRow.value = null;
    }

    const res = await post(h, "/v1/signing/passkeys/challenge");

    assert.equal(res.status, 200);
    const body = await res.text();
    const where = profile ? "with a profile" : "with no profile";
    assert.equal(
      body.includes(synthetic),
      false,
      `the synthetic address reached the credential, ${where}`,
    );
    assert.equal(
      body.includes("wallet.pickler.fun"),
      false,
      `the synthetic domain reached it, ${where}`,
    );
  }
});

/**
 * Someone who has never claimed a handle is labelled by an opaque fragment of their user id — not
 * refused, and above all not labelled with the address. The id is random, so this discloses
 * nothing; it is merely unfriendly, which is the right way for a fallback to be bad.
 */
test("a caller with no profile is labelled opaquely, never by their address", async () => {
  const synthetic =
    "eip155-2e911ddf15b7bd5963df3f09e9f34c2f580d701a2647bbca89cdb91e0941c59d@wallet.pickler.fun";
  const h = harness(buildUserPrincipal({ user: { id: ANA, email: synthetic } }));
  h.profileRow.value = null;

  const res = await post(h, "/v1/signing/passkeys/challenge");

  assert.equal(res.status, 200);
  const options = (await json(res))["data"] as { user: { name: string; displayName: string } };
  assert.equal(options.user.name, "pickler-11111111");
  assert.equal(options.user.displayName, "pickler-11111111");
});

test("the orphan of a lost race is logged against the request that caused it", async () => {
  const h = harness();
  const challenge = await challengeFor(h);
  // The pre-check passes, the unique index then rejects the insert, and the winner's row is
  // readable on the second look. This is the path that actually happens on a double submit.
  h.repository.saveRegistration = async () => ({ created: false });
  let lookups = 0;
  h.repository.findByUserId = async () => {
    lookups += 1;
    return lookups === 1
      ? null
      : {
          userId: ANA,
          subOrganizationId: "sub-winner",
          masterWalletId: "wal-winner",
          rootUserId: "usr-winner",
          address: "0x2222222222222222222222222222222222222222",
        };
  };

  const res = await post(
    h,
    "/v1/signing/passkeys/register",
    { label: "Touch ID", challenge, attestation: ATTESTATION },
    { "X-Request-Id": "req-abcdef12" },
  );

  assert.equal(res.status, 200);
  assert.equal((await data(res))["sub_organization_id"], "sub-winner");
  assert.deepEqual(h.orphans, [
    { userId: ANA, subOrganizationId: "sub-1", requestId: "req-abcdef12" },
  ]);
});

test("a body larger than any passkey ceremony produces is refused unread", async () => {
  const h = harness();
  const challenge = await challengeFor(h);

  const res = await post(h, "/v1/signing/passkeys/register", {
    label: "Touch ID",
    challenge,
    attestation: { ...ATTESTATION, attestationObject: "A".repeat(20_000) },
  });

  assert.equal(res.status, 413);
  assert.deepEqual(h.creations, []);
});

// ─── The agent wallet ceremony ──────────────────────────────────────────────────────────────

const get = (h: Harness, path: string) => h.app.request(path, { method: "GET" }, env);

const CEREMONY_SIGNED = {
  url: "https://api.turnkey.com/public/v1/submit/create_wallet",
  body: '{"type":"ACTIVITY_TYPE_CREATE_WALLET"}',
  stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "c3RhbXA" },
};

function completed(result: Record<string, Record<string, unknown>>): TurnkeyActivity {
  return { id: "act-9", fingerprint: "f", status: "ACTIVITY_STATUS_COMPLETED", result };
}

test("every ceremony route refuses a caller without a session", async () => {
  const h = harness(null);
  const calls: [string, "GET" | "POST"][] = [
    ["/v1/signing/agents/state", "GET"],
    ["/v1/signing/agents/delegated/prepare", "POST"],
    ["/v1/signing/agents/delegated/confirm", "POST"],
    ["/v1/signing/agents/wallet/prepare", "POST"],
    ["/v1/signing/agents/wallet/confirm", "POST"],
    ["/v1/signing/agents/wallet/w-1/policies/prepare", "POST"],
    ["/v1/signing/agents/wallet/w-1/policies/confirm", "POST"],
  ];

  for (const [path, method] of calls) {
    const res = method === "GET" ? await get(h, path) : await post(h, path, {});
    assert.equal(res.status, 401, `${method} ${path}`);
  }
  assert.deepEqual(h.ceremony.builds, []);
  assert.deepEqual(h.forwards, []);
});

test("the state tells the browser which steps remain", async () => {
  const h = harness();
  assert.deepEqual(await data(await get(h, "/v1/signing/agents/state")), {
    has_sub_organization: false,
    has_delegated_user: false,
  });

  await registered(h);
  h.ceremony.delegated = "da-1";

  assert.deepEqual(await data(await get(h, "/v1/signing/agents/state")), {
    has_sub_organization: true,
    has_delegated_user: true,
  });
});

test("the delegated user is prepared like add/prepare and confirmed into the caller's sub-organization", async () => {
  const h = harness();
  await registered(h);

  const prepared = await post(h, "/v1/signing/agents/delegated/prepare");

  assert.equal(prepared.status, 200);
  assert.deepEqual(await data(prepared), {
    url: "https://api.turnkey.com/public/v1/submit/create_users",
    body: '{"kind":"create_users"}',
    timestampMs: "1758542400000",
    organizationId: "sub-1",
  });
  assert.deepEqual(h.ceremony.builds, [
    { kind: "create_users", input: { subOrganizationId: "sub-1", publicKey: "02delegated" } },
  ]);

  h.nextActivity.value = completed({ createUsersResult: { userIds: ["da-1"] } });
  const confirmed = await post(h, "/v1/signing/agents/delegated/confirm", {
    signed: CEREMONY_SIGNED,
  });

  assert.equal(confirmed.status, 200);
  assert.deepEqual(await data(confirmed), { delegated_user_id: "da-1" });
  assert.deepEqual(h.forwards.at(-1)?.expectations, {
    organizationId: "sub-1",
    allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_USERS_V4"],
  });
  assert.equal(h.ceremony.delegated, "da-1");

  // Once set, a second prepare is a conflict rather than a second Pickler user.
  const again = await post(h, "/v1/signing/agents/delegated/prepare");
  assert.equal(again.status, 409);
});

test("without Pickler's delegated key the ceremony answers 503 and builds nothing", async () => {
  const h = harness();
  h.delegatedKey.value = null;
  await registered(h);

  const res = await post(h, "/v1/signing/agents/delegated/prepare");

  assert.equal(res.status, 503);
  assert.equal((await json(res))["error"], "agent_wallets_unavailable");
  assert.deepEqual(h.ceremony.builds, []);
});

test("a wallet is prepared under a valid handle, confirmed, and a retry answers the existing one", async () => {
  const h = harness();
  await registered(h);

  const bad = await post(h, "/v1/signing/agents/wallet/prepare", { handle: "Half Time" });
  assert.equal(bad.status, 400);

  const prepared = await post(h, "/v1/signing/agents/wallet/prepare", { handle: "halftime" });
  assert.equal(prepared.status, 200);
  assert.deepEqual(await data(prepared), {
    url: "https://api.turnkey.com/public/v1/submit/create_wallet",
    body: '{"kind":"create_wallet"}',
    timestampMs: "1758542400000",
    organizationId: "sub-1",
  });

  h.nextActivity.value = completed({
    createWalletResult: { walletId: "w-1", addresses: [ADDRESS] },
  });
  const confirmed = await post(h, "/v1/signing/agents/wallet/confirm", {
    handle: "halftime",
    signed: CEREMONY_SIGNED,
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await data(confirmed), { wallet_id: "w-1", address: ADDRESS });
  assert.deepEqual(h.forwards.at(-1)?.expectations, {
    organizationId: "sub-1",
    allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_WALLET"],
  });

  const retry = await post(h, "/v1/signing/agents/wallet/prepare", { handle: "halftime" });
  assert.deepEqual(await data(retry), { existing: { wallet_id: "w-1", address: ADDRESS } });
  assert.equal(h.ceremony.builds.filter((b) => b.kind === "create_wallet").length, 1);
});

test("policies are prepared for the caller's wallet and confirmed to their ids", async () => {
  const h = harness();
  await registered(h);
  h.ceremony.delegated = "da-1";
  h.ceremony.wallets.push({
    userId: ANA,
    walletId: "w-1",
    subOrganizationId: "sub-1",
    kind: "agent",
    name: "halftime",
    address: ADDRESS,
    path: "m/44'/60'/0'/0/0",
  });

  const missingFlag = await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare", {});
  assert.equal(missingFlag.status, 400);
  const notMine = await post(h, "/v1/signing/agents/wallet/w-2/policies/prepare", {
    first_agent: true,
  });
  assert.equal(notMine.status, 404);

  const prepared = await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare", {
    first_agent: true,
  });
  assert.equal(prepared.status, 200);
  assert.equal((await data(prepared))["organizationId"], "sub-1");
  const build = h.ceremony.builds.find((b) => b.kind === "create_policies");
  const policies = (build?.input as { policies: { policyName: string }[] }).policies;
  assert.deepEqual(
    policies.map((p) => p.policyName),
    ["Never a transfer out", "Only root changes the rules", "Pickler may remove itself"],
  );

  h.nextActivity.value = completed({ createPoliciesResult: { policyIds: ["p1", "p2", "p3"] } });
  const confirmed = await post(h, "/v1/signing/agents/wallet/w-1/policies/confirm", {
    signed: CEREMONY_SIGNED,
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await data(confirmed), { policy_ids: ["p1", "p2", "p3"] });
  assert.deepEqual(h.forwards.at(-1)?.expectations, {
    organizationId: "sub-1",
    allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_POLICIES"],
  });
});

test("a wallet id that could not be a Turnkey id is refused before core sees it", async () => {
  const h = harness();
  await registered(h);

  const res = await post(h, "/v1/signing/agents/wallet/w'1/policies/prepare", {
    first_agent: true,
  });

  assert.equal(res.status, 400);
  assert.deepEqual(h.ceremony.builds, []);
});
