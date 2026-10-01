// What the security panel says about this account's passkeys.
//
// The claim is about whether somebody can still reach their money after losing a device, so it
// needs a count, and `GET /v1/signing/passkeys` now answers with one. Two or more is COVERED; one
// is ONE KEY AWAY.
//
// The third state stays, and it is not dead code. A read can fail, and a failed read must never
// render as an account with no passkeys — `null` here means "nobody could check", which is a
// different thing from any number and is shown as such. The reason that distinction survives all
// the way down to the database is written on `CustodyRepository.listCredentials` in
// packages/core/src/features/wallets/ports/custody.ts: the method feeding `excludeCredentials`
// swallows a lookup failure on purpose, `listPasskeys` beside it does not, and they are two
// methods so that the swallow cannot reach this screen. `coverage(null)` is the last link in
// that chain.

type Coverage = "covered" | "one" | "unknown";

/**
 * Email recovery is off for every account and is not a setting anybody can change: the custody
 * specification records it as deliberately absent. It is a constant rather than an input because a
 * parameter would imply a value that varies, and this one does not.
 */
export const EMAIL_RECOVERY_ON = false;

interface CoverageCopy {
  eyebrow: string;
  headline: string;
  body: string;
  /** Which state pair the eyebrow's square takes. Only a known second key earns the good one. */
  tone: "good" | "caution";
}

/** `null` is a read that failed, never an account with no passkeys. */
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
    eyebrow: `PASSKEYS UNREAD · ${RECOVERY}`,
    headline: "CAN'T TELL YET.",
    body:
      "Your passkeys could not be read just now, so Pickler will not tell you that you are " +
      "covered. This is a failed lookup and not an empty account — nothing has changed about the " +
      "keys on it. Reload, and add a second passkey if you are not sure you have one.",
    tone: "caution",
  };
}
