"use client";

import { Button, Icon } from "@pickler/ui";
import styles from "../../auth.module.css";

/**
 * Verbatim from the design canvas, including the accent. The canvas writes the three colours as
 * #C8F03A, #9B7BFF and #FFC93F, which are `--pk-lime`, `--pk-violet` and `--pk-amber` to the
 * digit — so they are named here and resolved in auth.module.css rather than written into the
 * markup, which is what keeps this surface free of colour literals.
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
 * The one screen that has to land before a key exists: what the passkey is for, who does not have
 * a copy of it, and what happens if it is lost. Every word after this one assumes it was read.
 */
export function PasskeyStep({ busy, onCreate }: { busy: boolean; onCreate: () => void }) {
  return (
    <div className={styles.flowStep}>
      <h1 className={styles.flowTitle}>
        YOUR KEY.
        <br />
        NOT OURS
      </h1>

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
        Create passkey
      </Button>

      <p className={styles.flowLead}>KEEP IT SAFE · WE CAN&apos;T RECOVER IT</p>
    </div>
  );
}
