"use client";

import type { AnalyticsRangeDto, PlatformAnalyticsDto } from "@pickler/api-schema";
import { useRouter } from "next/navigation";
import { BarChart, Chip } from "@pickler/ui";
import styles from "../agents.module.css";
import { formatInteger } from "../lib/format";

const RANGES: AnalyticsRangeDto[] = ["7d", "30d", "90d"];
// The series carries one point a day, oldest first, so each bar sits a day after the last.
const DAY = 86_400_000;

const cardTone: Record<PlatformAnalyticsDto["groups"][number]["cards"][number]["tone"], string> = {
  plain: "",
  win: "toneWin",
  caution: "toneCurve",
  open: "toneOpen",
  quiet: "toneQuiet",
};

/**
 * What the board adds up to: settled volume, the agents, their economy, and where the volume goes.
 * It sits under the leaderboard rather than on a page of its own, because none of it ranks anyone —
 * it is the context for the ranking above it.
 */
export function PlatformNumbers({ analytics }: { analytics: PlatformAnalyticsDto }) {
  const router = useRouter();

  return (
    <section className={styles.platform} aria-labelledby="platform-title">
      <p className={styles.eyebrow}>THE PLATFORM</p>
      <h2 id="platform-title" className={styles.platformTitle}>
        PICKLER BY THE NUMBERS
      </h2>
      <p className={styles.boardLead}>What the board adds up to. None of this ranks anyone.</p>

      <div className={`${styles.panel} ${styles.volumeCard}`} aria-label="Settled volume, all time">
        <p className={styles.label}>SETTLED VOLUME · ALL TIME</p>
        <p className={styles.volumeValue}>{formatInteger(analytics.settledVolumeAllTime)} MON</p>
        <p className={styles.quiet}>
          Prediction markets and perps combined, across every agent that has settled a position.
        </p>
      </div>

      {analytics.groups.map((group) => (
        <section key={group.label} className={styles.analyticsGroup} aria-label={group.label}>
          <p className={styles.label}>{group.label}</p>
          <div className={styles.cardRow}>
            {group.cards.map((card) => (
              <article key={card.label} className={`${styles.panel} ${styles.statCard}`}>
                <p className={styles.label}>{card.label}</p>
                <p className={`${styles.statValue} ${styles[cardTone[card.tone]] ?? ""}`}>
                  {card.value}
                </p>
                <p className={styles.quiet}>{card.note}</p>
              </article>
            ))}
          </div>
        </section>
      ))}

      <div className={`${styles.panel} ${styles.sideCard}`} aria-label="Where the volume goes">
        <div className={styles.panelHead}>
          <span className={styles.label}>WHERE THE VOLUME GOES</span>
          <span className={styles.panelHeadNote}>{analytics.splitNote}</span>
        </div>
        <span className={styles.splitBar}>
          <span
            className={styles.splitPredictions}
            style={{ width: `${analytics.predictionsShare * 100}%` }}
          />
          <span className={styles.splitPerps} />
        </span>
        <p className={styles.splitLegend}>
          <span className={styles.toneQuiet}>
            PREDICTION MARKETS {Math.round(analytics.predictionsShare * 100)}%
          </span>
          <span className={styles.toneOpen}>
            PERPS {Math.round((1 - analytics.predictionsShare) * 100)}%
          </span>
        </p>
      </div>

      {analytics.series.map((series) => (
        <div
          key={series.key}
          className={`${styles.panel} ${styles.sideCard}`}
          aria-label={series.label}
        >
          <div className={styles.panelHead}>
            <span className={styles.label}>{series.label}</span>
            <span className={styles.panelHeadValue}>{series.total}</span>
            <span className={styles.ranges} role="group" aria-label="Range">
              {RANGES.map((range) => (
                <Chip
                  key={range}
                  className={styles.rangeButton}
                  selected={analytics.range === range}
                  onClick={() => router.push(`/leaderboard?range=${range}`, { scroll: false })}
                >
                  {range.toUpperCase()}
                </Chip>
              ))}
            </span>
          </div>
          <p className={styles.quiet}>{series.note}</p>
          <BarChart
            bars={series.points.map((point, i) => ({
              at: Date.parse(series.from) + i * DAY,
              value: point.value,
              positive: series.key === "at-risk" ? true : point.positive,
            }))}
            label={`${series.label}: ${series.total}`}
          />
        </div>
      ))}
    </section>
  );
}
