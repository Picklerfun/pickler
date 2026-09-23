"use client";

import { Button, Icon } from "@pickler/ui";
import { coverage, coverageCopy, EMAIL_RECOVERY_ON } from "../lib/coverage";
import { NotYet } from "../components/not-yet";
import { Toggle } from "../components/toggle";
import styles from "../account.module.css";

export function SecuritySection({
  /** How many passkeys this account has, or null when nothing can count them. */
  passkeys,
  onAddPasskey,
  canAdd,
  session,
}: {
  passkeys: number | null;
  onAddPasskey: () => void;
  /** False without a session: the ceremony needs a token, and offering a button that throws is
   *  worse than offering one that says why it cannot run. */
  canAdd: boolean;
  session: string | null;
}) {
  const state = coverage(passkeys);
  const copy = coverageCopy(state, passkeys);

  return (
    <section id="account-panel-security" className={styles.section} aria-label="Security">
      <div className={styles.risk}>
        <p className={styles.riskEyebrow} data-tone={copy.tone}>
          <span className={styles.riskSquare} aria-hidden="true" />
          {copy.eyebrow}
        </p>
        <h2 className={styles.riskHeadline}>{copy.headline}</h2>
        <p className={styles.riskBody}>{copy.body}</p>
      </div>

      <h3 className={styles.heading}>PASSKEYS · CAN MOVE FUNDS</h3>
      {/* No rows, and the reason is in lib/coverage.ts: nothing in this build lists an account's
          passkeys. Inventing a "This device" row out of the fact that a wallet exists would be the
          claim the headline above refuses to make, made smaller. */}
      <NotYet title="This account&rsquo;s passkeys cannot be listed">
        The signing API has no route that reads them back. Adding one below is real and does reach
        your account; what no screen can yet show you is which devices are already on it, or remove
        one. Until that route exists the count above stays unknown rather than guessed.
      </NotYet>

      <Button
        variant={state === "covered" ? "secondary" : "primary"}
        block
        className={styles.addPasskey}
        onClick={onAddPasskey}
        disabled={!canAdd}
        title={canAdd ? undefined : "Sign in to add a passkey."}
      >
        <Icon name="key" size={16} />
        Add a passkey
      </Button>

      <h3 className={styles.heading}>RECOVERY</h3>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <p className={styles.rowTitle}>Email recovery</p>
          {/* The meta line changes with the state, and the state is a constant: the custody
              specification records email recovery as deliberately off. It is not a feature waiting
              on a switch, so the row says what it is rather than offering one that does nothing. */}
          <p className={styles.rowMeta}>
            {EMAIL_RECOVERY_ON
              ? "ON · AN EMAILED CODE CAN ADD A PASSKEY"
              : "OFF BY DESIGN · ONLY A PASSKEY MOVES FUNDS"}
          </p>
        </div>
        <Toggle
          on={EMAIL_RECOVERY_ON}
          label="Email recovery"
          why="Email recovery is off by design: an emailed code that could add a passkey would be a second way into your funds."
        />
      </div>

      <h3 className={styles.heading}>SIGNED IN · CAN&rsquo;T MOVE FUNDS</h3>
      {session ? (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <p className={styles.rowTitle}>{session}</p>
            <p className={styles.rowMeta}>THIS SESSION · READS ONLY</p>
          </div>
          <span className={styles.current}>CURRENT</span>
        </div>
      ) : (
        <p className={styles.rowMeta}>NOT SIGNED IN</p>
      )}
      <NotYet title="Other signed-in devices cannot be listed">
        Supabase hands this browser its own session and nobody else&rsquo;s, and nothing here serves
        the rest. A session signs in; it cannot move funds, which is what the label above says and
        what makes this gap smaller than it looks.
      </NotYet>
    </section>
  );
}
