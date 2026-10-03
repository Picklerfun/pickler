"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@pickler/ui";
import type { Agent, StudioWallets } from "../api";
import { menuAccess } from "../home/access";
import { formatUnits, unitsOf } from "../new-agent/model";
import { AgentAvatar } from "./agent-avatar";
import type { StudioIdPrefix } from "./model";
import studio from "../studio.module.css";
import home from "../home/home.module.css";
import topBar from "../new-agent/new-agent.module.css";
import styles from "./shell.module.css";

export interface StudioTopBarProps {
  /** `draft` or `live`: the chip is `#<idPrefix>-agent-chip`, its menu `#<idPrefix>-agent-menu`. */
  idPrefix: StudioIdPrefix;
  agent: Agent;
  /** Every agent of the person, for the switcher. */
  agents: Agent[];
  canManage: boolean;
  /** Why "+ New agent" is shut (`home/gate.ts`'s `newAgentLock`), or "". */
  newAgentLock: string;
  /** The new-agent item's words: "+ New agent" by default, "Create another agent" in the live studio. */
  newAgentLabel?: string | undefined;
  /** The status chip (`StatusChip`), between the agent and the spacer. */
  status: ReactNode;
  /** The master wallet as `GET /wallets` read it; null draws dashes. */
  master: StudioWallets["master"] | null;
  /** The master AUSD | MON button: open "Your wallets". */
  onWallets(): void;
  /** The AI credits pill: open the credits modal. */
  onCredits(): void;
  onSwitch(agentId: string): void;
  /** "+ New agent": open the create screen. */
  onNew(): void;
  /**
   * The account button: the live studio opens its Account section (studio-live-v1 L3). Without it
   * the button links to `/account`, as the draft's does.
   */
  onAccount?: (() => void) | undefined;
}

/**
 * The studio's top bar, the same for a draft and a published agent (studio-live-v1 L2): the brand,
 * the agent and its switcher with "+ New agent" (or the studio's own words for it), the status chip, TESTNET, the master wallet's
 * AUSD | MON opening "Your wallets", AI credits, and the account.
 */
export function StudioTopBar({
  idPrefix,
  agent,
  agents,
  canManage,
  newAgentLock,
  newAgentLabel = "+ New agent",
  status,
  master,
  onWallets,
  onCredits,
  onSwitch,
  onNew,
  onAccount,
}: StudioTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const name = agent.name ?? "Your agent";
  const agentId = agent.productId ?? agent.id;
  const menuId = `${idPrefix}-agent-menu`;
  const access = menuAccess({
    hasAgent: true,
    canManage,
    researchLock: "",
    fundLock: newAgentLock,
    draftLock: "",
  });

  /* The switcher closes on Escape and on any click outside it, as the home's Menu does. */
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    const away = () => setMenuOpen(false);
    window.addEventListener("keydown", close);
    window.addEventListener("click", away);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("click", away);
    };
  }, [menuOpen]);

  const swatch = (
    <span className={studio.swatch} aria-hidden="true">
      <i data-swatch="lime" />
      <i data-swatch="violet" />
      <i data-swatch="amber" />
      <i data-swatch="blue" />
    </span>
  );

  return (
    <header className={home.top}>
      <Link href="/" className={home.brand}>
        <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
        <span>PICKLER</span>
      </Link>
      <div className={styles.chipWrap} onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={styles.chipButton}
          id={`${idPrefix}-agent-chip`}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={`${name}, switch agent`}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <AgentAvatar accent={agent.accent} pattern={agent.avatarPattern} size="chip" />
          <b>{name}</b>
          {agent.handle && <small>@{agent.handle}</small>}
          <Icon name="chevronDown" size={13} />
        </button>
        {menuOpen && (
          <div className={styles.chipMenu} id={menuId}>
            {access.create ? (
              <button
                type="button"
                className={home.newAgent}
                onClick={() => {
                  setMenuOpen(false);
                  onNew();
                }}
              >
                {newAgentLabel}
              </button>
            ) : (
              <div className={home.newAgentLocked} title={access.createNote} aria-disabled="true">
                <span className={home.newAgentLabel}>{newAgentLabel}</span>
                <span className={home.newAgentNote}>{access.createNote}</span>
              </div>
            )}
            <div className={home.menuGroup}>
              <p className={home.menuTitle}>YOUR AGENTS</p>
              {agents.map((other) => {
                const id = other.productId ?? other.id;
                const current = id === agentId;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`${home.menuItem} ${styles.menuAgent}`}
                    aria-current={current}
                    onClick={() => {
                      setMenuOpen(false);
                      if (!current) {
                        onSwitch(id);
                      }
                    }}
                  >
                    <AgentAvatar accent={other.accent} pattern={other.avatarPattern} size="chip" />
                    <span className={home.grow}>{other.name ?? id.slice(0, 8)}</span>
                    {other.draft && <span className={home.menuNote}>DRAFT</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {status}
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
      {onAccount ? (
        <button
          type="button"
          className={styles.accountButton}
          aria-label="Account"
          onClick={onAccount}
        >
          {swatch}
        </button>
      ) : (
        <Link href="/account" className={home.account} aria-label="Account">
          {swatch}
        </Link>
      )}
    </header>
  );
}
