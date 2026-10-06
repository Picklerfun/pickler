"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@pickler/ui";
import type { Agent } from "../api";
import { menuAccess } from "../home/access";
import { AgentAvatar } from "./agent-avatar";
import type { StudioIdPrefix } from "./model";
import home from "../home/home.module.css";
import styles from "./shell.module.css";

/** Workspace selection lives above the agent's navigation, outside its mobile scroller. */
export function AgentSelector({
  idPrefix,
  agent,
  agents,
  canManage,
  newAgentLock,
  newAgentLabel = "+ New agent",
  status,
  onSwitch,
  onNew,
}: {
  idPrefix: StudioIdPrefix;
  agent: Agent;
  agents: Agent[];
  canManage: boolean;
  newAgentLock: string;
  newAgentLabel?: string | undefined;
  status: ReactNode;
  onSwitch(agentId: string): void;
  onNew(): void;
}) {
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

  return (
    <div className={styles.agentSelector}>
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
          <span className={styles.selectorIdentity}>
            <b>{name}</b>
            {agent.handle && <small>@{agent.handle}</small>}
          </span>
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
      <div className={styles.selectorStatus}>{status}</div>
    </div>
  );
}
