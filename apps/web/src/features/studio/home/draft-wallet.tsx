"use client";
import { useState } from "react";
import { Button, Chip, ChipText } from "@pickler/ui";
import type { Agent } from "../api";
import { shortAddress } from "../new-agent/model";
import { MIN_FUNDED_AUSD } from "./status";
import styles from "./home.module.css";

/**
 * "Its wallet" on a draft's home. A draft made by the create screen has its own wallet, funded and
 * capped by its brief (studio-create-simplified-v1): its AUSD, address and Copy, and the moves to
 * and from the master wallet, which open "Your wallets" on it (D7, D12). A draft from before has
 * none, and says so.
 */
export function DraftWallet({
  agent,
  preview,
  onWallets,
}: {
  agent: Agent;
  preview: boolean;
  /** Open "Your wallets" with this wallet's move form showing, in this direction. */
  onWallets(toAgent: boolean): void;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const wallet = agent.wallet;
  if (!wallet) {
    return (
      <section className={styles.wallet} id="home-wallet" aria-label="Its wallet">
        <p className={styles.eyebrow}>ITS WALLET · MONAD</p>
        <p className={styles.fine}>
          No wallet is linked to this draft. It was made before drafts had their own, so it runs on
          paper only.
        </p>
      </section>
    );
  }

  const funded = wallet.balanceAusd >= MIN_FUNDED_AUSD;

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <section className={styles.wallet} id="home-wallet" aria-label="Its wallet">
      <div className={styles.walletHead}>
        <span className={styles.grow}>
          <span className={styles.eyebrow}>ITS WALLET · MONAD</span>
          <span className={styles.balance} data-funded={funded}>
            {wallet.balanceAusd.toFixed(2)} <small>AUSD</small>
          </span>
        </span>
        <Button
          variant={funded ? "secondary" : "primary"}
          size="sm"
          disabled={preview}
          onClick={() => onWallets(true)}
        >
          Fund from master
        </Button>
      </div>
      <div className={styles.addressRow}>
        <ChipText className={styles.address} title={wallet.address}>
          {shortAddress(wallet.address)}
        </ChipText>
        <Chip onClick={() => void copy(wallet.address)}>
          {copied === "copied" ? "Copied ✓" : copied === "failed" ? "Copy failed" : "Copy"}
        </Chip>
        <Chip onClick={() => onWallets(false)} disabled={preview}>
          Pull back to master
        </Chip>
        <span className={styles.secured}>Secured by your passkey</span>
      </div>
      <p className={styles.fine}>
        Its own wallet, held to the caps in its brief. It trades on paper until it goes public.
      </p>
    </section>
  );
}
