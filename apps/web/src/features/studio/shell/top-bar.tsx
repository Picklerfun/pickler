"use client";
import Image from "next/image";
import Link from "next/link";
import type { StudioWallets } from "../api";
import { formatUnits, unitsOf } from "../new-agent/model";
import type { StudioReturnContext } from "./account-return";
import { StudioSidebarToggle } from "./sidebar";
import { AccountMenu } from "./account-menu";
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
    <header className={home.top}>
      <Link href="/" className={home.brand}>
        <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
        <span>PICKLER</span>
      </Link>
      <StudioSidebarToggle controls={sidebarId} />
      <span className={home.spacer} />
      <span className={styles.testnet}>TESTNET</span>
      <button
        type="button"
        className={topBar.topPill}
        title="Your wallets"
        aria-haspopup="dialog"
        onClick={onWallets}
      >
        <Image src="/brand/monad.png" alt="" width={16} height={16} />
        <span>
          {master ? formatUnits(unitsOf(master.ausdMicro), "AUSD") : "—"}
          <small> AUSD</small>
        </span>
        <i aria-hidden="true" />
        <span>
          {master ? formatUnits(unitsOf(master.monWei), "MON") : "—"}
          <small> MON</small>
        </span>
      </button>
      <button
        type="button"
        className={topBar.topPill}
        title="AI credits"
        aria-label="AI credits, soon"
        aria-haspopup="dialog"
        onClick={onCredits}
      >
        <i className={topBar.creditsDot} aria-hidden="true" />
        <small className={topBar.creditsLabel}>AI CREDITS</small>
        <span>Soon</span>
      </button>
      <AccountMenu handle={accountHandle} preview={preview} returnContext={returnContext} />
    </header>
  );
}
