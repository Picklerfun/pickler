"use client";

import { Button, Icon } from "@pickler/ui";
import Image from "next/image";
import { useState } from "react";
import { TARGET_CHAIN } from "@/features/wallet/lib/provider";
import { useWallet } from "@/features/wallet/lib/wallet-context";
import { StatusActions, StatusScreen } from "./status-screen";
import styles from "./status.module.css";
import { chainName } from "./words";

/** 1g. A wallet connected on a chain Pickler does not settle on. */
export function WrongNetwork() {
  const wallet = useWallet();
  const [switching, setSwitching] = useState(false);
  const current = wallet.chainId === null ? "another network" : chainName(wallet.chainId);

  async function switchChain() {
    setSwitching(true);
    try {
      await wallet.switchChain();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <StatusScreen
      inside
      id="wrong-network"
      tone="caution"
      eyebrow="WALLET · WRONG NETWORK"
      foot="YOUR WALLET WILL ASK ONCE · WE NEVER ASK FOR A SEED PHRASE"
      title={`THAT'S NOT ${TARGET_CHAIN.name.split(" ")[0]?.toUpperCase() ?? "MONAD"}`}
      body={`Your wallet is on ${current}. Pickler settles on ${TARGET_CHAIN.name}. Nothing here can sign until you switch. Connecting is not signing in.`}
    >
      <div className={styles.row}>
        {wallet.chainId !== null && (
          <span className={`${styles.address} ${styles.was}`}>
            {current.toUpperCase()} · {wallet.chainId}
          </span>
        )}
        <Icon name="arrow" size={15} />
        <span className={styles.target}>
          <Image src="/brand/monad.png" alt="" width={18} height={18} />
          {TARGET_CHAIN.name.toUpperCase()} · {TARGET_CHAIN.chainId}
        </span>
      </div>
      <StatusActions>
        {wallet.canSwitchChain && (
          <Button variant="primary" onClick={() => void switchChain()} disabled={switching}>
            {switching && <span className={styles.pulse} aria-hidden="true" />}
            {switching ? "Confirm in wallet" : `Switch to ${TARGET_CHAIN.name.split(" ")[0]}`}
          </Button>
        )}
        <Button onClick={() => void wallet.disconnect()} variant="secondary">
          Disconnect
        </Button>
      </StatusActions>
    </StatusScreen>
  );
}
