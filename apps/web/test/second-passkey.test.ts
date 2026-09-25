import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SECOND_PASSKEY,
  hiddenThisSession,
  hideThisSession,
  suggestSecondPasskey,
  type SessionStore,
} from "../src/features/auth/lib/second-passkey";

const key = (id: string) => ({ id });

test("one passkey, read: suggest a second", () => {
  assert.equal(suggestSecondPasskey({ kind: "ready", passkeys: [key("a")] }), true);
});

test("two or more: covered, nothing to suggest", () => {
  assert.equal(suggestSecondPasskey({ kind: "ready", passkeys: [key("a"), key("b")] }), false);
  assert.equal(
    suggestSecondPasskey({ kind: "ready", passkeys: [key("a"), key("b"), key("c")] }),
    false,
  );
});

test("never on a guess: loading, a failed read, or an empty list suggest nothing", () => {
  assert.equal(suggestSecondPasskey({ kind: "loading" }), false);
  assert.equal(suggestSecondPasskey({ kind: "failed" }), false);
  assert.equal(suggestSecondPasskey({ kind: "ready", passkeys: [] }), false);
});

test("the suggestion says what is at stake and goes to the add-device screen", () => {
  assert.match(SECOND_PASSKEY.text, /one passkey/);
  assert.match(SECOND_PASSKEY.text, /lose access to your wallets/);
  assert.equal(SECOND_PASSKEY.href, "/passkey");
});

function memory(): SessionStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
  };
}

test("hiding lasts the session: a fresh session store shows it again", () => {
  const session = memory();
  assert.equal(hiddenThisSession(session), false);

  hideThisSession(session);
  assert.equal(hiddenThisSession(session), true);

  assert.equal(hiddenThisSession(memory()), false, "a new session must suggest it again");
});

test("a store that refuses or throws never hides it", () => {
  const throwing: SessionStore = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.doesNotThrow(() => hideThisSession(throwing));
  assert.equal(hiddenThisSession(throwing), false);
  assert.equal(hiddenThisSession(null), false);
});
