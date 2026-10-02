"use client";

import { useState } from "react";
import { Button, Field, Input } from "@pickler/ui";
import styles from "./claim-handle.module.css";
import { useHandleClaim } from "../lib/use-handle-claim";

/**
 * Asks for a handle once there is an account to hang it on.
 *
 * The chooser asks first, as its last step (docs/specs/mera-web-v1.md §3). This panel is for
 * whoever closed the chooser there, shown while the signed-in account is known to have no
 * username (`hasProfile === false` on the wallet context). It is dismissible on purpose. Claiming
 * is not a gate: somebody who closes this can still trade, and it comes back next visit because
 * the dismissal lives in component state and nothing writes it down. A person without a handle is an address on
 * the leaderboard, which is a worse experience rather than a blocked one — so the way out is an
 * ordinary button, not something to defeat.
 */
export function ClaimHandle({ onClaimed }: { onClaimed?: () => void }) {
  const form = useHandleClaim(onClaimed);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

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
          {...(form.shown ? { note: form.shown.text, tone: form.shown.tone } : {})}
        >
          <Input
            id="claim-handle"
            value={form.handle}
            mono
            prefix="@"
            autoComplete="off"
            spellCheck={false}
            maxLength={form.maxLength}
            invalid={form.problem !== null}
            placeholder="nightowl"
            onChange={(event) => form.setHandle(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={!form.askable || form.busy}
            onClick={() => void form.claim()}
          >
            {form.busy ? (form.signing ? "Check your wallet…" : "Claiming…") : "Claim"}
          </Button>
          <button type="button" className={styles.dismiss} onClick={() => setDismissed(true)}>
            Not now
          </button>
        </div>
      </div>
      {/* After a reload the page no longer holds the session's token, so the claim signs in again.
          Saying so before the wallet opens is the difference between a prompt somebody expected and
          one that appeared at them — and an unexpected prompt is how people learn to approve them
          without reading. */}
      <p className={styles.foot}>
        If your wallet asks you to sign one line of text, that is the board checking the name is
        yours. It costs nothing and moves nothing.
      </p>
      {form.failed && (
        <p className={styles.failed} role="alert">
          {form.failed}
        </p>
      )}
    </section>
  );
}
