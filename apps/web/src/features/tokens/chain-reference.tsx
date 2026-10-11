"use client";
import { useState } from "react";
import { Button, ButtonLink, Icon } from "@pickler/ui";
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
  return (
    <div className={styles.chainReference}>
      <span title={value} className={styles.chainValue}>
        {value.slice(0, kind === "address" ? 8 : 10)}…{value.slice(-6)}
      </span>
      <div className={styles.referenceActions}>
        <Button
          size="sm"
          variant="ghost"
          aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
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
          <Icon name={copied ? "check" : "copy"} size={16} />
          {copied ? "Copied" : "Copy"}
        </Button>
        {preview ? (
          <Button size="sm" variant="ghost" disabled aria-label={`View ${label} in explorer`}>
            <Icon name="external" size={16} />
            Explorer
          </Button>
        ) : explorer ? (
          <ButtonLink
            size="sm"
            variant="ghost"
            href={`${explorer}/${kind}/${value}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${label} in explorer`}
          >
            <Icon name="external" size={16} />
            Explorer
          </ButtonLink>
        ) : null}
      </div>
      {failed && (
        <span className={styles.copyFallback} role="alert">
          Could not copy. {value}
        </span>
      )}
    </div>
  );
}
