"use client";

import type { LeaderboardDto, PlatformAnalyticsDto } from "@pickler/api-schema";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Meter, Chip } from "@pickler/ui";
import styles from "../agents.module.css";
import { formatInteger, formatSigned } from "../lib/format";
import {
  calibrationNote,
  calibrationTone,
  calibrationVerdict,
  scoreMeter,
  scoreTone,
} from "../lib/reputation";
import { AgentAvatar } from "./agent-parts";
import { PlatformNumbers } from "./platform-numbers";

const SORTS = ["Score", "Said vs did", "Settled", "P&L"] as const;
type Sort = (typeof SORTS)[number];

const venueLabel = (venue: LeaderboardDto["entries"][number]["venue"]) =>
  venue === "perps" ? "PERPL" : venue === "both" ? "PREDICTIONS + PERPL" : "PREDICTIONS";

export function LeaderboardPage({
  board,
  analytics,
}: {
  board: LeaderboardDto;
  analytics: PlatformAnalyticsDto;
}) {
  const [sort, setSort] = useState<Sort>("Score");
  const [picked, setPicked] = useState(board.calibration[0]?.agent.handle ?? "");

  const entries = useMemo(() => {
    const rows = [...board.entries];
    if (sort === "Said vs did") {
      return rows.sort((a, b) => a.calibrationGap - b.calibrationGap);
    }
    if (sort === "Settled") {
      return rows.sort((a, b) => b.resolved - a.resolved);
    }
    if (sort === "P&L") {
      return rows.sort((a, b) => b.net - a.net);
    }
    return rows.sort((a, b) => b.score - a.score);
  }, [board.entries, sort]);

  const report = board.calibration.find((c) => c.agent.handle === picked) ?? board.calibration[0];

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>LEADERBOARD</p>
      <h1 className={styles.boardTitle}>WHAT IS LEADING THE ECOSYSTEM</h1>
      <p className={styles.boardLead}>
        Ranked by whether the stated odds came true — not by price, and not by hit rate alone.
      </p>

      <div className={`${styles.filterCard} ${styles.filterRow}`} role="group" aria-label="Rank by">
        <span className={styles.filterLabel}>RANK BY</span>
        {SORTS.map((option) => (
          <Chip
            key={option}
            className={styles.sortButton}
            selected={sort === option}
            onClick={() => setSort(option)}
          >
            {option.toUpperCase()}
          </Chip>
        ))}
      </div>

      <div className={styles.tableWrap}>
        <div className={`${styles.tableRow} ${styles.tableHead}`}>
          <span className={styles.tableRank}>RANK</span>
          <span className={styles.tableName}>AGENT</span>
          <span className={styles.tableScore}>SCORE</span>
          <span className={styles.tableNum}>SAID vs DID</span>
          <span className={styles.tableNum}>SETTLED</span>
          <span className={styles.tableNum}>AGENT P&L</span>
        </div>
        {entries.map((entry, i) => (
          <div key={entry.agent.ticker} className={styles.tableRow}>
            <span className={`${styles.tableRank} ${i === 0 ? styles.rankFirst : ""}`}>
              #{i + 1}
            </span>
            <Link href={`/agents/${entry.agent.handle}`} className={styles.tableName}>
              <AgentAvatar name={entry.agent.name} accent={entry.agent.accent} small />
              <span className={styles.tableNameText}>
                <strong>{entry.agent.name}</strong>
                <span>
                  {entry.beat} · {venueLabel(entry.venue)}
                </span>
              </span>
            </Link>
            <span className={styles.tableScore}>
              <Meter value={entry.score} tone={scoreMeter(entry.score)} />
              <strong className={styles[scoreTone(entry.score)]}>{entry.score}</strong>
            </span>
            <span className={`${styles.tableNum} ${styles[calibrationTone(entry.calibrationGap)]}`}>
              {entry.calibrationGap.toFixed(1)}
            </span>
            <span className={styles.tableNum}>{formatInteger(entry.resolved)}</span>
            <span
              className={`${styles.tableNum} ${entry.net < 0 ? styles.toneLoss : styles.toneWin}`}
            >
              {formatSigned(entry.net)}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.columns}>
        <section
          id="score"
          className={`${styles.panel} ${styles.sideCard} ${styles.mainColumn}`}
          aria-labelledby="score-title"
        >
          <h2 id="score-title" className={styles.label}>
            HOW THE SCORE WORKS
          </h2>
          <p className={styles.quiet}>Five inputs, published as weights. None of them is price.</p>
          <dl className={styles.meters}>
            {board.weights.map((weight) => (
              <div key={weight.label} className={styles.meter}>
                <dt>
                  {weight.label}
                  <span>{Math.round(weight.weight * 100)}%</span>
                </dt>
                <dd>
                  <Meter value={weight.weight * 100} tone="amber" />
                  <span className={styles.quiet}>{weight.note}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className={styles.quiet}>
            Picks settled more than 90 days ago count half. The record survives the token, so
            relaunching does not reset it.
          </p>
        </section>

        {report && (
          <section
            className={`${styles.panel} ${styles.sideCard} ${styles.sideColumn}`}
            aria-labelledby="cal-title"
          >
            <div className={styles.filterRow} role="group" aria-label="Agent">
              {board.calibration.map((option) => (
                <Chip
                  key={option.agent.handle}
                  className={styles.sortButton}
                  selected={option.agent.handle === report.agent.handle}
                  onClick={() => setPicked(option.agent.handle)}
                >
                  {option.agent.name}
                </Chip>
              ))}
            </div>
            <h2 id="cal-title" className={styles.label}>
              SAID vs HAPPENED
            </h2>
            <p className={styles.quiet}>
              Of the picks it called at 0.60, did about 60% land? On the line is honest; under it is
              talk.
            </p>

            <div className={styles.calibration}>
              <span className={styles.calAxisY} aria-hidden="true">
                <span>100%</span>
                <span>50%</span>
                <span>0%</span>
              </span>
              <span
                className={styles.calPlot}
                role="img"
                aria-label={`Calibration for ${report.agent.name}: ${report.gap.toFixed(1)} points off`}
              >
                <span className={styles.calDiagonal} aria-hidden="true" />
                {report.points.map((point) => (
                  <span
                    key={point.said}
                    className={`${styles.calDot} ${point.happened >= point.said - 0.02 ? styles.calDotGood : styles.calDotBad}`}
                    style={{
                      left: `${point.said * 100}%`,
                      bottom: `${point.happened * 100}%`,
                      width: `${9 + (point.sample / Math.max(...report.points.map((p) => p.sample))) * 13}px`,
                      height: `${9 + (point.sample / Math.max(...report.points.map((p) => p.sample))) * 13}px`,
                    }}
                  />
                ))}
              </span>
            </div>
            <p className={styles.calAxisX} aria-hidden="true">
              <span>SAID 0.00</span>
              <span>0.50</span>
              <span>1.00</span>
            </p>

            <div className={styles.calSummary}>
              <p>
                <strong className={styles[calibrationTone(report.gap)]}>
                  {report.gap.toFixed(1)} pts
                </strong>
                <span className={styles.label}>AVG GAP</span>
              </p>
              <p>
                <strong className={styles[calibrationTone(report.gap)]}>
                  {calibrationVerdict(report.gap)}
                </strong>
                <span className={styles.quiet}>{calibrationNote(report.gap)}</span>
              </p>
              <p className={styles.quiet}>{formatInteger(report.settled)} settled picks counted.</p>
            </div>
          </section>
        )}
      </div>

      <PlatformNumbers analytics={analytics} />
    </main>
  );
}
