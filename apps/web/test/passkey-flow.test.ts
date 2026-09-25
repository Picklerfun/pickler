import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hasSubOrganization, passkeyScreenFor } from "../src/features/auth/lib/custody";
import { ApiError } from "../src/features/auth/lib/pickler-api";
import { passkeyLine } from "../src/features/auth/lib/passkey-list";
import type { PasskeyDto } from "../src/features/auth/lib/custody-api";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("passkeyScreenFor sends an account with no sub-organization to create its wallet", () => {
  assert.equal(passkeyScreenFor({ hasSubOrganization: false }), "create");
});

test("passkeyScreenFor sends an account with a sub-organization to add a passkey", () => {
  assert.equal(passkeyScreenFor({ hasSubOrganization: true }), "add");
});

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

test("hasSubOrganization reads a wallet as yes and a 404 as no", async () => {
  assert.equal(await hasSubOrganization(async () => ({ address: "0xabc" })), true);
  assert.equal(
    await hasSubOrganization(async () => {
      throw new ApiError(404, "No wallet", "NOT_FOUND", undefined);
    }),
    false,
  );
});

test("hasSubOrganization propagates any other failure rather than calling it missing", async () => {
  // A wallet that could not be read is not a missing one: sending its owner to create another
  // would be the wrong door.
  await assert.rejects(
    hasSubOrganization(async () => {
      throw new ApiError(500, "Down", "INTERNAL", undefined);
    }),
    ApiError,
  );
});

test("signup, signin and /passkey render the enrolment step; nothing renders the none-yet one", () => {
  const flow = read("../src/features/auth/components/passkey-flow.tsx");
  assert.ok(flow.includes("./steps/create-wallet-step"), "the passkey step must be rendered");
  assert.ok(flow.includes('state.step === "passkey"'), "the sign rails must draw the passkey step");
  assert.ok(flow.includes('screen === "create"'), "/passkey must draw the create screen");
  assert.ok(!flow.includes("none-yet"), "the screen pointing at the first agent is gone");

  const page = read("../src/app/(auth)/passkey/page.tsx");
  assert.ok(page.includes('mode="add"'), "/passkey must open PasskeyAddFlow");
});

test("the studio shell and the create screen send a person without a sub-organization to /passkey", () => {
  for (const path of [
    "../src/features/studio/studio.tsx",
    "../src/features/studio/create/create.tsx",
  ]) {
    const source = read(path);
    assert.ok(source.includes("hasSubOrganization("), `${path} must read the sub-organization`);
    assert.ok(source.includes('router.replace("/passkey")'), `${path} must redirect to /passkey`);
  }
});
