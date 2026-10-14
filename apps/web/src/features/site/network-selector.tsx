"use client";

import { useId, type ChangeEvent } from "react";
import { Select } from "@pickler/ui";
import { ACTIVE_PRODUCT_NETWORK, MAINNET_NOTE, PRODUCT_NETWORKS } from "./networks";
import styles from "./network-selector.module.css";

/** The product network; opening this control never asks a wallet to switch or sign. */
export function NetworkSelector() {
  const noteId = useId();

  function keepActiveNetwork(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.value = String(ACTIVE_PRODUCT_NETWORK.chainId);
  }

  return (
    <span className={styles.control}>
      <Select
        size="sm"
        shape="pill"
        className={styles.select}
        aria-label="Network"
        aria-describedby={noteId}
        title={MAINNET_NOTE}
        value={String(ACTIVE_PRODUCT_NETWORK.chainId)}
        onChange={keepActiveNetwork}
      >
        {PRODUCT_NETWORKS.map(({ network, label, available }) => (
          <option key={network.chainId} value={String(network.chainId)} disabled={!available}>
            {label}
          </option>
        ))}
      </Select>
      <span id={noteId} className={styles.note}>
        {MAINNET_NOTE}
      </span>
    </span>
  );
}
