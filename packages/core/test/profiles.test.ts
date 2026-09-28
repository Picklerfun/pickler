import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProfileService,
  InvalidProfileError,
  ProfileAlreadyExistsError,
  ProfileHandleTakenError,
  WalletRequiredError,
  type Profile,
  type ProfileRepository,
} from "../src/index.js";

/** For tests about the profile itself; the wallet rule has its own test below. */
const EVERYONE_HAS_A_WALLET = { hasCustodyAccount: async () => true };

function memoryRepo(): ProfileRepository & { rows: Profile[] } {
  const rows: Profile[] = [];
  return {
    rows,
    findByUserId: async (userId) => rows.find((p) => p.userId === userId) ?? null,
    isHandleTaken: async (handle) => rows.some((p) => p.handle === handle),
    create: async (input) => {
      if (rows.some((p) => p.userId === input.userId)) {
        return { created: false, reason: "user_has_profile" };
      }
      if (rows.some((p) => p.handle === input.handle)) {
        return { created: false, reason: "handle_taken" };
      }
      const profile = { ...input, createdAt: new Date("2026-09-16T12:00:00Z") };
      rows.push(profile);
      return { created: true, profile };
    },
  };
}

test("handle availability explains why a handle cannot be used", async () => {
  const repo = memoryRepo();
  repo.rows.push({ userId: "u0", displayName: "Taken", handle: "halftime", createdAt: new Date() });
  const profiles = createProfileService(repo, EVERYONE_HAS_A_WALLET);
  assert.deepEqual(await profiles.checkHandle("@AnaRobles"), {
    handle: "anarobles",
    available: true,
  });
  assert.deepEqual(await profiles.checkHandle("ab"), {
    handle: "ab",
    available: false,
    reason: "too_short",
  });
  assert.deepEqual(await profiles.checkHandle("a".repeat(16)), {
    handle: "a".repeat(16),
    available: false,
    reason: "too_long",
  });
  assert.deepEqual(await profiles.checkHandle("ana-robles"), {
    handle: "ana-robles",
    available: false,
    reason: "invalid_characters",
  });
  assert.deepEqual(await profiles.checkHandle("Pickler"), {
    handle: "pickler",
    available: false,
    reason: "reserved",
  });
  assert.deepEqual(await profiles.checkHandle("HALFTIME"), {
    handle: "halftime",
    available: false,
    reason: "taken",
  });
});

test("creating a profile validates, normalizes and is idempotent per user", async () => {
  const repo = memoryRepo();
  const profiles = createProfileService(repo, EVERYONE_HAS_A_WALLET);
  const created = await profiles.createProfile("u1", {
    displayName: "  Ana   Robles ",
    handle: "@AnaRobles",
  });
  assert.deepEqual([created.displayName, created.handle], ["Ana Robles", "anarobles"]);
  assert.equal(
    (await profiles.createProfile("u1", { displayName: "Ana", handle: "anarobles" })).handle,
    "anarobles",
  );
  assert.equal(repo.rows.length, 1);

  await assert.rejects(
    profiles.createProfile("u1", { displayName: "Ana", handle: "other" }),
    ProfileAlreadyExistsError,
  );
  await assert.rejects(
    profiles.createProfile("u2", { displayName: "Bo", handle: "anarobles" }),
    ProfileHandleTakenError,
  );
  await assert.rejects(
    profiles.createProfile("u2", { displayName: "B", handle: "bo_bot" }),
    InvalidProfileError,
  );
  await assert.rejects(
    profiles.createProfile("u2", { displayName: "Bo", handle: "admin" }),
    InvalidProfileError,
  );
});

test("a profile is refused until the user has a custody account, then created", async () => {
  const repo = memoryRepo();
  const wallets = new Set<string>();
  const asked: string[] = [];
  const profiles = createProfileService(repo, {
    hasCustodyAccount: async (userId) => {
      asked.push(userId);
      return wallets.has(userId);
    },
  });

  await assert.rejects(
    profiles.createProfile("u1", { displayName: "Ana", handle: "anarobles" }),
    WalletRequiredError,
  );
  assert.deepEqual(asked, ["u1"], "the caller's own account is the one checked");
  assert.equal(repo.rows.length, 0, "nothing is written without a wallet");
  assert.equal((await profiles.checkHandle("anarobles")).available, true);

  wallets.add("u1");
  const created = await profiles.createProfile("u1", { displayName: "Ana", handle: "anarobles" });
  assert.equal(created.handle, "anarobles");
  assert.equal(repo.rows.length, 1);
});
