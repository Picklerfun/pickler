"use client";

import { useEffect } from "react";
import { Button, Icon } from "@pickler/ui";
import styles from "../auth.module.css";
import { sheetCopy, type Ceremony, type SheetPhase } from "../lib/sheet";

export type { Ceremony, SheetPhase };

/**
 * The last screen that is ours before the operating system takes the display.
 *
 * Shared by all three ceremonies — the first passkey, the backup, the one saved on a new device —
 * but never generic: `lib/sheet.ts` chooses the words from the ceremony, and every phase of every
 * ceremony is covered by apps/web/test/sheet.test.ts, which is why nothing here decides copy.
 *
 * `error` distinguishes the two ways a ceremony ends badly, and the distinction is the point:
 * `describeCeremonyFailure` returns null for NotAllowedError, which is the person dismissing the
 * prompt. That is a decision, not a fault, so the sheet says it was cancelled and says what was
 * not done — the question a cancelled ceremony actually raises is whether anything moved.
 */
export function PasskeySheet({
  open,
  ceremony,
  phase,
  error = null,
  rpId = null,
  userAgent = null,
  step,
  onConfirm,
  onCancel,
  onRetry,
}: {
  open: boolean;
  ceremony: Ceremony;
  phase: SheetPhase;
  /** A sentence from `describeCeremonyFailure`, or null for a prompt the person dismissed. */
  error?: string | null | undefined;
  /** The relying party the challenge named. Shown so it can be checked before agreeing. */
  rpId?: string | null | undefined;
  /** `navigator.userAgent`. The shell reads it; this stays testable through `sheetCopy`. */
  userAgent?: string | null | undefined;
  /** Which half of the two-ceremony "use my phone" run is going. Only `here` shows it. */
  step?: 1 | 2 | undefined;
  onConfirm: () => void;
  /** Closes the sheet. Also the way out of a finished or failed one — never a trap. */
  onCancel: () => void;
  onRetry: () => void;
}) {
  // While the operating system's own prompt is up there is nothing here to dismiss, and a stray
  // Escape would leave the ceremony running with its sheet gone.
  const dismissable = open && phase !== "busy";

  useEffect(() => {
    if (!dismissable) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissable, onCancel]);

  if (!open) {
    return null;
  }

  const copy = sheetCopy({ ceremony, phase, error, rpId, userAgent, step });

  return (
    <div className={styles.sheetScrim} role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className={styles.sheet}>
        <p className={styles.sheetTitle}>
          {phase === "ok" && <Icon name="check" size={18} className={styles.sheetSaved} />}{" "}
          {copy.title}
        </p>
        {copy.note && <p className={styles.sheetNote}>{copy.note}</p>}

        {/* Only ever the sentence describeCeremonyFailure wrote. A cancellation has no sentence,
            and inventing one for it would turn a decision into an error message. */}
        {phase === "error" && error && (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        )}

        {phase === "idle" && (
          <div className={styles.sheetActions}>
            <Button className={styles.primary} onClick={onConfirm} autoFocus>
              Continue
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}

        {phase === "busy" && (
          <p className={styles.busyNote} aria-live="polite">
            <span className={styles.busyDot} aria-hidden="true" />
            WAITING FOR YOUR DEVICE
          </p>
        )}

        {phase === "ok" && (
          <div className={styles.sheetActions}>
            <Button className={styles.primary} onClick={onCancel} autoFocus>
              Done
            </Button>
          </div>
        )}

        {phase === "error" && (
          <div className={styles.sheetActions}>
            <Button className={styles.primary} onClick={onRetry} autoFocus>
              Try again
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
