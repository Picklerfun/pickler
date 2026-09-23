import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/features/wallets/application/custody.js";
import { ChallengeNotUsableError } from "../src/features/wallets/domain/passkey.js";
import type {
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  StoredChallenge,
  SubOrganizationCreator,
} from "../src/features/wallets/ports/custody.js";

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
  return { challenges, repository, turnkey, stored, credentials, calls: () => created, rows };
}

export function service(f: ReturnType<typeof fakes>) {
  let seed = 0;
  return createCustodyService({
    challenges: f.challenges,
    repository: f.repository,
    turnkey: f.turnkey,
    activities: { build: () => ({ url: "u", body: "b", timestampMs: "1", organizationId: "o" }) },
    forwarder: { forward: async () => ({ id: "a", fingerprint: "f", status: "ACTIVITY_STATUS_COMPLETED" }) },
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
