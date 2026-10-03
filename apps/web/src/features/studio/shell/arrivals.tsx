"use client";
import { useState } from "react";
import type { StudioWallets } from "../api";
import { arrived } from "../new-agent/model";
import { agentWalletRead, readClock } from "./build-model";
import styles from "./build.module.css";

/** One balance that grew between two reads, stamped with the later read's time. */
export interface Arrival {
  text: string;
  at: string;
}

/**
 * What arrived in an agent's wallet between two reads, newest first: every new read of the wallets
 * (a transfer's, a refresh's) is compared with the one before it (`arrived`). Without a wallet
 * nothing arrives. Both studios' Limits draw it.
 */
export function useArrivals(wallets: StudioWallets | null, walletId: string | null): Arrival[] {
  const [arrivals, setArrivals] = useState<{ seen: StudioWallets | null; list: Arrival[] }>({
    seen: wallets,
    list: [],
  });
  if (wallets !== arrivals.seen) {
    const before = walletId ? agentWalletRead(arrivals.seen, walletId) : null;
    const after = walletId ? agentWalletRead(wallets, walletId) : null;
    const found =
      before && after && wallets ? arrived(before, after, readClock(wallets.readAt)) : [];
    setArrivals({ seen: wallets, list: [...found, ...arrivals.list] });
  }
  return arrivals.list;
}

/**
 * The arrivals as a list ("Arrived"), nothing when there are none. `radius` is the row's corner:
 * the draft canvas's `sm`, the live canvas's `md`.
 */
export function ArrivalList({
  arrivals,
  radius,
}: {
  arrivals: readonly Arrival[];
  radius: "sm" | "md";
}) {
  if (arrivals.length === 0) {
    return null;
  }
  return (
    <ol className={styles.arrivals} aria-label="Arrived">
      {arrivals.map((entry, index) => (
        <li
          key={`${entry.at}-${entry.text}-${index}`}
          className={styles.arrival}
          data-radius={radius}
        >
          <span className={styles.arrivalDot} aria-hidden="true" />
          <span className={styles.arrivalText}>{entry.text}</span>
          <span className={styles.arrivalAt} suppressHydrationWarning>
            {entry.at}
          </span>
        </li>
      ))}
    </ol>
  );
}
