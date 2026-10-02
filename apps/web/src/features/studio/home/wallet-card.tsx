"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Chip, ChipText, Icon } from "@pickler/ui";
import type { Agent } from "../api";
import { shortAddress } from "../new-agent/model";
import { DepositSheet } from "./deposit-sheet";
import { MIN_FUNDED_AUSD } from "./status";
import styles from "./home.module.css";

/**
 * When the balance is read again after a deposit. The API forgets its cached balance on confirm,
 * but the transfer may not have landed yet, so it is read now and twice more while it does.
 */
const REREAD_MS = [0, 5_000, 15_000];

/**
 * "Its wallet": the AUSD balance on Monad, the address and Copy, the deposit sheet, and "Pull back
 * to master", which opens "Your wallets" on it.
 */
export function WalletCard({
  agent,
  preview,
  canManage,
  open,
  onOpen,
  onRefresh,
  onPullBack,
}: {
  agent: Agent;
  preview: boolean;
  canManage: boolean;
  open: boolean;
  onOpen(open: boolean): void;
  /** Reads the agent again; the balance and both locks come back with it. */
  onRefresh(): Promise<void>;
  /** "Pull back to master": open "Your wallets" on this wallet, toward the master (D7). */
  onPullBack(): void;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [sent, setSent] = useState<{ txHash: string | null } | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const wallet = agent.wallet;
  if (!wallet) {
    return (
      <section className={styles.wallet} id="home-wallet" aria-label="Its wallet">
        <p className={styles.eyebrow}>ITS WALLET · MONAD</p>
        <p className={styles.fine}>
          No wallet is linked to this agent. It was created before agents had wallets, so it cannot
          be funded or run on its own.
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

  function deposited(txHash: string | null) {
    setSent({ txHash });
    onOpen(false);
    timers.current.forEach(clearTimeout);
    timers.current = REREAD_MS.map((delay) =>
      setTimeout(() => {
        onRefresh().then(
          () => setRefreshError(""),
          (caught: unknown) =>
            setRefreshError(
              caught instanceof Error ? caught.message : "Could not read the balance again.",
            ),
        );
      }, delay),
    );
  }

  return (
    <section className={styles.wallet} id="home-wallet" aria-label="Its wallet" data-open={open}>
      <div className={styles.walletHead}>
        <span className={styles.grow}>
          <span className={styles.eyebrow}>ITS WALLET · MONAD</span>
          <span className={styles.balance} data-funded={funded}>
            {wallet.balanceAusd.toFixed(2)} <small>AUSD</small>
          </span>
        </span>
        <Button
          variant={funded || open ? "secondary" : "primary"}
          size="sm"
          aria-expanded={open}
          aria-controls="home-deposit"
          onClick={() => onOpen(!open)}
        >
          {open ? "Close" : funded ? "Add funds" : "Deposit"}
        </Button>
      </div>
      <div className={styles.addressRow}>
        <ChipText className={styles.address} title={wallet.address}>
          {shortAddress(wallet.address)}
        </ChipText>
        <Chip onClick={() => void copy(wallet.address)}>
          {copied === "copied" ? "Copied ✓" : copied === "failed" ? "Copy failed" : "Copy"}
        </Chip>
        <Chip onClick={onPullBack} disabled={preview}>
          Pull back to master
        </Chip>
        <span className={styles.secured}>Secured by your passkey</span>
      </div>
      {sent && (
        <p className={styles.fine} role="status">
          <Icon name="check" size={13} />
          {sent.txHash
            ? `Sent · ${shortAddress(sent.txHash)}. The balance updates once it lands.`
            : "That deposit was already sent. The balance updates once it lands."}
        </p>
      )}
      {refreshError && (
        <p className={styles.alert} role="alert">
          <Icon name="alert" size={13} />
          {refreshError}
        </p>
      )}
      {open && (
        <DepositSheet
          agent={agent}
          preview={preview}
          canManage={canManage}
          onDeposited={deposited}
        />
      )}
    </section>
  );
}
