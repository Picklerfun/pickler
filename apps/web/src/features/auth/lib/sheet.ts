// What the ceremony sheet says, kept out of the component so node:test can drive every phase of
// every ceremony without a browser.
//
// The copy is per ceremony, from the "Pickler Auth Passkey Flow" canvas. A sheet that said
// "Confirm with your passkey" three times would be shorter and would tell the person nothing:
// creating the key that holds their money, adding a spare, and lending this browser a credential
// are three different things to agree to, and the sheet is the last screen before the operating
// system takes over.
//
// The canvas also carries `sign` and `send` entries. Both belong to flows outside this one and
// are not here.

import { describeBrowser, describePasskeyStore, describePlatform } from "./device";

/** The three ceremonies this flow runs. */
export type Ceremony = "create" | "backup" | "here";

export type SheetPhase = "idle" | "busy" | "ok" | "error";

/** Shared by a cancellation and a failure alike, because it is true of both. */
export const NOTHING_HAPPENED = "NOTHING WAS SIGNED · NOTHING MOVED";

/** The word for a prompt the person dismissed. Not a fault, and never phrased as one. */
export const CANCELLED_TITLE = "Passkey cancelled";

const FAILED_TITLE = "Passkey not saved";

const CEREMONIES: Record<Ceremony, { ask: string; done: string }> = {
  create: { ask: "Create a passkey for Pickler?", done: "Passkey saved" },
  backup: { ask: "Add a backup passkey?", done: "Backup saved" },
  here: { ask: "Save a passkey on this device?", done: "Saved" },
};

/** The one line a backup does not derive: it is what the operating system is about to offer. */
const BACKUP_NOTE = "PHONE · SECURITY KEY · PASSWORD MANAGER";

interface SheetInput {
  ceremony: Ceremony;
  phase: SheetPhase;
  /**
   * `describeCeremonyFailure`'s answer, read only in the `error` phase. A sentence is a failure;
   * `null` is the person dismissing the prompt, which is the whole reason that function returns
   * null rather than a message.
   */
  error?: string | null | undefined;
  /** The relying party the challenge named — the domain worth checking before agreeing. */
  rpId?: string | null | undefined;
  /** `navigator.userAgent`, passed in rather than read here so this stays a pure function. */
  userAgent?: string | null | undefined;
  /**
   * Which half of "use my phone" is running. Adding a passkey to an account that already has one
   * takes two ceremonies back to back — this browser makes the credential, then the phone stamps
   * the activity that admits it — and only `here` is ever in the middle of that pair.
   */
  step?: 1 | 2 | undefined;
}

interface SheetCopy {
  title: string;
  /** The mono line under the title. Empty when there is nothing true to put on it. */
  note: string;
}

const line = (...parts: (string | null | undefined)[]) =>
  parts
    .filter((part): part is string => Boolean(part))
    .join(" · ")
    .toUpperCase();

function note(input: SheetInput): string {
  switch (input.ceremony) {
    case "create":
      return line(input.rpId, describePasskeyStore(input.userAgent));
    case "backup":
      return BACKUP_NOTE;
    case "here":
      return line(
        describeBrowser(input.userAgent),
        describePlatform(input.userAgent),
        input.step === undefined ? null : `${input.step} of 2`,
      );
  }
}

export function sheetCopy(input: SheetInput): SheetCopy {
  const ceremony = CEREMONIES[input.ceremony];
  if (input.phase === "error") {
    return {
      title: input.error === null || input.error === undefined ? CANCELLED_TITLE : FAILED_TITLE,
      note: NOTHING_HAPPENED,
    };
  }
  return {
    title: input.phase === "ok" ? ceremony.done : ceremony.ask,
    note: note(input),
  };
}
