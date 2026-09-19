"use client";

import { Icon, Chip } from "@pickler/ui";
import { useState } from "react";
import styles from "../agents.module.css";

const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The contract chip and the share chip: both copy, both say so when they have. */
export function TokenActions({ address, name }: { address: string | null; name: string }) {
  const [copied, setCopied] = useState<"contract" | "link" | null>(null);

  const copy = async (value: string, which: "contract" | "link") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard access can be denied; the chip simply does nothing.
    }
  };

  return (
    <>
      {address && (
        <Chip className={styles.chip} onClick={() => copy(address, "contract")} title={address}>
          {copied === "contract" ? "Copied" : shorten(address)}
          <Icon name="copy" size={13} />
        </Chip>
      )}
      <Chip
        className={styles.chip}
        onClick={() => copy(window.location.href, "link")}
        aria-label={`Copy the link to ${name}`}
      >
        {copied === "link" ? "Copied" : "Share"}
      </Chip>
    </>
  );
}
