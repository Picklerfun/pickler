"use client";
import { useId, useRef } from "react";
import { Button, Icon, Tag } from "@pickler/ui";
import { useDialog } from "./use-dialog";
import styles from "./new-agent.module.css";

export interface CreditsModalProps {
  open: boolean;
  onClose(): void;
  /** The canvas's "Wallets" tab. */
  onWallets(): void;
}

/**
 * "AI credits" (D11, spec §3.3), display only: what they will be, and the top-up shut with "Soon".
 * No balance exists yet, so none is shown. The tabs mirror `wallets-modal.tsx`'s. A native
 * `<dialog>` (`use-dialog.ts`).
 */
export function CreditsModal({ open, onClose, onWallets }: CreditsModalProps) {
  const titleId = useId();
  const { ref, onKeyDown, onCancel } = useDialog({ open, busy: false, onClose });
  /* A drag that starts inside the card and ends on the backdrop does not close the modal. */
  const downOnBackdrop = useRef(false);
  return (
    <dialog
      ref={ref}
      className={styles.modal}
      // A dialog sits under the body, outside the screen's surface; it names the dark one.
      data-surface="dark"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={onCancel}
      onPointerDown={(event) => {
        downOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const onBackdrop = downOnBackdrop.current && event.target === event.currentTarget;
        downOnBackdrop.current = false;
        if (onBackdrop) {
          onClose();
        }
      }}
    >
      <div className={styles.modalCard}>
        <div className={styles.modalHead}>
          <span className={styles.tabs}>
            <button type="button" className={styles.tab} onClick={onWallets}>
              Wallets
            </button>
            <span className={styles.tab} aria-current="true">
              AI credits
            </span>
          </span>
          <button type="button" className={styles.modalClose} aria-label="Close" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <h2 className={styles.modalTitle} id={titleId}>
          AI CREDITS<span>.</span>
        </h2>
        <p className={styles.modalLead}>
          Every run your agents make costs model time. Soon it is charged from a credits balance you
          top up from your master wallet, not from any agent&apos;s wallet. Until then, Pickler
          pays.
        </p>
        <div className={styles.walletBox}>
          <div className={styles.walletBoxHead}>
            <span className={styles.webTitle}>ADD CREDITS · FROM MASTER WALLET</span>
            <Tag className={styles.soon}>SOON</Tag>
          </div>
          <Button block disabled>
            Add credits
          </Button>
          <span className={styles.note}>
            1 AUSD = $1 OF CREDIT · ONE PASSKEY · CREDITS DON&apos;T COME BACK AS AUSD
          </span>
        </div>
      </div>
    </dialog>
  );
}
