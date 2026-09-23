"use client";

import { Button, Icon } from "@pickler/ui";
import styles from "../../auth.module.css";

/**
 * What is still true when every passkey is gone, verbatim from the canvas.
 *
 * It is behind a disclosure because it is the question nobody asks until they have to, and the
 * answer is better than people fear: the money does not move, the agents keep to their limits,
 * and the one thing you can still do from a browser is stop them.
 */
const IF_ALL_LOST = [
  "FUNDS STAY LOCKED IN YOUR WALLET",
  "AGENTS KEEP BETTING INSIDE THEIR LIMITS",
  "YOU CAN STILL PAUSE THEM FROM HERE",
];

/** Which half of the two-ceremony run is going. `idle` is before either. */
export type UsePhonePhase = "idle" | "creating" | "verifying";

const PHONE_NOTE: Record<UsePhonePhase, string> = {
  idle: "SCAN A CODE · APPROVE WITH ITS PASSKEY",
  creating: "SAVING A PASSKEY ON THIS DEVICE · STEP 1 OF 2",
  verifying: "SCAN THE CODE AND APPROVE · STEP 2 OF 2",
};

/**
 * Signed in, on a browser the account has never seen.
 *
 * There is no QR code in this markup on purpose. The operating system draws it, over the page,
 * from the cross-platform ceremony — a code Pickler painted would be a code Pickler could get
 * wrong, and the one drawn by the platform is the one the phone will trust.
 */
export function NewDeviceStep({
  phase,
  onUsePhone,
}: {
  phase: UsePhonePhase;
  onUsePhone: () => void;
}) {
  return (
    <div className={styles.flowStep}>
      <h1 className={styles.flowTitle}>NEW DEVICE</h1>
      <p className={styles.subhead}>
        You&apos;re in. To move funds from here, approve with a passkey you already have.
      </p>

      <Button
        variant="tile"
        className={styles.tile}
        onClick={onUsePhone}
        disabled={phase !== "idle"}
      >
        <span className={styles.tileText}>
          <strong>Use my phone</strong>
          <span>{PHONE_NOTE[phase]}</span>
        </span>
        <Icon name="arrow" size={16} />
      </Button>

      <p className={styles.point} data-accent="muted">
        <span className={styles.pointTitle}>Recover by email</span>
        <span className={styles.pointTag}>OFF · TURN ON IN SECURITY</span>
      </p>

      <details className={styles.lost}>
        <summary>I&apos;ve lost every passkey</summary>
        <ul className={styles.lostFacts}>
          {IF_ALL_LOST.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * The last screen of the new-device rail, and it has one state on purpose.
 *
 * The canvas offers "save a passkey here" *after* the phone approves, and that ordering cannot
 * happen: `prepareAddPasskey` needs an attestation to build the activity it hands the phone, so
 * this browser's credential necessarily exists before the phone can stamp anything. By the time
 * this screen is on, the passkey is already saved — there is no state in which it is not, which
 * is why there is no branch here and no action to save one. Do not add it back from the canvas.
 *
 * `passkeys` is what the account holds now. Two is what this path produces — the phone's and this
 * device's — which is the number the canvas prints; a shell that knows better says so.
 */
export function RecoveredStep({
  passkeys = 2,
  onFinish,
}: {
  passkeys?: number | undefined;
  onFinish: () => void;
}) {
  return (
    <div className={styles.flowStep}>
      <h1 className={styles.flowTitle}>ALL SET</h1>
      <p className={styles.subhead}>
        This device can move funds now. You have {passkeys}{" "}
        {passkeys === 1 ? "passkey" : "passkeys"}.
      </p>

      <div className={styles.flowActions}>
        <Button variant="secondary" onClick={onFinish} arrow>
          Open the studio
        </Button>
      </div>
    </div>
  );
}
