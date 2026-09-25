import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  afterFailedCreate,
  enrolmentOutcome,
  readSubOrganization,
  redirectFor,
  SIGNUP_PASSKEY_STEP,
} from "../src/features/auth/lib/custody";
import { ApiError } from "../src/features/auth/lib/pickler-api";
import { passkeyLine } from "../src/features/auth/lib/passkey-list";
import type { PasskeyDto } from "../src/features/auth/lib/custody-api";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const PASSKEY: PasskeyDto = {
  id: "pk-1",
  credential_id: "cred-1",
  label: "Touch ID on this Mac",
  transports: ["internal"],
  device_type: "singleDevice",
  created_at: "2026-03-14T00:00:00.000Z",
  last_used_at: null,
};

test("passkeyLine names when a passkey was added and that it has never been used", () => {
  assert.equal(passkeyLine(PASSKEY), "ADDED MARCH 2026 · NEVER USED");
});

test("passkeyLine reports the last-used month over never-used once there is one", () => {
  assert.equal(
    passkeyLine({ ...PASSKEY, last_used_at: "2026-09-21T00:00:00.000Z" }),
    "ADDED MARCH 2026 · LAST USED SEPTEMBER 2026",
  );
});

test("passkeyLine says only what it can read, never a guess", () => {
  assert.equal(passkeyLine({ ...PASSKEY, created_at: "not-a-date" }), "NEVER USED");
});

test("readSubOrganization answers the wallet it read, and null for a 404", async () => {
  const wallet = { address: "0xabc" };
  assert.equal(await readSubOrganization(async () => wallet), wallet);
  assert.equal(
    await readSubOrganization(async () => {
      throw new ApiError(404, "No wallet", "NOT_FOUND", undefined);
    }),
    null,
  );
});

test("readSubOrganization propagates any other failure rather than calling it missing", async () => {
  // A wallet that could not be read is not a missing one: sending its owner to create another
  // would be the wrong door.
  await assert.rejects(
    readSubOrganization(async () => {
      throw new ApiError(500, "Down", "INTERNAL", undefined);
    }),
    ApiError,
  );
});

/* The redirect every signed-in custody screen asks — the studio shell, the create screen and
   /account — composed with the read it follows, so a 404 and an error are told apart end to end. */
/* The redirect every signed-in screen asks — the studio shell, the create screen, /account and
   /passkey — composed with the read it follows, so a 404 and an error are told apart end to end. */
test("redirectFor sends a person with no sub-organization to the signup's passkey step", async () => {
  const missing = await readSubOrganization(async () => {
    throw new ApiError(404, "No wallet", "NOT_FOUND", undefined);
  });
  assert.equal(redirectFor(missing), "/signup?step=passkey");
  assert.equal(redirectFor(missing), SIGNUP_PASSKEY_STEP);

  const present = await readSubOrganization(async () => ({ address: "0xabc" }));
  assert.equal(redirectFor(present), null);
});

test("the redirect's target is the signup, which resumes any session it is opened with", () => {
  const target = new URL(SIGNUP_PASSKEY_STEP, "https://pickler.test");
  assert.equal(target.pathname, "/signup");
});

test("a failed create advances once the sub-organization exists, and otherwise offers a retry", () => {
  // Another tab finished signup; this authenticator refused a duplicate. Retrying would loop.
  assert.equal(afterFailedCreate(true), "advance");
  // Still no sub-organization: the step stays, with "Try again".
  assert.equal(afterFailedCreate(false), "retry");
});

const on = (credential_id: string) => ({ credential_id });

test("enrolmentOutcome marks the browser only for a credential the account holds", () => {
  assert.equal(enrolmentOutcome("cred-mine", [on("cred-mine")]), "enrolled");
  // register answered another tab's account: this device's credential authorises nothing.
  assert.equal(enrolmentOutcome("cred-mine", [on("cred-other-tab")]), "orphan");
  assert.equal(enrolmentOutcome("cred-mine", []), "orphan");
  // A list that could not be read is not an empty one, and it is not a yes either.
  assert.equal(enrolmentOutcome("cred-mine", null), "unknown");
});

test("the signup draws the passkey step; /passkey only adds a device", () => {
  const flow = read("../src/features/auth/components/passkey-flow.tsx");
  assert.ok(flow.includes("./steps/create-wallet-step"), "the passkey step must be rendered");
  assert.ok(flow.includes('state.step === "passkey"'), "the sign rails must draw the passkey step");
  // /passkey's create screen is gone: the wallet is created on the signup step and nowhere else.
  assert.ok(!flow.includes('screen === "create"'), "/passkey must not create a wallet");
  assert.ok(!flow.includes("none-yet"), "the screen pointing at the first agent is gone");

  const page = read("../src/app/(auth)/passkey/page.tsx");
  assert.ok(page.includes('mode="add"'), "/passkey must open PasskeyAddFlow");
});
