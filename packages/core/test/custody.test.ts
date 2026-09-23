import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCustodyService,
  type CustodyServiceDeps,
} from "../src/features/wallets/application/custody.js";
import {
  ADD_PASSKEY_ACTIVITY_TYPE,
  ChallengeNotUsableError,
  NoCustodyAccountError,
} from "../src/features/wallets/domain/passkey.js";
import type {
  AddPasskeyActivityBuilder,
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  StoredChallenge,
  SubOrganizationCreator,
} from "../src/features/wallets/ports/custody.js";
import type { SignedActivityForwarder } from "../src/features/signing/ports/signing.js";
import type {
  ForwardExpectations,
  SignedActivityRequest,
} from "../src/features/signing/domain/turnkey-activity.js";

const NOW = new Date("2026-09-22T12:00:00Z");
const USER = "11111111-1111-4111-8111-111111111111";

export function fakes() {
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
  const rows: { account: unknown } = { account: null };
  // Recorded whole, for the same reason as `builds` and `forwards` below: a fake that keeps only
  // the credential id cannot tell a row landing on this person from one landing on a stranger.
  const credentials: Parameters<CustodyRepository["addPasskey"]>[0][] = [];
  const repository: CustodyRepository = {
    async findByUserId() {
      return (rows.account as CustodyAccount | null) ?? null;
    },
    async listCredentials() {
      return credentials;
    },
    async saveRegistration(input) {
      if (rows.account) {
        return { created: false };
      }
      // The port describes one transaction across turnkey_orgs, wallets, wallet_accounts AND
      // passkeys, so registering mirrors the first credential here. Leaving it out made the
      // second-device exclusion untestable without planting the row by hand.
      credentials.push({
        userId: input.userId,
        credentialId: input.credentialId,
        label: input.label,
        transports: input.transports,
        deviceType: input.deviceType,
      });
      rows.account = {
        userId: input.userId,
        subOrganizationId: input.subOrganizationId,
        masterWalletId: input.masterWalletId,
        rootUserId: input.rootUserId,
        address: input.address,
      };
      return { created: true };
    },
    async addPasskey(input) {
      credentials.push(input);
    },
  };
  let created = 0;
  const turnkey: SubOrganizationCreator = {
    async create() {
      created += 1;
      return {
        subOrganizationId: `sub-${created}`,
        walletId: `wal-${created}`,
        address: "0x1111111111111111111111111111111111111111",
        rootUserId: `usr-${created}`,
      };
    },
  };
  // The builder and the forwarder are recorded, not just stubbed: a fake that answers the same
  // constants whatever it is handed lets the caller pass the wrong sub-organization for ever.
  const builds: Parameters<AddPasskeyActivityBuilder["build"]>[0][] = [];
  const activities: AddPasskeyActivityBuilder = {
    build(input) {
      builds.push(input);
      return { url: "u", body: "b", timestampMs: "1", organizationId: "o" };
    },
  };
  const forwards: { request: SignedActivityRequest; expectations: ForwardExpectations }[] = [];
  const forwarder: SignedActivityForwarder = {
    async forward(request, expectations) {
      forwards.push({ request, expectations });
      return { id: "a", fingerprint: "f", status: "ACTIVITY_STATUS_COMPLETED" };
    },
  };
  return {
    challenges,
    repository,
    turnkey,
    activities,
    forwarder,
    stored,
    credentials,
    builds,
    forwards,
    calls: () => created,
    rows,
  };
}

export function service(f: ReturnType<typeof fakes>, extra: Partial<CustodyServiceDeps> = {}) {
  let seed = 0;
  return createCustodyService({
    challenges: f.challenges,
    repository: f.repository,
    turnkey: f.turnkey,
    activities: f.activities,
    forwarder: f.forwarder,
    rpId: "pickler.fun",
    appName: "Pickler",
    now: () => NOW,
    randomId: () => `r${(seed += 1)}`,
    ...extra,
  });
}

test("a challenge is stored against the caller and offered with the right algorithms", async () => {
  const f = fakes();
  const options = await service(f).issueChallenge(USER, "ana@pickler.fun");

  assert.equal(options.challenge, "r1");
  assert.equal(options.rp.id, "pickler.fun");
  assert.equal(options.rp.name, "Pickler");
  assert.equal(options.user.name, "ana@pickler.fun");
  assert.deepEqual(
    options.pubKeyCredParams.map((p) => p.alg),
    [-7, -257],
  );
  assert.deepEqual(f.stored.get("r1"), {
    userId: USER,
    expiresAt: new Date(NOW.getTime() + 300_000),
  });
});

test("a failed credential lookup never blocks the challenge", async () => {
  const f = fakes();
  f.repository.listCredentials = async () => {
    throw new Error("database down");
  };

  const options = await service(f).issueChallenge(USER, "ana@pickler.fun");

  assert.equal(options.challenge, "r1");
  assert.equal(options.excludeCredentials, undefined);
});

const attestation = {
  credentialId: "cred-1",
  clientDataJson: "Y2xpZW50",
  attestationObject: "YXR0",
  transports: ["internal"],
};

test("registering creates the sub-organization and returns the account", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");

  const account = await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID on This Mac",
    challenge: options.challenge,
    attestation,
  });

  assert.equal(account.subOrganizationId, "sub-1");
  assert.equal(account.address, "0x1111111111111111111111111111111111111111");
  assert.equal(f.calls(), 1);
});

test("a replay returns the existing account and never mints a second sub-organization", async () => {
  const f = fakes();
  const s = service(f);
  const first = await s.issueChallenge(USER, "ana@pickler.fun");
  await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: first.challenge,
    attestation,
  });

  const second = await s.issueChallenge(USER, "ana@pickler.fun");
  const account = await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: second.challenge,
    attestation,
  });

  assert.equal(account.subOrganizationId, "sub-1");
  assert.equal(f.calls(), 1, "Turnkey must not be called again");
});

test("a challenge cannot be spent twice", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");
  await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: options.challenge,
    attestation,
  });
  f.rows.account = null; // force past the idempotency pre-check

  await assert.rejects(
    () =>
      s.register(USER, {
        email: "ana@pickler.fun",
        label: "Touch ID",
        challenge: options.challenge,
        attestation,
      }),
    ChallengeNotUsableError,
  );
});

test("a challenge belonging to someone else is refused", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");

  await assert.rejects(
    () =>
      s.register("22222222-2222-4222-8222-222222222222", {
        email: "otra@pickler.fun",
        label: "Touch ID",
        challenge: options.challenge,
        attestation,
      }),
    ChallengeNotUsableError,
  );
  assert.equal(
    f.stored.has(options.challenge),
    false,
    "a rejected claim still spends the challenge; putting it back would let a stranger probe it",
  );
});

test("a challenge that outlived its TTL is refused", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");
  // The service clock is fixed, so age the stored record instead: this is what the row looks
  // like once the five-minute TTL has run out under a real clock.
  f.stored.set(options.challenge, { userId: USER, expiresAt: new Date(NOW.getTime() - 1) });

  await assert.rejects(
    () =>
      s.register(USER, {
        email: "ana@pickler.fun",
        label: "Touch ID",
        challenge: options.challenge,
        attestation,
      }),
    ChallengeNotUsableError,
  );
  assert.equal(f.calls(), 0, "an expired challenge must never reach Turnkey");
});

test("the loser of a concurrent submit gets the winner's account, not a 500", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");
  // The pre-check passes, then the unique index rejects the insert: saveRegistration reports
  // created:false and findByUserId now answers with the winner's row. The lookup must answer
  // null the first time, or the pre-check returns early and the backstop is never exercised.
  f.repository.saveRegistration = async () => ({ created: false });
  let lookups = 0;
  f.repository.findByUserId = async () => {
    lookups += 1;
    return lookups === 1
      ? null
      : {
          userId: USER,
          subOrganizationId: "sub-winner",
          masterWalletId: "wal-winner",
          rootUserId: "usr-winner",
          address: "0x2222222222222222222222222222222222222222",
        };
  };

  const account = await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: options.challenge,
    attestation,
  });

  assert.equal(account.subOrganizationId, "sub-winner");
  assert.equal(f.calls(), 1, "the pre-check must have been passed, not short-circuited");
  assert.equal(lookups, 2, "the winner must be re-read after the conflict");
});

test("a conflict with no readable winner fails loudly rather than returning nothing", async () => {
  const f = fakes();
  const s = service(f);
  const options = await s.issueChallenge(USER, "ana@pickler.fun");
  f.repository.saveRegistration = async () => ({ created: false });
  f.repository.findByUserId = async () => null;

  await assert.rejects(
    () =>
      s.register(USER, {
        email: "ana@pickler.fun",
        label: "Touch ID",
        challenge: options.challenge,
        attestation,
      }),
    /orphan sub-org sub-1/,
  );
});

/** Drives a registration that loses the race, with `winner` deciding whether one is readable. */
async function lostRace(reportOrphan: CustodyServiceDeps["reportOrphan"], winner: unknown) {
  const f = fakes();
  const s = service(f, { reportOrphan });
  const options = await s.issueChallenge(USER, "ana@pickler.fun");
  f.repository.saveRegistration = async () => ({ created: false });
  let lookups = 0;
  f.repository.findByUserId = async () => {
    lookups += 1;
    return lookups === 1 ? null : (winner as CustodyAccount | null);
  };
  return s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: options.challenge,
    attestation,
  });
}

const WINNER = {
  userId: USER,
  subOrganizationId: "sub-winner",
  masterWalletId: "wal-winner",
  rootUserId: "usr-winner",
  address: "0x2222222222222222222222222222222222222222",
};

test("the sub-organization the loser minted is reported, not discarded", async () => {
  const orphans: { userId: string; subOrganizationId: string }[] = [];

  const account = await lostRace((orphan) => orphans.push(orphan), WINNER);

  assert.equal(account.subOrganizationId, "sub-winner");
  // The whole record, not just the id: an orphan reported against the wrong person sends the
  // reconciliation to the wrong sub-organization, which is worse than no report at all.
  assert.deepEqual(orphans, [{ userId: USER, subOrganizationId: "sub-1" }]);
});

test("the orphan is reported even when the conflict has no readable winner", async () => {
  const orphans: { userId: string; subOrganizationId: string }[] = [];

  await assert.rejects(
    () => lostRace((orphan) => orphans.push(orphan), null),
    /orphan sub-org sub-1/,
  );
  // That message is replaced by "Internal server error" outside local development, so this is
  // the only place the id survives on this path.
  assert.deepEqual(orphans, [{ userId: USER, subOrganizationId: "sub-1" }]);
});

test("a registration that recovers is not undone by a log sink that throws", async () => {
  const account = await lostRace(() => {
    throw new Error("logging is down");
  }, WINNER);

  assert.equal(account.subOrganizationId, "sub-winner");
});

test("a registration that does not conflict reports no orphan", async () => {
  const f = fakes();
  const orphans: unknown[] = [];
  const s = service(f, { reportOrphan: (orphan) => orphans.push(orphan) });
  const options = await s.issueChallenge(USER, "ana@pickler.fun");

  await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: options.challenge,
    attestation,
  });

  assert.deepEqual(orphans, []);
});

/** The passkey row that registering the first device mirrors locally. */
const FIRST_DEVICE_ROW = {
  userId: USER,
  credentialId: "cred-1",
  label: "Touch ID",
  transports: ["internal"],
  deviceType: "platform",
};

/** Registers the first device so there is a sub-organization to add a second one to. */
async function registered(f: ReturnType<typeof fakes>) {
  const s = service(f);
  const first = await s.issueChallenge(USER, "ana@pickler.fun");
  await s.register(USER, {
    email: "ana@pickler.fun",
    label: "Touch ID",
    challenge: first.challenge,
    attestation,
  });
  return s;
}

test("preparing a new device needs an existing account", async () => {
  const f = fakes();
  await assert.rejects(
    () =>
      service(f).prepareAddPasskey(USER, {
        label: "Phone",
        challenge: "nope",
        attestation,
      }),
    NoCustodyAccountError,
  );
});

test("preparing refuses a challenge that was never issued", async () => {
  const f = fakes();
  const s = await registered(f);

  await assert.rejects(
    () =>
      s.prepareAddPasskey(USER, {
        label: "Phone",
        challenge: "never-issued",
        attestation: { ...attestation, credentialId: "cred-2", transports: ["hybrid"] },
      }),
    ChallengeNotUsableError,
  );
  assert.equal(f.builds.length, 0, "an unusable challenge must never reach the activity builder");
});

test("preparing returns the unsigned activity for the phone to stamp", async () => {
  const f = fakes();
  const s = await registered(f);
  const next = await s.issueChallenge(USER, "ana@pickler.fun");

  const prepared = await s.prepareAddPasskey(USER, {
    label: "Phone",
    challenge: next.challenge,
    attestation: { ...attestation, credentialId: "cred-2", transports: ["hybrid"] },
  });

  assert.equal(prepared.organizationId, "o");
  assert.equal(prepared.body, "b");
  // The two constants above are whatever the fake was told to say. What matters is what the
  // service handed it: the activity has to name this person's sub-organization and root user,
  // or the phone stamps an activity that adds its credential to somebody else's wallet.
  assert.deepEqual(f.builds, [
    {
      subOrganizationId: "sub-1",
      rootUserId: "usr-1",
      label: "Phone",
      challenge: next.challenge,
      attestation: { ...attestation, credentialId: "cred-2", transports: ["hybrid"] },
    },
  ]);
  assert.equal(f.stored.has(next.challenge), false, "preparing spends the challenge");
});

test("confirming forwards the stamped activity and mirrors the credential", async () => {
  const f = fakes();
  const s = await registered(f);

  const result = await s.confirmAddPasskey(USER, {
    label: "Phone",
    credentialId: "cred-2",
    transports: ["hybrid"],
    signed: {
      url: "https://api.turnkey.com/public/v1/submit/create_authenticators",
      body: "b",
      stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "s" },
    },
  });

  assert.equal(result.status, "ACTIVITY_STATUS_COMPLETED");
  // Every field, not just membership. `userId` is the one that matters most: it is the confirm
  // half of the same binding as `rootUserId` on the prepare side, and a literal in its place
  // puts the new device's credential on a stranger's account.
  assert.deepEqual(f.credentials, [
    FIRST_DEVICE_ROW,
    {
      userId: USER,
      credentialId: "cred-2",
      label: "Phone",
      transports: ["hybrid"],
      deviceType: "cross_device",
    },
  ]);
  // The forwarder is what stops a stamped body being aimed at another sub-organization or at
  // some other activity type, so pin what it was told to expect. The literal is deliberately not
  // repeated here: it is one shared constant, and whether that constant is the value Turnkey
  // accepts is settled by the compiler where the adapter builds the body against @turnkey/http's
  // single-member literal type.
  assert.deepEqual(f.forwards[0]?.expectations, {
    organizationId: "sub-1",
    allowedActivityTypes: [ADD_PASSKEY_ACTIVITY_TYPE],
  });
});

test("a credential is not mirrored until Turnkey says the activity completed", async () => {
  const f = fakes();
  const s = await registered(f);
  // Consensus is the realistic case: the activity is accepted but still needs another vote.
  f.forwarder.forward = async () => ({
    id: "a",
    fingerprint: "f",
    status: "ACTIVITY_STATUS_CONSENSUS_NEEDED",
  });

  const result = await s.confirmAddPasskey(USER, {
    label: "Phone",
    credentialId: "cred-2",
    transports: ["hybrid"],
    signed: {
      url: "https://api.turnkey.com/public/v1/submit/create_authenticators",
      body: "b",
      stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "s" },
    },
  });

  assert.equal(result.status, "ACTIVITY_STATUS_CONSENSUS_NEEDED");
  assert.deepEqual(
    f.credentials,
    [FIRST_DEVICE_ROW],
    "a second row here would claim a device Turnkey has not accepted",
  );
});

test("confirming a device needs an existing account", async () => {
  const f = fakes();
  await assert.rejects(
    () =>
      service(f).confirmAddPasskey(USER, {
        label: "Phone",
        credentialId: "cred-2",
        transports: ["hybrid"],
        signed: {
          url: "https://api.turnkey.com/public/v1/submit/create_authenticators",
          body: "b",
          stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "s" },
        },
      }),
    NoCustodyAccountError,
  );
  assert.equal(f.forwards.length, 0, "nothing may be forwarded without an account to aim it at");
});

const OTHER_USER = "22222222-2222-4222-8222-222222222222";

test("preparing refuses a challenge belonging to someone else", async () => {
  const f = fakes();
  const s = await registered(f);
  const issued = await s.issueChallenge(USER, "ana@pickler.fun");

  // The fake repository answers the same row for any caller, so the other person clears the
  // account guard and the ownership clause is the only thing left standing between them and
  // an activity built against Ana's sub-organization.
  await assert.rejects(
    () =>
      s.prepareAddPasskey(OTHER_USER, {
        label: "Phone",
        challenge: issued.challenge,
        attestation: { ...attestation, credentialId: "cred-2", transports: ["hybrid"] },
      }),
    ChallengeNotUsableError,
  );
  assert.equal(f.builds.length, 0, "a stranger's claim must never reach the activity builder");
});

test("preparing refuses a challenge that outlived its TTL", async () => {
  const f = fakes();
  const s = await registered(f);
  const issued = await s.issueChallenge(USER, "ana@pickler.fun");
  // The service clock is fixed, so age the stored record instead, as in the register case.
  f.stored.set(issued.challenge, { userId: USER, expiresAt: new Date(NOW.getTime() - 1) });

  await assert.rejects(
    () =>
      s.prepareAddPasskey(USER, {
        label: "Phone",
        challenge: issued.challenge,
        attestation: { ...attestation, credentialId: "cred-2", transports: ["hybrid"] },
      }),
    ChallengeNotUsableError,
  );
  assert.equal(f.builds.length, 0, "an expired challenge must never reach the activity builder");
});

/** Binds a prepare call for later, so several can be set up before any of them rejects. */
function prepareWith(svc: ReturnType<typeof service>, userId: string, challenge: string) {
  return () =>
    svc.prepareAddPasskey(userId, {
      label: "Phone",
      challenge,
      attestation: { ...attestation, credentialId: "cred-2", transports: ["hybrid"] },
    });
}

/** Returns the error a call rejected with, so two rejections can be compared to each other. */
async function rejection(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

test("the three ways a challenge can fail reject identically, so none of them is an oracle", async () => {
  // One fixture per cause, because each cause consumes a challenge and none can be reused.
  const absent = fakes();
  const missingCall = prepareWith(await registered(absent), USER, "never-issued");

  const stranger = fakes();
  const strangerService = await registered(stranger);
  const theirs = await strangerService.issueChallenge(USER, "ana@pickler.fun");
  const wrongOwnerCall = prepareWith(strangerService, OTHER_USER, theirs.challenge);

  const aged = fakes();
  const agedService = await registered(aged);
  const old = await agedService.issueChallenge(USER, "ana@pickler.fun");
  aged.stored.set(old.challenge, { userId: USER, expiresAt: new Date(NOW.getTime() - 1) });
  const expiredCall = prepareWith(agedService, USER, old.challenge);

  const missing = await rejection(missingCall);
  const wrongOwner = await rejection(wrongOwnerCall);
  const expired = await rejection(expiredCall);

  // The equality is the whole point, not tidiness: a caller who can tell "no such challenge"
  // from "not yours" can enumerate which challenges exist and who holds them. A later hand
  // adding a cause, a code or a more helpful message for debuggability breaks that, and these
  // three assertions are what says so. They compare the errors to each other rather than to a
  // class or a literal, so renaming the error or rewording it stays green.
  for (const other of [wrongOwner, expired]) {
    assert.equal(other.constructor, missing.constructor, "same error type");
    assert.equal(other.message, missing.message, "same message, to the character");
    assert.deepEqual({ ...other }, { ...missing }, "no extra property distinguishes the cause");
  }
  assert.equal(absent.builds.length + stranger.builds.length + aged.builds.length, 0);
});

test("the account is read straight through, and is null before there is one", async () => {
  const f = fakes();
  assert.equal(await service(f).getAccount(USER), null);

  const s = await registered(f);

  assert.deepEqual(await s.getAccount(USER), {
    userId: USER,
    subOrganizationId: "sub-1",
    masterWalletId: "wal-1",
    rootUserId: "usr-1",
    address: "0x1111111111111111111111111111111111111111",
  });
});

test("a second device is offered the first one's credential to exclude", async () => {
  const f = fakes();
  const s = await registered(f);

  // Nobody placed this row: registering the first device wrote it, and the challenge for the
  // second device picks it up. This is the defence against enrolling one authenticator twice,
  // and it only means anything if the two halves meet without a hand in between.
  const options = await s.issueChallenge(USER, "ana@pickler.fun");

  assert.deepEqual(options.excludeCredentials, [
    { id: "cred-1", type: "public-key", transports: ["internal"] },
  ]);
});
