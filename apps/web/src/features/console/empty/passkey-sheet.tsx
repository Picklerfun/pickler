"use client";
import { Icon } from "@pickler/ui";
import styles from "./empty.module.css";

/**
 * The passkey sheet, as the canvas draws it, with nothing behind its confirm.
 *
 * Authorising an agent's sub-wallet is specification two of the custody work. There is no endpoint
 * and no policy to sign against, so there is nothing for Continue to call. It is disabled and the
 * sheet says why.
 *
 * It is deliberately NOT wired to the master-wallet ceremony that does exist. That one is real: it
 * would take a person through a genuine biometric prompt and produce a signature, to authorise
 * something the product cannot honour. A ceremony that asks for a fingerprint has to mean it.
 */
export type SheetKind = "wallet" | "fund";

const COPY: Record<SheetKind, { title: string; body: string; why: string }> = {
  wallet: {
    title: "Create its wallet?",
    body: "A sub-wallet of yours, capped per pick and per day, that only this agent can spend from.",
    why: "Agent sub-wallets and their policies are not built. There is no key to create and no policy to sign, so this cannot ask for your passkey.",
  },
  fund: {
    title: "Fund it?",
    body: "From your wallet, on Monad. The agent spends inside its caps and can never withdraw.",
    why: "Funding needs the agent's wallet to exist first, and it does not. Nothing here would move money even if you confirmed it.",
  },
};

export function PasskeySheet({ kind, onClose }: { kind: SheetKind; onClose(): void }) {
  const copy = COPY[kind];
  return (
    <div
      className={styles.scrim}
      role="dialog"
      aria-modal="true"
      aria-labelledby="passkey-sheet-title"
      onClick={onClose}
    >
      <span className={styles.veil} aria-hidden="true" />
      <div className={styles.sheet} onClick={(event) => event.stopPropagation()}>
        <span className={styles.sheetMark}>
          <Icon name="key" size={30} />
        </span>
        <p className={styles.sheetTitle} id="passkey-sheet-title">
          {copy.title}
        </p>
        <p className={styles.sheetBody}>{copy.body}</p>
        <p className={styles.sheetWhy}>
          <Icon name="alert" size={13} />
          {copy.why}
        </p>
        <div className={styles.sheetActions}>
          <button type="button" className={styles.sheetGo} disabled title={copy.why}>
            Continue
          </button>
          <button type="button" className={styles.sheetCancel} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
