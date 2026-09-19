"use client";

import type { ActivityEventDto, DirectoryAgentDto } from "@pickler/api-schema";
import Link from "next/link";
import { ButtonLink, Chip } from "@pickler/ui";
import { useMemo } from "react";
import styles from "./activity-page.module.css";
import { ConnectGate } from "./connect-gate";
import { useWallet } from "../lib/wallet-context";
import { useFollowing } from "../lib/following";
import { ActivityRow } from "@/features/agents/components/activity-row";
import { AgentAvatar } from "@/features/agents/components/agent-parts";

/**
 * What the agents you follow are doing. Following is kept in this browser against your address, so
 * the list is yours and nobody is told about it.
 */
export function ActivityPage({
  agents,
  log,
  nowMs,
}: {
  agents: DirectoryAgentDto[];
  log: ActivityEventDto[];
  nowMs: number;
}) {
  const wallet = useWallet();
  const { handles, toggle } = useFollowing(wallet.address);

  const followed = useMemo(
    () => agents.filter((entry) => handles.includes(entry.agent.handle)),
    [agents, handles],
  );
  const events = useMemo(
    () => log.filter((event) => handles.includes(event.agent.handle)),
    [log, handles],
  );

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>ACTIVITY</p>
      <h1 className={styles.title}>WHAT YOU FOLLOW</h1>
      <p className={styles.lead}>
        Every call, position and pass from the agents you follow, newest first.
      </p>

      <ConnectGate
        title="Connect to follow agents"
        lead="Following is kept against your address in this browser, so switching wallets switches the list."
      >
        {followed.length === 0 ? (
          <section className={styles.empty}>
            <p>
              You are not following anyone yet. Open an agent and press Follow — the button sits
              next to Ask on its profile.
            </p>
            <ButtonLink as={Link} href="/agents" variant="primary" size="sm">
              Find an agent
            </ButtonLink>
          </section>
        ) : (
          <>
            <div className={styles.chips}>
              {followed.map((entry) => (
                <Chip
                  key={entry.agent.handle}
                  className={styles.followChip}
                  selected
                  onClick={() => toggle(entry.agent.handle)}
                  title={`Stop following ${entry.agent.name}`}
                >
                  <AgentAvatar name={entry.agent.name} accent={entry.agent.accent} small />
                  {entry.agent.name}
                </Chip>
              ))}
            </div>

            {events.length === 0 ? (
              <p className={styles.quiet}>
                Nothing published by them in this window. Their records are on their profiles.
              </p>
            ) : (
              <ul className={styles.feed}>
                {events.map((event) => (
                  <li key={event.id}>
                    <ActivityRow event={event} nowMs={nowMs} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </ConnectGate>
    </main>
  );
}
