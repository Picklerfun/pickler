"use client";

import Link from "next/link";
import { Button, Icon } from "@pickler/ui";
import { useState } from "react";
import styles from "./account-menu.module.css";
import { useWallet } from "../lib/wallet-context";
import { formatBalance, shortAddress, TARGET_CHAIN } from "../lib/provider";

/**
 * The wallet in the navigation. Disconnected it is one button; connected it is the address, the
 * balance and the three things that only exist for a connected wallet — what it holds, what it
 * follows, and the reads it paid for.
 *
 * Connecting is not signing in. The creator account at /signin is for building agents; this is for
 * the person reading and backing them.
 */
export function AccountMenu() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (wallet.status !== "connected" || !wallet.address) {
    const label =
      wallet.status === "connecting"
        ? "Waiting for your wallet…"
        : wallet.status === "unsupported"
          ? "No wallet found"
          : "Connect wallet";
    return (
      <span className={styles.slot}>
        <Button
          className={styles.connect}
          onClick={() => void wallet.connect()}
          disabled={wallet.status === "connecting" || wallet.status === "unsupported"}
          title={
            wallet.status === "unsupported"
              ? "No browser wallet is installed on this device."
              : undefined
          }
        >
          {label}
        </Button>
        {wallet.error && <span className={styles.error}>{wallet.error}</span>}
      </span>
    );
  }

  const address = wallet.address;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // A browser that refuses the clipboard still shows the address in full below.
    }
  };

  return (
    <span className={styles.slot}>
      <button
        type="button"
        className={styles.chip}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span
          className={`${styles.dot} ${wallet.onTargetChain ? "" : styles.dotWrong}`}
          aria-hidden="true"
        />
        {shortAddress(address)}
        <Icon name={open ? "chevronUp" : "chevronDown"} size={13} />
      </button>

      {open && (
        <>
          <button
            type="button"
            className={styles.scrim}
            aria-label="Close wallet menu"
            onClick={() => setOpen(false)}
          />
          <div className={styles.menu}>
            <p className={styles.balanceLabel}>
              {wallet.onTargetChain ? "BALANCE" : "WRONG NETWORK"}
            </p>
            {wallet.onTargetChain ? (
              <p className={styles.balance}>
                {wallet.balance === null ? "—" : formatBalance(wallet.balance)}{" "}
                <span>{TARGET_CHAIN.nativeCurrency.symbol}</span>
              </p>
            ) : (
              <button
                type="button"
                className={styles.switch}
                onClick={() => void wallet.switchChain()}
              >
                Switch to {TARGET_CHAIN.name}
              </button>
            )}

            <button type="button" className={styles.address} onClick={() => void copy()}>
              {copied ? "COPIED" : shortAddress(address)}
              <Icon name="copy" size={13} />
            </button>

            <nav className={styles.links} aria-label="Wallet">
              <Link href="/portfolio" className={styles.link} onClick={() => setOpen(false)}>
                Portfolio
                <span>What this wallet holds</span>
              </Link>
              <Link href="/activity" className={styles.link} onClick={() => setOpen(false)}>
                Activity
                <span>The agents you follow, as they act</span>
              </Link>
              <Link href="/reads" className={styles.link} onClick={() => setOpen(false)}>
                Reads
                <span>The questions you paid for</span>
              </Link>
            </nav>

            <button
              type="button"
              className={styles.disconnect}
              onClick={() => {
                setOpen(false);
                void wallet.disconnect();
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </span>
  );
}
