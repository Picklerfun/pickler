// The nudge towards a second passkey, as pure functions so the rule and its words are pinned by
// node:test (apps/web/test/second-passkey.test.ts) without a browser.
//
// One passkey is one lost device away from a wallet nobody can open. So wherever a screen already
// knows the account's passkeys, and there is exactly one, it suggests adding another — every
// session, until there are two. Never on a guess: a list still loading, or one that could not be
// read, shows nothing, and so does an empty list (an account with a wallet always has a passkey,
// so zero is a read that is wrong somewhere, not advice to give).

/** A screen's read of GET /v1/signing/passkeys. `failed` is not an empty list. */
export type PasskeysKnown =
  { kind: "loading" } | { kind: "failed" } | { kind: "ready"; passkeys: readonly unknown[] };

/** True only for a list that was read and holds exactly one passkey. */
export function suggestSecondPasskey(read: PasskeysKnown): boolean {
  return read.kind === "ready" && read.passkeys.length === 1;
}

/** The words, one copy for every placement. `/passkey` is the add-device screen. */
export const SECOND_PASSKEY = {
  text: "You have one passkey. If you lose this device, you lose access to your wallets. Add a second one.",
  cta: "Add a second passkey",
  href: "/passkey",
  hide: "Not now",
} as const;

/** `window.sessionStorage`, narrowed to what the hide needs and nullable where there is none. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const HIDDEN = "pickler.second-passkey.hidden";

/**
 * Whether the person hid the suggestion in this browser session. Not a dismissal: session storage
 * ends with the session, and the suggestion comes back until the account has a second passkey. A
 * store that refuses or throws reads as "not hidden" — the safe direction is to keep suggesting.
 */
export function hiddenThisSession(store: SessionStore | null): boolean {
  try {
    return store?.getItem(HIDDEN) === "1";
  } catch {
    return false;
  }
}

/** Hides the suggestion for the rest of this session. A store that refuses changes nothing. */
export function hideThisSession(store: SessionStore | null): void {
  try {
    store?.setItem(HIDDEN, "1");
  } catch {
    // Nothing to do: the suggestion simply stays, which is what it does next session anyway.
  }
}
