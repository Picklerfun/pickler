"use client";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import { Button, ButtonLink, Icon, Tag } from "@pickler/ui";
import type { AgentTokenDto } from "@pickler/api-schema";
import styles from "./token.module.css";
import { AgentAvatar } from "../studio/shell/agent-avatar";

/** Compact token identity shared by the owner and public profile. Never reads a provider. */
export function AgentTokenCard({
  token,
  preview = false,
  confirmationPending = false,
}: {
  token: AgentTokenDto | null;
  avatar?: ReactNode;
  preview?: boolean;
  confirmationPending?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (!token) {
    return (
      <section className={styles.card} data-token-state="empty" aria-label="Agent token">
        <div className={styles.head}>
          <Icon name="coin" />
          <h3>Token</h3>
          {preview && <Tag>PREVIEW</Tag>}
        </div>
        <p className={styles.quiet}>
          {confirmationPending ? "Token confirmation pending" : "No token launched yet"}
        </p>
      </section>
    );
  }
  const explorer =
    token.chainId === 10143 ? "https://testnet.monadexplorer.com" : "https://monadexplorer.com";
  return (
    <section className={styles.card} data-token-state="launched" aria-label="Agent token">
      <div className={styles.head}>
        {token.imageUri &&
        /^https:\/\/app\.pickler\.fun\/api\/v1\/token-assets\/[0-9a-f]{64}\.svg$/.test(
          token.imageUri,
        ) ? (
          <Image
            src={token.imageUri}
            alt={`${token.name} token`}
            width={48}
            height={48}
            unoptimized
          />
        ) : (
          <AgentAvatar accent={token.avatar.accent} pattern={token.avatar.pattern} size="head" />
        )}
        <div className={styles.identity}>
          <h3>{token.name}</h3>
          <span className={styles.quiet}>${token.ticker.replace(/^\$/, "")}</span>
        </div>
        <Tag>{token.chainId === 10143 ? "TESTNET" : "MAINNET"}</Tag>
      </div>
      <div className={styles.address}>
        <span title={token.address}>
          {token.address.slice(0, 8)}…{token.address.slice(-6)}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(token.address).then(
              () => {
                setCopied(true);
                setCopyError(false);
              },
              () => setCopyError(true),
            );
          }}
        >
          <Icon name="copy" />
          {copied ? "Copied" : "Copy address"}
        </Button>
      </div>
      <div className={styles.actions}>
        {preview ? (
          <Button size="sm" variant="secondary" disabled>
            Explorer
          </Button>
        ) : (
          <ButtonLink
            size="sm"
            variant="secondary"
            href={`${explorer}/address/${token.address}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Explorer
            <Icon name="external" />
          </ButtonLink>
        )}
      </div>
      {preview && <p className={styles.quiet}>Preview · simulated token, no transaction sent</p>}
      {copyError && (
        <p role="alert" className={styles.quiet}>
          Could not copy. Address: {token.address}
        </p>
      )}
    </section>
  );
}
