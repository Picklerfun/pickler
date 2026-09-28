"use client";

import { Button, Icon } from "@pickler/ui";
import type { PasskeyDto } from "../../auth/lib/custody-api";
import { coverage, coverageCopy, EMAIL_RECOVERY_ON } from "../lib/coverage";
import { passkeyMeta, removalBlocked } from "../lib/passkeys";
import { SecondPasskey } from "../../auth/components/second-passkey";
import { NotYet } from "../components/not-yet";
import { Toggle } from "../components/toggle";
import styles from "../account.module.css";

/** What the screen knows about this account's passkeys. `failed` is not an empty list. */
export type PasskeyState =
  { kind: "loading" } | { kind: "ready"; passkeys: PasskeyDto[] } | { kind: "failed" };

export function SecuritySection({
  state: read,
  onAddPasskey,
  canAdd,
  session,
}: {
  state: PasskeyState;
  onAddPasskey: () => void;
  /** False without a session: the ceremony needs a token, and offering a button that throws is
   *  worse than offering one that says why it cannot run. */
  canAdd: boolean;
  session: string | null;
}) {
  // A failed read counts as null, never as zero. `coverage` turns that into the third state, and
  // the whole chain from the repository down exists to keep those two apart; see lib/coverage.ts.
  const listed = read.kind === "ready" ? read.passkeys : null;
  const count = listed === null ? null : listed.length;
  const state = coverage(count);
  const copy = coverageCopy(state, count);

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
      <SecondPasskey passkeys={read} id="account-second-passkey" />
      {read.kind === "loading" && <p className={styles.rowMeta}>READING YOUR PASSKEYS…</p>}
      {read.kind === "failed" && (
        <p className={styles.rowMeta}>
          THIS LIST COULD NOT BE READ · YOUR PASSKEYS HAVE NOT CHANGED
        </p>
      )}
      {listed?.map((passkey) => (
        <div key={passkey.id} className={styles.row}>
          <span className={styles.passkeyMark} aria-hidden="true" />
          <div className={styles.rowText}>
            <p className={styles.rowTitle}>{passkey.label}</p>
            <p className={styles.rowMeta}>{passkeyMeta(passkey)}</p>
          </div>
          {/* Always disabled, with the title saying which of the two reasons applies. No route
              deletes a passkey, so nothing here could run — and the one-key rule is already in
              `removalBlocked` so that it is in place the day the route lands. */}
          <Button
            variant="ghost"
            size="sm"
            disabled
            title={removalBlocked(listed.length)}
            className={styles.remove}
          >
            Remove
          </Button>
        </div>
      ))}
      {listed?.length === 0 && <p className={styles.rowMeta}>NO PASSKEYS ON THIS ACCOUNT YET</p>}
      <NotYet title="A passkey cannot be removed yet">
        The signing API reads them and adds them; nothing deletes one. Until it does, the Remove on
        each row stays disabled — and it would stay disabled on the last passkey whatever happens,
        because removing the only key into an account locks its funds for good.
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
