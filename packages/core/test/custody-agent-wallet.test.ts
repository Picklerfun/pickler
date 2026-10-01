import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/features/wallets/application/custody.js";
import {
  AgentWalletNotFoundError,
  DelegatedKeyNotConfiguredError,
  DelegatedUserExistsError,
  DelegatedUserMissingError,
  MONAD_ACCOUNT_PATH,
  NoCustodyAccountError,
} from "../src/features/wallets/domain/passkey.js";
import {
  agentWalletPolicies,
  MIN_AGENT_WALLET_POLICIES,
  type TurnkeyPolicy,
} from "../src/features/wallets/domain/agent-wallet-policies.js";
import type { UnsignedActivity } from "../src/features/wallets/ports/custody.js";
import {
  MIN_START_MICRO_AUSD,
  MIN_START_MON_WEI,
  WalletUnderfundedError,
} from "../src/features/studio/create.js";
import { DepositsUnavailableError } from "../src/features/wallets/domain/deposit.js";
import type {
  AgentWalletActivityBuilders,
  AgentWalletRepository,
  CustodyAccount,
  CustodyRepository,
  ExistingAgentWallet,
} from "../src/features/wallets/ports/custody.js";
import type { SignedActivityForwarder } from "../src/features/signing/ports/signing.js";
import {
  InvalidSignedActivityError,
  SignedActivityRejectedError,
  SigningServiceUnavailableError,
  type ForwardExpectations,
  type TurnkeyActivity,
} from "../src/features/signing/domain/turnkey-activity.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "0x2222222222222222222222222222222222222222";
const ACCOUNT: CustodyAccount = {
  userId: USER,
  subOrganizationId: "sub-ana",
  masterWalletId: "wal-master",
  rootUserId: "root-ana",
  address: "0x1111111111111111111111111111111111111111",
};
/** What the browser sends back after the passkey stamps an unsigned activity, unchanged. */
function stamped(unsigned: UnsignedActivity, body: string = unsigned.body) {
  return {
    url: unsigned.url,
    body,
    stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "s" },
  };
}

/** The same activity with its parameters edited, as a tampering browser would stamp it. */
function tampered(
  unsigned: UnsignedActivity,
  edit: (parameters: { [key: string]: unknown; policies: unknown[] }) => void,
) {
  const body = JSON.parse(unsigned.body);
  edit(body.parameters);
  return stamped(unsigned, JSON.stringify(body));
}

type Saved = Parameters<AgentWalletRepository["saveWallet"]>[0];

function fakes(
  options: {
    account?: CustodyAccount | null;
    delegated?: string | null;
    agentWallets?: number;
  } = {},
) {
  const state = {
    /** Agent wallets recorded before this test's, which `countAgentWallets` adds to its own. */
    earlierWallets: options.agentWallets ?? 0,
    /** Chain balances by address; a wallet not listed holds exactly the minimums to start. */
    balances: {} as Record<string, { monWei: bigint | null; ausdMicro: bigint | null }>,
    account: options.account === undefined ? ACCOUNT : options.account,
    delegated: options.delegated ?? null,
    wallets: [] as Saved[],
    linked: new Set<string>(),
    /** `approved_policy_ids` per wallet id, as `saveApprovedPolicies` would have left them. */
    approvedIds: new Map<string, string[]>(),
    /** Whether any of this person's wallets is linked to an agent already. */
    hasLinked: false,
    /** What `saveApprovedPolicies` was called with, most recent last. */
    approved: [] as { userId: string; walletId: string; policyIds: string[] }[],
    /** Makes the save refuse as if another confirm had recorded its user first. */
    raceOnSave: false,
    unrecorded: [] as { userId: string; subOrganizationId: string; delegatedUserId: string }[],
    /** What the forwarder answers next. */
    activity: {
      id: "act-1",
      fingerprint: "f",
      status: "ACTIVITY_STATUS_COMPLETED",
    } as TurnkeyActivity,
  };

  const repository = {
    async findByUserId(userId: string) {
      return state.account?.userId === userId ? state.account : null;
    },
  } as unknown as CustodyRepository;

  const agentWallets: AgentWalletRepository = {
    async saveDelegatedUser(_userId, id) {
      if (state.raceOnSave || (state.delegated && state.delegated !== id)) {
        throw new DelegatedUserExistsError();
      }
      state.delegated = id;
    },
    async delegatedUserId() {
      return state.delegated;
    },
    async saveWallet(input) {
      state.wallets.push(input);
    },
    async findUnlinkedWallet(userId) {
      const found = [...state.wallets]
        .reverse()
        .find((w) => w.userId === userId && !state.linked.has(w.walletId));
      return found
        ? {
            walletId: found.walletId,
            address: found.address,
            approvedPolicyIds: state.approvedIds.get(found.walletId) ?? null,
          }
        : null;
    },
    async countAgentWallets(userId) {
      return state.earlierWallets + state.wallets.filter((w) => w.userId === userId).length;
    },
    async listAgentWallets() {
      return [];
    },
    async saveTransfer() {},
    async transferRecorded() {
      return false;
    },
    async findOwnedAgentWallet(userId, walletId) {
      const found = state.wallets.find((w) => w.userId === userId && w.walletId === walletId);
      return found ? { walletId: found.walletId, address: found.address } : null;
    },
    async hasLinkedAgentWallet() {
      return state.hasLinked;
    },
    async findAgentWallet() {
      return null;
    },
    async saveApprovedPolicies(userId, walletId, policyIds) {
      state.approved.push({ userId, walletId, policyIds });
    },
    async saveDeposit() {},
    async depositRecorded() {
      return false;
    },
  };

  const builds: { kind: string; input: unknown }[] = [];
  // A real JSON body carrying everything the builder was given, and a fresh timestamp unless a
  // confirm asks for one, as the Turnkey builder does; the confirm-side byte comparison depends on
  // exactly that. Only prepares (no timestamp asked) are recorded as builds.
  let clock = 0;
  const unsigned = (kind: string, input: { subOrganizationId: string; timestampMs?: string }) => {
    const { subOrganizationId, timestampMs: asked, ...parameters } = input;
    if (asked === undefined) {
      builds.push({ kind, input });
    }
    const timestampMs = asked ?? String((clock += 1));
    return {
      url: `https://api.turnkey.com/public/v1/submit/${kind}`,
      body: JSON.stringify({
        type: kind,
        timestampMs,
        organizationId: subOrganizationId,
        parameters,
      }),
      timestampMs,
      organizationId: subOrganizationId,
    };
  };
  const agentActivities: AgentWalletActivityBuilders = {
    createDelegatedUser: (input) => unsigned("create_users", input),
    createAgentWallet: (input) => unsigned("create_wallet", input),
    createPolicies: (input) => unsigned("create_policies", input),
    signTransaction: (input) => unsigned("sign_transaction", input),
  };

  const forwards: ForwardExpectations[] = [];
  const forwarder: SignedActivityForwarder = {
    async forward(_request, expectations) {
      forwards.push(expectations);
      return state.activity;
    },
  };

  return { state, repository, agentWallets, agentActivities, forwarder, builds, forwards };
}

function service(
  f: ReturnType<typeof fakes>,
  extra: { delegatedPublicKey?: string | null; venueContracts?: string[]; balances?: boolean } = {},
) {
  return createCustodyService({
    challenges: { put: async () => {}, consume: async () => null },
    repository: f.repository,
    turnkey: {
      create: async () => {
        throw new Error("not in this ceremony");
      },
    },
    activities: {
      build: () => {
        throw new Error("not in this ceremony");
      },
    },
    forwarder: f.forwarder,
    agentActivities: f.agentActivities,
    agentWallets: f.agentWallets,
    ...(extra.balances === false
      ? {}
      : {
          balances: {
            read: async (address: string) =>
              f.state.balances[address] ?? {
                monWei: MIN_START_MON_WEI,
                ausdMicro: MIN_START_MICRO_AUSD,
              },
          },
        }),
    delegatedPublicKey: extra.delegatedPublicKey === undefined ? "02abc" : extra.delegatedPublicKey,
    venueContracts: extra.venueContracts ?? [],
    rpId: "pickler.fun",
    appName: "Pickler",
    now: () => new Date("2026-09-25T12:00:00Z"),
    randomId: () => "r",
    reportUnrecordedDelegatedUser: (user) => f.state.unrecorded.push(user),
  });
}

function completed(result: Record<string, Record<string, unknown>>): TurnkeyActivity {
  return { id: "act-1", fingerprint: "f", status: "ACTIVITY_STATUS_COMPLETED", result };
}

test("the state says which steps remain", async () => {
  assert.deepEqual(await service(fakes({ account: null })).agentWalletState(USER), {
    hasSubOrganization: false,
    hasDelegatedUser: false,
  });
  assert.deepEqual(await service(fakes()).agentWalletState(USER), {
    hasSubOrganization: true,
    hasDelegatedUser: false,
  });
  assert.deepEqual(await service(fakes({ delegated: "da" })).agentWalletState(USER), {
    hasSubOrganization: true,
    hasDelegatedUser: true,
  });
});

test("the delegated user is built against the person's sub-organization with Pickler's key", async () => {
  const f = fakes();

  const unsigned = await service(f).prepareDelegatedUser(USER);

  assert.equal(unsigned.organizationId, "sub-ana");
  assert.deepEqual(f.builds, [
    { kind: "create_users", input: { subOrganizationId: "sub-ana", publicKey: "02abc" } },
  ]);
});

test("prepareDelegatedUser refuses when one is already set, when the key is missing, and without a sub-organization", async () => {
  await assert.rejects(
    service(fakes({ delegated: "da" })).prepareDelegatedUser(USER),
    DelegatedUserExistsError,
  );
  await assert.rejects(
    service(fakes(), { delegatedPublicKey: null }).prepareDelegatedUser(USER),
    DelegatedKeyNotConfiguredError,
  );
  await assert.rejects(
    service(fakes({ account: null })).prepareDelegatedUser(USER),
    NoCustodyAccountError,
  );
});

test("confirmDelegatedUser forwards only create_users into the person's sub-organization and saves the id", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDelegatedUser(USER);
  f.state.activity = completed({ createUsersResult: { userIds: ["da-1"] } });

  assert.deepEqual(await service(f).confirmDelegatedUser(USER, stamped(unsigned)), {
    delegatedUserId: "da-1",
  });

  assert.deepEqual(f.forwards, [
    { organizationId: "sub-ana", allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_USERS_V4"] },
  ]);
  assert.equal(f.state.delegated, "da-1");
});

test("a delegated user stamped with another key, or beside another user, is refused unforwarded", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDelegatedUser(USER);
  f.state.activity = completed({ createUsersResult: { userIds: ["da-1"] } });

  await assert.rejects(
    service(f).confirmDelegatedUser(
      USER,
      tampered(unsigned, (p) => {
        p.publicKey = "02attacker";
      }),
    ),
    InvalidSignedActivityError,
  );
  await assert.rejects(
    service(f).confirmDelegatedUser(
      USER,
      tampered(unsigned, (p) => {
        p.extraUser = { userName: "Mallory" };
      }),
    ),
    InvalidSignedActivityError,
  );
  // Another organization, or another endpoint, is not the prepared activity either.
  const elsewhere = JSON.parse(unsigned.body);
  elsewhere.organizationId = "sub-other";
  await assert.rejects(
    service(f).confirmDelegatedUser(USER, stamped(unsigned, JSON.stringify(elsewhere))),
    InvalidSignedActivityError,
  );
  await assert.rejects(
    service(f).confirmDelegatedUser(USER, {
      ...stamped(unsigned),
      url: "https://api.turnkey.com/public/v1/submit/create_wallet",
    }),
    InvalidSignedActivityError,
  );
  await assert.rejects(
    service(f).confirmDelegatedUser(USER, stamped(unsigned, "not json")),
    InvalidSignedActivityError,
  );

  assert.deepEqual(f.forwards, []);
  assert.equal(f.state.delegated, null);
});

test("confirming a delegated user without the configured key is refused", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDelegatedUser(USER);

  await assert.rejects(
    service(f, { delegatedPublicKey: null }).confirmDelegatedUser(USER, stamped(unsigned)),
    DelegatedKeyNotConfiguredError,
  );
  assert.deepEqual(f.forwards, []);
});

test("a delegated user that did not complete is not saved", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDelegatedUser(USER);

  f.state.activity = { id: "a", fingerprint: "f", status: "ACTIVITY_STATUS_FAILED" };
  await assert.rejects(
    service(f).confirmDelegatedUser(USER, stamped(unsigned)),
    SignedActivityRejectedError,
  );

  f.state.activity = { id: "a", fingerprint: "f", status: "ACTIVITY_STATUS_PENDING" };
  await assert.rejects(
    service(f).confirmDelegatedUser(USER, stamped(unsigned)),
    SigningServiceUnavailableError,
  );
  assert.equal(f.state.delegated, null);
});

test("a wallet is built as Agent wallet 1, confirmed with create_wallet only, and saved as an agent's", async () => {
  const f = fakes();

  const prepared = await service(f).prepareAgentWallet(USER);
  assert.ok("unsigned" in prepared);
  assert.deepEqual(f.builds, [
    { kind: "create_wallet", input: { subOrganizationId: "sub-ana", name: "Agent wallet 1" } },
  ]);

  f.state.activity = completed({ createWalletResult: { walletId: "w-1", addresses: [ADDRESS] } });
  const wallet = await service(f).confirmAgentWallet(USER, stamped(prepared.unsigned));

  assert.deepEqual(wallet, { walletId: "w-1", address: ADDRESS });
  assert.deepEqual(f.forwards, [
    { organizationId: "sub-ana", allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_WALLET"] },
  ]);
  assert.deepEqual(f.state.wallets, [
    {
      userId: USER,
      walletId: "w-1",
      subOrganizationId: "sub-ana",
      kind: "agent",
      name: "Agent wallet 1",
      address: ADDRESS,
      path: MONAD_ACCOUNT_PATH,
    },
  ]);
});

test("the second agent wallet is named Agent wallet 2", async () => {
  const f = fakes({ agentWallets: 1 });

  const prepared = await service(f).prepareAgentWallet(USER);

  assert.ok("unsigned" in prepared);
  assert.equal(JSON.parse(prepared.unsigned.body).parameters.name, "Agent wallet 2");
});

test("a wallet stamped under another name is refused unforwarded", async () => {
  const f = fakes();
  const prepared = await service(f).prepareAgentWallet(USER);
  assert.ok("unsigned" in prepared);

  await assert.rejects(
    service(f).confirmAgentWallet(
      USER,
      tampered(prepared.unsigned, (p) => {
        p.name = "Mallory's wallet";
      }),
    ),
    InvalidSignedActivityError,
  );
  assert.deepEqual(f.forwards, []);
  assert.deepEqual(f.state.wallets, []);
});

test("a ceremony prepared before another wallet was recorded no longer confirms, and mints nothing", async () => {
  const f = fakes();
  const stale = await service(f).prepareAgentWallet(USER);
  assert.ok("unsigned" in stale);
  // Another tab's ceremony recorded "Agent wallet 1" in between.
  f.state.earlierWallets = 1;

  await assert.rejects(
    service(f).confirmAgentWallet(USER, stamped(stale.unsigned)),
    InvalidSignedActivityError,
  );
  assert.deepEqual(f.forwards, []);
});

test("a retry finds the unlinked wallet, whatever its name, and builds nothing", async () => {
  const f = fakes();
  orphan(f);

  const prepared = await service(f).prepareAgentWallet(USER);

  assert.deepEqual(prepared, {
    existing: {
      walletId: "w-orphan",
      address: ADDRESS,
      policiesApproved: false,
    } satisfies ExistingAgentWallet,
  });
  assert.deepEqual(f.builds, []);
});

function orphan(f: ReturnType<typeof fakes>, approvedIds?: string[]) {
  f.state.wallets.push({
    userId: USER,
    walletId: "w-orphan",
    subOrganizationId: "sub-ana",
    kind: "agent",
    name: "halftime",
    address: ADDRESS,
    path: MONAD_ACCOUNT_PATH,
  });
  if (approvedIds) {
    f.state.approvedIds.set("w-orphan", approvedIds);
  }
}

test("an orphan wallet whose rules were approved says so, so a retry skips that prompt", async () => {
  const f = fakes();
  orphan(f, ["p1", "p2", "p3"]);

  const prepared = await service(f).prepareAgentWallet(USER);

  assert.deepEqual(prepared, {
    existing: { walletId: "w-orphan", address: ADDRESS, policiesApproved: true },
  });
  assert.deepEqual(f.builds, []);
});

test("an orphan wallet with fewer approved ids than the floor is not approved", async () => {
  const f = fakes();
  orphan(f, ["p1", "p2"]);

  const prepared = await service(f).prepareAgentWallet(USER);

  assert.ok("existing" in prepared);
  assert.equal(prepared.existing.policiesApproved, false);
});

test("the floor is the policies every wallet is written with, whatever the venues", () => {
  assert.equal(
    agentWalletPolicies({ delegatedUserId: "da", walletId: "w-1", venueContracts: [] }).length,
    MIN_AGENT_WALLET_POLICIES,
  );
});

function withWallet(delegated: string | null = "da") {
  const f = fakes({ delegated });
  f.state.wallets.push({
    userId: USER,
    walletId: "w-1",
    subOrganizationId: "sub-ana",
    kind: "agent",
    name: "halftime",
    address: ADDRESS,
    path: MONAD_ACCOUNT_PATH,
  });
  return f;
}

function builtPolicies(f: ReturnType<typeof fakes>): TurnkeyPolicy[] {
  const build = f.builds.find((b) => b.kind === "create_policies");
  assert.ok(build);
  return (build.input as { policies: TurnkeyPolicy[] }).policies;
}

test("the self-delete policy is added only while no wallet of the person's is linked", async () => {
  const first = withWallet();
  await service(first).preparePolicies(USER, "w-1");
  const later = withWallet();
  later.state.hasLinked = true;
  await service(later).preparePolicies(USER, "w-1");

  const names = (f: ReturnType<typeof fakes>) => builtPolicies(f).map((p) => p.policyName);
  assert.deepEqual(names(first), [
    "Never a transfer out",
    "Only root changes the rules",
    "Pickler never gives itself a new way in",
    "Pickler may remove itself",
  ]);
  assert.deepEqual(names(later), [
    "Never a transfer out",
    "Only root changes the rules",
    "Pickler never gives itself a new way in",
  ]);
});

test("the venue list reaches the policies", async () => {
  const f = withWallet();

  await service(f, { venueContracts: ["0xabc"] }).preparePolicies(USER, "w-1");

  const [allow] = builtPolicies(f);
  assert.equal(allow?.effect, "EFFECT_ALLOW");
  assert.match(allow!.condition, /eth\.tx\.to == '0xabc'/);
  assert.match(allow!.condition, /wallet\.id == 'w-1'/);
});

test("policies need the delegated user and a wallet of the caller's", async () => {
  await assert.rejects(
    service(withWallet(null)).preparePolicies(USER, "w-1"),
    DelegatedUserMissingError,
  );
  await assert.rejects(
    service(withWallet()).preparePolicies(USER, "someone-elses"),
    AgentWalletNotFoundError,
  );
  const f = withWallet();
  const unsigned = await service(f).preparePolicies(USER, "w-1");
  await assert.rejects(
    service(f).confirmPolicies(USER, "someone-elses", stamped(unsigned)),
    AgentWalletNotFoundError,
  );
});

test("policies are not prepared for a wallet below the minimums", async () => {
  for (const balances of [
    { monWei: 0n, ausdMicro: 25_000_000n },
    { monWei: MIN_START_MON_WEI, ausdMicro: MIN_START_MICRO_AUSD - 1n },
    { monWei: null, ausdMicro: 25_000_000n },
  ]) {
    const f = withWallet();
    f.state.balances[ADDRESS] = balances;

    await assert.rejects(service(f).preparePolicies(USER, "w-1"), WalletUnderfundedError);
    assert.deepEqual(f.builds, []);
  }
});

test("policies are prepared once both minimums are met", async () => {
  const f = withWallet();
  f.state.balances[ADDRESS] = { monWei: MIN_START_MON_WEI, ausdMicro: MIN_START_MICRO_AUSD };

  await service(f).preparePolicies(USER, "w-1");

  assert.equal(f.builds.length, 1);
});

test("without a balance reader, policies cannot be prepared", async () => {
  await assert.rejects(
    service(withWallet(), { balances: false }).preparePolicies(USER, "w-1"),
    DepositsUnavailableError,
  );
});

test("confirmPolicies does not check balances: the stamp is already made", async () => {
  const f = withWallet();
  const unsigned = await service(f).preparePolicies(USER, "w-1");
  f.state.balances[ADDRESS] = { monWei: 0n, ausdMicro: 0n };
  f.state.activity = completed({
    createPoliciesResult: { policyIds: ["p1", "p2", "p3", "p4"] },
  });

  assert.deepEqual(await service(f).confirmPolicies(USER, "w-1", stamped(unsigned)), {
    policyIds: ["p1", "p2", "p3", "p4"],
  });
});

test("confirmPolicies forwards only create_policies and returns the ids", async () => {
  const f = withWallet();
  const unsigned = await service(f).preparePolicies(USER, "w-1");
  f.state.activity = completed({
    createPoliciesResult: { policyIds: ["p1", "p2", "p3", "p4"] },
  });

  assert.deepEqual(await service(f).confirmPolicies(USER, "w-1", stamped(unsigned)), {
    policyIds: ["p1", "p2", "p3", "p4"],
  });
  assert.deepEqual(f.forwards, [
    { organizationId: "sub-ana", allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_POLICIES"] },
  ]);
});

test("confirmPolicies records the ids Turnkey actually created as this wallet's approved ones", async () => {
  const f = withWallet();
  const unsigned = await service(f).preparePolicies(USER, "w-1");
  f.state.activity = completed({
    createPoliciesResult: { policyIds: ["p1", "p2", "p3", "p4"] },
  });

  await service(f).confirmPolicies(USER, "w-1", stamped(unsigned));

  assert.deepEqual(f.state.approved, [
    { userId: USER, walletId: "w-1", policyIds: ["p1", "p2", "p3", "p4"] },
  ]);
});

test("policies with an extra ALLOW, or one missing, are refused unforwarded", async () => {
  const f = withWallet();
  const unsigned = await service(f).preparePolicies(USER, "w-1");

  await assert.rejects(
    service(f).confirmPolicies(
      USER,
      "w-1",
      tampered(unsigned, (p) => {
        p.policies.push({
          policyName: "Anything",
          effect: "EFFECT_ALLOW",
          consensus: "approvers.any(user, user.id == 'da')",
          condition: "true",
          notes: "",
        });
      }),
    ),
    InvalidSignedActivityError,
  );
  await assert.rejects(
    service(f).confirmPolicies(
      USER,
      "w-1",
      tampered(unsigned, (p) => {
        p.policies.shift();
      }),
    ),
    InvalidSignedActivityError,
  );
  assert.deepEqual(f.forwards, []);
});

test("policies prepared for a first agent no longer confirm once another wallet is linked", async () => {
  const f = withWallet();
  const unsigned = await service(f).preparePolicies(USER, "w-1");
  f.state.hasLinked = true;

  await assert.rejects(
    service(f).confirmPolicies(USER, "w-1", stamped(unsigned)),
    InvalidSignedActivityError,
  );
  assert.deepEqual(f.forwards, []);
});

test("confirmPolicies needs exactly one id per prepared policy", async () => {
  const f = withWallet();
  const unsigned = await service(f).preparePolicies(USER, "w-1");

  for (const policyIds of [["p1"], ["p1", "p2", "p3"], ["p1", "p2", "p3", "p4", "p5"]]) {
    f.state.activity = completed({ createPoliciesResult: { policyIds } });
    await assert.rejects(
      service(f).confirmPolicies(USER, "w-1", stamped(unsigned)),
      SigningServiceUnavailableError,
      `${policyIds.length} ids`,
    );
  }
});

test("a stamped body is compared byte for byte, with its own timestamp", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDelegatedUser(USER);
  const body = JSON.parse(unsigned.body);

  // The same content with the keys in another order is not the prepared body.
  const reordered = JSON.stringify({
    parameters: body.parameters,
    organizationId: body.organizationId,
    timestampMs: body.timestampMs,
    type: body.type,
  });
  // No timestamp, or one that is not digits, cannot be rebuilt at all.
  const { timestampMs: _dropped, ...untimed } = body;
  void _dropped;

  for (const tampered of [
    reordered,
    JSON.stringify(untimed),
    JSON.stringify({ ...body, timestampMs: "12a" }),
    `${unsigned.body} `,
  ]) {
    await assert.rejects(
      service(f).confirmDelegatedUser(USER, stamped(unsigned, tampered)),
      InvalidSignedActivityError,
    );
  }
  assert.deepEqual(f.forwards, []);
});

test("a delegated user already recorded is refused before anything reaches Turnkey", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDelegatedUser(USER);
  f.state.delegated = "da-0";

  await assert.rejects(
    service(f).confirmDelegatedUser(USER, stamped(unsigned)),
    DelegatedUserExistsError,
  );
  assert.deepEqual(f.forwards, []);
});

test("a delegated user Turnkey created but a racing confirm beat to the record is reported", async () => {
  const f = fakes();
  const unsigned = await service(f).prepareDelegatedUser(USER);
  f.state.activity = completed({ createUsersResult: { userIds: ["da-late"] } });
  f.state.raceOnSave = true;

  await assert.rejects(
    service(f).confirmDelegatedUser(USER, stamped(unsigned)),
    DelegatedUserExistsError,
  );
  assert.equal(f.forwards.length, 1);
  assert.deepEqual(f.state.unrecorded, [
    { userId: USER, subOrganizationId: "sub-ana", delegatedUserId: "da-late" },
  ]);
});
