"use client";

import { Button, Icon } from "@pickler/ui";
import type { ReactNode } from "react";
import styles from "./connect-gate.module.css";
import { useWallet } from "../lib/wallet-context";

/**
 * Pages that only mean something for a wallet — a portfolio, a read history, the agents you follow —
 * say so instead of showing an empty table. Connecting is all that is asked for: no account, no
 * signature, no email.
 */
export function ConnectGate({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const wallet = useWallet();

  if (wallet.status === "connected") {
    return <>{children}</>;
  }

  return (
    <section className={styles.gate}>
      <span className={styles.mark} aria-hidden="true">
        <Icon name="wallet" size={22} />
      </span>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.lead}>{lead}</p>
      {/* Offered even when nothing on this device can connect: the chooser names what is missing
          and that the app account exists, which a dead button cannot do. */}
      <Button
        variant="primary"
        onClick={() => wallet.connect(title)}
        disabled={wallet.status === "connecting"}
      >
        {wallet.status === "connecting" ? "Waiting for your wallet…" : "Connect wallet"}
      </Button>
      <p className={styles.note}>
        Connecting only reads your address. Building an agent is a different thing, and it lives
        behind a creator account.
      </p>
    </section>
  );
}
