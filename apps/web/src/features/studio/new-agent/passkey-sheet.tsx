"use client";
import { useEffect, useId, useRef, type KeyboardEvent, type SyntheticEvent } from "react";
import { Button, Icon } from "@pickler/ui";
import styles from "./new-agent.module.css";

export type SheetPhase = "idle" | "busy" | "ok" | "err";

export interface PasskeySheetProps {
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
 * A native `<dialog>` opened with `showModal`, as the auth sheet is: the page behind it is inert
 * and the focus stays inside. Every way out goes through `onClose`, which refuses while a passkey
 * is up, so Escape cannot close a busy sheet. On close the focus goes back to what opened it.
 */
export function PasskeySheet({
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
  const sheet = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const busy = phase === "busy";
  /* The latest props, for the native close event, which is bound once. */
  const latest = useRef({ open, busy, onClose });
  useEffect(() => {
    latest.current = { open, busy, onClose };
  });

  useEffect(() => {
    const element = sheet.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    }
    if (!open && element.open) {
      element.close();
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) {
        back.focus();
      }
    }
  }, [open]);

  /* Each phase puts the focus on its first action (Continue, Try again), or on the sheet itself
     while there is none, so a phase that removes the focused button never drops it to the page. */
  useEffect(() => {
    const element = sheet.current;
    if (!open || !element) {
      return;
    }
    (element.querySelector("button") ?? element).focus();
  }, [open, phase]);

  /* A close the platform forces (a second Escape some browsers stop asking about) is answered
     like any other: closed when it may close, shown again while a passkey is up. */
  useEffect(() => {
    const element = sheet.current;
    if (!element) {
      return;
    }
    const closed = () => {
      const { open: shouldBeOpen, busy: isBusy, onClose: close } = latest.current;
      if (!shouldBeOpen) {
        return;
      }
      if (isBusy) {
        element.showModal();
      } else {
        close();
      }
    };
    element.addEventListener("close", closed);
    return () => element.removeEventListener("close", closed);
  }, []);

  function escape(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Escape") {
      return;
    }
    // Answered here, so the platform's cancel never runs: the caller decides.
    event.preventDefault();
    if (!busy) {
      onClose();
    }
  }

  function cancel(event: SyntheticEvent) {
    event.preventDefault();
    if (!busy) {
      onClose();
    }
  }

  return (
    <dialog
      ref={sheet}
      className={styles.sheet}
      // A dialog sits under the body, outside the screen's surface; it names the dark one.
      data-surface="dark"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      onKeyDown={escape}
      onCancel={cancel}
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
      {/* Always in the tree, so the wait is announced when it starts. */}
      <p className={styles.sheetWait} role="status" aria-live="polite">
        {busy && (
          <>
            <i aria-hidden="true" />
            <span className={styles.srOnly}>Waiting for </span>
            TOUCH ID
          </>
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
