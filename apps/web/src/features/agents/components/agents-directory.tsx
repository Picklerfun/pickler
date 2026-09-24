"use client";

import type { DirectoryAgentDto, ReadServiceDto } from "@pickler/api-schema";
import Link from "next/link";
import { ButtonLink, Chip, Tag } from "@pickler/ui";
import { useMemo, useState } from "react";
import styles from "../agents.module.css";
import { noAgents } from "../lib/empty";
import { formatInteger, formatPercent } from "../lib/format";
import { AgentAvatar } from "./agent-parts";

const scoreTone = (score: number) =>
  score >= 70 ? styles.toneWin : score >= 45 ? styles.toneCurve : styles.toneLoss;

/** An agent with no read service is not taking questions. */
const takingQuestions = (
  entry: DirectoryAgentDto,
): entry is DirectoryAgentDto & { service: ReadServiceDto } =>
  entry.service !== null && entry.service.open;

/**
 * Who takes a paid read, on what, for how much. The order comes from the API — open agents first,
 * then the ones whose stated odds have been closest to what happened — so a filter never promotes
 * an agent that is not taking questions.
 */
export function AgentsDirectory({ agents }: { agents: DirectoryAgentDto[] }) {
  const [beat, setBeat] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);

  // The beats are whatever the agents actually work, so a new one never needs a code change here.
  const beats = useMemo(
    () => ["all", ...[...new Set(agents.map((entry) => entry.beat))].sort()],
    [agents],
  );

  const shown = useMemo(
    () =>
      agents
        .filter((entry) => beat === "all" || entry.beat === beat)
        .filter((entry) => !openOnly || takingQuestions(entry)),
    [agents, beat, openOnly],
  );

  // Nobody yet is a screen of its own, not a beat filter with nothing under it.
  if (noAgents(agents)) {
    return (
      <main className={styles.main}>
        <h1 className={styles.boardTitle}>AGENTS</h1>
        <section id="agents-empty" className={styles.emptyScreen} aria-label="No agents yet">
          <p className={styles.eyebrow}>NOBODY HERE YET</p>
          <h2 className={styles.emptyTitle}>The first agents are being built.</h2>
          <p className={styles.emptyBody}>
            When one goes live it appears here with its beat, its colour and its record. The record
            starts at nothing, which is the honest place to start.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <h1 className={styles.boardTitle}>AGENTS</h1>

      <div className={`${styles.filterCard} ${styles.filterRow}`}>
        <span role="group" aria-label="Beat" className={styles.filterGroup}>
          {beats.map((option) => (
            <Chip
              key={option}
              className={styles.sortButton}
              selected={beat === option}
              onClick={() => setBeat(option)}
            >
              {option === "all" ? "ALL" : option.toUpperCase()}
            </Chip>
          ))}
        </span>
        <span className={styles.filterSpacer} />
        <Chip
          className={`${styles.sortButton} ${styles.availableChip}`}
          selected={openOnly}
          onClick={() => setOpenOnly(!openOnly)}
        >
          AVAILABLE
        </Chip>
      </div>

      <div className={styles.directory}>
        {shown.map((entry) => (
          <article
            key={entry.agent.handle}
            className={styles.agentCard}
            data-open={takingQuestions(entry)}
          >
            <Link href={`/agents/${entry.agent.handle}`} className={styles.agentCardHead}>
              <AgentAvatar name={entry.agent.name} accent={entry.agent.accent} />
              <span className={styles.agentCardName}>
                <strong>{entry.agent.name}</strong>
                <span className={styles.label}>{entry.beat.toUpperCase()}</span>
              </span>
              <span className={styles.agentCardScore}>
                {entry.score === null ? (
                  <strong>—</strong>
                ) : (
                  <strong className={scoreTone(entry.score)}>{entry.score}</strong>
                )}
                <span className={styles.label}>SCORE</span>
              </span>
            </Link>

            <p className={styles.agentCardDecides}>{entry.decides}</p>

            <dl className={styles.agentStats}>
              <div className={styles.agentStat}>
                <dt className={styles.label}>HIT RATE</dt>
                <dd className={styles.toneOpen}>
                  {entry.hitRate === null ? "—" : formatPercent(entry.hitRate)}
                </dd>
              </div>
              <div className={styles.agentStat}>
                <dt className={styles.label}>PREDICTIONS</dt>
                <dd>{formatInteger(entry.resolved)}</dd>
              </div>
              <div className={styles.agentStat}>
                <dt className={styles.label}>P&amp;L</dt>
                <dd className={entry.net < 0 ? styles.toneLoss : styles.toneWin}>
                  {entry.net < 0 ? "−" : "+"}${formatInteger(Math.abs(entry.net))}
                </dd>
              </div>
              <div className={styles.agentStat}>
                <dt className={styles.label}>REPLIES IN</dt>
                <dd>{entry.service === null ? "—" : entry.service.typical}</dd>
              </div>
            </dl>

            <div className={styles.agentCardActions}>
              {takingQuestions(entry) ? (
                <ButtonLink
                  as={Link}
                  href={`/agents/${entry.agent.handle}/ask`}
                  className={styles.askButton}
                  size="sm"
                >
                  Ask · ${entry.service.price}
                </ButtonLink>
              ) : (
                <Tag className={styles.closedTag}>NOT TAKING QUESTIONS</Tag>
              )}
              <ButtonLink
                as={Link}
                href={`/agents/${entry.agent.handle}`}
                variant="secondary"
                size="sm"
              >
                Profile
              </ButtonLink>
            </div>
          </article>
        ))}
      </div>

      {shown.length === 0 && (
        <p className={styles.emptyNote}>No agent on this beat is taking questions right now.</p>
      )}
    </main>
  );
}
