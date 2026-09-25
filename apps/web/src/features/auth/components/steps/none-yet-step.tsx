"use client";

import Link from "next/link";
import { ButtonLink } from "@pickler/ui";
import styles from "../../auth.module.css";

/**
 * `/passkey` for a signed-in person with no sub-organization yet.
 *
 * There is no button here that starts a ceremony. Under the studio-create-and-fund specification
 * a sub-organization is born in exactly one place — the first agent's "Create and run it once" —
 * so the only honest thing this screen can offer is the door to it.
 */
export function NoneYetStep() {
  return (
    <div className={styles.flowStep} id="passkey-none-yet">
      <h1 className={styles.flowTitle}>
        YOUR FIRST AGENT
        <br />
        CREATES YOUR WALLET
      </h1>
      <p className={styles.subhead}>The passkey you make then is the only key to it.</p>
      <div className={styles.flowActions}>
        <ButtonLink as={Link} href="/studio/new" className={styles.primary} variant="primary" arrow>
          Build my first agent
        </ButtonLink>
      </div>
    </div>
  );
}
