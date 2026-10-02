"use client";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, Tag } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { HomeMenu } from "../home/menu";
import { RAIL } from "../sections/rail";
import shell from "../studio.module.css";
import home from "../home/home.module.css";
import { AvatarGrid } from "./identity";
import { formatUnits, type NewAgentForm } from "./model";
import styles from "./new-agent.module.css";

/**
 * The create screen's frame, as the empty home drew it: the top bar (the new agent's chip once it
 * has a name, TESTNET, the master wallet's AUSD | MON, which opens "Your wallets", the Menu below
 * the rail's width, the account) and the studio rail with
 * every section disabled until an agent exists. The screen itself is `children`; its sheets and
 * modals are `overlays`, outside the main area's flow.
 */
export function Chrome({
  form,
  handle,
  hasAgents,
  canManage,
  researchLock,
  sectionNote,
  master,
  onWallets,
  onCredits,
  children,
  overlays,
}: {
  form: NewAgentForm;
  handle: string;
  hasAgents: boolean;
  canManage: boolean;
  researchLock: string;
  /** Why the rail's sections are shut. */
  sectionNote: string;
  /** The master wallet's balances in base units, once the wallets are read. */
  master: { ausdMicro: bigint | null; monWei: bigint | null } | null;
  onWallets(): void;
  onCredits(): void;
  children: ReactNode;
  overlays: ReactNode;
}) {
  const name = form.name.trim();
  return (
    <main className={home.home} id="home-empty" data-surface="dark">
      <header className={home.top}>
        <Link href="/" className={home.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
          <span>PICKLER</span>
        </Link>
        {name ? (
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
          <button
            type="button"
            className={styles.topPill}
            title="Your wallets"
            aria-haspopup="dialog"
            onClick={onWallets}
          >
            <Image src="/brand/monad.png" alt="" width={16} height={16} />
            <span>
              {formatUnits(master.ausdMicro, "AUSD")}
              <small> AUSD</small>
            </span>
            <i aria-hidden="true" />
            <span>
              {formatUnits(master.monWei, "MON")}
              <small> MON</small>
            </span>
          </button>
        )}
        <button
          type="button"
          className={styles.topPill}
          title="AI credits"
          aria-haspopup="dialog"
          onClick={onCredits}
        >
          <i className={styles.creditsDot} aria-hidden="true" />
          <small>AI CREDITS</small>
          <span>Soon</span>
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
        <Link href="/account" className={home.account} aria-label="Account">
          <span className={shell.swatch} aria-hidden="true">
            <i data-swatch="lime" />
            <i data-swatch="violet" />
            <i data-swatch="amber" />
            <i data-swatch="blue" />
          </span>
        </Link>
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
