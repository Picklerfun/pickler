"use client";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PerpsClosedPositionsPageDto } from "@pickler/api-schema";
import { perpsClosedPositions } from "../api";
import { LiveSection, type LiveSectionProps } from "./live-section";
import { RECORD_EMPTY, RECORD_META } from "./run-model";
import { closedRow, paperShown, recordView } from "./runtime-model";
import { Sparkline } from "./sparkline";
import { PerplTradingRecord } from "../perpl-execution/execution";
import styles from "./run.module.css";
import runtime from "./runtime.module.css";

/**
 * Record (canvas 264–283, spec L7). With the Perpl runtime off and no paper account: the head
 * with nothing closed and the empty line. With it on, or a paper account (R13): the paper equity line, the five figures from the record, and
 * the closed positions, newest first; the empty line stays until the first close.
 */
export const RecordSection = (props: LiveSectionProps): ReactElement => (
  <AccountRecordSection key={props.agent.productId ?? props.agent.id} {...props} />
);

const AccountRecordSection: (props: LiveSectionProps) => ReactElement = ({
  live,
  agent,
  now,
  onSection,
}) => {
  const record = paperShown(live.record) ? live.record : null;
  const positions = live.positions && live.positions !== "failed" ? live.positions : null;
  const [older, setOlder] = useState<PerpsClosedPositionsPageDto["items"]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const closed = [
    ...new Map([...(positions?.closed ?? []), ...older].map((p) => [p.id, p])).values(),
  ];
  const next = cursor === undefined ? (positions?.closedNextCursor ?? null) : cursor;
  async function loadOlder() {
    if (!next || loading) {
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const page = await perpsClosedPositions(agent.productId ?? agent.id, next, controller.signal);
      if (!controller.signal.aborted) {
        // Keep the page that established this cursor. Live head refreshes may move a close
        // past the first-page boundary while the owner is reading older pages.
        setOlder((current) => [...(positions?.closed ?? []), ...current, ...page.items]);
        setCursor(page.nextCursor);
      }
    } catch {
      if (!controller.signal.aborted) {
        setFailed(true);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
      if (pending.current === controller) {
        pending.current = null;
      }
    }
  }
  const view = record ? recordView(record) : null;
  const meta =
    record?.projection?.complete === false ? "Updating record" : (view?.meta ?? RECORD_META);

  return (
    <LiveSection section="record">
      <div className={styles.run}>
        {(!live.preview || !!live.execution.state?.available) && (
          <PerplTradingRecord execution={live.execution} onControls={() => onSection("controls")} />
        )}
        {(record || (live.preview && !live.execution.state?.available)) && (
          <div className={styles.list} id="live-record-list">
            <div className={styles.listHead}>
              <h3 className={styles.listTitle}>
                {live.execution.state?.setupRequired === false ? "Paper record" : "Record"}
              </h3>
              <span className={styles.listMeta}>{meta}</span>
            </div>
            {record?.projection?.complete === false && (
              <p role="status">Record updating · financial history is retained.</p>
            )}
            {view && record?.projection?.complete !== false && (
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
            {positions?.closedHistoryReady === false ? (
              <p role="status">
                Closed history is being prepared. Your financial evidence is retained.
              </p>
            ) : closed.length === 0 ? (
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
            {next && (
              <button
                type="button"
                className={runtime.older}
                disabled={loading}
                onClick={() => void loadOlder()}
              >
                {loading ? "Loading…" : failed ? "Retry older closes" : "Show older closes"}
              </button>
            )}
            {failed && <p role="status">Could not load older closes. Your history is retained.</p>}
          </div>
        )}
      </div>
    </LiveSection>
  );
};
