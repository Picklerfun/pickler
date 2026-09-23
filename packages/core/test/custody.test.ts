import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustodyService } from "../src/features/wallets/application/custody.js";
import type {
  ChallengeStore,
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
      return rows.account as never;
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
