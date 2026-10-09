"use client";

import Link from "next/link";
import { Button, Icon } from "@pickler/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pickler/ui/dropdown-menu";
import { useState } from "react";
import styles from "./account-menu.module.css";
import { useWallet } from "../lib/wallet-context";
import { formatBalance, shortAddress, TARGET_CHAIN } from "../lib/provider";

/**
 * The wallet in the navigation. Disconnected it is one button; connected it is the address, the
 * balance and the three things that only exist for a connected wallet — what it holds, what it
 * follows, and the reads it paid for.
 *
 * This wallet belongs to readers and backers. Its existing connection/sign-in flow stays separate
 * from the creator account and custody wallet used to build agents in Studio.
 */
export function AccountMenu({ surface = "light" }: { surface?: "light" | "dark" }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (wallet.status !== "connected" || !wallet.address) {
    return (
      <span className={styles.slot}>
        <Button
          variant="chip"
          className={styles.trigger}
          aria-label={wallet.status === "connecting" ? "Waiting for your wallet" : "Connect wallet"}
          onClick={() => wallet.connect()}
          disabled={wallet.status === "connecting"}
        >
          <Icon name="wallet" size={16} />
          <span className={styles.triggerLabel}>
            {wallet.status === "connecting" ? "Waiting for your wallet…" : "Connect wallet"}
          </span>
        </Button>
        {wallet.error && (
          <span className={styles.error} role="alert">
            {wallet.error}
          </span>
        )}
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
      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="chip"
            className={styles.trigger}
            aria-label={`Wallet, ${shortAddress(address)}${wallet.onTargetChain ? "" : ", wrong network"}`}
          >
            <Icon name="wallet" size={16} className={styles.connectedIcon} />
            <span
              className={`${styles.dot} ${wallet.onTargetChain ? "" : styles.dotWrong}`}
              aria-hidden="true"
            />
            <span className={styles.triggerLabel}>{shortAddress(address)}</span>
            <Icon name="chevronDown" size={16} className={styles.connectedChevron} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className={styles.menu}
          data-surface={surface}
          aria-label="Wallet"
        >
          <p className={styles.balanceLabel}>
            {wallet.onTargetChain ? "BALANCE" : "WRONG NETWORK"}
          </p>
          {wallet.onTargetChain && (
            <p className={styles.balance}>
              {wallet.balance === null ? "—" : formatBalance(wallet.balance)}{" "}
              <span>{TARGET_CHAIN.nativeCurrency.symbol}</span>
            </p>
          )}
          <p className={styles.kind}>
            {wallet.kind === "mera" ? "PASSKEY WALLET" : "BROWSER WALLET"}
          </p>
          <DropdownMenuGroup>
            {!wallet.onTargetChain && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void wallet.switchChain();
                }}
                className={styles.link}
              >
                Switch to {TARGET_CHAIN.name}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                void copy();
              }}
              className={styles.link}
            >
              {copied ? "Copied" : shortAddress(address)} <Icon name="copy" size={16} />
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={styles.link}>
              <Link href="/portfolio">
                Portfolio<span>What this wallet holds</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={styles.link}>
              <Link href="/activity">
                Activity<span>The agents you follow, as they act</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={styles.link}>
              <Link href="/reads">
                Reads<span>The questions you paid for</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              className={styles.link}
              onSelect={() => {
                void wallet.disconnect();
              }}
            >
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
