// What the security panel is allowed to say about this account's passkeys.
//
// The canvas draws two states: COVERED. at two or more passkeys, ONE KEY AWAY. at one. Both are
// claims about whether somebody can still reach their money after losing a device, and both need a
// count to be true. There is a third state, and it is the one this build is actually in.
//
// **There is no route that lists an account's passkeys.** workers/api/src/routes/signing.ts mounts
// five: passkeys/challenge, passkeys/register, passkeys/add/prepare, passkeys/add/confirm and
// wallets/me. `CustodyRepository.listCredentials` exists in packages/core and nothing exposes it
// over HTTP, so the browser cannot count them.
//
// Two near-misses, written down so that nobody reaches for either:
//
//   - `wallets/me` answering 200 proves at least one passkey exists, because registration mints
//     one. It cannot tell one from five, which is the only distinction the headline makes.
//   - `passkeys/challenge` answers with `excludeCredentials`, built from listCredentials. It looks
//     like a count and must not be used as one: core's `excludeCredentials` swallows a lookup
//     failure and returns undefined, so "this account has no passkeys" and "the database did not
//     answer" arrive identically. A security headline read off a field that degrades silently will
//     one day tell somebody they are covered when nobody looked. It also spends a stored challenge
//     per call, which is a write standing in for a read.
//
// So the third state says it does not know. That is worse to look at than a green tick, and it is
// the only thing here that is true.

export type Coverage = "covered" | "one" | "unknown";

/**
 * Email recovery is off for every account and is not a setting anybody can change: the custody
 * specification records it as deliberately absent. It is a constant rather than an input because a
 * parameter would imply a value that varies, and this one does not.
 */
export const EMAIL_RECOVERY_ON = false;

export interface CoverageCopy {
  eyebrow: string;
  headline: string;
  body: string;
  /** Which state pair the eyebrow's square takes. Only a known second key earns the good one. */
  tone: "good" | "caution";
}

/** `null` is "nothing can count them", which is every account in this build. */
export function coverage(passkeys: number | null): Coverage {
  if (passkeys === null) {
    return "unknown";
  }
  return passkeys >= 2 ? "covered" : "one";
}

const RECOVERY = EMAIL_RECOVERY_ON ? "EMAIL RECOVERY ON" : "EMAIL RECOVERY OFF";

export function coverageCopy(state: Coverage, passkeys: number | null): CoverageCopy {
  if (state === "covered") {
    return {
      eyebrow: `${passkeys} PASSKEYS · ${RECOVERY}`,
      headline: "COVERED.",
      body: "Lose one device and another still moves your funds.",
      tone: "good",
    };
  }
  if (state === "one") {
    return {
      eyebrow: `1 PASSKEY · ${RECOVERY}`,
      headline: "ONE KEY AWAY.",
      body: "Lose this device and your funds stay locked. Add a second passkey.",
      tone: "caution",
    };
  }
  return {
    eyebrow: `PASSKEYS UNCOUNTED · ${RECOVERY}`,
    headline: "CAN'T TELL YET.",
    body:
      "Nothing in this build can list the passkeys on this account, so Pickler will not tell you " +
      "that you are covered. If you are not sure you have a second one, add it — a passkey you " +
      "already have is refused by the device, not by us.",
    tone: "caution",
  };
}
