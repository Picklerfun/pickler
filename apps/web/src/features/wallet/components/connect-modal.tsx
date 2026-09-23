"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@pickler/ui";
import type { IconName } from "@pickler/ui";
import type { WalletChoice } from "../lib/wallet-context";
import type { SignerKind } from "../lib/signer";
import styles from "./connect-modal.module.css";

/**
 * The chooser. Where the person picks the wallet they brought.
 *
 * It holds up what the person was about to do, the way the app's own sign-in screen does, so the
 * wallet is a step inside their action rather than a wall in front of it. A choice this browser
 * cannot offer stays visible with the reason on it, which tells someone what is missing rather
 * than leaving them in front of an empty list.
 */

const COPY: Record<SignerKind, { title: string; sub: string; icon: IconName }> = {
  injected: {
    title: "Browser wallet",
    sub: "MetaMask, Rabby, or whatever this browser injects.",
    icon: "wallet",
  },
};

interface ConnectModalProps {
  open: boolean;
  choices: WalletChoice[];
  /** What the person was about to do when the wallet got in the way. */
  holding: string | null;
  connecting: boolean;
  error: string | null;
  onPick: (kind: SignerKind) => void;
  onClose: () => void;
}

export function ConnectModal({
  open,
  choices,
  holding,
  connecting,
  error,
  onPick,
  onClose,
}: ConnectModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  // `showModal` is what makes it a modal: the page behind goes inert, focus is trapped, and
  // Escape closes it without a keydown listener of our own.
  useEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    }
    if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="connect-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click that lands on the dialog itself landed on the backdrop: the card is a child.
      onClick={(event) => {
        if (event.target === dialog.current) {
          onClose();
        }
      }}
    >
      <div className={styles.card}>
        <header className={styles.head}>
          <p className={styles.label}>WALLET</p>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        {holding && (
          <div className={styles.held}>
            <p className={styles.label}>WE KEPT WHAT YOU WERE ABOUT TO DO</p>
            <p className={styles.heldAction}>{holding}</p>
          </div>
        )}

        <h2 id="connect-title" className={styles.title}>
          CONNECT A WALLET.
        </h2>
        <p className={styles.lead}>
          Reading and following never need an account. The wallet appears the first time money moves
          — paying for a read, or buying a token.
        </p>

        <ul className={styles.choices}>
          {choices.map((choice) => {
            const copy = COPY[choice.kind];
            return (
              <li key={choice.kind}>
                <button
                  type="button"
                  className={styles.choice}
                  disabled={choice.unavailable !== null || connecting}
                  onClick={() => onPick(choice.kind)}
                >
                  <span className={styles.choiceIcon} aria-hidden="true">
                    <Icon name={copy.icon} size={18} />
                  </span>
                  <span className={styles.choiceText}>
                    <span className={styles.choiceTitle}>
                      {copy.title}
                      {choice.last && <span className={styles.lastUsed}>LAST USED</span>}
                    </span>
                    <span className={styles.choiceSub}>{choice.unavailable ?? copy.sub}</span>
                    {choice.unavailable === null && choice.note && (
                      <span className={styles.choiceNote}>{choice.note}</span>
                    )}
                  </span>
                  {choice.unavailable === null && <Icon name="arrow" size={16} />}
                </button>
              </li>
            );
          })}
        </ul>

        {connecting && <p className={styles.waiting}>Waiting for your wallet…</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <p className={styles.foot}>
          Connecting is not signing. Every operation is confirmed on its own, and this site never
          signs anything on your behalf.
        </p>
      </div>
    </dialog>
  );
}
