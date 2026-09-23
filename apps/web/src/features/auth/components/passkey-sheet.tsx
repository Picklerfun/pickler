"use client";

import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from "react";
import { Button, Icon } from "@pickler/ui";
import styles from "../auth.module.css";
import { sheetCopy, type Ceremony, type SheetPhase } from "../lib/sheet";

export type { Ceremony, SheetPhase };

/**
 * The last screen that is ours before the operating system takes the display.
 *
 * Shared by all three ceremonies — the first passkey, the backup, the one saved on a new device —
 * but generic in none of them: `lib/sheet.ts` chooses the words from the ceremony, and every phase
 * of every ceremony is covered by apps/web/test/sheet.test.ts, which is why nothing here decides
 * copy.
 *
 * It is a native `<dialog>` opened with `showModal`, so the modality is the browser's rather than
 * a claim in an attribute: the page behind it really is inert, the focus really is held inside,
 * and Escape is handled without a listener of ours racing the platform's.
 *
 * `error` separates the two ways a ceremony ends badly, and the separation is the point:
 * `describeCeremonyFailure` answers null for NotAllowedError, which is the person dismissing the
 * prompt. That is a decision, not a fault, so the sheet says it was cancelled and says what was
 * not done — because what a cancelled ceremony actually raises is whether anything moved.
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
  const sheet = useRef<HTMLDialogElement>(null);

  // While the operating system's own prompt is up there is nothing here to dismiss, and a stray
  // Escape would leave the ceremony running with its sheet gone.
  const dismissable = phase !== "busy";

  useEffect(() => {
    const dialog = sheet.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  /**
   * Escape. Always answered here rather than by the user agent: the sheet closes when `open` goes
   * false and not before, so the one place that decides is the caller. Preventing the default
   * also stops the `close` event, which is why there is no handler for it — a `close` fired by
   * our own effect would come straight back as a second cancellation.
   */
  function cancel(event: SyntheticEvent) {
    event.preventDefault();
    if (dismissable) {
      onCancel();
    }
  }

  /**
   * Outside the card is outside the question — but only while there is a question to leave.
   *
   * A `::backdrop` is not an element, so a click on it arrives with the dialog itself as its
   * target, exactly like a click on the dialog's own padding. The box is the only thing that
   * tells them apart; without this check the padding would dismiss the sheet.
   */
  function backdrop(event: MouseEvent<HTMLDialogElement>) {
    const dialog = sheet.current;
    if (!dialog || event.target !== dialog || !dismissable) {
      return;
    }
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) {
      onCancel();
    }
  }

  const copy = sheetCopy({ ceremony, phase, error, rpId, userAgent, step });

  return (
    <dialog
      ref={sheet}
      className={styles.sheet}
      aria-label={copy.title}
      onCancel={cancel}
      onClick={backdrop}
    >
      <p className={styles.sheetTitle}>
        {phase === "ok" && <Icon name="check" size={18} className={styles.sheetSaved} />}
        {copy.title}
      </p>
      {copy.note && <p className={styles.sheetNote}>{copy.note}</p>}

      {/* Only ever the sentence describeCeremonyFailure wrote. A cancellation has no sentence, and
          inventing one for it would turn a decision into an error message. */}
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
    </dialog>
  );
}
