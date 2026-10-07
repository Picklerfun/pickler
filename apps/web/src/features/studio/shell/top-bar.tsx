"use client";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@pickler/ui";
import type { StudioWallets } from "../api";
import { unitsOf } from "../new-agent/model";
import type { StudioReturnContext } from "./account-return";
import { StudioSidebarToggle } from "./sidebar";
import { AccountMenu } from "./account-menu";
import { WalletBalanceButton } from "./wallet-balance-button";
import home from "../home/home.module.css";
import topBar from "../new-agent/new-agent.module.css";
import styles from "./shell.module.css";

export interface StudioTopBarProps {
  /** The master wallet as `GET /wallets` read it; null draws dashes. */
  master: StudioWallets["master"] | null;
  /** The master AUSD | MON button: open "Your wallets". */
  onWallets(): void;
  /** The AI credits pill: open the credits modal. */
  onCredits(): void;
  sidebarId: string;
  accountHandle: string | null;
  preview: boolean;
  returnContext?: StudioReturnContext;
}

/** Global account and balance controls; workspace selection belongs to the sidebar. */
export function StudioTopBar({
  master,
  sidebarId,
  onWallets,
  onCredits,
  accountHandle,
  preview,
  returnContext,
}: StudioTopBarProps) {
  return (
    <header className={styles.top} data-agent-navbar>
      <Link href="/" className={home.brand}>
        <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
        <span>PICKLER</span>
      </Link>
      <StudioSidebarToggle controls={sidebarId} />
      <span className={home.spacer} data-navbar-spacer />
      <span className={styles.testnet} title="Monad testnet" aria-label="Monad testnet">
        <span className={styles.networkLabel}>TESTNET</span>
        <span className={styles.networkDot} aria-hidden="true" />
      </span>
      <div className={styles.globalControls}>
        <WalletBalanceButton
          ausdMicro={unitsOf(master?.ausdMicro ?? null)}
          monWei={unitsOf(master?.monWei ?? null)}
          onClick={onWallets}
        />
        <button
          type="button"
          className={topBar.topPill}
          data-credits-control
          title="AI credits"
          aria-label="AI credits, soon"
          aria-haspopup="dialog"
          onClick={onCredits}
        >
          <span className={topBar.navReveal}>
            <span className={topBar.navDetails}>
              <i className={topBar.creditsDot} aria-hidden="true" />
              <small className={topBar.creditsLabel}>AI CREDITS</small>
              <span className={topBar.creditsStatus}>Soon</span>
            </span>
          </span>
          <span className={topBar.creditsIcon}>
            <Icon name="coin" size={18} />
          </span>
        </button>
        <AccountMenu handle={accountHandle} preview={preview} returnContext={returnContext} />
      </div>
    </header>
  );
}
