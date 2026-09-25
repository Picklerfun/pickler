"use client";

import { Button, Icon } from "@pickler/ui";
import styles from "../../auth.module.css";

/**
 * Recovered from the enrolment screen commit c4383d2 deleted (`steps/passkey-step.tsx`), with its
 * points verbatim from the design canvas. The canvas writes the three colours as #C8F03A, #9B7BFF
 * and #FFC93F, which are `--pk-lime`, `--pk-violet` and `--pk-amber` to the digit — so they are
 * named here and resolved in auth.module.css rather than written into the markup.
 *
 * The tag carries the meaning on its own. Nobody learns that a passkey cannot be reset from an
 * amber bar.
 */
const POINTS = [
  { title: "Sends, withdrawals, agent budgets", tag: "NEEDS IT", accent: "lime" },
  { title: "Pickler holds no copy", tag: "YOURS ONLY", accent: "violet" },
  { title: "Keep it safe", tag: "NO RESET", accent: "amber" },
] as const;

/**
 * The mandatory passkey step (spec §4.1): its one prompt creates the sub-organization, with this
 * passkey as its only root, and the master wallet the studio's profile shows from the first visit.
 *
 * There is no skip and no "later". A prompt that was closed or failed leaves the person here, with
 * the same button to try again; `retry` only changes what it says.
 */
export function CreateWalletStep({
  busy,
  retry,
  onCreate,
}: {
  /** True while the sheet behind this screen is open, so a second prompt cannot be started. */
  busy: boolean;
  /** An earlier attempt on this screen did not finish. */
  retry: boolean;
  onCreate: () => void;
}) {
  return (
    <div className={styles.flowStep} id="passkey-create">
      <h1 className={styles.flowTitle}>
        CREATE YOUR
        <br />
        WALLET
      </h1>
      <p className={styles.subhead}>
        One passkey on this device creates your wallet and is the only key to it. Your agents are
        built on it, so this comes first.
      </p>

      <ul className={styles.points}>
        {POINTS.map((point) => (
          <li key={point.title} className={styles.point} data-accent={point.accent}>
            <span className={styles.pointTitle}>{point.title}</span>
            <span className={styles.pointTag}>{point.tag}</span>
          </li>
        ))}
      </ul>

      <Button className={styles.primary} onClick={onCreate} disabled={busy}>
        <Icon name="key" size={19} />
        {retry ? "Try again" : "Create passkey"}
      </Button>

      <p className={styles.flowLead}>
        {retry
          ? "NO WALLET YET · IT NEEDS YOUR PASSKEY TO CONTINUE"
          : "KEEP IT SAFE · WE CAN'T RECOVER IT"}
      </p>
    </div>
  );
}
