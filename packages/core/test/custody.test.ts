import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/features/wallets/application/custody.js";
import {
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
  const credentials: { credentialId: string; transports: string[] }[] = [];
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
      credentials.push({ credentialId: input.credentialId, transports: input.transports });
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

export function service(f: ReturnType<typeof fakes>) {
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

test("existing credentials are excluded so the browser refuses a second enrolment", async () => {
  const f = fakes();
  f.credentials.push({ credentialId: "cred-1", transports: ["internal"] });

  const options = await service(f).issueChallenge(USER, "ana@pickler.fun");

  assert.deepEqual(options.excludeCredentials, [
    { id: "cred-1", type: "public-key", transports: ["internal"] },
  ]);
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
  assert.ok(f.credentials.some((c) => c.credentialId === "cred-2"));
  // The forwarder is what stops a stamped body being aimed at another sub-organization or at
  // some other activity type, so pin what it was told to expect.
  assert.deepEqual(f.forwards[0]?.expectations, {
    organizationId: "sub-1",
    allowedActivityTypes: ["ACTIVITY_TYPE_CREATE_AUTHENTICATORS"],
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
  assert.equal(
    f.credentials.some((c) => c.credentialId === "cred-2"),
    false,
    "a row here would claim a device that Turnkey has not accepted",
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
