"use client";

import { useEffect, useState } from "react";
import type { FieldTone } from "@pickler/ui";
import { HANDLE_RULES, RESERVED_HANDLES } from "@pickler/api-schema";
import { useWallet } from "./wallet-context";
import {
  checkAvailability,
  claimHandle,
  localProblem,
  type Availability,
  type HandleProblem,
} from "./handles";

/**
 * Everything about claiming a username except how it is drawn: the field's value, what is wrong
 * with it, whether it is free, and the claim itself. The chooser's username step draws it.
 *
 * The rules come in from `@pickler/api-schema`, which mirrors core and is held to it by
 * workers/api/test/handle-rules.test.ts. They are handed to `localProblem` rather than read inside
 * it, which is what lets that function be tested at all.
 */
const WORDS: Record<HandleProblem, string> = {
  too_short: `At least ${HANDLE_RULES.min} characters.`,
  too_long: `At most ${HANDLE_RULES.max} characters.`,
  invalid_characters: "Letters, numbers and underscores only.",
  reserved: "That one is spoken for.",
  taken: "Someone already has that one.",
};

/** How long to sit still before asking. Long enough that typing a name is not a request per key. */
const SETTLE_MS = 350;

function note(
  problem: HandleProblem | null,
  availability: Availability | null,
): { text: string; tone: FieldTone } {
  if (problem) {
    return { text: WORDS[problem], tone: "bad" };
  }
  if (!availability) {
    return { text: "Checking…", tone: "quiet" };
  }
  if (!availability.known) {
    // Never "taken". A lookup that failed is not an answer, and saying it is would send somebody
    // off to pick a different name for no reason at all.
    return { text: "Could not check that just now — you can still claim it.", tone: "quiet" };
  }
  return availability.available
    ? { text: "Yours if you want it.", tone: "good" }
    : { text: WORDS.taken, tone: "bad" };
}

/** Where the field stands, for a screen that words it in its own voice. */
export type HandleState = "empty" | HandleProblem | "checking" | "unknown" | "ok";

export function useHandleClaim(onClaimed?: () => void) {
  const wallet = useWallet();
  const [handle, setHandle] = useState("");
  /**
   * The answer is stored with the handle it was asked about, rather than cleared when the field
   * changes. That keeps every `setState` out of the effect body — the rule this project enforces —
   * and it settles the stale-reply problem in the same stroke: a reply for a handle nobody is
   * typing any more simply does not match, so it is never shown against the wrong name.
   */
  const [answer, setAnswer] = useState<{ asked: string; value: Availability } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const trimmed = handle.trim().toLowerCase();
  const problem = handle.trim() ? localProblem(handle, HANDLE_RULES, RESERVED_HANDLES) : null;
  const askable = Boolean(handle.trim()) && problem === null;
  const availability = answer && answer.asked === trimmed ? answer.value : null;

  useEffect(() => {
    if (!askable) {
      return;
    }
    const timer = setTimeout(() => {
      void checkAvailability(trimmed).then(
        (value) => setAnswer({ asked: trimmed, value }),
        // A thrown lookup is the same fact as a refused one: nobody looked.
        () => setAnswer({ asked: trimmed, value: { known: false } }),
      );
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, askable]);

  /**
   * A username needs an account, so this signs in when nobody has yet. Straight after connecting
   * the session is already there and nothing is asked again; after a reload the page no longer
   * holds its token, and the claim costs one signature. If the person closes that prompt,
   * `signInWithWallet` answers with no error to show and the form simply stays as it was.
   */
  async function claim() {
    setBusy(true);
    setFailed(null);
    try {
      const signedIn = await wallet.signInWithWallet();
      if ("error" in signedIn) {
        // From the result, not from `wallet.sessionError`: that is the value of the render this
        // function was made in, from before the sign-in was even asked for.
        setFailed(signedIn.error);
        return;
      }
      await claimHandle({ handle: trimmed, displayName: handle.trim() }, signedIn.token);
      wallet.profileClaimed();
      onClaimed?.();
    } catch (caught) {
      setFailed(caught instanceof Error ? caught.message : "That handle could not be claimed");
    } finally {
      setBusy(false);
    }
  }

  let state: HandleState = "checking";
  if (!handle.trim()) {
    state = "empty";
  } else if (problem) {
    state = problem;
  } else if (availability) {
    state = !availability.known ? "unknown" : availability.available ? "ok" : "taken";
  }

  return {
    handle,
    setHandle,
    state,
    minLength: HANDLE_RULES.min,
    problem,
    askable,
    busy,
    failed,
    claim,
    /** What to say under the field, or null while it is empty. */
    shown: handle.trim() ? note(problem, availability) : null,
    /** A wallet prompt is open: the button says to look at the wallet. */
    signing: wallet.session === "signing",
    maxLength: HANDLE_RULES.max,
  };
}
