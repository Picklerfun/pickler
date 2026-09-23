"use client";

import { useEffect, useState } from "react";
import { Button, Icon } from "@pickler/ui";
import styles from "../../auth.module.css";
import { addressButtonLabel, type CopyState } from "../../lib/address";

/** How long "COPIED" stays on the button before it goes back to showing the address. */
const COPIED_FOR = 1600;

/**
 * The wallet exists; the screen spends its whole attention on the thing that does not yet.
 *
 * One passkey is one device away from a wallet nobody can open, so the two rows say plainly what
 * is saved and what is only recommended, and the way out is "Later" rather than "Skip" — this is
 * something to come back to, not something to decline.
 */
export function WalletStep({
  address,
  deviceLabel,
  hasBackup,
  busy,
  onAddBackup,
  onFinish,
}: {
  /** From the flow machine, which took it from the register response. One copy, one source. */
  address: string;
  /** What this browser and platform are called — `describeDevice` in lib/device.ts. */
  deviceLabel: string;
  hasBackup: boolean;
  busy: boolean;
  onAddBackup: () => void;
  onFinish: () => void;
}) {
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    if (copy !== "copied") {
      return;
    }
    const timer = setTimeout(() => setCopy("idle"), COPIED_FOR);
    return () => clearTimeout(timer);
  }, [copy]);

  async function take() {
    try {
      // Absent on an insecure origin, and refusable by permission even on a secure one. Reading
      // the property can throw as readily as the write can reject, so both are inside the try.
      await navigator.clipboard.writeText(address);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <div className={styles.flowStep}>
      <p className={styles.created}>
        <Icon name="check" size={14} />
        WALLET CREATED
        <button
          type="button"
          className={styles.addressButton}
          onClick={() => void take()}
          aria-label={`Copy your wallet address, ${address}`}
        >
          {addressButtonLabel(address, copy)}
        </button>
      </p>

      {copy === "failed" && (
        <p className={styles.copyFailed}>
          <span>COULD NOT COPY · SELECT IT INSTEAD</span>
          {address}
        </p>
      )}

      <h1 className={styles.flowTitle}>ADD A BACKUP</h1>
      <p className={styles.subhead}>
        Lose your only passkey and your funds stay locked. A second one, somewhere else, keeps you
        in.
      </p>

      <ul className={styles.points}>
        <li className={styles.point}>
          <span className={styles.pointTitle}>{deviceLabel}</span>
          <span className={styles.pointTag}>SAVED</span>
        </li>
        <li className={styles.point} data-accent={hasBackup ? "lime" : "amber"}>
          <span className={styles.pointTitle}>
            {hasBackup ? "Backup passkey" : "Second device or password manager"}
          </span>
          <span className={styles.pointTag}>{hasBackup ? "SAVED" : "RECOMMENDED"}</span>
        </li>
      </ul>

      <div className={styles.flowActions}>
        {!hasBackup && (
          <Button className={styles.primary} onClick={onAddBackup} disabled={busy}>
            <Icon name="key" size={19} />
            Add backup passkey
          </Button>
        )}
        <Button variant="secondary" onClick={onFinish} arrow>
          {hasBackup ? "Open the studio" : "Later"}
        </Button>
      </div>
    </div>
  );
}
