"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@pickler/ui";
import { accentVars } from "@/lib/accent";
import { useNow } from "@/lib/now";
import type { Agent } from "../api";
import { menuAccess } from "../home/access";
import { CreditsModal } from "../new-agent/credits-modal";
import { formatUnits, patternCells, unitsOf } from "../new-agent/model";
import { WalletsModal } from "../new-agent/wallets-modal";
import { Brief } from "./brief";
import { Console } from "./console";
import type { DraftStaged } from "./fixture";
import { Identity } from "./identity";
import { Limits } from "./limits";
import { Locked } from "./locked";
import { Master } from "./master";
import {
  draftRail,
  headerTiles,
  isLockedSection,
  sectionLabel,
  type DraftSectionKey,
} from "./model";
import { Overview } from "./overview";
import type { DraftSectionProps } from "./section";
import { Sources } from "./sources";
import { TradeSoon } from "./trade-soon";
import { Trades } from "./trades";
import { PREVIEW_NOTE, useDraft } from "./use-draft";
import shell from "../studio.module.css";
import home from "../home/home.module.css";
import topBar from "../new-agent/new-agent.module.css";
import styles from "./draft.module.css";

/** The agent's avatar: its accent and one of the six patterns, as its profile holds them. */
export function DraftAvatar({
  accent,
  pattern,
  size,
}: {
  accent: Agent["accent"];
  pattern: number;
  size: "chip" | "head" | "large";
}) {
  return (
    <span className={styles.avatar} data-size={size} style={accentVars(accent)} aria-hidden="true">
      <span className={styles.avatarCells}>
        {patternCells(pattern).map((on, index) => (
          <span key={index} className={styles.avatarCell} data-on={on} />
        ))}
      </span>
    </span>
  );
}

/**
 * The header line's first part (canvas `headerSub`): the agent's handle, or on the YOU sections the
 * account's ("YOU · @nightowl"), just "YOU" until the account is read.
 */
const headerWho = (you: boolean, handle: string | undefined, account: string | null): string => {
  if (you) {
    return account ? `YOU · @${account}` : "YOU";
  }
  return handle ? `@${handle}` : "NO HANDLE";
};

type Modal = null | { kind: "wallets"; toAgent: boolean | null } | { kind: "credits" };

/**
 * A private agent's studio (studio-draft-dashboard-v1 D1), the "Pickler Studio Draft" canvas's
 * created phase: the top bar (the agent and its switcher, DRAFT · PRIVATE, TESTNET, the master
 * wallet's AUSD | MON opening "Your wallets", AI credits, the account), the rail of RUN / BUILD /
 * GROW / YOU with the locked sections (D2), the header with the five tiles (D15), and the section.
 *
 * The data and writes are `use-draft.ts`'s; each section is its own file and takes
 * `DraftSectionProps`. With `staged` (`?stage=draft*`) the studio is the fixture's and touches no
 * API. Once Go Public lands the shell reloads the agent, which is no longer a draft, and the studio
 * opens the live one in its place, on its home (`onPublished`).
 */
export function DraftStudio({
  agent,
  agents,
  canManage,
  newAgentLock,
  staged,
  preview,
  initialSection,
  accountHandle,
  onRefreshAgent,
  onPublished,
  onSwitch,
  onNew,
}: {
  agent: Agent;
  agents: Agent[];
  canManage: boolean;
  /** Why "+ New agent" is shut (`home/gate.ts`'s `newAgentLock`), or "". */
  newAgentLock: string;
  /** The `?stage=draft*` fixture, or null. */
  staged: DraftStaged | null;
  /** A preview studio (no authentication here): nothing is read or written. */
  preview: boolean;
  initialSection?: DraftSectionKey | undefined;
  /** The signed-in account's handle, which the YOU sections' header line names; null unread. */
  accountHandle: string | null;
  onRefreshAgent(): Promise<void>;
  /** Go Public landed: the live studio that replaces this one opens on its home (D1). */
  onPublished(): void;
  onSwitch(agentId: string): void;
  /** "+ New agent": open the create screen. */
  onNew(): void;
}) {
  const [section, setSection] = useState<DraftSectionKey>(
    staged?.section ?? initialSection ?? "overview",
  );
  const [modal, setModal] = useState<Modal>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const wallClock = useNow();
  const now = staged ? staged.now : wallClock;
  const draft = useDraft({ agent, staged, preview, onRefreshAgent, onPublished });
  /* "Back to Overview" unmounts the button it was on, so focus moves to the rail's Overview. */
  const focusRail = useRef(false);

  const name = agent.name ?? "Your agent";
  const agentId = agent.productId ?? agent.id;
  const master = draft.wallets?.master ?? null;
  const access = menuAccess({
    hasAgent: true,
    canManage,
    researchLock: "",
    fundLock: newAgentLock,
    draftLock: "",
  });
  const you = section === "trade" || section === "master";

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

  /* The current rail item stays in view on the phone's scrolling row (a deep link to Master wallet
     starts past the edge), and takes focus when the locked panel's way back unmounted it. */
  useEffect(() => {
    const item = document.getElementById(`draft-rail-${section}`);
    item?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    if (focusRail.current) {
      focusRail.current = false;
      item?.focus();
    }
  }, [section]);

  /** Open "Your wallets", reading them again; with a direction, on this agent's move form. */
  function openWallets(toAgent: boolean | null) {
    setModal({ kind: "wallets", toAgent });
    void draft.readWallets();
  }

  const props: DraftSectionProps = {
    agent,
    draft,
    canManage,
    now,
    onSection: setSection,
    onWallets: openWallets,
    onCredits: () => setModal({ kind: "credits" }),
  };

  function body() {
    if (isLockedSection(section)) {
      return (
        <Locked
          section={section}
          onBack={() => {
            focusRail.current = true;
            setSection("overview");
          }}
        />
      );
    }
    switch (section) {
      case "overview":
        return <Overview {...props} goPublic={staged?.goPublic ?? null} />;
      case "console":
        return <Console {...props} />;
      case "picks":
        return <Trades {...props} />;
      case "brief":
        return <Brief {...props} />;
      case "skills":
        return <Sources {...props} />;
      case "limits":
        return <Limits {...props} />;
      case "identity":
        return <Identity {...props} />;
      case "trade":
        return <TradeSoon {...props} />;
      case "master":
        return <Master {...props} />;
      default:
        return null;
    }
  }

  return (
    <main className={styles.studio} id="draft-studio" data-surface="dark">
      <header className={home.top}>
        <Link href="/" className={home.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
          <span>PICKLER</span>
        </Link>
        <div className={styles.chipWrap} onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={styles.chipButton}
            id="draft-agent-chip"
            aria-expanded={menuOpen}
            aria-controls="draft-agent-menu"
            aria-label={`${name}, switch agent`}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <DraftAvatar accent={agent.accent} pattern={agent.avatarPattern} size="chip" />
            <b>{name}</b>
            {agent.handle && <small>@{agent.handle}</small>}
            <Icon name="chevronDown" size={13} />
          </button>
          {menuOpen && (
            <div className={styles.chipMenu} id="draft-agent-menu">
              {access.create ? (
                <button
                  type="button"
                  className={home.newAgent}
                  onClick={() => {
                    setMenuOpen(false);
                    onNew();
                  }}
                >
                  + New agent
                </button>
              ) : (
                <div className={home.newAgentLocked} title={access.createNote} aria-disabled="true">
                  <span className={home.newAgentLabel}>+ New agent</span>
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
                      <DraftAvatar
                        accent={other.accent}
                        pattern={other.avatarPattern}
                        size="chip"
                      />
                      <span className={home.grow}>{other.name ?? id.slice(0, 8)}</span>
                      {other.draft && <span className={home.menuNote}>DRAFT</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <span className={styles.status} id="draft-status">
          <span className={styles.statusDot} />
          DRAFT · PRIVATE
        </span>
        <span className={home.spacer} />
        <span className={styles.testnet}>TESTNET</span>
        <button
          type="button"
          className={topBar.topPill}
          title="Your wallets"
          aria-haspopup="dialog"
          onClick={() => openWallets(null)}
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
          onClick={() => setModal({ kind: "credits" })}
        >
          <i className={topBar.creditsDot} aria-hidden="true" />
          <small className={topBar.creditsLabel}>AI CREDITS</small>
          <span>Soon</span>
        </button>
        <Link href="/account" className={home.account} aria-label="Account">
          <span className={shell.swatch} aria-hidden="true">
            <i data-swatch="lime" />
            <i data-swatch="violet" />
            <i data-swatch="amber" />
            <i data-swatch="blue" />
          </span>
        </Link>
      </header>

      <div className={styles.body}>
        <nav className={styles.rail} aria-label="Agent sections">
          {draftRail(section).map((group) => (
            <div key={group.title} className={styles.railGroup}>
              <p className={styles.railTitle}>{group.title}</p>
              <div className={styles.railItems}>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={styles.railItem}
                    id={`draft-rail-${item.key}`}
                    aria-current={item.on ? "page" : undefined}
                    aria-disabled={item.locked || undefined}
                    title={item.locked ? undefined : item.title}
                    onClick={() => setSection(item.key)}
                  >
                    <Icon name={item.icon} size={17} />
                    <span className={styles.railLabel}>{item.label}</span>
                    {item.locked && (
                      <>
                        <span className={styles.railLock} aria-hidden="true">
                          <Icon name="lock" size={12} />
                        </span>
                        <span className={styles.srOnly}> · {item.title}</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={styles.main}>
          <div className={styles.column}>
            {draft.preview && (
              <p className={styles.note} role="status">
                <Icon name="alert" size={13} />
                {PREVIEW_NOTE}
              </p>
            )}
            <div className={styles.header}>
              <DraftAvatar accent={agent.accent} pattern={agent.avatarPattern} size="head" />
              <div className={styles.headText}>
                <h1 className={styles.name}>{name}</h1>
                <p className={styles.sub}>
                  <span>{headerWho(you, agent.handle, accountHandle)}</span>
                  <span className={styles.subDot} aria-hidden="true">
                    ·
                  </span>
                  <span>{sectionLabel(section)}</span>
                </p>
              </div>
              <span className={styles.status}>
                <span className={styles.statusDot} />
                DRAFT · PRIVATE
              </span>
            </div>
            <ul className={styles.tiles} aria-label="Your money">
              {headerTiles(draft.wallets).map((tile) => (
                <li key={tile.label} className={styles.tile} data-soon={tile.soon}>
                  <span className={styles.tileValue}>{tile.value}</span>
                  <span className={styles.tileLabel}>{tile.label}</span>
                </li>
              ))}
            </ul>
            {draft.error && (
              <p className={styles.alert} role="alert">
                <Icon name="alert" size={13} />
                {draft.error}
              </p>
            )}
            {body()}
          </div>
        </div>
      </div>

      <WalletsModal
        open={modal?.kind === "wallets"}
        wallets={draft.wallets}
        openOn={
          modal?.kind === "wallets" && modal.toAgent !== null
            ? (agent.wallet?.walletId ?? null)
            : null
        }
        openToAgent={modal?.kind === "wallets" ? (modal.toAgent ?? true) : true}
        draft={null}
        preview={draft.preview}
        onClose={() => setModal(null)}
        onCredits={() => setModal({ kind: "credits" })}
        onMoved={() => {
          /* The wallets say what moved; the agent's own balance follows on its next read, so a
             failed reload here is not worth a second alert over the modal. */
          void draft.refresh();
          void onRefreshAgent().catch(() => undefined);
        }}
      />
      <CreditsModal
        open={modal?.kind === "credits"}
        onClose={() => setModal(null)}
        onWallets={() => openWallets(null)}
      />
    </main>
  );
}
