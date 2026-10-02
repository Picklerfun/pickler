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
  MIN_START_MICRO_AUSD,
  MIN_START_MON_WEI,
  type WalletBalanceReader,
} from "@pickler/core";
import { createActivityBuilders } from "@pickler/infrastructure";
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
    hasLinked: false,
    /** Wallet ids already an agent's. */
    linked: new Set<string>(),
    approved: [] as { userId: string; walletId: string; policyIds: string[] }[],
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
    async findUnlinkedWallet(userId) {
      // The fake links nothing: the newest wallet of this person's is the one a retry resumes.
      const found = ceremony.wallets.findLast((w) => w.userId === userId);
      const approved = ceremony.approved.findLast((a) => a.walletId === found?.walletId);
      return found
        ? {
            walletId: found.walletId,
            address: found.address,
            approvedPolicyIds: approved?.policyIds ?? null,
          }
        : null;
    },
    async countAgentWallets(userId) {
      return ceremony.wallets.filter((w) => w.userId === userId).length;
    },
    async listAgentWallets() {
      return [];
    },
    async saveTransfer() {},
    async transferRecorded() {
      return false;
    },
    async findOwnedAgentWallet(userId, walletId) {
      const found = ceremony.wallets.find((w) => w.userId === userId && w.walletId === walletId);
      return found
        ? {
            walletId: found.walletId,
            address: found.address,
            linked: ceremony.linked.has(found.walletId),
          }
        : null;
    },
    async hasLinkedAgentWallet() {
      return ceremony.hasLinked;
    },
    async findAgentWallet() {
      return null;
    },
    async saveApprovedPolicies(userId, walletId, policyIds) {
      ceremony.approved.push({ userId, walletId, policyIds });
    },
    async saveDeposit() {},
    async depositRecorded() {
      return false;
    },
  };
  // The real Turnkey builders, recorded: the confirm routes compare what was stamped against a
  // rebuild, so the tamper tests below have to edit the bodies Turnkey would really receive.
  let clock = 1_758_542_400_000;
  const real = createActivityBuilders({ now: () => (clock += 1) });
  const recorded =
    <K extends keyof AgentWalletActivityBuilders>(kind: K) =>
    (input: Parameters<AgentWalletActivityBuilders[K]>[0]) => {
      ceremony.builds.push({ kind, input });
      return (real[kind] as (i: typeof input) => ReturnType<AgentWalletActivityBuilders[K]>)(input);
    };
  const agentActivities: AgentWalletActivityBuilders = {
    createDelegatedUser: recorded("createDelegatedUser"),
    createAgentWallet: recorded("createAgentWallet"),
    createPolicies: recorded("createPolicies"),
    signTransaction: recorded("signTransaction"),
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

  /** What the agent wallet holds on chain, as the custody service reads it; the minimums by default. */
  const funds: { monWei: bigint | null; ausdMicro: bigint | null; fail?: Error } = {
    monWei: MIN_START_MON_WEI,
    ausdMicro: MIN_START_MICRO_AUSD,
  };
  const walletBalances: WalletBalanceReader = {
    async read() {
      if (funds.fail) {
        throw funds.fail;
      }
      return { monWei: funds.monWei, ausdMicro: funds.ausdMicro };
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
      balances: walletBalances,
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

  // A real profile service over a fake repository: the passkey's names come from here where there
  // is a profile. Without one, the WebAuthn name is the principal's real email (never a synthetic
  // one) and the Turnkey root user is the opaque fallback.
  const profileRow: {
    value: { userId: string; displayName: string; handle: string; createdAt: Date } | null;
  } = { value: { userId: ANA, displayName: "Ana Robles", handle: "anarobles", createdAt: NOW } };
  // POST /v1/profile is mounted on the same app and refuses a user without a custody account, read
  // from the same repository `register` writes — so the passkey-first rule is tested end to end.
  const profiles = createProfileService(
    {
      findByUserId: async (userId) =>
        profileRow.value?.userId === userId ? profileRow.value : null,
      isHandleTaken: async () => false,
      create: async (input) => {
        profileRow.value = { ...input, createdAt: NOW };
        return { created: true, profile: profileRow.value };
      },
    },
    { hasCustodyAccount: async (userId) => (await repository.findByUserId(userId)) !== null },
  );

  const app = createApp({
    authenticate,
    authenticateAgent: async () => {
      throw new Error("unused");
    },
    findWorkspace: async () => null,
    agentQueries: {} as never,
    budgets: {} as never,
    profiles,
    custody: {
      authenticate,
      custody,
      balances,
      profiles,
      // As container.ts wires WALLET_EMAIL_DOMAIN: wallet accounts' synthetic emails end in it.
      walletEmailDomain: "wallet.pickler.fun",
    },
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
    funds,
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
 * A wallet account's auth email is synthetic and derived from the wallet, and WebAuthn's
 * `user.name` is stored in the authenticator and synced to a password manager — so if that email
 * ever reached this field, an internal key would be in someone's keychain permanently. A real
 * email may be used (see below); a synthetic one never. Asserts the absence directly.
 */
test("the passkey is never labelled with a wallet account's synthetic email", async () => {
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

/**
 * Signup creates the passkey before the handle, so the first passkey usually has no profile to be
 * named after. The keychain entry is then the person's sign-in email, which they recognise — but
 * the Turnkey root user and sub-organization are named with the opaque fallback, because email is
 * kept out of Turnkey on purpose.
 */
test("with no profile, the WebAuthn name is the email and the Turnkey user name never is", async () => {
  const h = harness();
  h.profileRow.value = null;

  const issued = await data(await post(h, "/v1/signing/passkeys/challenge"));
  assert.deepEqual(issued["user"], { id: "r2", name: EMAIL, displayName: EMAIL });

  const res = await post(h, "/v1/signing/passkeys/register", {
    label: "Touch ID on This Mac",
    challenge: issued["challenge"],
    attestation: ATTESTATION,
  });
  assert.equal(res.status, 200, await res.text());
  assert.equal(h.creations.length, 1);
  assert.equal(h.creations[0]?.ownerLabel, "pickler-11111111");
  assert.equal(
    JSON.stringify(h.creations).includes(EMAIL),
    false,
    "the email reached the Turnkey sub-organization",
  );
});

test("with a profile, both names are the handle and the email is used for neither", async () => {
  const h = harness();

  const issued = await data(await post(h, "/v1/signing/passkeys/challenge"));
  assert.deepEqual(issued["user"], { id: "r2", name: "anarobles", displayName: "Ana Robles" });
  await post(h, "/v1/signing/passkeys/register", {
    label: "Touch ID on This Mac",
    challenge: issued["challenge"],
    attestation: ATTESTATION,
  });
  assert.equal(h.creations[0]?.ownerLabel, "anarobles");
  assert.equal(JSON.stringify(h.creations).includes(EMAIL), false);
});

test("with no profile and no email, both names are the opaque fallback", async () => {
  const h = harness(buildUserPrincipal({ user: { id: ANA } }));
  h.profileRow.value = null;

  const issued = await data(await post(h, "/v1/signing/passkeys/challenge"));
  assert.deepEqual(issued["user"], {
    id: "r2",
    name: "pickler-11111111",
    displayName: "pickler-11111111",
  });
  await post(h, "/v1/signing/passkeys/register", {
    label: "Touch ID on This Mac",
    challenge: issued["challenge"],
    attestation: ATTESTATION,
  });
  assert.equal(h.creations[0]?.ownerLabel, "pickler-11111111");
});

test("the handle is refused with wallet_required before register, and saved after it", async () => {
  const h = harness();
  h.profileRow.value = null;
  const create = () => post(h, "/v1/profile", { display_name: "Ana Robles", handle: "anarobles" });

  const refused = await create();
  assert.equal(refused.status, 409);
  assert.equal((await json(refused))["error"], "wallet_required");
  assert.equal(h.profileRow.value, null, "no profile is written without a wallet");

  await registered(h);
  const created = await create();
  assert.equal(created.status, 201, await created.text());
  assert.equal(h.profileRow.value?.handle, "anarobles");
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

interface Prepared {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}

/** What the browser posts back after the passkey stamps a prepared activity. */
function stamp(prepared: Prepared, body: string = prepared.body) {
  return {
    url: prepared.url,
    body,
    stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "c3RhbXA" },
  };
}

/** The prepared activity with its parameters edited before stamping, as a tampering page would. */
/** The parts of the create_users and create_policies parameters the tamper tests reach into. */
interface StampedParameters {
  users: { userName: string; apiKeys: { publicKey: string }[]; authenticators: unknown[] }[];
  policies: unknown[];
}

function tamper(prepared: Prepared, edit: (parameters: StampedParameters) => void) {
  const body = JSON.parse(prepared.body);
  edit(body.parameters);
  return stamp(prepared, JSON.stringify(body));
}

function completed(result: Record<string, Record<string, unknown>>): TurnkeyActivity {
  return { id: "act-9", fingerprint: "f", status: "ACTIVITY_STATUS_COMPLETED", result };
}

function withAgentWallet(h: Harness) {
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

  const res = await post(h, "/v1/signing/agents/delegated/prepare");

  assert.equal(res.status, 200);
  const prepared = (await data(res)) as unknown as Prepared;
  assert.deepEqual(Object.keys(prepared), ["url", "body", "timestampMs", "organizationId"]);
  assert.equal(prepared.url, "https://api.turnkey.com/public/v1/submit/create_users");
  assert.equal(prepared.organizationId, "sub-1");
  const body = JSON.parse(prepared.body);
  assert.equal(body.type, "ACTIVITY_TYPE_CREATE_USERS_V4");
  assert.equal(body.parameters.users[0].apiKeys[0].publicKey, "02delegated");

  h.nextActivity.value = completed({ createUsersResult: { userIds: ["da-1"] } });
  const confirmed = await post(h, "/v1/signing/agents/delegated/confirm", {
    signed: stamp(prepared),
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

test("a delegated user stamped with another public key or an extra user is refused before Turnkey", async () => {
  const h = harness();
  await registered(h);
  const prepared = (await data(
    await post(h, "/v1/signing/agents/delegated/prepare"),
  )) as unknown as Prepared;

  const otherKey = await post(h, "/v1/signing/agents/delegated/confirm", {
    signed: tamper(prepared, (p) => {
      p.users[0].apiKeys[0].publicKey = "02attacker";
    }),
  });
  const extraUser = await post(h, "/v1/signing/agents/delegated/confirm", {
    signed: tamper(prepared, (p) => {
      p.users.push({ ...p.users[0], userName: "Mallory" });
    }),
  });
  const withPasskey = await post(h, "/v1/signing/agents/delegated/confirm", {
    signed: tamper(prepared, (p) => {
      p.users[0].authenticators.push({ authenticatorName: "x" });
    }),
  });

  // The same key twice, the attacker's first: JavaScript's JSON.parse keeps the last, so this
  // body parses to exactly what Pickler built, while a parser that keeps the first reads the
  // attacker's key. Only the exact bytes Pickler built are accepted, so neither reading counts.
  const ours = JSON.stringify(JSON.parse(prepared.body).parameters.users[0].apiKeys[0].publicKey);
  const duplicateKey = await post(h, "/v1/signing/agents/delegated/confirm", {
    signed: stamp(
      prepared,
      prepared.body.replace(`"publicKey":${ours}`, `"publicKey":"02attacker","publicKey":${ours}`),
    ),
  });

  for (const res of [otherKey, extraUser, withPasskey, duplicateKey]) {
    assert.equal(res.status, 400);
    assert.equal((await json(res))["error"], "invalid_signed_activity");
  }
  assert.deepEqual(h.forwards, []);
  assert.equal(h.ceremony.delegated, null);
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

test("a wallet is prepared as Agent wallet N, confirmed, and a retry answers the existing one", async () => {
  const h = harness();
  await registered(h);

  const res = await post(h, "/v1/signing/agents/wallet/prepare", {});
  assert.equal(res.status, 200);
  const prepared = (await data(res)) as unknown as Prepared;
  assert.equal(prepared.url, "https://api.turnkey.com/public/v1/submit/create_wallet");
  assert.equal(prepared.organizationId, "sub-1");
  assert.equal(JSON.parse(prepared.body).parameters.walletName, "Agent wallet 1");

  // Stamped over an edited body: not the activity Pickler built.
  const renamed = await post(h, "/v1/signing/agents/wallet/confirm", {
    signed: stamp(prepared, prepared.body.replace("Agent wallet 1", "Agent wallet 9")),
  });
  assert.equal(renamed.status, 400);
  assert.deepEqual(h.forwards, []);

  h.nextActivity.value = completed({
    createWalletResult: { walletId: "w-1", addresses: [ADDRESS] },
  });
  const confirmed = await post(h, "/v1/signing/agents/wallet/confirm", {
    signed: stamp(prepared),
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await data(confirmed), { wallet_id: "w-1", address: ADDRESS });
  assert.deepEqual(h.forwards.at(-1)?.expectations, {
    organizationId: "sub-1",
    allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_WALLET"],
  });

  // The retry answers the unlinked wallet and builds no second create_wallet.
  const builtBefore = h.ceremony.builds.length;
  const retry = await post(h, "/v1/signing/agents/wallet/prepare");
  assert.deepEqual(await data(retry), {
    existing: { wallet_id: "w-1", address: ADDRESS, policies_approved: false },
  });
  assert.equal(h.ceremony.builds.length, builtBefore);

  // Once its rules were approved, the retry says so, and the browser skips that prompt too.
  h.ceremony.approved.push({ userId: "u", walletId: "w-1", policyIds: ["p1", "p2", "p3"] });
  const approved = await post(h, "/v1/signing/agents/wallet/prepare", {});
  assert.deepEqual(await data(approved), {
    existing: { wallet_id: "w-1", address: ADDRESS, policies_approved: true },
  });
});

test("a handle in the wallet prepare body is refused", async () => {
  const h = harness();
  await registered(h);

  const res = await post(h, "/v1/signing/agents/wallet/prepare", { handle: "halftime" });

  assert.equal(res.status, 400);
  assert.deepEqual(h.ceremony.builds, []);
});

test("WalletUnderfundedError on policies prepare is 409 wallet_underfunded with detail", async () => {
  const h = harness();
  await registered(h);
  withAgentWallet(h);
  h.funds.monWei = 0n;
  h.funds.ausdMicro = null;

  const res = await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare");

  assert.equal(res.status, 409);
  const body = await json(res);
  assert.equal(body["error"], "wallet_underfunded");
  assert.deepEqual(body["detail"], {
    ausdMicro: null,
    monWei: "0",
    minAusdMicro: "10000000",
    minMonWei: "500000000000000000",
  });
  assert.deepEqual(h.ceremony.builds, []);
});

test("policies for a wallet already linked to an agent are 409 wallet_assigned", async () => {
  const h = harness();
  await registered(h);
  withAgentWallet(h);
  h.ceremony.linked.add("w-1");

  const res = await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare");

  assert.equal(res.status, 409);
  assert.equal((await json(res))["error"], "wallet_assigned");
  assert.deepEqual(h.ceremony.builds, []);
});

const policyNames = (prepared: Prepared) =>
  (JSON.parse(prepared.body).parameters.policies as { policyName: string }[]).map(
    (p) => p.policyName,
  );

test("a chain that answers neither balance on policies prepare is 503 balances_unavailable", async () => {
  const h = harness();
  await registered(h);
  withAgentWallet(h);
  h.funds.monWei = null;
  h.funds.ausdMicro = null;

  const res = await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare");

  assert.equal(res.status, 503);
  assert.equal((await json(res))["error"], "balances_unavailable");
  assert.deepEqual(h.ceremony.builds, []);
});

test("a balance read that throws on policies prepare is 503 balances_unavailable", async () => {
  const h = harness();
  await registered(h);
  withAgentWallet(h);
  h.funds.fail = new Error("timeout");

  const res = await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare");

  assert.equal(res.status, 503);
  assert.equal((await json(res))["error"], "balances_unavailable");
});

test("the first agent's policies carry the self-delete policy; a later agent's do not", async () => {
  const h = harness();
  await registered(h);
  withAgentWallet(h);

  const first = (await data(
    await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare"),
  )) as unknown as Prepared;
  h.ceremony.hasLinked = true;
  const later = (await data(
    await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare", {}),
  )) as unknown as Prepared;

  assert.deepEqual(policyNames(first), [
    "Never a transfer out",
    "Only root changes the rules",
    "Pickler never gives itself a new way in",
    "Pickler may remove itself",
  ]);
  assert.deepEqual(policyNames(later), [
    "Never a transfer out",
    "Only root changes the rules",
    "Pickler never gives itself a new way in",
  ]);
});

test("policies prepare takes no body: first_agent is the server's decision", async () => {
  const h = harness();
  await registered(h);
  withAgentWallet(h);

  const res = await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare", {
    first_agent: false,
  });

  assert.equal(res.status, 400);
  assert.deepEqual(h.ceremony.builds, []);
});

test("policies are prepared for the caller's wallet and confirmed to their ids", async () => {
  const h = harness();
  await registered(h);
  withAgentWallet(h);

  const notMine = await post(h, "/v1/signing/agents/wallet/w-2/policies/prepare");
  assert.equal(notMine.status, 404);

  const res = await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare");
  assert.equal(res.status, 200);
  const prepared = (await data(res)) as unknown as Prepared;
  assert.equal(prepared.organizationId, "sub-1");

  h.nextActivity.value = completed({
    createPoliciesResult: { policyIds: ["p1", "p2", "p3", "p4"] },
  });
  const confirmed = await post(h, "/v1/signing/agents/wallet/w-1/policies/confirm", {
    signed: stamp(prepared),
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await data(confirmed), { policy_ids: ["p1", "p2", "p3", "p4"] });
  assert.deepEqual(h.forwards.at(-1)?.expectations, {
    organizationId: "sub-1",
    allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_POLICIES"],
  });
  assert.deepEqual(h.ceremony.approved.at(-1), {
    userId: ANA,
    walletId: "w-1",
    policyIds: ["p1", "p2", "p3", "p4"],
  });
});

test("policies stamped with an extra ALLOW are refused before Turnkey", async () => {
  const h = harness();
  await registered(h);
  withAgentWallet(h);
  const prepared = (await data(
    await post(h, "/v1/signing/agents/wallet/w-1/policies/prepare"),
  )) as unknown as Prepared;

  const res = await post(h, "/v1/signing/agents/wallet/w-1/policies/confirm", {
    signed: tamper(prepared, (p) => {
      p.policies.push({
        policyName: "Anything goes",
        effect: "EFFECT_ALLOW",
        consensus: "approvers.any(user, user.id == 'da-1')",
        condition: "activity.action == 'SIGN'",
        notes: "",
      });
    }),
  });

  assert.equal(res.status, 400);
  assert.equal((await json(res))["error"], "invalid_signed_activity");

  // A condition given twice in one policy, a harmless "true" first: parsed last-wins it is the
  // DENY Pickler built; parsed first-wins it denies nothing. The bytes decide, not the parser.
  const firstCondition = JSON.stringify(
    (JSON.parse(prepared.body).parameters.policies as { condition: string }[])[0]!.condition,
  );
  const duplicate = await post(h, "/v1/signing/agents/wallet/w-1/policies/confirm", {
    signed: stamp(
      prepared,
      prepared.body.replace(
        `"condition":${firstCondition}`,
        `"condition":"true","condition":${firstCondition}`,
      ),
    ),
  });
  assert.equal(duplicate.status, 400);
  assert.equal((await json(duplicate))["error"], "invalid_signed_activity");
  assert.deepEqual(h.forwards, []);
});

test("a wallet id that could not be a Turnkey id is refused before core sees it", async () => {
  const h = harness();
  await registered(h);

  const res = await post(h, "/v1/signing/agents/wallet/w'1/policies/prepare");

  assert.equal(res.status, 400);
  assert.deepEqual(h.ceremony.builds, []);
});
