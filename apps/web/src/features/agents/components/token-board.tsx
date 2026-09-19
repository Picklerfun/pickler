"use client";

import type { AgentSummaryDto } from "@pickler/api-schema";
import Link from "next/link";
import { Icon, Meter, Chip, Segmented, Input } from "@pickler/ui";
import { useMemo, useState } from "react";
import styles from "../agents.module.css";
import {
  boardSearch,
  SORTS,
  STAGES,
  VIEWS,
  type BoardFilters,
  type Sort,
  type StageFilter,
} from "../lib/board-filters";
import { formatChange, formatCompact, formatInteger } from "../lib/format";
import { AgentAvatar, CurveProgress, StageBadge, VenueMarks } from "./agent-parts";

const comparators: Record<Sort, (a: AgentSummaryDto, b: AgentSummaryDto) => number> = {
  Mcap: (a, b) => (b.token?.marketCap ?? 0) - (a.token?.marketCap ?? 0),
  Volume: (a, b) => (b.token?.volume24h ?? 0) - (a.token?.volume24h ?? 0),
  New: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
};

const stageLabel: Record<StageFilter, string> = {
  all: "ANY STAGE",
  "pre-graduation": "PRE-GRAD",
  graduated: "GRADUATED",
};

const pair = (agent: AgentSummaryDto) =>
  agent.token?.stage === "graduated" ? `${agent.ticker}/MON` : agent.ticker;
const cta = (agent: AgentSummaryDto) => (agent.token?.stage === "graduated" ? "TRADE" : "BACK IT");

// Filters live in the URL so a filtered board can be shared.
function writeUrl(filters: BoardFilters) {
  const search = boardSearch(filters);
  window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
}

export function TokenBoard({
  agents,
  initialFilters,
}: {
  agents: AgentSummaryDto[];
  initialFilters: BoardFilters;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const update = (patch: Partial<BoardFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    writeUrl(next);
  };

  const shown = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return agents
      .filter((a) => filters.stage === "all" || a.token?.stage === filters.stage)
      .filter((a) => !q || `${a.name} ${a.ticker} ${a.beat}`.toLowerCase().includes(q))
      .sort(comparators[filters.sort]);
  }, [agents, filters]);

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>TOKENS</p>
      <h1 className={styles.boardTitle}>EVERY AGENT TOKEN.</h1>
      <p className={styles.boardLead}>
        Every agent launches with a token. Buy it on the curve, or trade it in the pool once it
        graduates.
      </p>

      <div className={styles.filterCard}>
        <div className={styles.filterRow} role="group" aria-label="Token stage">
          {STAGES.map((stage) => (
            <Chip
              key={stage}
              className={styles.stageButton}
              selected={filters.stage === stage}
              onClick={() => update({ stage })}
            >
              {stageLabel[stage]}
              <span>
                {stage === "all"
                  ? agents.length
                  : agents.filter((a) => a.token?.stage === stage).length}
              </span>
            </Chip>
          ))}
        </div>
        <div className={`${styles.filterRow} ${styles.filterRowSplit}`}>
          <Input
            type="search"
            shape="pill"
            size="sm"
            className={styles.search}
            placeholder="search a name or a ticker…"
            aria-label="Search tokens"
            value={filters.query}
            onChange={(e) => update({ query: e.target.value })}
          />
          <span className={styles.filterLabel}>BEST BY</span>
          {SORTS.map((sort) => (
            <Chip
              key={sort}
              className={styles.sortButton}
              selected={filters.sort === sort}
              onClick={() => update({ sort })}
            >
              {sort.toUpperCase()}
            </Chip>
          ))}
          <Segmented
            label="Layout"
            className={styles.viewToggle}
            optionClassName={styles.viewButton}
            value={filters.view}
            onChange={(view) => update({ view })}
            options={VIEWS.map((view) => ({ value: view, label: view.toUpperCase() }))}
          />
        </div>
      </div>

      <p className={styles.resultCount} aria-live="polite">
        {shown.length} OF {agents.length} AGENT TOKENS
      </p>

      {shown.length === 0 ? (
        <p className={`${styles.panel} ${styles.empty}`}>No tokens match those filters.</p>
      ) : filters.view === "grid" ? (
        <ul className={styles.grid}>
          {shown.map((agent) => (
            <li key={agent.ticker}>
              <article className={styles.card}>
                <Link href={`/tokens/${agent.slug}`} className={styles.cardTop}>
                  <span className={styles.cardHead}>
                    <AgentAvatar name={agent.name} accent={agent.accent} />
                    <span className={styles.cardName}>
                      <strong>
                        {agent.name}
                        <StageBadge token={agent.token} />
                      </strong>
                      <span>{pair(agent)}</span>
                    </span>
                    <VenueMarks token={agent.token} />
                  </span>
                  <dl className={styles.cardStats}>
                    <div className={styles.cardStat}>
                      <dt>MCAP · MON</dt>
                      <dd>{agent.token ? formatCompact(agent.token.marketCap) : "—"}</dd>
                    </div>
                    <div className={styles.cardStat}>
                      <dt>VOL 24H · MON</dt>
                      <dd>{agent.token ? formatCompact(agent.token.volume24h) : "—"}</dd>
                    </div>
                  </dl>
                </Link>
                <div className={styles.cardFoot}>
                  {agent.token?.stage === "graduated" ? (
                    <span className={styles.curve}>
                      <span className={styles.curveLabel}>PRICE · 24H</span>
                      <strong
                        className={agent.token.change24h < 0 ? styles.toneLoss : styles.toneWin}
                      >
                        {formatChange(agent.token.change24h)}
                      </strong>
                      <Meter
                        value={Math.abs(agent.token.change24h) * 500}
                        tone={agent.token.change24h < 0 ? "magenta" : "lime"}
                      />
                    </span>
                  ) : agent.token ? (
                    <span className={styles.curve}>
                      <span className={styles.curveLabel}>
                        {formatInteger(agent.token.graduationTarget - agent.token.raised)} MON LEFT
                      </span>
                      <strong className={styles.toneCurve}>
                        {Math.round((agent.token.raised / agent.token.graduationTarget) * 100)}%
                      </strong>
                      <CurveProgress token={agent.token} bareBar />
                    </span>
                  ) : (
                    <span className={`${styles.curve} ${styles.curveNote}`}>
                      No token launched yet
                    </span>
                  )}
                  <Link href={`/tokens/${agent.slug}`} className={styles.cardCta}>
                    {cta(agent)} <Icon name="arrow" size={14} />
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.tableWrap}>
          <div className={`${styles.tableRow} ${styles.tableHead}`}>
            <span className={styles.tableMark} />
            <span className={styles.tableName}>AGENT</span>
            <span className={styles.tableStage}>STAGE</span>
            <span className={styles.tableNum}>MCAP</span>
            <span className={styles.tableNum}>VOL 24H</span>
            <span className={styles.tableCta} />
          </div>
          {shown.map((agent) => (
            <div key={agent.ticker} className={styles.tableRow}>
              <span className={styles.tableMark}>
                <AgentAvatar name={agent.name} accent={agent.accent} small />
              </span>
              <Link href={`/tokens/${agent.slug}`} className={styles.tableName}>
                <strong>{agent.name}</strong>
                <span>{pair(agent)}</span>
              </Link>
              <span className={styles.tableStage}>
                <StageBadge token={agent.token} />
              </span>
              <span className={styles.tableNum}>
                {agent.token ? formatCompact(agent.token.marketCap) : "—"}
              </span>
              <span className={styles.tableNum}>
                {agent.token ? formatCompact(agent.token.volume24h) : "—"}
              </span>
              <Link
                href={`/tokens/${agent.slug}`}
                className={`${styles.tableCta} ${styles.cardCta}`}
              >
                {cta(agent)} <Icon name="arrow" size={14} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
