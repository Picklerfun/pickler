"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@pickler/ui";
import type { Agent } from "../api";
import { newAgentLock } from "../create/gate";
import { menuAccess } from "./access";
import type { SectionKey } from "../sections/keys";
import styles from "./home.module.css";

interface Item {
  key: SectionKey;
  label: string;
  note: string;
}

/**
 * The home's Menu: "+ New agent" behind its lock (one unfunded agent at a time, as the API decided
 * it), then every studio section the rail reaches, grouped as the canvas groups them, and the
 * person's other agents when there is more than one.
 *
 * With no agent yet the Menu still opens, so a person can see everything an agent gets before
 * making one: "+ New agent" is open (the lock needs an agent to fund) and each section is listed
 * but disabled, with the "Pickler Studio Empty" canvas's hint.
 */
export function HomeMenu({
  agent,
  agents,
  calls,
  running,
  canManage,
  researchLock = "",
  onSection,
  onSwitch,
}: {
  agent: Agent | null;
  agents: Agent[];
  calls: number;
  running: boolean;
  canManage: boolean;
  /** Why this workspace cannot create agents at all (research not enabled), or "". */
  researchLock?: string;
  onSection(key: SectionKey): void;
  onSwitch(agentId: string): void;
}) {
  const [open, setOpen] = useState(false);
  /* The lock is the workspace's, not the selected agent's: a selected draft is never the one to
     fund. Funding only, because "+ New agent" leads to /studio/new, which creates no draft. */
  const access = menuAccess({
    hasAgent: agent !== null,
    canManage,
    researchLock,
    fundLock: newAgentLock(agents),
    draftLock: "",
  });
  const plugins = agent?.config.plugins?.enabled.length ?? 0;
  const groups: { title: string; items: Item[] }[] = [
    {
      title: "RUN",
      items: [
        { key: "overview", label: "Overview", note: "" },
        { key: "context", label: "Context", note: "" },
        { key: "picks", label: "Picks", note: calls ? String(calls) : "" },
        { key: "activity", label: "Activity", note: running ? "RUNNING" : "" },
      ],
    },
    {
      title: "BUILD",
      items: [
        { key: "brief", label: "Brief", note: "" },
        { key: "skills", label: "Skills", note: plugins ? `${plugins} PLUGINS` : "" },
        { key: "sources", label: "Sources", note: "" },
        { key: "limits", label: "Limits & funding", note: "" },
        { key: "identity", label: "Identity & voice", note: "" },
      ],
    },
    {
      title: "GROW",
      items: [
        { key: "profile", label: "Public page", note: "" },
        { key: "audience", label: "Audience", note: "" },
        { key: "token", label: "Token", note: "OPTIONAL" },
        { key: "board", label: "The board", note: "" },
      ],
    },
  ];
  const others = agent
    ? agents.filter((other) => (other.productId ?? other.id) !== (agent.productId ?? agent.id))
    : [];

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const away = () => setOpen(false);
    window.addEventListener("keydown", close);
    window.addEventListener("click", away);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("click", away);
    };
  }, [open]);

  return (
    <div className={styles.menuWrap} id="home-menu" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls="home-menu-panel"
        data-open={open}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.burger} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        Menu
      </button>
      {open && (
        <div className={styles.menu} id="home-menu-panel">
          {access.create ? (
            <Link href="/studio/new" className={styles.newAgent}>
              + New agent
            </Link>
          ) : (
            <div className={styles.newAgentLocked} title={access.createNote} aria-disabled="true">
              <span className={styles.newAgentLabel}>+ New agent</span>
              <span className={styles.newAgentNote}>{access.createNote}</span>
            </div>
          )}
          {!access.sections && (
            <p className={styles.menuHint}>
              Every section opens {access.sectionNote.toLowerCase()}.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.title} className={styles.menuGroup}>
              <p className={styles.menuTitle}>{group.title}</p>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={styles.menuItem}
                  disabled={!access.sections}
                  title={access.sectionNote || undefined}
                  onClick={() => {
                    setOpen(false);
                    onSection(item.key);
                  }}
                >
                  <span className={styles.grow}>{item.label}</span>
                  {access.sections && item.note && (
                    <span className={styles.menuNote}>{item.note}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {others.length > 0 && (
            <div className={styles.menuGroup}>
              <p className={styles.menuTitle}>YOUR AGENTS</p>
              {others.map((other) => {
                const id = other.productId ?? other.id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setOpen(false);
                      onSwitch(id);
                    }}
                  >
                    <Icon name="target" size={14} />
                    <span className={styles.grow}>{other.name ?? id.slice(0, 8)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
