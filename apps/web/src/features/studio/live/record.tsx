"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { RECORD_EMPTY, RECORD_META } from "./run-model";
import { closedRow, paperShown, recordView } from "./runtime-model";
import { Sparkline } from "./sparkline";
import styles from "./run.module.css";
import runtime from "./runtime.module.css";

/**
 * Record (canvas 264–283, spec L7). With the Perpl runtime off and no paper account: the head
 * with nothing closed and the empty line. With it on, or a paper account (R13): the paper equity line, the five figures from the record, and
 * the closed positions, newest first; the empty line stays until the first close.
 */
export const RecordSection: (props: LiveSectionProps) => ReactElement = ({ live, now }) => {
  const record = paperShown(live.record) ? live.record : null;
  const positions = live.positions && live.positions !== "failed" ? live.positions : null;
  const closed = positions?.closed ?? [];
  const view = record ? recordView(record) : null;

  return (
    <LiveSection section="record">
      <div className={styles.run}>
        <div className={styles.list} id="live-record-list">
          <div className={styles.listHead}>
            <h3 className={styles.listTitle}>Record</h3>
            <span className={styles.listMeta}>{view ? view.meta : RECORD_META}</span>
          </div>
          {view && (
            <>
              <div className={runtime.equity} id="live-record-equity">
                <div className={runtime.equityHead}>
                  <span className={runtime.equityLabel}>EQUITY · AUSD · PAPER</span>
                  <span className={runtime.equityMeta}>{view.equityHead}</span>
                </div>
                <div className={runtime.equityChart}>
                  <Sparkline trail={view.trail} up={view.up} />
                </div>
                <span className={styles.srOnly}>{view.trailText}</span>
              </div>
              <ul className={runtime.stats} aria-label="Its record">
                {view.stats.map((stat) => (
                  <li key={stat.key} className={runtime.stat}>
                    <span className={runtime.statValue} data-tone={stat.tone ?? undefined}>
                      {stat.value}
                    </span>
                    <span className={runtime.statLabel}>{stat.label}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {closed.length === 0 ? (
            <div className={styles.empty}>{RECORD_EMPTY}</div>
          ) : (
            <ul className={runtime.closed} id="live-record-closed">
              {closed.map((position) => {
                const row = closedRow(position, now);
                return (
                  <li key={row.id} className={runtime.closedRow}>
                    <span
                      className={runtime.closedDot}
                      data-tone={row.tone ?? undefined}
                      aria-hidden="true"
                    />
                    <span className={runtime.closedText}>
                      <span className={runtime.closedTitle}>{row.title}</span>
                      <span className={runtime.closedSub}>{row.sub}</span>
                    </span>
                    <span className={runtime.closedPnl} data-tone={row.tone ?? undefined}>
                      {row.pnl}
                    </span>
                    <span className={runtime.closedAt} suppressHydrationWarning>
                      {row.at}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </LiveSection>
  );
};
