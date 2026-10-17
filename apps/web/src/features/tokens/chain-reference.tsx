"use client";
import { useState } from "react";
import { Button, Icon } from "@pickler/ui";
import { networkByChainId } from "@pickler/chain";
import styles from "./token.module.css";

/** Only actual server-provided chain identities receive an explorer link. */
export function ChainReference({
  value,
  chainId,
  kind = "address",
  label,
  preview = false,
}: {
  value: string;
  chainId: number;
  kind?: "address" | "tx" | "block";
  label: string;
  preview?: boolean;
}) {
  const [copy, setCopy] = useState<{ value: string; error: boolean } | null>(null);
  const explorer = networkByChainId(chainId)?.explorers[0];
  const copied = copy?.value === value && !copy.error;
  const failed = copy?.value === value && copy.error;
  const text = `${value.slice(0, kind === "address" ? 8 : 10)}…${value.slice(-6)}`;
  const copyLabel = copied ? `Copied ${label}` : `Copy ${label}`;
  return (
    <div className={styles.chainReference}>
      {!preview && explorer ? (
        <a
          title={value}
          className={styles.chainValue}
          href={`${explorer}/${kind}/${value}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${label} in explorer`}
        >
          {text}
        </a>
      ) : (
        <span title={value} className={styles.chainValue}>
          {text}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        className={styles.copyButton}
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => {
          if (!navigator.clipboard) {
            setCopy({ value, error: true });
            return;
          }
          void navigator.clipboard.writeText(value).then(
            () => setCopy({ value, error: false }),
            () => setCopy({ value, error: true }),
          );
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={16} label={copyLabel} />
      </Button>
      {failed && (
        <span className={styles.copyFallback} role="alert">
          Could not copy. {value}
        </span>
      )}
    </div>
  );
}
