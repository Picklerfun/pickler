"use client";
import Image from "next/image";
import type { ReactElement } from "react";
import { Ledger, MasterCard } from "../shell/master";
import { useCopied } from "../shell/use-copied";
import { limitsWallet } from "./build-model";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { liveAllocation } from "./market-model";
import { liveWalletRead, walletCards } from "./model";
import styles from "./market.module.css";

/**
 * Wallets (canvas 749–790, spec L20). Master, the shell's card (`MasterCard`) as the live canvas
 * words it: "YOURS · MASTER · @{account}", the allocation of this agent's wallet and AI credits
 * (Soon), "Fund {name}" (the Wallets modal toward the agent) and "Deposit · copy address". Its
 * agent's wallet: NO WITHDRAWALS, the address and Copy, AUSD · FREE, AUSD · IN POSITIONS (0),
 * MON · GAS, who moves money, "Pull free AUSD back" (the Wallets modal back to master) and
 * "Caps & limits" (→ Limits). Then the shell's ledger, read the first time this section opens.
 */
export const Wallets: (props: LiveSectionProps) => ReactElement = ({
  agent,
  live,
  canManage,
  now,
  accountHandle,
  onWallets,
  onSection,
}) => {
  const cards = walletCards(live.wallets, agent, accountHandle);

  return (
    <LiveSection section="master">
      <div className={styles.stack}>
        <div className={styles.grid}>
          <MasterCard
            idPrefix="live"
            agent={agent}
            wallets={live.wallets}
            canManage={canManage}
            accountHandle={accountHandle}
            label={cards.master.title}
            allocation={liveAllocation(live.wallets, agent)}
            fundLabel={cards.master.fund}
            onFund={() => onWallets(agent.wallet ? true : null)}
            deposit={{ label: cards.master.deposit, copied: cards.master.copied }}
          />
          <AgentWallet
            card={cards.agent}
            canPull={limitsWallet(liveWalletRead(agent.wallet, live.wallets)).canPull}
            canManage={canManage}
            onPull={() => onWallets(false)}
            onLimits={() => onSection("limits")}
          />
        </div>
        <Ledger idPrefix="live" agent={agent} studio={live} now={now} />
      </div>
    </LiveSection>
  );
};

function AgentWallet({
  card,
  canPull,
  canManage,
  onPull,
  onLimits,
}: {
  card: ReturnType<typeof walletCards>["agent"];
  canPull: boolean;
  canManage: boolean;
  onPull(): void;
  onLimits(): void;
}) {
  const [copied, copy] = useCopied();

  if (!card) {
    return (
      <div className={styles.card} id="live-wallets-agent">
        <div className={styles.cardHead}>
          <h3 className={styles.cardLabel}>ITS WALLET</h3>
        </div>
        <p className={styles.cardNote}>This agent has no wallet of its own.</p>
      </div>
    );
  }

  return (
    <div className={styles.card} id="live-wallets-agent">
      <div className={styles.cardHead}>
        <h3 className={styles.cardLabel}>{card.title}</h3>
        <span className={styles.headTag}>{card.tag}</span>
      </div>
      <div className={styles.address}>
        <Image className={styles.walletMark} src="/brand/monad.png" alt="" width={22} height={22} />
        <span className={styles.addressText} title={card.address}>
          {card.short}
        </span>
        <button
          type="button"
          className={styles.copyChip}
          aria-label={copied ? "Address copied" : "Copy its address"}
          onClick={() => copy(card.address)}
        >
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <div className={styles.balances} data-count="3">
        <span className={styles.balance}>
          <span className={styles.balanceValue}>{card.ausdFree}</span>
          <span className={styles.balanceLabel}>AUSD · FREE</span>
        </span>
        <span className={styles.balance}>
          <span className={styles.balanceValue}>{card.inPositions}</span>
          <span className={styles.balanceLabel}>AUSD · IN POSITIONS</span>
        </span>
        <span className={styles.balance}>
          <span className={styles.balanceValue}>{card.mon}</span>
          <span className={styles.balanceLabel}>MON · GAS</span>
        </span>
      </div>
      <p className={styles.cardNote}>{card.note}</p>
      <div className={styles.pair}>
        <button
          type="button"
          className={styles.whiteButton}
          disabled={!canManage || !canPull}
          title={canPull ? undefined : "No free AUSD to pull back"}
          onClick={onPull}
        >
          {card.pull}
        </button>
        <button type="button" className={styles.darkButton} onClick={onLimits}>
          {card.limits}
        </button>
      </div>
    </div>
  );
}
