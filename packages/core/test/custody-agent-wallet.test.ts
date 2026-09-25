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
import type { TurnkeyPolicy } from "../src/features/wallets/domain/agent-wallet-policies.js";
import type {
  AgentWallet,
  AgentWalletActivityBuilders,
  AgentWalletRepository,
  CustodyAccount,
  CustodyRepository,
} from "../src/features/wallets/ports/custody.js";
import type { SignedActivityForwarder } from "../src/features/signing/ports/signing.js";
import {
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
const SIGNED = {
  url: "https://api.turnkey.com/public/v1/submit/create_wallet",
  body: "{}",
  stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "s" },
};

type Saved = Parameters<AgentWalletRepository["saveWallet"]>[0];

function fakes(options: { account?: CustodyAccount | null; delegated?: string | null } = {}) {
  const state = {
    account: options.account === undefined ? ACCOUNT : options.account,
    delegated: options.delegated ?? null,
    wallets: [] as Saved[],
    linked: new Set<string>(),
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
      if (state.delegated && state.delegated !== id) {
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
    async findOrphanWallet(userId, name) {
      const found = state.wallets.find(
        (w) => w.userId === userId && w.name === name && !state.linked.has(w.walletId),
      );
      return found ? { walletId: found.walletId, address: found.address } : null;
    },
    async findOwnedAgentWallet(userId, walletId) {
      const found = state.wallets.find((w) => w.userId === userId && w.walletId === walletId);
      return found ? { walletId: found.walletId, address: found.address } : null;
    },
    async findAgentWallet() {
      return null;
    },
    async saveDeposit() {},
  };

  const builds: { kind: string; input: unknown }[] = [];
  const unsigned = (kind: string, input: { subOrganizationId: string }) => {
    builds.push({ kind, input });
    return {
      url: `u/${kind}`,
      body: "b",
      timestampMs: "1",
      organizationId: input.subOrganizationId,
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
  extra: { delegatedPublicKey?: string | null; venueContracts?: string[] } = {},
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
    delegatedPublicKey: extra.delegatedPublicKey === undefined ? "02abc" : extra.delegatedPublicKey,
    venueContracts: extra.venueContracts ?? [],
    rpId: "pickler.fun",
    appName: "Pickler",
    now: () => new Date("2026-09-25T12:00:00Z"),
    randomId: () => "r",
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
  f.state.activity = completed({ createUsersResult: { userIds: ["da-1"] } });

  assert.deepEqual(await service(f).confirmDelegatedUser(USER, SIGNED), {
    delegatedUserId: "da-1",
  });

  assert.deepEqual(f.forwards, [
    { organizationId: "sub-ana", allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_USERS_V4"] },
  ]);
  assert.equal(f.state.delegated, "da-1");
});

test("a delegated user that did not complete is not saved", async () => {
  const f = fakes();
  f.state.activity = { id: "a", fingerprint: "f", status: "ACTIVITY_STATUS_FAILED" };
  await assert.rejects(service(f).confirmDelegatedUser(USER, SIGNED), SignedActivityRejectedError);

  f.state.activity = { id: "a", fingerprint: "f", status: "ACTIVITY_STATUS_PENDING" };
  await assert.rejects(
    service(f).confirmDelegatedUser(USER, SIGNED),
    SigningServiceUnavailableError,
  );
  assert.equal(f.state.delegated, null);
});

test("a wallet is built under the handle, confirmed with create_wallet only, and saved as an agent's", async () => {
  const f = fakes();

  const prepared = await service(f).prepareAgentWallet(USER, "halftime");
  assert.ok("unsigned" in prepared);
  assert.deepEqual(f.builds, [
    { kind: "create_wallet", input: { subOrganizationId: "sub-ana", handle: "halftime" } },
  ]);

  f.state.activity = completed({ createWalletResult: { walletId: "w-1", addresses: [ADDRESS] } });
  const wallet = await service(f).confirmAgentWallet(USER, "halftime", SIGNED);

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
      name: "halftime",
      address: ADDRESS,
      path: MONAD_ACCOUNT_PATH,
    },
  ]);
});

test("a retry finds the orphan wallet and builds nothing", async () => {
  const f = fakes();
  f.state.wallets.push({
    userId: USER,
    walletId: "w-orphan",
    subOrganizationId: "sub-ana",
    kind: "agent",
    name: "halftime",
    address: ADDRESS,
    path: MONAD_ACCOUNT_PATH,
  });

  const prepared = await service(f).prepareAgentWallet(USER, "halftime");

  assert.deepEqual(prepared, {
    existing: { walletId: "w-orphan", address: ADDRESS } satisfies AgentWallet,
  });
  assert.deepEqual(f.builds, []);
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

test("the self-delete policy is added only for the first agent", async () => {
  const first = withWallet();
  await service(first).preparePolicies(USER, "w-1", { firstAgent: true });
  const later = withWallet();
  await service(later).preparePolicies(USER, "w-1", { firstAgent: false });

  const names = (f: ReturnType<typeof fakes>) => builtPolicies(f).map((p) => p.policyName);
  assert.deepEqual(names(first), [
    "Never a transfer out",
    "Only root changes the rules",
    "Pickler may remove itself",
  ]);
  assert.deepEqual(names(later), ["Never a transfer out", "Only root changes the rules"]);
});

test("the venue list reaches the policies", async () => {
  const f = withWallet();

  await service(f, { venueContracts: ["0xabc"] }).preparePolicies(USER, "w-1", {
    firstAgent: false,
  });

  const [allow] = builtPolicies(f);
  assert.equal(allow?.effect, "EFFECT_ALLOW");
  assert.match(allow!.condition, /eth\.tx\.to == '0xabc'/);
  assert.match(allow!.condition, /wallet\.id == 'w-1'/);
});

test("policies need the delegated user and a wallet of the caller's", async () => {
  await assert.rejects(
    service(withWallet(null)).preparePolicies(USER, "w-1", { firstAgent: true }),
    DelegatedUserMissingError,
  );
  await assert.rejects(
    service(withWallet()).preparePolicies(USER, "someone-elses", { firstAgent: true }),
    AgentWalletNotFoundError,
  );
  await assert.rejects(
    service(withWallet()).confirmPolicies(USER, "someone-elses", SIGNED),
    AgentWalletNotFoundError,
  );
});

test("confirmPolicies forwards only create_policies and returns the ids", async () => {
  const f = withWallet();
  f.state.activity = completed({ createPoliciesResult: { policyIds: ["p1", "p2", "p3"] } });

  assert.deepEqual(await service(f).confirmPolicies(USER, "w-1", SIGNED), {
    policyIds: ["p1", "p2", "p3"],
  });
  assert.deepEqual(f.forwards, [
    { organizationId: "sub-ana", allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_POLICIES"] },
  ]);
});

test("confirmPolicies with a single id throws", async () => {
  const f = withWallet();
  f.state.activity = completed({ createPoliciesResult: { policyIds: ["p1"] } });

  await assert.rejects(
    service(f).confirmPolicies(USER, "w-1", SIGNED),
    SigningServiceUnavailableError,
  );
});
