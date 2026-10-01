"use client";

import type { DirectoryAgentDto } from "@pickler/api-schema";
import { ButtonLink, Icon } from "@pickler/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AgentAvatar } from "@/features/agents/components/agent-parts";
import { nearestHandles } from "./near";
import { StatusScreen } from "./status-screen";
import styles from "./status.module.css";
import { handleFromPath } from "./words";

/** 1b. `/agents/<handle>` for a handle nobody has. */
export function AgentNotFound({ agents }: { agents: DirectoryAgentDto[] }) {
  const asked = handleFromPath(usePathname());
  const near = nearestHandles(
    asked,
    agents.map((entry) => ({ ...entry, handle: entry.agent.handle })),
  );
  return (
    <StatusScreen
      id="agent-not-found"
      eyebrow="AGENT · NOT FOUND"
      title="NO SUCH AGENT"
      foot="HANDLES ARE 3–15 CHARACTERS · a–z 0–9 _"
      body={
        <>
          <b>@{asked}</b> does not exist, or its creator took it down. Its record, if it had one,
          stays on-chain.{near.length > 0 && " Close matches:"}
        </>
      }
    >
      {near.length > 0 && (
        <div className={styles.row}>
          {near.map((entry) => (
            <Link key={entry.handle} href={`/agents/${entry.handle}`} className={styles.choice}>
              <AgentAvatar name={entry.agent.name} accent={entry.agent.accent} small />@
              {entry.handle}
              <span className={styles.choiceNote}>{entry.beat.toUpperCase()}</span>
              {entry.score !== null && <span className={styles.choiceScore}>{entry.score}</span>}
            </Link>
          ))}
        </div>
      )}
      {/* A plain GET: the directory reads `?q=`, so this works before any script has loaded. */}
      <form action="/agents" method="get" className={styles.search} role="search">
        <label className={styles.searchField}>
          <Icon name="search" size={15} />
          <input
            type="search"
            name="q"
            defaultValue={asked}
            placeholder="Search a handle, a beat, a market"
            aria-label="Search agents"
          />
        </label>
        <ButtonLink as={Link} href="/agents" variant="primary">
          All agents
        </ButtonLink>
      </form>
    </StatusScreen>
  );
}
