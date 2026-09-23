"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, type FieldTone } from "@pickler/ui";
import { HANDLE_RULES, RESERVED_HANDLES } from "@pickler/api-schema";
import styles from "./claim-handle.module.css";
import {
  checkAvailability,
  claimHandle,
  localProblem,
  type Availability,
  type HandleProblem,
} from "../lib/handles";

/**
 * Asks for a handle once there is an account to hang it on.
 *
 * It is dismissible on purpose. Claiming is not a gate: somebody who closes this can still trade,
 * and it comes back next visit because the dismissal lives in component state and nothing writes
 * it down. A person without a handle is an address on the leaderboard, which is a worse experience
 * rather than a blocked one — so the way out is an ordinary button, not something to defeat.
 *
 * The rules come in from `@pickler/api-schema`, which mirrors core and is held to it by
 * workers/api/test/handle-rules.test.ts. They are handed to `localProblem` rather than read inside
 * it, which is what lets that function be tested here at all.
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

export function ClaimHandle({ token, onClaimed }: { token: string; onClaimed?: () => void }) {
  const [handle, setHandle] = useState("");
  const [dismissed, setDismissed] = useState(false);
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

  if (dismissed) {
    return null;
  }

  async function claim() {
    setBusy(true);
    setFailed(null);
    try {
      await claimHandle({ handle: handle.trim().toLowerCase(), displayName: handle.trim() }, token);
      onClaimed?.();
    } catch (caught) {
      setFailed(caught instanceof Error ? caught.message : "That handle could not be claimed");
    } finally {
      setBusy(false);
    }
  }

  const shown = handle.trim() ? note(problem, availability) : null;

  return (
    <section className={styles.panel} aria-label="Claim your handle">
      <p className={styles.eyebrow}>YOUR HANDLE</p>
      <h2 className={styles.title}>Pick a name for the board.</h2>
      <p className={styles.lead}>
        Every pick you back shows the name you go by. Without one you appear as your address, which
        works — it just reads like a wallet rather than a person.
      </p>
      <div className={styles.row}>
        <Field
          className={styles.field}
          label="HANDLE"
          htmlFor="claim-handle"
          {...(shown ? { note: shown.text, tone: shown.tone } : {})}
        >
          <Input
            id="claim-handle"
            value={handle}
            mono
            prefix="@"
            autoComplete="off"
            spellCheck={false}
            maxLength={HANDLE_RULES.max}
            invalid={problem !== null}
            placeholder="nightowl"
            onChange={(event) => setHandle(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <Button variant="primary" disabled={!askable || busy} onClick={() => void claim()}>
            {busy ? "Claiming…" : "Claim"}
          </Button>
          <button type="button" className={styles.dismiss} onClick={() => setDismissed(true)}>
            Not now
          </button>
        </div>
      </div>
      {failed && <p className={styles.failed}>{failed}</p>}
    </section>
  );
}
