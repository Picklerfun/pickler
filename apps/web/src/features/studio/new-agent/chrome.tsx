"use client";
import { WalletBalanceButton } from "../shell/wallet-balance-button";
import Image from "next/image";
import { AccountMenu } from "../shell/account-menu";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, Icon, Tag } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { HomeMenu } from "../home/menu";
import { RAIL } from "../sections/rail";
import shell from "../studio.module.css";
import home from "../home/home.module.css";
import { AvatarGrid } from "./identity";
import { type NewAgentForm } from "./model";
import styles from "./new-agent.module.css";

/**
 * The create screen's frame, as the empty home drew it: the top bar (the new agent's chip once it
 * has a name, or "Back to {agent}" for someone who opened it from "+ New agent", TESTNET, the
 * master wallet's AUSD | MON, which opens "Your wallets", the Menu below the rail's width, the
 * account) and the studio rail with every section disabled until an agent exists. The screen
 * itself is `children`; its sheets and modals are `overlays`, outside the main area's flow.
 *
 * `#new-agent` is the screen's root on every stage; `data-staged="false"` only where no fixture
 * drew it (the real screen, and `?stage=empty`), so the harness can tell that one apart.
 */
export function Chrome({
  form,
  accountHandle,
  preview,
  handle,
  hasAgents,
  canManage,
  researchLock,
  sectionNote,
  master,
  staged,
  back,
  onWallets,
  onCredits,
  children,
  overlays,
}: {
  form: NewAgentForm;
  accountHandle: string | null;
  preview: boolean;
  handle: string;
  hasAgents: boolean;
  canManage: boolean;
  researchLock: string;
  /** Why the rail's sections are shut. */
  sectionNote: string;
  /** The master wallet's balances in base units, once the wallets are read. */
  master: { ausdMicro: bigint | null; monWei: bigint | null } | null;
  /** A fixture drew the screen (`?stage=create-*`). */
  staged: boolean;
  /** The way back to the agent the person came from, or null on a first visit. */
  back: { to: string; disabled: boolean; onBack(): void } | null;
  onWallets(): void;
  onCredits(): void;
  children: ReactNode;
  overlays: ReactNode;
}) {
  const name = form.name.trim();
  return (
    <main className={home.home} id="new-agent" data-staged={staged} data-surface="dark">
      <header className={home.top}>
        <Link href="/" className={home.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
          <span>PICKLER</span>
        </Link>
        {back ? (
          <Button
            variant="ghost"
            size="sm"
            id="new-agent-back"
            disabled={back.disabled}
            onClick={back.onBack}
          >
            <Icon name="arrowLeft" size={14} />
            Back to {back.to}
          </Button>
        ) : name ? (
          <span className={home.agentChip}>
            <span className={styles.chipAvatar} style={accentVars(form.accent)} aria-hidden="true">
              <AvatarGrid pattern={form.pattern} small />
            </span>
            <b>{name}</b>
            {handle && <small>@{handle}</small>}
          </span>
        ) : (
          <span className={home.noAgent}>
            <span className={home.noAgentMark} aria-hidden="true">
              +
            </span>
            <b>{hasAgents ? "New agent" : "No agent yet"}</b>
          </span>
        )}
        <span className={home.spacer} />
        <span className={home.pill} data-tint="grey">
          TESTNET
        </span>
        {master && (
          <WalletBalanceButton
            ausdMicro={master.ausdMicro}
            monWei={master.monWei}
            onClick={onWallets}
          />
        )}
        <button
          type="button"
          className={styles.topPill}
          data-credits-control
          title="AI credits"
          aria-label="AI credits, soon"
          aria-haspopup="dialog"
          onClick={onCredits}
        >
          <span className={styles.navReveal}>
            <span className={styles.navDetails}>
              <i className={styles.creditsDot} aria-hidden="true" />
              <small className={styles.creditsLabel}>AI CREDITS</small>
              <span className={styles.creditsStatus}>Soon</span>
            </span>
          </span>
          <span className={styles.creditsIcon}>
            <Icon name="coin" size={18} />
          </span>
        </button>
        <span className={home.emptyMenu}>
          <HomeMenu
            agent={null}
            agents={[]}
            calls={0}
            running={false}
            canManage={canManage}
            researchLock={researchLock}
            onSection={noSection}
            onSwitch={noSection}
            onNew={noSection}
          />
        </span>
        <AccountMenu handle={accountHandle} preview={preview} returnContext={{ section: "new" }} />
      </header>

      <div className={home.emptyBody}>
        <nav className={home.emptyRail} aria-label="Studio sections">
          {/* The same sections the shell's rail draws, every row disabled until an agent exists. */}
          {RAIL.map((group) => (
            <div key={group.title}>
              <p className={shell.railTitle}>{group.title}</p>
              <div className={shell.railItems}>
                {group.items.map((item) => (
                  <span
                    key={item.key}
                    className={home.emptyRailItem}
                    title={sectionNote}
                    aria-disabled="true"
                  >
                    <Icon name={item.icon} size={17} />
                    <span className={shell.railLabel}>{item.label}</span>
                    {item.soon && <Tag className={home.soon}>SOON</Tag>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className={home.emptyMain}>{children}</div>
      </div>
      {overlays}
    </main>
  );
}

/* Every section and every switch needs an agent; the Menu disables them, so nothing calls these.
   "+ New agent" is this screen already. */
function noSection(): void {}
