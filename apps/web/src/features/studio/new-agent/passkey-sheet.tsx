"use client";
import { useEffect, useId } from "react";
import { Button, Icon } from "@pickler/ui";
import { useDialog } from "./use-dialog";
import styles from "./new-agent.module.css";

export type SheetPhase = "idle" | "busy" | "ok" | "err";

export interface PasskeySheetProps {
  /** The design harness's handle on this sheet; the Wallets modal's own sheet has none. */
  id?: string;
  open: boolean;
  title: string;
  body: string;
  done: string;
  phase: SheetPhase;
  twoStep: boolean;
  step: 1 | 2;
  onContinue(): void;
  onClose(): void;
}

/**
 * The canvas's passkey sheet: what will be signed, Continue, the Touch ID wait, done or cancelled.
 * The words are `sheetCopy`'s (model.ts); this file decides none.
 *
 * A native `<dialog>` (`use-dialog.ts`): the page behind it is inert, Escape and every other way
 * out go through `onClose`, refused while a passkey is up, and the focus goes back to what opened
 * it.
 */
export function PasskeySheet({
  id,
  open,
  title,
  body,
  done,
  phase,
  twoStep,
  step,
  onContinue,
  onClose,
}: PasskeySheetProps) {
  const titleId = useId();
  const bodyId = useId();
  const busy = phase === "busy";
  const { ref: sheet, onKeyDown, onCancel } = useDialog({ open, busy, onClose, nested: true });

  /* Each phase puts the focus on its first action (Continue, Try again), or on the sheet itself
     while there is none, so a phase that removes the focused button never drops it to the page. */
  useEffect(() => {
    const element = sheet.current;
    if (!open || !element) {
      return;
    }
    (element.querySelector("button") ?? element).focus();
  }, [open, phase, sheet]);

  return (
    <dialog
      ref={sheet}
      id={id}
      className={styles.sheet}
      data-phase={phase}
      // A dialog sits under the body, outside the screen's surface; it names the dark one.
      data-surface="dark"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onCancel={onCancel}
    >
      <span className={styles.sheetIcon} data-phase={phase} aria-hidden="true">
        <Icon name={phase === "ok" ? "check" : phase === "err" ? "x" : "key"} size={26} />
      </span>
      {twoStep && (
        <span className={styles.sheetSteps} role="img" aria-label={`Step ${step} of 2`}>
          <i data-on="true" />
          <i data-on={step === 2} />
        </span>
      )}
      <p className={styles.sheetTitle} id={titleId}>
        {phase === "err" ? "Passkey cancelled" : phase === "ok" ? done : title}
      </p>
      <p className={styles.sheetNote} id={bodyId}>
        {phase === "err" ? "NOTHING WAS SIGNED · NOTHING MOVED" : body}
      </p>
      {phase === "idle" && (
        <div className={styles.sheetActions}>
          <Button onClick={onContinue}>Continue</Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
      {/* Always in the tree, so the wait and a cancellation are announced when they happen. The
          cancellation is already the visible title; here it is only read out. */}
      <p className={styles.sheetWait} role="status" data-busy={busy}>
        {busy && (
          <>
            <i aria-hidden="true" />
            <span className={styles.srOnly}>Waiting for </span>
            TOUCH ID
          </>
        )}
        {phase === "err" && (
          <span className={styles.srOnly}>Passkey cancelled · nothing was signed</span>
        )}
      </p>
      {phase === "err" && (
        <div className={styles.sheetActions}>
          <Button onClick={onContinue}>Try again</Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </dialog>
  );
}
