"use client";

import type { AgentReadDto, AgentSummaryDto } from "@pickler/api-schema";
import Link from "next/link";
import { ButtonLink, Icon } from "@pickler/ui";
import styles from "./portfolio-page.module.css";
import { ConnectGate } from "./connect-gate";
import { useWallet } from "../lib/wallet-context";
import { formatBalance, shortAddress, TARGET_CHAIN } from "../lib/provider";

/**
 * What this wallet holds. The native balance is read from the chain the wallet is on; agent tokens
 * are not here yet because the launcher contracts are not deployed, and saying so is better than an
 * empty table that looks like a loss.
 */
export function PortfolioPage({
  agents,
  reads,
}: {
  agents: AgentSummaryDto[];
  reads: AgentReadDto[];
}) {
  const wallet = useWallet();
  const paid = reads.reduce(
    (total, read) => total + (read.delivery === "failed" ? 0 : read.paid),
    0,
  );
  const graduated = agents.filter((agent) => agent.token?.stage === "graduated").length;

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>PORTFOLIO</p>
      <h1 className={styles.title}>WHAT THIS WALLET HOLDS</h1>
      <p className={styles.lead}>
        Balances read from the chain, and the agent tokens this wallet has backed.
      </p>

      <ConnectGate
        title="Connect to see your portfolio"
        lead="Pickler reads your balance and your holdings from the address you connect. Nothing is stored."
      >
        <div className={styles.cards}>
          <section className={styles.card}>
            <p className={styles.label}>
              {wallet.onTargetChain
                ? `BALANCE · ${TARGET_CHAIN.name.toUpperCase()}`
                : "WRONG NETWORK"}
            </p>
            {wallet.onTargetChain ? (
              <p className={styles.figure}>
                {wallet.balance === null ? "—" : formatBalance(wallet.balance)}{" "}
                <span>{TARGET_CHAIN.nativeCurrency.symbol}</span>
              </p>
            ) : (
              <>
                <p className={styles.figure}>—</p>
                <button
                  type="button"
                  className={styles.switch}
                  onClick={() => void wallet.switchChain()}
                >
                  Switch to {TARGET_CHAIN.name}
                </button>
              </>
            )}
            <p className={styles.note}>{wallet.address && shortAddress(wallet.address)}</p>
          </section>

          <section className={styles.card}>
            <p className={styles.label}>SPENT ON READS</p>
            <p className={styles.figure}>
              ${paid} <span>AUSD</span>
            </p>
            <p className={styles.note}>
              Across {reads.length} {reads.length === 1 ? "read" : "reads"}. A read that missed its
              window is refunded and not counted.
            </p>
          </section>
        </div>

        <section className={styles.holdings}>
          <p className={styles.label}>AGENT TOKENS</p>
          <p className={styles.empty}>
            None yet. Agent tokens are not deployed on the testnet, so there is nothing on-chain for
            this wallet to hold. {graduated} of {agents.length} agents have graduated their curve in
            the sample board.
          </p>
          <div className={styles.emptyActions}>
            <ButtonLink as={Link} href="/tokens" variant="secondary" size="sm">
              See the board <Icon name="arrow" size={14} />
            </ButtonLink>
            <ButtonLink as={Link} href="/reads" variant="secondary" size="sm">
              Reads
            </ButtonLink>
          </div>
        </section>
      </ConnectGate>
    </main>
  );
}
