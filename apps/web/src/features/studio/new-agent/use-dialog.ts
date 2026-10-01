"use client";
import { useEffect, useRef, type KeyboardEvent, type SyntheticEvent } from "react";

/* The last opener outside any dialog. A dialog opened from inside another one (the Wallets and AI
   credits tabs switching) returns to this one, not to a button that is gone with its dialog. */
let outsideOpener: HTMLElement | null = null;

/**
 * The create screen's dialog pattern, shared by the passkey sheet and the Wallets modal: a native
 * `<dialog>` opened with `showModal`, as the auth sheet is, so the page behind it is inert and the
 * focus stays inside. Every way out goes through `onClose`, which is refused while `busy` (a
 * passkey is up), so Escape cannot close a busy dialog. On close the focus goes back to what
 * opened it.
 */
export function useDialog({
  open,
  busy,
  onClose,
  nested = false,
}: {
  open: boolean;
  busy: boolean;
  onClose(): void;
  /** Opens above another dialog that stays up (the passkey sheet), so it returns into it. */
  nested?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /* The latest props, for the native close event, which is bound once. */
  const latest = useRef({ open, busy, onClose });
  useEffect(() => {
    latest.current = { open, busy, onClose };
  });

  useEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (active && (nested || !active.closest("dialog"))) {
        opener.current = active;
        if (!active.closest("dialog")) {
          outsideOpener = active;
        }
      } else {
        opener.current = outsideOpener;
      }
      element.showModal();
    }
    if (!open) {
      const back = opener.current;
      opener.current = null;
      if (element.open) {
        element.close();
        if (back?.isConnected) {
          back.focus();
        }
      }
    }
  }, [open, nested]);

  /* A close the platform forces (a second Escape some browsers stop asking about) is answered
     like any other: closed when it may close, shown again while a passkey is up. */
  useEffect(() => {
    const element = dialog.current;
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

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Escape") {
      return;
    }
    // Answered here, so the platform's cancel never runs: the caller decides.
    event.preventDefault();
    if (!busy) {
      onClose();
    }
  }

  function onCancel(event: SyntheticEvent) {
    event.preventDefault();
    if (!busy) {
      onClose();
    }
  }

  return { ref: dialog, onKeyDown, onCancel };
}
