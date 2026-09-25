import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { passkeyScreenFor } from "../src/features/auth/lib/custody";
import { passkeyLine } from "../src/features/auth/lib/passkey-list";
import type { PasskeyDto } from "../src/features/auth/lib/custody-api";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("passkeyScreenFor sends an account with no sub-organization to the none-yet screen", () => {
  assert.equal(passkeyScreenFor({ hasSubOrganization: false }), "none-yet");
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

test("signup and signin no longer render the enrolment ceremony", () => {
  const flow = read("../src/features/auth/components/passkey-flow.tsx");
  // The enrol screens: `PasskeyStep` asked for the first passkey and created the
  // sub-organization; `WalletStep` was what followed it. Both files are deleted — a
  // sub-organization is now born in exactly one place, the studio's own ceremony — so neither can
  // be imported here, where signup and signin's rails are still driven.
  assert.ok(
    !flow.includes("./steps/passkey-step"),
    "PasskeyStep is the enrolment screen; it must not be imported by the flow signup and signin share",
  );
  assert.ok(
    !flow.includes("./steps/wallet-step"),
    "WalletStep only ever followed the enrolment ceremony",
  );

  const page = read("../src/app/(auth)/passkey/page.tsx");
  assert.ok(page.includes('mode="add"'), "/passkey must open PasskeyAddFlow, not the enrol rail");
});
