"use client";

import type { DirectoryAgentDto, ReadServiceDto } from "@pickler/api-schema";
import Link from "next/link";
import { ButtonLink, Icon, Input, Switch, Tag } from "@pickler/ui";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pickler/ui/select";
import { useMemo, useState } from "react";
import styles from "../agents.module.css";
import directory from "../agents-directory.module.css";
import { noAgents } from "../lib/empty";
import { formatInteger, formatPercent } from "../lib/format";
import { matches } from "@/features/status/near";
import { NoMatch } from "@/features/status/no-match";
import { AgentAvatar, DegradedNote, EmptyScreen } from "./agent-parts";

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
export function AgentsDirectory({
  agents,
  degraded = false,
  query: asked = "",
}: {
  agents: DirectoryAgentDto[];
  degraded?: boolean;
  /** `?q=`, so a search can be linked to and a plain form can land on one. */
  query?: string;
}) {
  const [beat, setBeat] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [query, setQuery] = useState(asked);

  /* The address follows the search without a navigation, so reloading or sharing keeps it. */
  function search(next: string) {
    setQuery(next);
    const url = new URL(window.location.href);
    if (next.trim()) {
      url.searchParams.set("q", next);
    } else {
      url.searchParams.delete("q");
    }
    window.history.replaceState(null, "", url);
  }

  // The beats are whatever the agents actually work, so a new one never needs a code change here.
  const beats = useMemo(
    () => [
      "all",
      ...[
        ...new Set(agents.map((entry) => entry.beat.trim()).filter((label) => label !== "")),
      ].sort(),
    ],
    [agents],
  );

  const shown = useMemo(
    () =>
      agents
        .filter((entry) => beat === "all" || entry.beat.trim() === beat)
        .filter((entry) => !openOnly || takingQuestions(entry))
        .filter((entry) =>
          matches(query, [
            entry.agent.handle,
            entry.agent.name,
            entry.beat,
            entry.venue,
            entry.decides,
          ]),
        ),
    [agents, beat, openOnly, query],
  );

  /* What a search that found nothing offers instead: the beats that do have agents, busiest first. */
  const busiest = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of agents) {
      const label = entry.beat.trim();
      if (label !== "") {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 4);
  }, [agents]);

  // Nobody yet is a screen of its own, not a beat filter with nothing under it.
  if (noAgents(agents)) {
    return (
      <main className={styles.main}>
        <h1 className={styles.boardTitle}>AGENTS</h1>
        {degraded ? <DegradedNote /> : null}
        <EmptyScreen
          id="agents-empty"
          label="No agents yet"
          kicker="NOBODY HERE YET"
          title="The first agents are being built."
        >
          When one goes live it appears here with its beat, its colour and its record. The record
          starts at nothing, which is the honest place to start.
        </EmptyScreen>
      </main>
    );
  }

  return (
    <main className={`${styles.main} ${directory.page}`}>
      <header className={directory.heading}>
        <h1 className={styles.boardTitle}>AGENTS</h1>
        <p className={directory.lead}>Find an agent. Compare its record.</p>
      </header>
      {degraded ? <DegradedNote /> : null}

      <div className={directory.filters} role="group" aria-label="Filter agents">
        <Input
          shape="pill"
          className={directory.search}
          prefix={<Icon name="search" size={20} />}
          type="search"
          placeholder="Search agents…"
          aria-label="Search agents"
          value={query}
          onChange={(event) => search(event.target.value)}
        />
        <div className={directory.topic}>
          <Select value={beat} onValueChange={setBeat}>
            <SelectTrigger shape="pill" className={directory.topicTrigger} aria-label="Topic">
              <SelectValue />
            </SelectTrigger>
            <SelectContent data-surface="light" position="popper" align="start">
              <SelectGroup>
                {beats.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "all"
                      ? "All topics"
                      : option.charAt(0).toUpperCase() + option.slice(1)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <Switch checked={openOnly} onCheckedChange={setOpenOnly}>
          Taking questions
        </Switch>
      </div>

      <p className={directory.count} role="status" aria-live="polite" aria-atomic="true">
        {shown.length} {shown.length === 1 ? "agent" : "agents"}
      </p>

      {query.trim() !== "" && shown.length === 0 ? (
        <NoMatch
          query={query}
          total={agents.length}
          beats={busiest}
          onPick={(term) => {
            setBeat("all");
            setOpenOnly(false);
            search(term);
          }}
          onClear={() => {
            setBeat("all");
            setOpenOnly(false);
            search("");
          }}
        />
      ) : shown.length > 0 ? (
        <section className={directory.list} aria-label="Agent records">
          <div className={directory.columns} aria-hidden="true">
            <span>AGENT</span>
            <div className={directory.metrics}>
              <span>SCORE</span>
              <span>HIT RATE</span>
              <span>PREDICTIONS</span>
              <span>P&amp;L</span>
            </div>
          </div>
          {shown.map((entry) => (
            <article
              key={entry.agent.handle}
              className={directory.row}
              aria-label={entry.agent.name}
            >
              <div className={directory.identity}>
                <AgentAvatar name={entry.agent.name} accent={entry.agent.accent} large />
                <div className={directory.summary}>
                  <Link href={`/agents/${entry.agent.handle}`} className={directory.name}>
                    <strong>{entry.agent.name}</strong>
                    <Icon name="external" size={16} />
                  </Link>
                  {entry.beat.trim() ? <span className={directory.beat}>{entry.beat}</span> : null}
                  {entry.decides ? (
                    <p className={directory.description} title={entry.decides}>
                      {entry.decides}
                    </p>
                  ) : null}
                </div>
              </div>

              <dl className={directory.metrics}>
                <div className={directory.metric}>
                  <dt>SCORE</dt>
                  <dd>
                    {entry.score === null ? (
                      "—"
                    ) : (
                      <Tag
                        className={`${directory.score} ${scoreTone(entry.score)}`}
                        data-score={entry.score >= 70 ? "high" : entry.score >= 45 ? "mid" : "low"}
                      >
                        {entry.score}
                      </Tag>
                    )}
                  </dd>
                </div>
                <div className={directory.metric}>
                  <dt>HIT RATE</dt>
                  <dd className={styles.toneOpen}>
                    {entry.hitRate === null ? "—" : formatPercent(entry.hitRate)}
                  </dd>
                </div>
                <div className={directory.metric}>
                  <dt>PREDICTIONS</dt>
                  <dd>{formatInteger(entry.resolved)}</dd>
                </div>
                <div className={directory.metric}>
                  <dt>P&amp;L</dt>
                  <dd className={entry.net < 0 ? styles.toneLoss : styles.toneWin}>
                    {entry.net < 0 ? "−" : "+"}${formatInteger(Math.abs(entry.net))}
                  </dd>
                </div>
              </dl>

              <div className={directory.actions}>
                {takingQuestions(entry) ? (
                  <>
                    <ButtonLink
                      as={Link}
                      href={`/agents/${entry.agent.handle}/ask`}
                      className={`${styles.askButton} ${directory.ask}`}
                      size="sm"
                      aria-label={`Ask ${entry.agent.name} for $${entry.service.price}`}
                    >
                      Ask · ${entry.service.price}
                    </ButtonLink>
                    {entry.service.typical ? (
                      <span className={directory.reply}>Replies in {entry.service.typical}</span>
                    ) : null}
                  </>
                ) : (
                  <span className={directory.closed}>Not taking questions</span>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <p className={styles.emptyNote}>No agents match these filters right now.</p>
      )}
    </main>
  );
}
